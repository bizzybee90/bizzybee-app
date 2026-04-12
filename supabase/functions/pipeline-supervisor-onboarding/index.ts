import {
  DEFAULT_TIME_BUDGET_MS,
  HttpError,
  assertWorkerToken,
  createServiceClient,
  jsonResponse,
  queueDelete,
  queueSend,
  readQueue,
  withinBudget,
} from '../_shared/pipeline.ts';
import {
  ONBOARDING_SUPERVISOR_QUEUE,
  buildOnboardingObservabilityContext,
  failRun,
  recordRunEvent,
  type OnboardingSupervisorJob,
} from '../_shared/onboarding.ts';
import { deadletterStepJob, requeueStepJob } from '../_shared/onboarding-worker.ts';
import { loadRunRecord } from '../_shared/onboarding-worker.ts';

const QUEUE_NAME = ONBOARDING_SUPERVISOR_QUEUE;
const VT_SECONDS = 120;
const MAX_ATTEMPTS = 5;
const STALL_THRESHOLD_MS = 5 * 60 * 1000;
// Keep a small early-warning window so degraded runs show up in the event stream
// before they cross the hard stall cutoff.
const WARNING_THRESHOLD_MS = 4 * 60 * 1000;
const HEARTBEAT_CHECK_DELAY_SECONDS = 300;

async function processJob(record: {
  msg_id: number;
  read_ct: number;
  message: OnboardingSupervisorJob;
}) {
  const supabase = createServiceClient();
  const job = record.message;
  const run = await loadRunRecord(supabase, job.run_id).catch((error) => {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return null;
    }
    throw error;
  });

  if (!run) {
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    return;
  }

  const heartbeatAgeMs = run.last_heartbeat_at
    ? Date.now() - new Date(run.last_heartbeat_at).getTime()
    : null;
  const observedAt = new Date().toISOString();
  const observabilityContext = buildOnboardingObservabilityContext({
    runId: run.id,
    workspaceId: run.workspace_id,
    workflowKey: run.workflow_key,
    status: run.status,
    currentStepKey: run.current_step_key,
    lastHeartbeatAt: run.last_heartbeat_at,
    triggerSource: run.trigger_source,
    rolloutMode: run.rollout_mode,
    legacyProgressWorkflowType: run.legacy_progress_workflow_type,
    sourceJobId: run.source_job_id,
    queueName: QUEUE_NAME,
    action: job.action,
    heartbeatAgeMs,
    checkedAt: observedAt,
    attempt: record.read_ct,
    extra: {
      msg_id: record.msg_id,
      queue_message_action: job.action,
    },
  });

  if (!['queued', 'running', 'waiting'].includes(run.status)) {
    await recordRunEvent(supabase, {
      runId: run.id,
      workspaceId: run.workspace_id,
      level: 'info',
      eventType: 'supervisor:terminal_observed',
      message: `Run already ${run.status}`,
      payload: observabilityContext,
    });
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    return;
  }

  const isStalled = heartbeatAgeMs === null || heartbeatAgeMs > STALL_THRESHOLD_MS;

  if (job.action === 'fail_stalled' || isStalled) {
    await failRun(supabase, {
      runId: run.id,
      workspaceId: run.workspace_id,
      workflowKey: run.workflow_key as OnboardingSupervisorJob['workflow_key'],
      reason: `Run stalled while on step ${run.current_step_key || 'unknown'}`,
      details: {
        current_step_key: run.current_step_key,
        last_heartbeat_at: run.last_heartbeat_at,
        heartbeat_age_ms: heartbeatAgeMs,
        threshold_ms: STALL_THRESHOLD_MS,
        warning_threshold_ms: WARNING_THRESHOLD_MS,
        queue_name: QUEUE_NAME,
        supervisor_action: job.action,
        checked_at: observedAt,
      },
      context: observabilityContext,
      eventType: job.action === 'fail_stalled' ? 'supervisor:forced_fail' : 'supervisor:stalled',
    });
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    return;
  }

  const heartbeatLevel =
    heartbeatAgeMs !== null && heartbeatAgeMs >= WARNING_THRESHOLD_MS ? 'warning' : 'info';
  await recordRunEvent(supabase, {
    runId: run.id,
    workspaceId: run.workspace_id,
    level: heartbeatLevel,
    eventType: 'supervisor:heartbeat_check',
    message:
      heartbeatLevel === 'warning'
        ? 'Run heartbeat approaching stall threshold'
        : 'Run heartbeat healthy',
    payload: observabilityContext,
  });

  await queueSend(
    supabase,
    QUEUE_NAME,
    {
      run_id: run.id,
      workflow_key: run.workflow_key,
      action: 'heartbeat_check',
      observed_status: run.status,
      observed_step_key: run.current_step_key,
      observed_last_heartbeat_at: run.last_heartbeat_at,
      heartbeat_age_ms: heartbeatAgeMs,
      threshold_ms: STALL_THRESHOLD_MS,
      warning_threshold_ms: WARNING_THRESHOLD_MS,
      checked_at: observedAt,
      queue_name: QUEUE_NAME,
    },
    HEARTBEAT_CHECK_DELAY_SECONDS,
  );
  await queueDelete(supabase, QUEUE_NAME, record.msg_id);
}

Deno.serve(async (req) => {
  const startMs = Date.now();
  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }

    assertWorkerToken(req);
    const supabase = createServiceClient();
    const jobs = await readQueue<OnboardingSupervisorJob>(supabase, QUEUE_NAME, VT_SECONDS, 8);

    let processed = 0;
    for (const record of jobs) {
      if (!withinBudget(startMs, DEFAULT_TIME_BUDGET_MS)) break;

      try {
        await processJob(record);
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (record.read_ct >= MAX_ATTEMPTS) {
          await deadletterStepJob(supabase, {
            queueName: QUEUE_NAME,
            workflowKey: record.message.workflow_key,
            scope: 'pipeline-supervisor-onboarding',
            record: record as unknown as {
              msg_id: number;
              read_ct: number;
              message: Record<string, unknown>;
            },
            errorMessage: message,
          });
        } else {
          await requeueStepJob(
            supabase,
            QUEUE_NAME,
            record as unknown as {
              msg_id: number;
              read_ct: number;
              message: Record<string, unknown>;
            },
            message,
          );
        }
      }
    }

    return jsonResponse({
      ok: true,
      queue: QUEUE_NAME,
      fetched_jobs: jobs.length,
      processed,
      elapsed_ms: Date.now() - startMs,
    });
  } catch (error) {
    console.error('pipeline-supervisor-onboarding fatal', error);
    if (error instanceof HttpError) {
      return jsonResponse({ ok: false, error: error.message }, error.status);
    }

    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected error',
        elapsed_ms: Date.now() - startMs,
      },
      500,
    );
  }
});
