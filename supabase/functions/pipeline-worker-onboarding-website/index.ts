import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
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
import { createPgmqHeartbeat } from '../_shared/pgmq-heartbeat.ts';

const QUEUE_NAME = ONBOARDING_WEBSITE_QUEUE;
const VT_SECONDS = 180;
const MAX_ATTEMPTS = 5;

async function tryWakeWorker(supabase: SupabaseClient): Promise<void> {
  try {
    await wakeWorker(supabase, 'pipeline-worker-onboarding-website');
  } catch (workerKickError) {
    console.warn('Failed to chain onboarding website worker', workerKickError);
  }
}

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

  // Pgmq heartbeat: extend this message's VT every ~60s of wall-clock
  // while the step executes. The extract step performs up to 12 Claude
  // calls serially (each 20-60s) which can easily exceed the 180s VT and
  // cause pgmq to redeliver — spawning concurrent workers that race on
  // the same run's output_summary (observed 2026-04-16 as "batch counter
  // appears to reset from 10/12 back to 7/12"). The nudge-side dedupe
  // handles external re-enqueues; this heartbeat handles the pgmq-level
  // redelivery caused by long-running processing.
  const heartbeat = createPgmqHeartbeat(supabase, QUEUE_NAME, record.msg_id);

  // Pass job.batch_index through to the runner so it processes exactly this batch.
  const result = await executeWebsiteRunStep(supabase, run, job.step, effectiveAttempt, {
    heartbeat,
    batchIndex: job.batch_index,
  });

  // Note: `executedStep === null` (runner no-op — nothing pending) and
  // `executedStep === 'persist'` (terminal — run already marked succeeded
  // inside the runner) intentionally fall through to the queueDelete below
  // without chaining a new msg. Only 'fetch' and 'extract' need a follow-up.
  if (result.executedStep === 'fetch') {
    // Start the chunked extract chain at batch 0.
    await queueSend(
      supabase,
      QUEUE_NAME,
      {
        run_id: run.id,
        workspace_id: run.workspace_id,
        step: 'extract',
        attempt: 1,
        batch_index: 0,
      },
      0,
    );
    await tryWakeWorker(supabase);
  } else if (result.executedStep === 'extract') {
    if (result.allBatchesDone === true) {
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
    } else if (typeof result.batchIndex === 'number' && typeof result.batchCount === 'number') {
      // Runner wrote batch N; next is N+1.
      await queueSend(
        supabase,
        QUEUE_NAME,
        {
          run_id: run.id,
          workspace_id: run.workspace_id,
          step: 'extract',
          attempt: 1,
          batch_index: result.batchIndex + 1,
        },
        0,
      );
    } else {
      // Defensive: neither allBatchesDone nor usable batch info. The runner
      // contract says one of those shapes must hold for extract. Throwing
      // here triggers the outer catch → requeueStepJob → another worker
      // picks it up and retries (at which point idempotency short-circuits
      // or the resolver fills in the missing index).
      throw new Error(
        `Invalid extract step result for run ${run.id}: ` +
          JSON.stringify({
            executedStep: result.executedStep,
            batchIndex: result.batchIndex,
            batchCount: result.batchCount,
            allBatchesDone: result.allBatchesDone,
          }),
      );
    }
    await tryWakeWorker(supabase);
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
        // record.read_ct resets on every requeueStepJob. Use resolveQueueAttempt
        // which reads the payload-level attempt counter across requeues.
        if (resolveQueueAttempt(record) >= MAX_ATTEMPTS) {
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
