import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const APIFY_RUN_URL =
  'https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items';
const APIFY_TIMEOUT_SECS = 180;
const MAX_CONTENT_LENGTH = 30_000;
const DEFAULT_MAX_PAGES = 8;

/**
 * We scrape competitor sites with Apify's website-content-crawler actor in
 * **playwright** mode (headless Chromium).
 *
 * Why not cheerio:
 *  - cheerio is a raw-HTML parser, no JavaScript engine. Modern small-
 *    business sites (WordPress + Elementor, Wix, SquareSpace, anything
 *    behind Cloudflare's "Just a moment…" interstitial) render their
 *    real content client-side, so cheerio sees an empty `<div
 *    id="root"></div>` and returns nothing.
 *  - Observed on 2026-04-16 for MAC Cleaning: cheerio failed on 10 of 16
 *    UK competitor sites. After digging, every failure was a JS- or
 *    Cloudflare-rendered page that a real browser would have rendered
 *    fine.
 *
 * Why not "cheerio with playwright fallback":
 *  - To use the fallback we first pay for the failed cheerio call, then
 *    pay again for the playwright call. The 7× cost difference per page
 *    disappears quickly when 60% of sites need the fallback.
 *  - The site-count per run is small (<= 25) and playwright at ~$0.017/
 *    page is ~£0.25 for a full discovery. Negligible compared to the
 *    user-facing cost of half the competitors coming back empty.
 *
 * Apify's website-content-crawler actor defaults to `playwright:chrome`
 * when crawlerType isn't specified, which is what the original (n8n)
 * version of this pipeline relied on. We set it explicitly so nobody
 * accidentally re-introduces the cheerio regression.
 */
const APIFY_CRAWLER_TYPE = 'playwright:chrome';

type ApifyCrawlItem = {
  url?: string;
  title?: string;
  text?: string;
  markdown?: string;
};

export interface FetchResult {
  url: string;
  title: string | null;
  content: string;
  content_length: number;
  truncated: boolean;
  crawler: 'playwright';
}

export async function handleFetchSourcePage(
  supabase: SupabaseClient,
  input: { url: string; run_id: string; max_pages?: number },
  workspaceId: string,
  allowedUrls: string[],
): Promise<FetchResult[]> {
  if (!allowedUrls.includes(input.url)) {
    throw new Error(`URL not in allowed list: ${input.url}`);
  }

  const apifyKey = Deno.env.get('APIFY_API_KEY') || Deno.env.get('APIFY_API_TOKEN');
  if (!apifyKey) throw new Error('APIFY_API_KEY or APIFY_API_TOKEN not configured');

  const maxPages = Math.max(1, Math.min(input.max_pages ?? DEFAULT_MAX_PAGES, 12));
  const origin = (() => {
    try {
      return new URL(input.url).origin;
    } catch {
      return null;
    }
  })();

  const response = await fetch(`${APIFY_RUN_URL}?token=${apifyKey}&timeout=${APIFY_TIMEOUT_SECS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startUrls: [{ url: input.url }],
      // Mirror own-site scrape depth (onboarding-ai.ts#crawlWebsitePages) so
      // competitors get the same 8-page crawl + per-page extraction that
      // makes own-site FAQ harvest 10× more productive than the old
      // single-landing-page competitor scrape. /services, /pricing, /faq
      // sub-pages are where the real FAQ content lives.
      maxCrawlPages: maxPages,
      crawlerType: APIFY_CRAWLER_TYPE,
      // Only follow links within the same origin — we don't want the
      // crawler wandering off onto cross-domain footer links.
      ...(origin ? { includeUrlGlobs: [`${origin}/**`] } : {}),
      // Remove cookie banners and consent modals from the extracted content
      // so Claude doesn't see "We use cookies on this site" as the main
      // heading of every page.
      removeCookieWarnings: true,
      sameDomainDelaySecs: 0,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Apify playwright crawl failed for ${input.url} (${response.status}): ${errText.slice(0, 300)}`,
    );
  }

  const items = (await response.json()) as ApifyCrawlItem[];
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`Apify playwright returned no content for ${input.url}`);
  }

  const results: FetchResult[] = [];
  const seenUrls = new Set<string>();
  for (const item of items) {
    const pageUrl = typeof item.url === 'string' && item.url.length > 0 ? item.url : input.url;
    if (seenUrls.has(pageUrl)) continue;
    seenUrls.add(pageUrl);

    let content = item.markdown || item.text || '';
    if (!content.trim()) continue;
    const truncated = content.length > MAX_CONTENT_LENGTH;
    if (truncated) content = content.slice(0, MAX_CONTENT_LENGTH);

    results.push({
      url: pageUrl,
      title: item.title ?? null,
      content,
      content_length: content.length,
      truncated,
      crawler: 'playwright',
    });
  }

  if (results.length === 0) {
    throw new Error(`Apify playwright returned no usable pages for ${input.url}`);
  }

  await supabase.from('agent_run_artifacts').insert({
    run_id: input.run_id,
    workspace_id: workspaceId,
    artifact_type: 'source_page',
    artifact_key: input.url,
    source_url: input.url,
    content: {
      start_url: input.url,
      page_count: results.length,
      pages: results.map((page) => ({
        url: page.url,
        title: page.title,
        text_length: page.content_length,
        truncated: page.truncated,
      })),
      crawler: 'playwright',
    },
  });

  return results;
}
