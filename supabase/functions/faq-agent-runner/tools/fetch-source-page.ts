import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const APIFY_RUN_URL =
  'https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items';
const APIFY_TIMEOUT_SECS = 60;
const MAX_CONTENT_LENGTH = 30_000;

export interface FetchResult {
  url: string;
  title: string | null;
  content: string;
  content_length: number;
  truncated: boolean;
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
      crawlerType: 'cheerio',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Apify request failed (${response.status}): ${errText}`);
  }

  const items = (await response.json()) as Array<{
    url: string;
    title?: string;
    text?: string;
    markdown?: string;
  }>;

  const page = items?.[0];
  if (!page) throw new Error(`Apify returned no content for ${input.url}`);

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
    },
  });

  return {
    url: input.url,
    title: page.title ?? null,
    content,
    content_length: content.length,
    truncated,
  };
}
