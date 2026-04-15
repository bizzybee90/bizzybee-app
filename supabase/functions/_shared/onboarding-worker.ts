import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import {
  auditJob,
  calculateBackoffSeconds,
  deadletterJob,
  queueDelete,
  queueSend,
  nowIso,
} from './pipeline.ts';
import {
  buildOnboardingObservabilityContext,
  failRun,
  type OnboardingWorkflowKey,
} from './onboarding.ts';

export async function loadRunRecord(
  supabase: SupabaseClient,
  runId: string,
): Promise<{
  id: string;
  workspace_id: string;
  workflow_key: OnboardingWorkflowKey;
  status: string;
  current_step_key: string | null;
  input_snapshot: Record<string, unknown>;
  output_summary: Record<string, unknown>;
  error_summary: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  last_heartbeat_at: string | null;
  trigger_source: string | null;
  rollout_mode: string | null;
  legacy_progress_workflow_type: string | null;
  source_job_id: string | null;
}> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select(
      'id, workspace_id, workflow_key, status, current_step_key, input_snapshot, output_summary, error_summary, started_at, completed_at, last_heartbeat_at, trigger_source, rollout_mode, legacy_progress_workflow_type, source_job_id',
    )
    .eq('id', runId)
    .single();

  if (error || !data) {
    throw new Error(`Agent run not found: ${runId}`);
  }

  return {
    id: data.id,
    workspace_id: data.workspace_id,
    workflow_key: data.workflow_key as OnboardingWorkflowKey,
    status: data.status,
    current_step_key: data.current_step_key,
    input_snapshot: (data.input_snapshot as Record<string, unknown> | null) || {},
    output_summary: (data.output_summary as Record<string, unknown> | null) || {},
    error_summary: (data.error_summary as Record<string, unknown> | null) || null,
    started_at: data.started_at,
    completed_at: data.completed_at,
    last_heartbeat_at: data.last_heartbeat_at,
    trigger_source: data.trigger_source,
    rollout_mode: data.rollout_mode,
    legacy_progress_workflow_type: data.legacy_progress_workflow_type,
    source_job_id: data.source_job_id,
  };
}

// Real retry with exponential backoff + jitter + Retry-After + retryable-status
// classification. Extracted to retry.ts so it can be unit-tested under vitest
// (this file cannot be tested directly — it imports esm.sh URLs).
export { withTransientRetry } from './retry.ts';

export function resolveQueueAttempt(record: {
  read_ct?: number | null;
  message?: Record<string, unknown> | null;
}): number {
  const queuedAttempt = Math.max(1, Number(record.message?.attempt || 1));
  const deliveryAttempt = Math.max(1, Number(record.read_ct || 1));
  return queuedAttempt + deliveryAttempt - 1;
}

export async function requeueStepJob(
  supabase: SupabaseClient,
  queueName: string,
  record: { msg_id: number; read_ct: number; message: Record<string, unknown> },
  errorMessage: string,
): Promise<void> {
  const attempt = resolveQueueAttempt(record) + 1;
  const retryPayload = {
    ...record.message,
    attempt,
    last_error: errorMessage,
    requeued_at: nowIso(),
  };

  await queueSend(
    supabase,
    queueName,
    retryPayload,
    calculateBackoffSeconds(record.read_ct, 5, 240),
  );
  await queueDelete(supabase, queueName, record.msg_id);
  await auditJob(supabase, {
    workspaceId:
      typeof record.message.workspace_id === 'string' ? record.message.workspace_id : null,
    runId: typeof record.message.run_id === 'string' ? record.message.run_id : null,
    queueName,
    jobPayload: retryPayload,
    outcome: 'requeued',
    error: errorMessage,
    attempts: record.read_ct,
  });
}

export async function deadletterStepJob(
  supabase: SupabaseClient,
  params: {
    queueName: string;
    workflowKey: OnboardingWorkflowKey;
    scope: string;
    record: { msg_id: number; read_ct: number; message: Record<string, unknown> };
    errorMessage: string;
  },
): Promise<void> {
  const workspaceId =
    typeof params.record.message.workspace_id === 'string'
      ? params.record.message.workspace_id
      : null;
  const runId =
    typeof params.record.message.run_id === 'string' ? params.record.message.run_id : null;
  const run = runId ? await loadRunRecord(supabase, runId).catch(() => null) : null;
  const stepKey =
    typeof params.record.message.step === 'string' ? params.record.message.step : null;
  const observabilityContext = buildOnboardingObservabilityContext({
    runId: runId || 'unknown',
    workspaceId: workspaceId || 'unknown',
    workflowKey: params.workflowKey,
    status: run?.status || null,
    currentStepKey: run?.current_step_key || stepKey,
    lastHeartbeatAt: run?.last_heartbeat_at || null,
    triggerSource: run?.trigger_source || null,
    rolloutMode: run?.rollout_mode || null,
    legacyProgressWorkflowType: run?.legacy_progress_workflow_type || null,
    sourceJobId: run?.source_job_id || null,
    queueName: params.queueName,
    action: 'deadletter',
    attempt: params.record.read_ct,
    checkedAt: nowIso(),
    extra: {
      scope: params.scope,
      error_message: params.errorMessage,
      queue_attempt: params.record.read_ct,
      message: params.record.message,
    },
  });

  const deadletterPayload = {
    ...params.record.message,
    last_error: params.errorMessage,
    deadletter_scope: params.scope,
    deadlettered_at: nowIso(),
    deadlettered_attempts: params.record.read_ct,
    run_context: observabilityContext,
  };

  await deadletterJob(supabase, {
    fromQueue: params.queueName,
    msgId: params.record.msg_id,
    attempts: params.record.read_ct,
    workspaceId,
    runId,
    jobPayload: deadletterPayload,
    error: params.errorMessage,
    scope: params.scope,
  });

  if (run && runId && workspaceId) {
    await failRun(supabase, {
      runId,
      workspaceId,
      workflowKey: params.workflowKey,
      reason: params.errorMessage,
      details: {
        scope: params.scope,
        queue_name: params.queueName,
        attempt: params.record.read_ct,
      },
      context: observabilityContext,
      eventType: `${params.workflowKey}:deadlettered`,
    });
  }
}
