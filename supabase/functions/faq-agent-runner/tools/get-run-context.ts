import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface RunContext {
  run_id: string;
  workspace_id: string;
  workspace_name: string;
  industry: string | null;
  service_area: string | null;
  business_type: string | null;
  allowed_urls: string[];
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

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .single();

  const { data: bizCtx } = await supabase
    .from('business_context')
    .select('company_name, industry, service_area, business_type')
    .eq('workspace_id', workspaceId)
    .single();

  const { data: competitors } = await supabase
    .from('competitor_sites')
    .select('url, domain, title')
    .eq('workspace_id', workspaceId)
    .eq('is_selected', true)
    .neq('status', 'rejected');

  const allowedUrls = (competitors ?? []).map((c) => c.url).filter((u): u is string => !!u);

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
  };
}
