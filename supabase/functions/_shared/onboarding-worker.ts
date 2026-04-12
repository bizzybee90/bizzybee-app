import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import {
  auditJob,
  calculateBackoffSeconds,
  deadletterJob,
  queueDelete,
  queueSend,
} from './pipeline.ts';
import { failRun, type OnboardingWorkflowKey } from './onboarding.ts';

export async function loadRunRecord(
  supabase: SupabaseClient,
  runId: string,
): Promise<{
  id: string;
  workspace_id: string;
  workflow_key: OnboardingWorkflowKey;
  status: string;
  input_snapshot: Record<string, unknown>;
  source_job_id: string | null;
}> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('id, workspace_id, workflow_key, status, input_snapshot, source_job_id')
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
    input_snapshot: (data.input_snapshot as Record<string, unknown> | null) || {},
    source_job_id: data.source_job_id,
  };
}

export async function withTransientRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}

export async function requeueStepJob(
  supabase: SupabaseClient,
  queueName: string,
  record: { msg_id: number; read_ct: number; message: Record<string, unknown> },
  errorMessage: string,
): Promise<void> {
  const attempt = Number(record.message.attempt || 1) + 1;
  const retryPayload = {
    ...record.message,
    attempt,
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

  await deadletterJob(supabase, {
    fromQueue: params.queueName,
    msgId: params.record.msg_id,
    attempts: params.record.read_ct,
    workspaceId,
    runId,
    jobPayload: params.record.message,
    error: params.errorMessage,
    scope: params.scope,
  });

  if (runId && workspaceId) {
    await failRun(supabase, {
      runId,
      workspaceId,
      workflowKey: params.workflowKey,
      reason: params.errorMessage,
      details: { scope: params.scope },
    });
  }
}
