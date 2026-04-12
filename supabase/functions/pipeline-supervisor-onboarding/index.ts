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
  failRun,
  recordRunEvent,
  type OnboardingSupervisorJob,
} from '../_shared/onboarding.ts';
import { deadletterStepJob, requeueStepJob } from '../_shared/onboarding-worker.ts';

const QUEUE_NAME = ONBOARDING_SUPERVISOR_QUEUE;
const VT_SECONDS = 120;
const MAX_ATTEMPTS = 5;
const STALL_THRESHOLD_MS = 5 * 60 * 1000;

async function processJob(record: {
  msg_id: number;
  read_ct: number;
  message: OnboardingSupervisorJob;
}) {
  const supabase = createServiceClient();
  const job = record.message;

  const { data: run, error } = await supabase
    .from('agent_runs')
    .select('id, workspace_id, workflow_key, status, current_step_key, last_heartbeat_at')
    .eq('id', job.run_id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load onboarding run ${job.run_id}: ${error.message}`);
  }

  if (!run) {
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    return;
  }

  if (!['queued', 'running', 'waiting'].includes(run.status)) {
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    return;
  }

  const heartbeatAt = run.last_heartbeat_at ? new Date(run.last_heartbeat_at).getTime() : 0;
  const isStalled = !heartbeatAt || Date.now() - heartbeatAt > STALL_THRESHOLD_MS;

  if (job.action === 'fail_stalled' || isStalled) {
    await failRun(supabase, {
      runId: run.id,
      workspaceId: run.workspace_id,
      workflowKey: run.workflow_key as OnboardingSupervisorJob['workflow_key'],
      reason: `Run stalled while on step ${run.current_step_key || 'unknown'}`,
      details: {
        last_heartbeat_at: run.last_heartbeat_at,
        current_step_key: run.current_step_key,
      },
    });
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    return;
  }

  await recordRunEvent(supabase, {
    runId: run.id,
    workspaceId: run.workspace_id,
    level: 'debug',
    eventType: 'supervisor:heartbeat_check',
    message: 'Run heartbeat healthy',
    payload: {
      current_step_key: run.current_step_key,
      last_heartbeat_at: run.last_heartbeat_at,
    },
  });

  await queueSend(
    supabase,
    QUEUE_NAME,
    {
      run_id: run.id,
      workflow_key: run.workflow_key,
      action: 'heartbeat_check',
    },
    300,
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
