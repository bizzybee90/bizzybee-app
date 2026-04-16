import { domainFromUrl } from '../../_shared/onboarding.ts';
import { canonicalizeUrl } from '../../_shared/urlCanonicalization.ts';
import { callClaudeForJson } from './json-tools.ts';
import { injectPromptVariables, loadPrompt } from './prompt-loader.ts';

const APIFY_SEARCH_ACTOR = 'apify/google-search-scraper';
const APIFY_CONTENT_ACTOR = 'apify/website-content-crawler';
const DIRECT_CRAWL_TIMEOUT_MS = 15_000;

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

async function crawlWebsitePagesDirect(url: string, maxPages = 8): Promise<FetchedPage[]> {
  const urls = await discoverOwnWebsiteUrls(url, maxPages);
  const pages = await Promise.all(
    urls.slice(0, maxPages).map(async (pageUrl) => {
      try {
        const { html, title, structuredFaqs } = await fetchPageHtml(pageUrl);
        const text = stripHtmlToText(html).slice(0, 30000);
        if (!text.trim()) return null;

        return {
          url: pageUrl,
          title,
          content: text,
          content_length: text.length,
          structured_faqs: structuredFaqs,
        } satisfies FetchedPage;
      } catch {
        return null;
      }
    }),
  );

  return pages.filter((item): item is FetchedPage => Boolean(item));
}

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
          queries: query,
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
      return { ...fallback, fallback_reason: 'claude_empty' };
    }

    return { ...result, fallback_reason: 'none' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      '[competitor-qualification] Falling back to heuristic qualification after Claude error',
      message,
    );
    const fallback = buildHeuristicCompetitorFallback(context, candidates, targetCount);
    return { ...fallback, fallback_reason: 'claude_error', claude_error: message };
  }
}

export async function crawlWebsitePages(url: string, maxPages = 8): Promise<FetchedPage[]> {
  const directPages = await crawlWebsitePagesDirect(url, maxPages).catch(() => []);
  if (directPages.length >= Math.min(3, maxPages)) {
    return directPages;
  }

  const items = await runApifyActor<Record<string, unknown>>(APIFY_CONTENT_ACTOR, {
    startUrls: [{ url }],
    maxCrawlPages: maxPages,
    crawlerType: 'cheerio',
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

  return apifyPages.length > 0 ? apifyPages : directPages;
}

export async function extractWebsiteFaqs(
  apiKey: string,
  model: string,
  context: PromptContext,
  pages: FetchedPage[],
): Promise<{ faqs: FaqCandidate[] }> {
  const template = await loadPrompt('website-faq-extraction.md');
  const systemPrompt = injectPromptVariables(template, buildPromptContext(context));
  const userPrompt = JSON.stringify({ pages }, null, 2);

  return await callClaudeForJson(apiKey, {
    systemPrompt,
    userPrompt,
    model,
    maxTokens: 2200,
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
): Promise<{ faqs: FaqCandidate[]; batchCount: number }> {
  const chunks = chunkPagesForExtraction(pages);
  const structuredFaqs = dedupeFaqCandidates(
    pages.flatMap((page) => page.structured_faqs || []).slice(0, 24),
  );
  const collected: FaqCandidate[] = [...structuredFaqs];

  if (structuredFaqs.length >= 6) {
    return {
      faqs: structuredFaqs.slice(0, 15),
      batchCount: 0,
    };
  }

  for (let batchIndex = 0; batchIndex < chunks.length; batchIndex += 1) {
    const chunk = chunks[batchIndex].map((page) => ({
      ...page,
      content: page.content.slice(0, WEBSITE_EXTRACTION_CONTENT_LIMIT),
      content_length: Math.min(page.content_length, WEBSITE_EXTRACTION_CONTENT_LIMIT),
    }));
    const extracted = await extractWebsiteFaqs(apiKey, model, context, chunk);
    const candidates = Array.isArray(extracted?.faqs) ? extracted.faqs : [];
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

  return {
    faqs: dedupeFaqCandidates(collected).slice(0, 15),
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
  const systemPrompt = `You are BizzyBee's FAQ finalizer.

Return valid JSON only.

Select the strongest final FAQ set for:
- Workspace: ${context.workspace_name}
- Industry: ${context.industry || ''}
- Service area: ${context.service_area || ''}
- Business type: ${context.business_type || ''}

Rules:
- Prefer fewer strong FAQs over many weak ones.
- Do not return duplicates of existing FAQ questions.
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
