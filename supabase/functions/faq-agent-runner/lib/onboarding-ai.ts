import { domainFromUrl } from '../../_shared/onboarding.ts';
import { withTransientRetry } from '../../_shared/retry.ts';
import { canonicalizeUrl } from '../../_shared/urlCanonicalization.ts';
import {
  isKnownUnscrapableUrl,
  UNSCRAPABLE_HOSTNAME_PATTERNS,
} from '../../_shared/unscrapableUrl.ts';
import { callClaudeForJson } from './json-tools.ts';
import { injectPromptVariables, loadPrompt } from './prompt-loader.ts';

const APIFY_SEARCH_ACTOR = 'apify/google-search-scraper';
const APIFY_CONTENT_ACTOR = 'apify/website-content-crawler';
const DIRECT_CRAWL_TIMEOUT_MS = 15_000;

// Appended to every SERP query as `-site:` operators so the most common
// directory / social / aggregator noise never enters the candidate pool.
// Capped at ~10 entries — Google silently ignores operators past that count,
// which previously caused *later* entries in the list to leak back in while
// simultaneously distorting the SERP composition (UK directory slots got
// freed and US results bubbled up). The full UNSCRAPABLE_HOSTNAME_PATTERNS
// list still runs post-fetch via filterUnscrapableFromQualification.
const SERP_QUERY_EXCLUDE_HOSTS: readonly string[] = [
  'facebook.com',
  'instagram.com',
  'yell.com',
  'yelp.com',
  'checkatrade.com',
  'trustatrader.com',
  'bark.com',
  'pinterest.com',
  'nextdoor.com',
  'mybuilder.com',
];
const SEARCH_EXCLUSION_OPERATORS = SERP_QUERY_EXCLUDE_HOSTS.map((host) => `-site:${host}`).join(
  ' ',
);

interface PromptContext {
  workspace_name: string;
  industry: string | null;
  service_area: string | null;
  business_type: string | null;
  workspace_domain?: string | null;
}

export interface SearchCandidate {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  discovery_query: string;
}

export interface QualifiedCandidate {
  url: string;
  domain: string;
  business_name: string;
  match_reason: string;
  relevance_score: number;
  discovery_query: string;
}

export interface RejectedCandidate {
  url: string;
  domain: string;
  business_name: string;
  reason: string;
}

export interface FetchedPage {
  url: string;
  title: string | null;
  content: string;
  content_length: number;
  structured_faqs?: FaqCandidate[];
}

export interface FaqCandidate {
  question: string;
  answer: string;
  source_url: string;
  evidence_quote: string;
  source_business?: string;
  quality_score: number;
  /**
   * Page-level classification emitted by the page-aware own-website
   * extractor (homepage, service, location, pricing, about, faq, contact,
   * blog, product, menu, policy, other). Optional because competitor
   * extraction and legacy JSON-LD structured FAQs don't populate it.
   * Persisted onto faq_database.page_type — null for any row that lacks it.
   */
  page_type?: string;
  /**
   * Coarse topical category Claude may emit (Services | Pricing | Policies |
   * Process | Coverage | Trust | General) for own-website FAQs. Typed as
   * `string` rather than a union so we pass through Claude output even when
   * it drifts slightly off-spec — buildFaqRows falls back to the caller's
   * default category when this is empty.
   */
  category?: string;
}

const WEBSITE_EXTRACTION_BATCH_SIZE = 1;
const WEBSITE_EXTRACTION_CONTENT_LIMIT = 8_000;
const DIRECTORY_DOMAIN_HINTS = [
  'checkatrade',
  'yell.',
  'trustatrader',
  'ratedpeople',
  'mybuilder',
  'bark.com',
  'houzz',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
];

function getApifyKey(): string {
  const apiKey = Deno.env.get('APIFY_API_KEY')?.trim() || Deno.env.get('APIFY_API_TOKEN')?.trim();
  if (!apiKey) {
    throw new Error('APIFY_API_KEY or APIFY_API_TOKEN not configured');
  }
  return apiKey;
}

function buildPromptContext(context: PromptContext): Record<string, string> {
  return {
    workspace_name: context.workspace_name,
    industry: context.industry || '',
    service_area: context.service_area || '',
    business_type: context.business_type || '',
    workspace_domain: context.workspace_domain || '',
  };
}

function normalizeWords(value: string | null | undefined): string[] {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

export function buildHeuristicCompetitorFallback(
  context: PromptContext,
  candidates: SearchCandidate[],
  targetCount: number,
): { approved: QualifiedCandidate[]; rejected: RejectedCandidate[] } {
  const businessTokens = normalizeWords(context.business_type);
  const locationTokens = normalizeWords(context.service_area);
  const workspaceDomain = String(context.workspace_domain || '').toLowerCase();

  const scored = candidates.map((candidate) => {
    const haystack =
      `${candidate.domain} ${candidate.title} ${candidate.snippet} ${candidate.discovery_query}`.toLowerCase();
    let score = 35;
    let rejectedReason: string | null = null;

    if (workspaceDomain && candidate.domain === workspaceDomain) {
      rejectedReason = 'Matches the workspace domain rather than a competitor';
    } else if (
      DIRECTORY_DOMAIN_HINTS.some(
        (hint) => candidate.domain.includes(hint) || haystack.includes(hint),
      )
    ) {
      rejectedReason =
        'Looks like a directory or marketplace result rather than an operating business';
    } else if (haystack.includes('directory') || haystack.includes('marketplace')) {
      rejectedReason = 'Looks like an aggregator rather than a local competitor';
    }

    const businessMatches = businessTokens.filter((token) => haystack.includes(token)).length;
    const locationMatches = locationTokens.filter((token) => haystack.includes(token)).length;

    score += businessMatches * 12;
    score += locationMatches * 8;
    if (haystack.includes('commercial')) score += 4;
    if (haystack.includes('residential')) score += 4;
    if (haystack.includes('services')) score += 3;
    if (candidate.domain.split('.').length <= 3) score += 2;

    if (!rejectedReason && businessMatches === 0) {
      rejectedReason = 'Service match was too weak to trust automatically';
    }

    return { candidate, score: Math.max(0, Math.min(100, score)), rejectedReason };
  });

  const approvedCandidates = scored
    .filter((item) => !item.rejectedReason)
    .sort((a, b) => b.score - a.score)
    .slice(0, targetCount)
    .map(
      ({ candidate, score }) =>
        ({
          url: candidate.url,
          domain: candidate.domain,
          business_name: candidate.title || candidate.domain,
          match_reason: 'Heuristic fallback selected this as a likely local service competitor.',
          relevance_score: score,
          discovery_query: candidate.discovery_query,
        }) satisfies QualifiedCandidate,
    );

  const approvedDomains = new Set(approvedCandidates.map((candidate) => candidate.domain));
  const rejectedCandidates = scored
    .filter((item) => item.rejectedReason || !approvedDomains.has(item.candidate.domain))
    .map(
      ({ candidate, rejectedReason }) =>
        ({
          url: candidate.url,
          domain: candidate.domain,
          business_name: candidate.title || candidate.domain,
          reason: rejectedReason || 'Lower-confidence result trimmed from the final competitor set',
        }) satisfies RejectedCandidate,
    );

  return {
    approved: approvedCandidates,
    rejected: rejectedCandidates,
  };
}

async function runApifyActor<T>(
  actor: string,
  input: Record<string, unknown>,
  timeoutSeconds = 120,
): Promise<T[]> {
  const apiKey = getApifyKey();
  const actorId = actor.includes('/') ? actor.replace('/', '~') : actor;
  const response = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiKey}&timeout=${timeoutSeconds}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Apify actor ${actorId} failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as T[];
}

function sameOriginUrl(candidate: string, origin: string): string | null {
  try {
    const parsed = new URL(candidate, origin);
    if (parsed.origin !== origin) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractLinksFromHtml(html: string, origin: string): string[] {
  const matches = html.matchAll(/href=["']([^"'#]+)["']/gi);
  const urls = new Set<string>();

  for (const match of matches) {
    const resolved = sameOriginUrl(match[1], origin);
    if (!resolved) continue;
    urls.add(resolved);
  }

  return Array.from(urls);
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSchemaTypes(value: unknown): string[] {
  if (typeof value === 'string') return [value.toLowerCase()];
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.toLowerCase());
  }
  return [];
}

function collectJsonLdNodes(input: unknown): Record<string, unknown>[] {
  if (!input) return [];

  if (Array.isArray(input)) {
    return input.flatMap((entry) => collectJsonLdNodes(entry));
  }

  if (typeof input !== 'object') return [];

  const node = input as Record<string, unknown>;
  const nested = Array.isArray(node['@graph']) ? collectJsonLdNodes(node['@graph']) : [];
  return [node, ...nested];
}

function extractStructuredFaqsFromHtml(html: string, sourceUrl: string): FaqCandidate[] {
  const structuredFaqs: FaqCandidate[] = [];
  const scriptMatches = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const match of scriptMatches) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const nodes = collectJsonLdNodes(parsed);
    for (const node of nodes) {
      const types = normalizeSchemaTypes(node['@type']);
      if (!types.includes('faqpage')) continue;

      const entities = Array.isArray(node.mainEntity) ? node.mainEntity : [];
      for (const entity of entities) {
        if (!entity || typeof entity !== 'object') continue;
        const questionNode = entity as Record<string, unknown>;
        const question = typeof questionNode.name === 'string' ? questionNode.name.trim() : '';
        const acceptedAnswer =
          questionNode.acceptedAnswer && typeof questionNode.acceptedAnswer === 'object'
            ? (questionNode.acceptedAnswer as Record<string, unknown>)
            : null;
        const answerText =
          typeof acceptedAnswer?.text === 'string' ? acceptedAnswer.text.trim() : '';

        if (!question || !answerText) continue;

        structuredFaqs.push({
          question,
          answer: answerText,
          source_url: sourceUrl,
          evidence_quote: answerText,
          quality_score: 0.98,
        });
      }
    }
  }

  return dedupeFaqCandidates(structuredFaqs);
}

async function fetchPageHtml(
  url: string,
): Promise<{ html: string; title: string | null; structuredFaqs: FaqCandidate[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DIRECT_CRAWL_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'BizzyBee own-site onboarding crawler',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Fetch failed for ${url} (${response.status})`);
    }

    const html = await response.text();
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const structuredFaqs = extractStructuredFaqsFromHtml(html, url);
    return {
      html,
      title: titleMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? null,
      structuredFaqs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverOwnWebsiteUrls(url: string, maxPages: number): Promise<string[]> {
  const origin = new URL(url).origin;
  const candidates = new Set<string>([new URL(url).toString()]);

  try {
    const sitemapResponse = await fetch(`${origin}/sitemap.xml`, {
      headers: { 'User-Agent': 'BizzyBee own-site onboarding crawler' },
    });
    if (sitemapResponse.ok) {
      const sitemapXml = await sitemapResponse.text();
      for (const match of sitemapXml.matchAll(/<loc>(.*?)<\/loc>/gi)) {
        const resolved = sameOriginUrl(match[1], origin);
        if (resolved) candidates.add(resolved);
        if (candidates.size >= maxPages * 3) break;
      }
    }
  } catch {
    // Sitemap fallback is best-effort only.
  }

  const homepage = await fetchPageHtml(new URL(url).toString());
  for (const link of extractLinksFromHtml(homepage.html, origin)) {
    candidates.add(link);
    if (candidates.size >= maxPages * 4) break;
  }

  return Array.from(candidates).slice(0, Math.max(maxPages, 1));
}

/**
 * Discover competitor candidates via Google Places Text Search, filtered
 * to operating businesses with a website. Replaces SERP as the primary
 * discovery source for any workspace where the business_type + towns are
 * known — see 2026-04-17 brief: "SERP returns directory/social noise
 * that drowns the real businesses; Places returns real businesses with
 * rating/review signal already baked in."
 *
 * Fans out across every town in `towns` (primary + user-retained nearby
 * towns from the radius-expansion chip row), so a 20-mile radius actually
 * gets covered — a single-town query only returns ~20 Places results
 * from the primary town itself, which is nowhere near enough.
 *
 * Algorithm:
 *   1. Text Search `"{business_type} in {town}, UK"` per town, in
 *      parallel. The ", UK" suffix is a crude but effective geo pin
 *      that avoids the Dunstable-MA class of false positives.
 *   2. Dedupe raw places by `place_id` (same business turning up under
 *      adjacent towns collapses) and also by `domain` (chains / multi-
 *      listed businesses).
 *   3. Rank by `rating × log(review_count + 1)` — treats a 5★ shop
 *      with 5 reviews as weaker than a 4.5★ shop with 200 reviews.
 *   4. Place Details per top-N to fetch `website` (legacy textsearch
 *      doesn't include it). Done for the top N only so we don't pay
 *      Details fees on low-ranked dross.
 *   5. Filter: must have website, website not in UNSCRAPABLE, domain
 *      not equal to workspace's own domain.
 *   6. Return up to targetCount candidates in rank order.
 *
 * Fails soft: returns `[]` if GOOGLE_MAPS_API_KEY is missing or every
 * town query errors, so callers can fall back to the SERP path without
 * extra branching.
 */
export async function searchCompetitorsViaPlaces(
  businessType: string,
  towns: string[],
  targetCount: number,
  workspaceDomain: string | null,
): Promise<SearchCandidate[]> {
  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY')?.trim();
  if (!apiKey) {
    console.warn('[searchCompetitorsViaPlaces] GOOGLE_MAPS_API_KEY missing — skipping Places path');
    return [];
  }
  const trimmedBusinessType = businessType?.trim();
  const cleanTowns = (towns ?? [])
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0);
  if (!trimmedBusinessType || cleanTowns.length === 0) {
    return [];
  }

  type Scored = {
    place: Record<string, unknown>;
    score: number;
    firstTown: string;
  };

  // Three query variants per town widens the candidate pool — single
  // "X in Y, UK" query hits Google's ~20-result cap per call, which
  // for a 20-town fan-out was still leaving us short at ~10 final
  // candidates. `near` and `best` catch businesses that rank
  // differently on the same town-level intent but index Places
  // tiebreak order differently. Dedupe by place_id across all three
  // variants collapses duplicates.
  const QUERY_VARIANTS: ReadonlyArray<(service: string, town: string) => string> = [
    (service, town) => `${service} in ${town}, UK`,
    (service, town) => `${service} near ${town}, UK`,
    (service, town) => `best ${service} ${town} UK`,
  ];

  const townVariantPairs = cleanTowns.flatMap((town) =>
    QUERY_VARIANTS.map((buildQuery) => ({ town, query: buildQuery(trimmedBusinessType, town) })),
  );

  // Per-(town, variant) text search, parallel. Each call contributes up
  // to ~20 raw Places results. Errors in one call don't fail the run.
  const perCall = await Promise.all(
    townVariantPairs.map(async ({ town, query }) => {
      const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
      url.searchParams.set('query', query);
      url.searchParams.set('region', 'uk');
      url.searchParams.set('key', apiKey);
      try {
        const response = await fetch(url.toString());
        const data = (await response.json()) as {
          status?: string;
          results?: unknown[];
          error_message?: string;
        };
        if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
          console.warn(
            '[searchCompetitorsViaPlaces] textsearch failed for query',
            query,
            data.status,
            data.error_message,
          );
          return { town, results: [] as Array<Record<string, unknown>> };
        }
        const results = Array.isArray(data.results)
          ? (data.results as Array<Record<string, unknown>>)
          : [];
        return { town, results };
      } catch (error) {
        console.warn('[searchCompetitorsViaPlaces] textsearch threw for query', query, error);
        return { town, results: [] as Array<Record<string, unknown>> };
      }
    }),
  );

  // Dedupe by place_id across towns+variants. When the same business
  // shows up for multiple towns/variants we keep the first occurrence
  // (which will be the nearest town + "in" variant because
  // townVariantPairs is built town-outer, variant-inner with towns in
  // primary-first, nearest-first order).
  const byPlaceId = new Map<string, Scored>();
  for (const { town, results } of perCall) {
    for (const place of results) {
      const placeId = typeof place.place_id === 'string' ? place.place_id : null;
      if (!placeId) continue;
      if (byPlaceId.has(placeId)) continue;
      const rating = typeof place.rating === 'number' ? place.rating : 0;
      const reviews = typeof place.user_ratings_total === 'number' ? place.user_ratings_total : 0;
      byPlaceId.set(placeId, {
        place,
        score: rating * Math.log(reviews + 1),
        firstTown: town,
      });
    }
  }

  // Rank by (rating × log(reviews + 1)). Keep roughly 2× targetCount so
  // Details lookups that return no website still leave us a pool big
  // enough to hit targetCount.
  const ranked = Array.from(byPlaceId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(targetCount * 2, 15));

  const detailsUrl = 'https://maps.googleapis.com/maps/api/place/details/json';
  const withWebsites = await Promise.all(
    ranked.map(async (entry) => {
      const placeId = typeof entry.place.place_id === 'string' ? entry.place.place_id : null;
      if (!placeId) return null;
      try {
        const u = new URL(detailsUrl);
        u.searchParams.set('place_id', placeId);
        u.searchParams.set('fields', 'website,name,formatted_address');
        u.searchParams.set('key', apiKey);
        const resp = await fetch(u.toString());
        const data = (await resp.json()) as { status?: string; result?: Record<string, unknown> };
        if (data.status !== 'OK' || !data.result) return null;
        const website = typeof data.result.website === 'string' ? data.result.website : null;
        if (!website) return null;
        return { ...entry, website };
      } catch (error) {
        console.warn('[searchCompetitorsViaPlaces] details fetch failed', placeId, error);
        return null;
      }
    }),
  );

  const candidates: SearchCandidate[] = [];
  const seenDomains = new Set<string>();
  for (const entry of withWebsites) {
    if (!entry) continue;
    if (isKnownUnscrapableUrl(entry.website)) continue;
    const domain = domainFromUrl(entry.website);
    if (!domain) continue;
    if (workspaceDomain && domain === workspaceDomain) continue;
    if (seenDomains.has(domain)) continue;
    seenDomains.add(domain);

    const name = typeof entry.place.name === 'string' ? entry.place.name : domain;
    const address =
      typeof entry.place.formatted_address === 'string' ? entry.place.formatted_address : '';
    const rating = typeof entry.place.rating === 'number' ? entry.place.rating : 0;
    const reviews =
      typeof entry.place.user_ratings_total === 'number' ? entry.place.user_ratings_total : 0;

    candidates.push({
      url: entry.website,
      domain,
      title: name,
      snippet: `${rating}★ (${reviews} reviews) — ${address}`,
      discovery_query: `places:${trimmedBusinessType} in ${entry.firstTown}`,
    });
    if (candidates.length >= targetCount) break;
  }

  return candidates;
}

// crawlWebsitePagesDirect (fetch + stripHtmlToText) intentionally removed:
// it was a cheerio-equivalent raw-HTML path that silently failed on
// JS-rendered / Cloudflare-protected sites. crawlWebsitePages now routes
// 100% through Apify's website-content-crawler (playwright) — same path
// as competitor scraping — matching the original n8n behaviour.

export async function searchCompetitorCandidates(
  searchQueries: string[],
  targetCount: number,
): Promise<SearchCandidate[]> {
  // Parallelised: each Apify google-search call is an independent network
  // round-trip (~15-60s server-side). Running them sequentially made discovery
  // take 3-5x longer than necessary. Promise.all is safe because we dedupe by
  // URL below. Apify allows per-account concurrency; a handful of simultaneous
  // google-search actor runs is well within limits.
  const perQueryResults = await Promise.all(
    searchQueries.map(async (query) => {
      try {
        const items = await runApifyActor<Record<string, unknown>>(APIFY_SEARCH_ACTOR, {
          queries: `${query} ${SEARCH_EXCLUSION_OPERATORS}`,
          maxPagesPerQuery: 1,
          resultsPerPage: Math.min(Math.max(targetCount, 10), 25),
          mobileResults: false,
          languageCode: 'en',
        });
        return { query, items };
      } catch (err) {
        console.warn('[searchCompetitorCandidates] Apify actor failed for query', query, err);
        return { query, items: [] };
      }
    }),
  );

  // Dedup by canonical URL — collapses http/https, leading www./m., trailing
  // slash, hash fragments, and hostname case so variants of the same page
  // from different search queries don't pollute the candidate list.
  const resultsByCanonicalUrl = new Map<string, SearchCandidate>();
  for (const { query, items } of perQueryResults) {
    for (const item of items) {
      const organicResults = Array.isArray(item.organicResults)
        ? (item.organicResults as Array<Record<string, unknown>>)
        : [];

      for (const result of organicResults) {
        const url =
          typeof result.url === 'string'
            ? result.url
            : typeof result.link === 'string'
              ? result.link
              : '';
        if (!url) continue;
        const canonical = canonicalizeUrl(url);
        if (!canonical) continue;
        const domain = domainFromUrl(url);
        if (!domain) continue;

        const candidate: SearchCandidate = {
          url,
          domain,
          title: typeof result.title === 'string' ? result.title : domain,
          snippet:
            typeof result.description === 'string'
              ? result.description
              : typeof result.snippet === 'string'
                ? result.snippet
                : '',
          discovery_query: query,
        };

        if (!resultsByCanonicalUrl.has(canonical)) {
          resultsByCanonicalUrl.set(canonical, candidate);
        }
      }
    }
  }

  return Array.from(resultsByCanonicalUrl.values()).slice(
    0,
    Math.max(targetCount * 3, targetCount),
  );
}

export type QualificationFallbackReason = 'none' | 'claude_empty' | 'claude_error';

export interface QualificationResult {
  approved: QualifiedCandidate[];
  rejected: RejectedCandidate[];
  /**
   * Why (if at all) we fell back from Claude's LLM qualification to the
   * heuristic scoring path. Callers should log + record this on the step so
   * operators can distinguish "Claude ran and approved these" from "Claude
   * broke and we silently substituted heuristic scores" — previously those
   * two paths produced identical results with no visibility into which was
   * taken.
   */
  fallback_reason: QualificationFallbackReason;
  claude_error?: string;
}

export async function qualifyCompetitorCandidates(
  apiKey: string,
  model: string,
  context: PromptContext,
  candidates: SearchCandidate[],
  targetCount: number,
): Promise<QualificationResult> {
  const template = await loadPrompt('competitor-qualification.md');
  const systemPrompt = injectPromptVariables(template, buildPromptContext(context));
  const userPrompt = JSON.stringify(
    {
      target_count: targetCount,
      candidates,
    },
    null,
    2,
  );

  try {
    const result = await callClaudeForJson(apiKey, {
      systemPrompt,
      userPrompt,
      model,
      maxTokens: 3000,
    });

    if (!result || !Array.isArray(result.approved) || result.approved.length === 0) {
      console.warn(
        '[competitor-qualification] Claude returned no approved competitors, falling back to heuristics',
      );
      const fallback = buildHeuristicCompetitorFallback(context, candidates, targetCount);
      return filterUnscrapableFromQualification({
        ...fallback,
        fallback_reason: 'claude_empty',
      });
    }

    return filterUnscrapableFromQualification({ ...result, fallback_reason: 'none' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      '[competitor-qualification] Falling back to heuristic qualification after Claude error',
      message,
    );
    const fallback = buildHeuristicCompetitorFallback(context, candidates, targetCount);
    return filterUnscrapableFromQualification({
      ...fallback,
      fallback_reason: 'claude_error',
      claude_error: message,
    });
  }
}

/**
 * Move any approved competitor whose URL matches a known-unscrapable pattern
 * (facebook, yelp, google.com/maps, etc.) into the rejected list with a
 * clear reason. Claude sometimes rubber-stamps social profiles that look
 * like real businesses — by the time fetch_pages sees them they waste an
 * Apify slot that will 100% fail. Catching them here means the review
 * screen shows them in the rejected panel with a sensible explanation
 * instead of confusing the user when the scrape produces no FAQs for them.
 */
function filterUnscrapableFromQualification(result: QualificationResult): QualificationResult {
  const stillApproved: QualifiedCandidate[] = [];
  const extraRejected: RejectedCandidate[] = [];

  for (const candidate of result.approved) {
    if (isKnownUnscrapableUrl(candidate.url)) {
      extraRejected.push({
        url: candidate.url,
        domain: candidate.domain,
        business_name: candidate.business_name,
        reason: 'Social / directory URL — site is not scrapable for competitor FAQs',
      });
      continue;
    }
    stillApproved.push(candidate);
  }

  if (extraRejected.length > 0) {
    console.warn('[competitor-qualification] dropped unscrapable URLs from approved list', {
      dropped: extraRejected.length,
      urls: extraRejected.map((r) => r.url),
    });
  }

  return {
    ...result,
    approved: stillApproved,
    rejected: [...result.rejected, ...extraRejected],
  };
}

export async function crawlWebsitePages(url: string, maxPages = 8): Promise<FetchedPage[]> {
  // Unified on Apify website-content-crawler / playwright for both
  // competitor scrape (fetch-source-page.ts) and own-website scrape
  // (this function). A single URL becomes up to maxPages pages crawled
  // within the same domain. Previously this path tried a raw-HTML "direct"
  // crawl first, then fell back to cheerio via Apify — both of which
  // silently dropped JS- and Cloudflare-rendered sites. Playwright handles
  // those, which is what the original n8n workflow relied on.
  const items = await runApifyActor<Record<string, unknown>>(APIFY_CONTENT_ACTOR, {
    startUrls: [{ url }],
    maxCrawlPages: maxPages,
    crawlerType: 'playwright:chrome',
    sameDomainDelaySecs: 0,
    removeCookieWarnings: true,
    includeUrlGlobs: [`${new URL(url).origin}/**`],
  });

  const apifyPages = items
    .map((item) => {
      const pageUrl = typeof item.url === 'string' ? item.url : '';
      const markdown = typeof item.markdown === 'string' ? item.markdown : '';
      const text = markdown || (typeof item.text === 'string' ? item.text : '');
      if (!pageUrl || !text.trim()) return null;

      return {
        url: pageUrl,
        title: typeof item.title === 'string' ? item.title : null,
        content: text.slice(0, 30000),
        content_length: text.length,
      } satisfies FetchedPage;
    })
    .filter((item): item is FetchedPage => Boolean(item));

  return apifyPages;
}

/**
 * Derive the bare hostname from a page URL (strips `www.`). Falls back to
 * the raw URL string if the input fails to parse — the prompt tolerates
 * either (the `{{domain}}` placeholder is only used for context framing).
 */
function deriveDomainFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return rawUrl;
  }
}

/**
 * Page-aware own-website FAQ extraction. Processes exactly ONE page per
 * call — the prompt instructs Claude to classify the page type first, then
 * only emit FAQs that are DISTINCTIVE to that page (so the location-page
 * duplication problem from the 2026-04-16 MAC Cleaning audit stops at the
 * prompt layer rather than relying on downstream fingerprint dedup alone).
 *
 * `options.singlePageSite` toggles the dedup-skipping branch: on a site
 * with ≤3 discovered pages there are no other pages to defer facts to, so
 * Claude is told to extract everything useful from this page. Callers
 * compute this once per run from pages.length and thread it through.
 */
export async function extractWebsiteFaqs(
  apiKey: string,
  model: string,
  context: PromptContext,
  page: FetchedPage,
  options: { singlePageSite: boolean },
): Promise<{ faqs: FaqCandidate[] }> {
  const template = await loadPrompt('website-faq-extraction.md');
  const domain = deriveDomainFromUrl(page.url);
  const systemPrompt = injectPromptVariables(template, {
    business_name: context.workspace_name,
    business_type: context.business_type || '',
    domain,
    page_url: page.url,
    single_page_site: options.singlePageSite ? 'true' : 'false',
    page_content: page.content,
  });

  // The page content lives in the system prompt now, so the user prompt is
  // just a nudge to produce output. Everything the model needs to reason
  // about is already in the system message above.
  const userPrompt = 'Extract now.';

  return await callClaudeForJson(apiKey, {
    systemPrompt,
    userPrompt,
    model,
    maxTokens: 4000,
  });
}

function normalizeFaqKey(faq: FaqCandidate): string {
  return `${faq.question}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

function dedupeFaqCandidates(faqs: FaqCandidate[]): FaqCandidate[] {
  const byQuestion = new Map<string, FaqCandidate>();

  for (const faq of faqs) {
    const question = faq.question?.trim();
    const answer = faq.answer?.trim();
    const sourceUrl = faq.source_url?.trim();
    const evidenceQuote = faq.evidence_quote?.trim();

    if (!question || !answer || !sourceUrl || !evidenceQuote) continue;

    const candidate: FaqCandidate = {
      ...faq,
      question,
      answer,
      source_url: sourceUrl,
      evidence_quote: evidenceQuote,
      quality_score: Number.isFinite(faq.quality_score) ? faq.quality_score : 0,
    };

    const key = normalizeFaqKey(candidate);
    const existing = byQuestion.get(key);
    if (!existing || candidate.quality_score > existing.quality_score) {
      byQuestion.set(key, candidate);
    }
  }

  return Array.from(byQuestion.values()).sort((a, b) => b.quality_score - a.quality_score);
}

function chunkPagesForExtraction(pages: FetchedPage[]): FetchedPage[][] {
  const chunks: FetchedPage[][] = [];
  for (let index = 0; index < pages.length; index += WEBSITE_EXTRACTION_BATCH_SIZE) {
    chunks.push(pages.slice(index, index + WEBSITE_EXTRACTION_BATCH_SIZE));
  }
  return chunks;
}

function normalizeFaqCollection(
  value: unknown,
  preferredKey: 'faqs' | 'candidates',
): FaqCandidate[] {
  if (Array.isArray(value)) {
    return dedupeFaqCandidates(value as FaqCandidate[]);
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const preferred = record[preferredKey];
  if (Array.isArray(preferred)) {
    return dedupeFaqCandidates(preferred as FaqCandidate[]);
  }

  const faqs = record.faqs;
  if (Array.isArray(faqs)) {
    return dedupeFaqCandidates(faqs as FaqCandidate[]);
  }

  const candidates = record.candidates;
  if (Array.isArray(candidates)) {
    return dedupeFaqCandidates(candidates as FaqCandidate[]);
  }

  return [];
}

export async function extractWebsiteFaqsInChunks(
  apiKey: string,
  model: string,
  context: PromptContext,
  pages: FetchedPage[],
  onProgress?: (progress: {
    batchIndex: number;
    batchCount: number;
    pagesInBatch: number;
    candidateCount: number;
    totalCandidateCount: number;
  }) => Promise<void> | void,
  options?: { finalLimit?: number },
): Promise<{ faqs: FaqCandidate[]; batchCount: number }> {
  // `finalLimit` caps the number of candidates returned after dedupe.
  // Default 15 matches the original own-site single-site limit. Competitor
  // runs pass a higher cap (e.g. 60) because each competitor site
  // independently contributes 6–15 candidates and the finalizer, not this
  // slice, is the choke-point for the final user-facing FAQ set.
  const finalLimit = options?.finalLimit ?? 15;
  const chunks = chunkPagesForExtraction(pages);
  const structuredFaqs = dedupeFaqCandidates(
    pages.flatMap((page) => page.structured_faqs || []).slice(0, 24),
  );
  const collected: FaqCandidate[] = [...structuredFaqs];

  if (structuredFaqs.length >= 6) {
    return {
      faqs: structuredFaqs.slice(0, finalLimit),
      batchCount: 0,
    };
  }

  // Per-batch retry scope — NOT per-function. Previously the entire
  // extractWebsiteFaqsInChunks was wrapped in withTransientRetry at the
  // caller, so any single batch throwing a 429/5xx restarted the loop
  // from batch 0 — users saw "AI pass 9 of 12" reset to "pass 1 of 12"
  // with no useful signal. Now each batch gets its own retry; if the
  // retry exhausts, we log the batch as skipped and carry on. Losing
  // one batch (~10% of candidates) is far better than losing all 12.
  //
  // Single-page-site gating is computed once from the full page set so the
  // same boolean is passed to every batch's Claude call — matches the
  // per-batch runner path in onboarding-website-runner.ts.
  const singlePageSite = pages.length <= 3;
  let skippedBatches = 0;
  for (let batchIndex = 0; batchIndex < chunks.length; batchIndex += 1) {
    const chunk = chunks[batchIndex].map((page) => ({
      ...page,
      content: page.content.slice(0, WEBSITE_EXTRACTION_CONTENT_LIMIT),
      content_length: Math.min(page.content_length, WEBSITE_EXTRACTION_CONTENT_LIMIT),
    }));

    let candidates: FaqCandidate[] = [];
    try {
      // WEBSITE_EXTRACTION_BATCH_SIZE is 1, so chunk[0] is the sole page
      // for this batch. The new extractWebsiteFaqs signature takes one
      // page at a time — chunks here only exist to mirror the legacy
      // progress reporting shape.
      const pageForBatch = chunk[0];
      if (!pageForBatch) continue;
      const extracted = await withTransientRetry(
        () => extractWebsiteFaqs(apiKey, model, context, pageForBatch, { singlePageSite }),
        { attempts: 3, baseMs: 500, maxMs: 10_000 },
      );
      candidates = Array.isArray(extracted?.faqs) ? extracted.faqs : [];
    } catch (err) {
      skippedBatches += 1;
      console.warn('[extractWebsiteFaqsInChunks] batch failed after retries — skipping', {
        batch_index: batchIndex + 1,
        batch_count: chunks.length,
        pages_in_batch: chunk.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    collected.push(...candidates);

    if (onProgress) {
      await onProgress({
        batchIndex: batchIndex + 1,
        batchCount: chunks.length,
        pagesInBatch: chunk.length,
        candidateCount: candidates.length,
        totalCandidateCount: collected.length,
      });
    }
  }

  if (skippedBatches > 0) {
    console.warn('[extractWebsiteFaqsInChunks] completed with skipped batches', {
      skipped: skippedBatches,
      batch_count: chunks.length,
      final_candidate_count: collected.length,
    });
  }

  return {
    faqs: dedupeFaqCandidates(collected).slice(0, finalLimit),
    batchCount: chunks.length,
  };
}

export async function extractCompetitorFaqCandidates(
  apiKey: string,
  model: string,
  context: PromptContext,
  pages: Array<FetchedPage & { source_business?: string }>,
): Promise<{ candidates: FaqCandidate[] }> {
  const template = await loadPrompt('faq-extraction.md');
  const systemPrompt = injectPromptVariables(template, buildPromptContext(context));
  const userPrompt = JSON.stringify({ pages }, null, 2);

  const response = await callClaudeForJson<unknown>(apiKey, {
    systemPrompt,
    userPrompt,
    model,
    maxTokens: 4000,
  });

  return {
    candidates: normalizeFaqCollection(response, 'candidates'),
  };
}

export async function finalizeFaqCandidates(
  apiKey: string,
  model: string,
  context: PromptContext,
  candidates: FaqCandidate[],
  existingQuestions: string[],
): Promise<{ faqs: FaqCandidate[] }> {
  const systemPrompt = `You are BizzyBee's FAQ finalizer for the competitor-research stream.

You are finalizing FAQ candidates that were extracted from COMPETITOR websites.
These FAQs will be added to the user's own knowledge base alongside FAQs
extracted from their own website.

Return valid JSON only.

Select the strongest final FAQ set for:
- Workspace: ${context.workspace_name}
- Industry: ${context.industry || ''}
- Service area: ${context.service_area || ''}
- Business type: ${context.business_type || ''}

INVARIANT — user's own website is the source of truth:
The user's own website is the source of truth for pricing, services,
geography, guarantees, insurance, and voice. You MUST NOT let
competitor-specific claims leak into the user's knowledge base.

For each candidate, ask:
1. Is the QUESTION one a customer might reasonably ask the USER's business? (If yes → keep; if no → drop.)
2. Does the ANSWER contain competitor-specific facts (their exact pricing, their exact product names, their exact guarantees, their exact geography)? (If yes → rewrite in generic terms OR drop the FAQ.)

REWRITE rules:
- Strip competitor brand names. "At Acme Cleaning we offer..." → "We offer...".
- Generalise competitor-specific pricing. "Acme charges £18 per visit" → either drop, or generalise to "Window cleaning for a typical 3-bed semi is usually £15–£25" only IF a reasonable industry-standard range is clearly supported across multiple competitor sources.
- Drop competitor-specific claims that contradict the user's declared services or business_type.
- Never promise a service on the user's behalf that only appears in a competitor source.
- Use the user's voice: first person ("we", "our", "us"), short sentences, no marketing fluff.

EXISTING rules (retained):
- Prefer fewer strong FAQs over many weak ones.
- Do not return duplicates of existing FAQ questions (user-site FAQs).
- Keep only clearly grounded, customer-helpful FAQs.
- Do not include unsupported or speculative claims.
- Return no more than 15 FAQs.`;

  const userPrompt = JSON.stringify(
    {
      existing_questions: existingQuestions,
      candidates,
    },
    null,
    2,
  );

  const response = await callClaudeForJson<unknown>(apiKey, {
    systemPrompt,
    userPrompt,
    model,
    maxTokens: 3000,
  });

  return {
    faqs: normalizeFaqCollection(response, 'faqs'),
  };
}

export async function dedupeOwnWebsiteFaqsAcrossBatches(
  apiKey: string,
  model: string,
  context: PromptContext,
  candidates: FaqCandidate[],
): Promise<{ faqs: FaqCandidate[] }> {
  if (candidates.length === 0) return { faqs: [] };

  const systemPrompt = `You are BizzyBee's own-website FAQ deduplicator.

Return valid JSON only in the exact shape:
{ "faqs": [ { "question": "...", "answer": "...", "source_url": "...", "evidence_quote": "...", "quality_score": 0.0, "source_business": "..." }, ... ] }

CONTEXT
- Workspace: ${context.workspace_name}
- Industry: ${context.industry || ''}
- Service area: ${context.service_area || ''}
- Business type: ${context.business_type || ''}

INPUT
You receive a list of FAQ candidates extracted independently from different pages of this workspace's own website. Each batch processed one page without knowing what other batches produced, so the SAME question often appears multiple times with slightly different wording.

YOUR JOB
Identify groups of duplicate / near-duplicate questions and return a single deduplicated list.

RULES
1. Keep ONE FAQ per distinct topic — pick the version with the clearest question and best-grounded answer (prefer ones with highest quality_score, strongest evidence_quote, most specific numbers).
2. PRESERVE genuinely-distinct FAQs even when they share keywords. Examples of questions that must NOT be merged:
   - "How much does window cleaning cost in Luton?" vs "How much does window cleaning cost in Dunstable?" — different locations, different pricing.
   - "How much does fascia cleaning cost?" vs "How much does gutter clearing cost?" — different services.
   - "How long does a fascia clean take?" vs "How long does a conservatory roof clean take?" — different services.
3. DO merge these patterns (examples):
   - "Do I need to be home for my window clean?" / "Do I need to be home when MAC Cleaning cleans my windows?" / "Do I need to be home when MAC Cleaning visits?" → keep one.
   - "What is included in a standard window clean?" / "What is included in every window clean?" / "What exactly is included in a standard window clean?" → keep one.
   - Questions about the same topic asked from different pages (home page vs blog vs location page) where the underlying answer is identical.
4. Do NOT invent new FAQs. Do NOT modify question/answer/source_url/evidence_quote/quality_score text. Copy the winning candidate's fields verbatim.
5. No maximum count — return as many FAQs as there are distinct topics. For a 89-candidate input with ~15 duplicate groups, expect ~70-75 output FAQs.
6. If a candidate has missing/empty question/answer/source_url/evidence_quote, drop it.`;

  const userPrompt = JSON.stringify({ candidates }, null, 2);

  const response = await callClaudeForJson<unknown>(apiKey, {
    systemPrompt,
    userPrompt,
    model,
    maxTokens: 16000, // 89 FAQs × ~150 tokens each = ~13k; 16k provides headroom
  });

  return {
    faqs: normalizeFaqCollection(response, 'faqs'),
  };
}
