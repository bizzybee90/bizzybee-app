import {
  DEFAULT_TIME_BUDGET_MS,
  HttpError,
  assertWorkerToken,
  createServiceClient,
  jsonResponse,
  queueDelete,
  queueSend,
  readQueue,
  wakeWorker,
  withinBudget,
} from '../_shared/pipeline.ts';
import { ONBOARDING_WEBSITE_QUEUE, type OnboardingWebsiteJob } from '../_shared/onboarding.ts';
import {
  deadletterStepJob,
  loadRunRecord,
  resolveQueueAttempt,
  requeueStepJob,
} from '../_shared/onboarding-worker.ts';
import { executeWebsiteRunStep } from '../_shared/onboarding-website-runner.ts';

const QUEUE_NAME = ONBOARDING_WEBSITE_QUEUE;
const VT_SECONDS = 180;
const MAX_ATTEMPTS = 5;

async function processJob(
  record: { msg_id: number; read_ct: number; message: OnboardingWebsiteJob },
  startMs: number,
) {
  const supabase = createServiceClient();
  const job = record.message;
  const run = await loadRunRecord(supabase, job.run_id);

  if (run.workflow_key !== 'own_website_scrape') {
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    return;
  }
  const effectiveAttempt = resolveQueueAttempt(record);

  const { executedStep } = await executeWebsiteRunStep(supabase, run, job.step, effectiveAttempt);

  if (executedStep === 'fetch') {
    await queueSend(
      supabase,
      QUEUE_NAME,
      {
        run_id: run.id,
        workspace_id: run.workspace_id,
        step: 'extract',
        attempt: 1,
      },
      0,
    );
    try {
      await wakeWorker(supabase, 'pipeline-worker-onboarding-website');
    } catch (workerKickError) {
      console.warn('Failed to chain onboarding website extract step', workerKickError);
    }
  } else if (executedStep === 'extract') {
    await queueSend(
      supabase,
      QUEUE_NAME,
      {
        run_id: run.id,
        workspace_id: run.workspace_id,
        step: 'persist',
        attempt: 1,
      },
      0,
    );
    try {
      await wakeWorker(supabase, 'pipeline-worker-onboarding-website');
    } catch (workerKickError) {
      console.warn('Failed to chain onboarding website persist step', workerKickError);
    }
  }

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
    const jobs = await readQueue<OnboardingWebsiteJob>(supabase, QUEUE_NAME, VT_SECONDS, 3);

    let processed = 0;
    const failures: Array<{ run_id: string; step: string; attempt: number; error: string }> = [];
    for (const record of jobs) {
      if (!withinBudget(startMs, DEFAULT_TIME_BUDGET_MS)) break;

      try {
        await processJob(record, startMs);
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({
          run_id: typeof record.message?.run_id === 'string' ? record.message.run_id : 'unknown',
          step: typeof record.message?.step === 'string' ? record.message.step : 'unknown',
          attempt: Number(record.message?.attempt || 0),
          error: message,
        });
        if (record.read_ct >= MAX_ATTEMPTS) {
          await deadletterStepJob(supabase, {
            queueName: QUEUE_NAME,
            workflowKey: 'own_website_scrape',
            scope: 'pipeline-worker-onboarding-website',
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
      failures,
      elapsed_ms: Date.now() - startMs,
    });
  } catch (error) {
    console.error('pipeline-worker-onboarding-website fatal', error);
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
