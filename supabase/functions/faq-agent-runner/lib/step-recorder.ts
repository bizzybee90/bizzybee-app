import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface StepRecordInput {
  supabase: SupabaseClient;
  runId: string;
  workspaceId: string;
  stepKey: string;
  attempt?: number;
  provider?: string;
  model?: string;
  inputPayload?: Record<string, unknown>;
}

export interface StepRecord {
  id: string;
  runId: string;
  stepKey: string;
}

export async function beginStep(input: StepRecordInput): Promise<StepRecord> {
  const {
    supabase,
    runId,
    workspaceId,
    stepKey,
    attempt = 1,
    provider,
    model,
    inputPayload,
  } = input;

  const { data, error } = await supabase
    .from('agent_run_steps')
    .insert({
      run_id: runId,
      workspace_id: workspaceId,
      step_key: stepKey,
      attempt,
      status: 'running',
      provider: provider ?? null,
      model: model ?? null,
      input_payload: inputPayload ?? {},
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create step record: ${error.message}`);

  await supabase
    .from('agent_runs')
    .update({
      current_step_key: stepKey,
      last_heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);

  return { id: data.id, runId, stepKey };
}

export async function succeedStep(
  supabase: SupabaseClient,
  stepId: string,
  outputPayload: Record<string, unknown>,
  metrics?: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from('agent_run_steps')
    .update({
      status: 'succeeded',
      output_payload: outputPayload,
      metrics: metrics ?? {},
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', stepId);
}

export async function failStep(
  supabase: SupabaseClient,
  stepId: string,
  errorMessage: string,
): Promise<void> {
  await supabase
    .from('agent_run_steps')
    .update({
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', stepId);
}
