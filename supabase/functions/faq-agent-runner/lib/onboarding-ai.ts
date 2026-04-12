import { domainFromUrl } from '../../_shared/onboarding.ts';
import { callClaudeForJson } from './json-tools.ts';
import { injectPromptVariables, loadPrompt } from './prompt-loader.ts';

const APIFY_SEARCH_ACTOR = 'apify/google-search-scraper';
const APIFY_CONTENT_ACTOR = 'apify/website-content-crawler';

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
}

export interface FaqCandidate {
  question: string;
  answer: string;
  source_url: string;
  evidence_quote: string;
  source_business?: string;
  quality_score: number;
}

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

async function runApifyActor<T>(
  actor: string,
  input: Record<string, unknown>,
  timeoutSeconds = 120,
): Promise<T[]> {
  const apiKey = getApifyKey();
  const response = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${apiKey}&timeout=${timeoutSeconds}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Apify actor ${actor} failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as T[];
}

export async function searchCompetitorCandidates(
  searchQueries: string[],
  targetCount: number,
): Promise<SearchCandidate[]> {
  const resultsByUrl = new Map<string, SearchCandidate>();

  for (const query of searchQueries) {
    const items = await runApifyActor<Record<string, unknown>>(APIFY_SEARCH_ACTOR, {
      queries: query,
      maxPagesPerQuery: 1,
      resultsPerPage: Math.min(Math.max(targetCount, 10), 25),
      mobileResults: false,
      languageCode: 'en',
    });

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

        if (!resultsByUrl.has(url)) {
          resultsByUrl.set(url, candidate);
        }
      }
    }
  }

  return Array.from(resultsByUrl.values()).slice(0, Math.max(targetCount * 3, targetCount));
}

export async function qualifyCompetitorCandidates(
  apiKey: string,
  model: string,
  context: PromptContext,
  candidates: SearchCandidate[],
  targetCount: number,
): Promise<{ approved: QualifiedCandidate[]; rejected: RejectedCandidate[] }> {
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

  return await callClaudeForJson(apiKey, {
    systemPrompt,
    userPrompt,
    model,
    maxTokens: 3000,
  });
}

export async function crawlWebsitePages(url: string, maxPages = 8): Promise<FetchedPage[]> {
  const items = await runApifyActor<Record<string, unknown>>(APIFY_CONTENT_ACTOR, {
    startUrls: [{ url }],
    maxCrawlPages: maxPages,
    crawlerType: 'cheerio',
    sameDomainDelaySecs: 0,
    removeCookieWarnings: true,
    includeUrlGlobs: [`${new URL(url).origin}/**`],
  });

  return items
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
    maxTokens: 3500,
  });
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

  return await callClaudeForJson(apiKey, {
    systemPrompt,
    userPrompt,
    model,
    maxTokens: 4000,
  });
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

  return await callClaudeForJson(apiKey, {
    systemPrompt,
    userPrompt,
    model,
    maxTokens: 3000,
  });
}
