import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Message } from './claude-client.ts';

const TIMEOUT_BUDGET_MS = 120_000;

export function createDeadlineTracker() {
  const startedAt = Date.now();
  return {
    isApproachingTimeout: () => Date.now() - startedAt > TIMEOUT_BUDGET_MS,
    elapsedMs: () => Date.now() - startedAt,
  };
}

export interface ContinuationState {
  messages: Message[];
  toolCallCount: number;
  chainDepth: number;
}

export async function saveContinuationState(
  supabase: SupabaseClient,
  runId: string,
  state: ContinuationState,
): Promise<void> {
  await supabase
    .from('agent_runs')
    .update({
      status: 'waiting',
      output_summary: { continuation: state },
      last_heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);
}

export async function loadContinuationState(
  supabase: SupabaseClient,
  runId: string,
): Promise<ContinuationState | null> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('output_summary')
    .eq('id', runId)
    .single();

  if (error || !data?.output_summary) return null;

  const summary = data.output_summary as Record<string, unknown>;
  if (!summary.continuation) return null;

  return summary.continuation as ContinuationState;
}

export async function fireAndForgetContinuation(
  supabaseUrl: string,
  serviceRoleKey: string,
  runId: string,
): Promise<void> {
  fetch(`${supabaseUrl}/functions/v1/faq-agent-runner`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ run_id: runId }),
  }).catch((err) => console.error('[self-chain] Failed to invoke continuation:', err));
}
