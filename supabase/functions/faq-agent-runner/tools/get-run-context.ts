import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface RunContext {
  run_id: string;
  workspace_id: string;
  workspace_name: string;
  industry: string | null;
  service_area: string | null;
  business_type: string | null;
  allowed_urls: string[];
  selected_competitor_ids: string[];
  website_url: string | null;
  trigger_source: string | null;
  model_policy: Record<string, unknown>;
  provider_policy: Record<string, unknown>;
}

export async function handleGetRunContext(
  supabase: SupabaseClient,
  input: { run_id: string },
): Promise<RunContext> {
  const { data: run, error: runErr } = await supabase
    .from('agent_runs')
    .select('id, workspace_id, input_snapshot, status')
    .eq('id', input.run_id)
    .single();

  if (runErr || !run) throw new Error(`Agent run not found: ${input.run_id}`);

  const workspaceId = run.workspace_id;
  const inputSnapshot = (run.input_snapshot as Record<string, unknown> | null) || {};
  const selectedCompetitorIds = Array.isArray(inputSnapshot.selected_competitor_ids)
    ? inputSnapshot.selected_competitor_ids.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  const configuredAllowedUrls = Array.isArray(inputSnapshot.allowed_urls)
    ? inputSnapshot.allowed_urls.filter((value): value is string => typeof value === 'string')
    : [];

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .single();

  const { data: bizCtx } = await supabase
    .from('business_context')
    .select('company_name, service_area, business_type, website_url')
    .eq('workspace_id', workspaceId)
    .single();

  let competitorQuery = supabase
    .from('competitor_sites')
    .select('id, url, domain, title')
    .eq('workspace_id', workspaceId)
    .eq('is_selected', true)
    .neq('status', 'rejected');

  if (selectedCompetitorIds.length > 0) {
    competitorQuery = competitorQuery.in('id', selectedCompetitorIds);
  }

  const { data: competitors } = await competitorQuery;

  const competitorUrls = (competitors ?? []).map((c) => c.url).filter((u): u is string => !!u);
  const allowedUrls = configuredAllowedUrls.length > 0 ? configuredAllowedUrls : competitorUrls;

  await supabase
    .from('agent_runs')
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.run_id);

  return {
    run_id: input.run_id,
    workspace_id: workspaceId,
    workspace_name: workspace?.name ?? 'Unknown',
    industry: bizCtx?.industry ?? null,
    service_area: bizCtx?.service_area ?? null,
    business_type: bizCtx?.business_type ?? null,
    allowed_urls: allowedUrls,
    selected_competitor_ids: selectedCompetitorIds,
    website_url:
      typeof inputSnapshot.website_url === 'string'
        ? inputSnapshot.website_url
        : (bizCtx?.website_url ?? null),
    trigger_source:
      typeof inputSnapshot.trigger_source === 'string' ? inputSnapshot.trigger_source : null,
    model_policy: (inputSnapshot.model_policy as Record<string, unknown> | null) || {},
    provider_policy: (inputSnapshot.provider_policy as Record<string, unknown> | null) || {},
  };
}
