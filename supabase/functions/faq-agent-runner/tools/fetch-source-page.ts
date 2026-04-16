import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const APIFY_RUN_URL =
  'https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items';
const APIFY_TIMEOUT_SECS = 90;
const MAX_CONTENT_LENGTH = 30_000;

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
  input: { url: string; run_id: string },
  workspaceId: string,
  allowedUrls: string[],
): Promise<FetchResult> {
  if (!allowedUrls.includes(input.url)) {
    throw new Error(`URL not in allowed list: ${input.url}`);
  }

  const apifyKey = Deno.env.get('APIFY_API_KEY') || Deno.env.get('APIFY_API_TOKEN');
  if (!apifyKey) throw new Error('APIFY_API_KEY or APIFY_API_TOKEN not configured');

  const response = await fetch(`${APIFY_RUN_URL}?token=${apifyKey}&timeout=${APIFY_TIMEOUT_SECS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startUrls: [{ url: input.url }],
      maxCrawlPages: 1,
      crawlerType: APIFY_CRAWLER_TYPE,
      // Remove cookie banners and consent modals from the extracted content
      // so Claude doesn't see "We use cookies on this site" as the main
      // heading of every page.
      removeCookieWarnings: true,
      // Run quietly — don't follow same-domain links. We only want the
      // landing page for FAQ extraction.
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
  const page = Array.isArray(items) ? items[0] : undefined;
  if (!page) throw new Error(`Apify playwright returned no content for ${input.url}`);

  let content = page.markdown || page.text || '';
  const truncated = content.length > MAX_CONTENT_LENGTH;
  if (truncated) content = content.slice(0, MAX_CONTENT_LENGTH);

  await supabase.from('agent_run_artifacts').insert({
    run_id: input.run_id,
    workspace_id: workspaceId,
    artifact_type: 'source_page',
    artifact_key: input.url,
    source_url: input.url,
    content: {
      title: page.title ?? null,
      text_length: content.length,
      truncated,
      crawler: 'playwright',
    },
  });

  return {
    url: input.url,
    title: page.title ?? null,
    content,
    content_length: content.length,
    truncated,
    crawler: 'playwright',
  };
}
