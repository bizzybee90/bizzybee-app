import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type ProgressStage =
  | 'context_loaded'
  | 'fetch_complete'
  | 'candidates_generated'
  | 'quality_review_complete'
  | 'finalized';

const STAGE_TO_N8N: Record<ProgressStage, { status: string; details: Record<string, unknown> }> = {
  context_loaded: { status: 'in_progress', details: { phase: 'loading' } },
  fetch_complete: { status: 'in_progress', details: { phase: 'extracting' } },
  candidates_generated: { status: 'in_progress', details: { phase: 'consolidating' } },
  quality_review_complete: { status: 'in_progress', details: { phase: 'reviewing' } },
  finalized: { status: 'complete', details: {} },
};

export async function handleMirrorProgress(
  supabase: SupabaseClient,
  input: {
    run_id: string;
    stage: ProgressStage;
    summary: string;
    metadata?: Record<string, unknown>;
  },
  workspaceId: string,
): Promise<{ mirrored: boolean }> {
  const mapping = STAGE_TO_N8N[input.stage];
  if (!mapping) throw new Error(`Unknown progress stage: ${input.stage}`);

  const details = {
    ...mapping.details,
    ...(input.metadata ?? {}),
    agent_summary: input.summary,
  };

  const now = new Date().toISOString();
  await supabase.from('n8n_workflow_progress').upsert(
    {
      workspace_id: workspaceId,
      workflow_type: 'faq_generation',
      status: mapping.status,
      details,
      started_at: input.stage === 'context_loaded' ? now : undefined,
      completed_at: input.stage === 'finalized' ? now : undefined,
      updated_at: now,
    },
    { onConflict: 'workspace_id,workflow_type' },
  );

  await supabase.from('agent_run_events').insert({
    run_id: input.run_id,
    workspace_id: workspaceId,
    level: 'info',
    event_type: `progress:${input.stage}`,
    message: input.summary,
    payload: input.metadata ?? {},
  });

  return { mirrored: true };
}
