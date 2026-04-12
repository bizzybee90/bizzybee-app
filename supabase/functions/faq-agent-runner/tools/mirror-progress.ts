import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function handleMirrorProgress(
  supabase: SupabaseClient,
  input: {
    run_id: string;
    stage: string;
    summary: string;
    metadata?: Record<string, unknown>;
  },
  workspaceId: string,
): Promise<{ mirrored: boolean }> {
  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('agent_runs')
    .update({
      status: 'running',
      current_step_key: input.stage,
      last_heartbeat_at: now,
      updated_at: now,
    })
    .eq('id', input.run_id);

  if (updateError) {
    throw new Error(`Failed to mirror run progress: ${updateError.message}`);
  }

  const { error: eventError } = await supabase.from('agent_run_events').insert({
    run_id: input.run_id,
    workspace_id: workspaceId,
    level: 'info',
    event_type: `progress:${input.stage}`,
    message: input.summary,
    payload: input.metadata ?? {},
  });

  if (eventError) {
    throw new Error(`Failed to record progress event: ${eventError.message}`);
  }

  return { mirrored: true };
}
