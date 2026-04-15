import { aurinkoToUnifiedMessage, fetchAurinkoMessagesPage } from '../_shared/aurinko.ts';
import {
  assertWorkerToken,
  auditJob,
  calculateBackoffSeconds,
  createServiceClient,
  deadletterJob,
  DEFAULT_TIME_BUDGET_MS,
  HttpError,
  isUuidLike,
  jsonResponse,
  queueDelete,
  queueSend,
  RateLimitError,
  readQueue,
  touchPipelineRun,
  withinBudget,
} from '../_shared/pipeline.ts';
import type { ImportFetchJob } from '../_shared/types.ts';

const QUEUE_NAME = 'bb_import_jobs';
const VT_SECONDS = 180;
const MAX_ATTEMPTS = 20;
const PAGE_LIMIT = 100;
const MAILBOX_WARMUP_DELAY_SECONDS = 15;
const MAILBOX_WARMUP_MAX_ATTEMPTS = 8;

function isMailboxWarmupError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('mailbox.unavailable') ||
    normalized.includes('loading imap folders') ||
    normalized.includes('mailbox folders') ||
    normalized.includes('mailbox_warmup_retry')
  );
}

function buildMailboxWarmupRetryMessage(provider?: string | null, attempts?: number): string {
  const providerLabel = provider?.trim() || 'Email';
  const suffix =
    typeof attempts === 'number'
      ? ` BizzyBee will retry automatically (${attempts}/${MAILBOX_WARMUP_MAX_ATTEMPTS}).`
      : ' BizzyBee will retry automatically.';
  return `MAILBOX_WARMUP_RETRY: ${providerLabel} is still exposing folders to BizzyBee.${suffix}`;
}

function buildMailboxWarmupStuckMessage(provider?: string | null): string {
  const providerLabel = provider?.trim() || 'This inbox';
  return `MAILBOX_WARMUP_STUCK: ${providerLabel} stalled before import could begin. Disconnect and reconnect this inbox to continue importing historical email.`;
}

function parseCap(job: ImportFetchJob): number {
  const requested = Number(job.cap ?? 2500);
  if (!Number.isFinite(requested)) {
    return 2500;
  }
  return Math.max(1, Math.min(10000, Math.floor(requested)));
}

async function processJob(
  record: { msg_id: number; read_ct: number; message: ImportFetchJob },
  startMs: number,
) {
  const supabase = createServiceClient();
  const job = record.message;

  const { data: runRecord, error: runLookupError } = await supabase
    .from('pipeline_runs')
    .select('id, state')
    .eq('id', job.run_id)
    .maybeSingle();

  if (runLookupError || !runRecord) {
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    await auditJob(supabase, {
      workspaceId: job?.workspace_id,
      runId: job?.run_id,
      queueName: QUEUE_NAME,
      jobPayload: job as unknown as Record<string, unknown>,
      outcome: 'discarded',
      error: `Missing pipeline run: ${runLookupError?.message || 'not found'}`,
      attempts: record.read_ct,
    });
    return;
  }

  if (runRecord.state !== 'running') {
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    await auditJob(supabase, {
      workspaceId: job?.workspace_id,
      runId: job?.run_id,
      queueName: QUEUE_NAME,
      jobPayload: job as unknown as Record<string, unknown>,
      outcome: 'discarded',
      error: `Pipeline run is ${runRecord.state}`,
      attempts: record.read_ct,
    });
    return;
  }

  if (job?.job_type !== 'IMPORT_FETCH') {
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    await auditJob(supabase, {
      workspaceId: job?.workspace_id,
      runId: job?.run_id,
      queueName: QUEUE_NAME,
      jobPayload: job as unknown as Record<string, unknown>,
      outcome: 'discarded',
      error: 'Unsupported import job type',
      attempts: record.read_ct,
    });
    return;
  }

  if (!isUuidLike(job.workspace_id) || !isUuidLike(job.run_id) || !isUuidLike(job.config_id)) {
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    await auditJob(supabase, {
      workspaceId: job.workspace_id,
      runId: job.run_id,
      queueName: QUEUE_NAME,
      jobPayload: job as unknown as Record<string, unknown>,
      outcome: 'discarded',
      error: 'Invalid UUID in import job payload',
      attempts: record.read_ct,
    });
    return;
  }

  const cap = parseCap(job);
  const fetchedSoFar = Math.max(0, Math.floor(Number(job.fetched_so_far ?? 0)));
  const pages = Math.max(0, Math.floor(Number(job.pages ?? 0)));
  const rateLimitCount = Math.max(0, Math.floor(Number(job.rate_limit_count ?? 0)));

  if (fetchedSoFar >= cap) {
    await touchPipelineRun(supabase, {
      runId: job.run_id,
      metricsPatch: {
        fetched_so_far: fetchedSoFar,
        pages,
        rate_limit_count: rateLimitCount,
        import_done: true,
        import_done_reason: 'cap_reached',
      },
    });

    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    await auditJob(supabase, {
      workspaceId: job.workspace_id,
      runId: job.run_id,
      queueName: QUEUE_NAME,
      jobPayload: job as unknown as Record<string, unknown>,
      outcome: 'processed',
      attempts: record.read_ct,
    });
    return;
  }

  const { data: config, error: configError } = await supabase
    .from('email_provider_configs')
    .select('id, workspace_id, email_address, aliases, access_token, provider')
    .eq('id', job.config_id)
    .eq('workspace_id', job.workspace_id)
    .single();

  if (configError || !config) {
    throw new Error(`email_provider_configs lookup failed: ${configError?.message || 'not found'}`);
  }

  const accessToken = String((config as { access_token?: string }).access_token || '').trim();
  if (!accessToken) {
    throw new Error('Missing Aurinko access token for provider config');
  }

  const page = await fetchAurinkoMessagesPage({
    accessToken,
    folder: job.folder,
    pageToken: job.pageToken || null,
    limit: PAGE_LIMIT,
  });

  const ownerEmail = String(config.email_address || '')
    .toLowerCase()
    .trim();
  const aliases = Array.isArray((config as any).aliases)
    ? (config as any).aliases.map((a: string) => String(a).toLowerCase().trim()).filter(Boolean)
    : [];
  const ownerIdentifiers = new Set([ownerEmail, ...aliases].filter(Boolean));

  function inferDirectionFromOwner(msg: Record<string, unknown>): 'inbound' | 'outbound' {
    const from = String((msg as any).from?.[0]?.address || (msg as any).from?.address || '')
      .toLowerCase()
      .trim();
    if (ownerIdentifiers.has(from)) return 'outbound';
    return 'inbound';
  }

  const unified = page.messages.map((message) =>
    aurinkoToUnifiedMessage({
      message,
      channel: 'email',
      direction: inferDirectionFromOwner(message as unknown as Record<string, unknown>),
      defaultToIdentifier: ownerEmail,
    }),
  );

  const { error: ingestError } = await supabase.rpc('bb_ingest_unified_messages', {
    p_workspace_id: job.workspace_id,
    p_config_id: job.config_id,
    p_run_id: job.run_id,
    p_channel: 'email',
    p_messages: unified,
  });

  if (ingestError) {
    throw new Error(`bb_ingest_unified_messages failed: ${ingestError.message}`);
  }

  const nextFetched = fetchedSoFar + unified.length;
  const nextPages = pages + 1;

  const baseMetrics = {
    fetched_so_far: nextFetched,
    pages: nextPages,
    rate_limit_count: rateLimitCount,
    last_folder: job.folder,
    last_page_token: job.pageToken || null,
    last_page_size: unified.length,
    import_done: false,
  } as Record<string, unknown>;

  let nextJob: ImportFetchJob | null = null;

  if (nextFetched >= cap) {
    baseMetrics.import_done = true;
    baseMetrics.import_done_reason = 'cap_reached';
  } else if (page.nextPageToken) {
    nextJob = {
      ...job,
      pageToken: page.nextPageToken,
      fetched_so_far: nextFetched,
      pages: nextPages,
      rate_limit_count: rateLimitCount,
    };
  } else if (job.folder === 'SENT') {
    nextJob = {
      ...job,
      folder: 'INBOX',
      pageToken: null,
      fetched_so_far: nextFetched,
      pages: nextPages,
      rate_limit_count: rateLimitCount,
    };
  } else {
    baseMetrics.import_done = true;
    baseMetrics.import_done_reason = 'no_more_pages';
  }

  await touchPipelineRun(supabase, {
    runId: job.run_id,
    metricsPatch: baseMetrics,
    state: 'running',
  });

  if (nextJob) {
    await queueSend(supabase, QUEUE_NAME, nextJob as unknown as Record<string, unknown>, 0);
  }

  await queueDelete(supabase, QUEUE_NAME, record.msg_id);
  await auditJob(supabase, {
    workspaceId: job.workspace_id,
    runId: job.run_id,
    queueName: QUEUE_NAME,
    jobPayload: job as unknown as Record<string, unknown>,
    outcome: 'processed',
    attempts: record.read_ct,
  });

  if (!withinBudget(startMs, DEFAULT_TIME_BUDGET_MS - 2_000)) {
    return;
  }
}

async function loadProviderNameForJob(
  supabase: ReturnType<typeof createServiceClient>,
  workspaceId?: string | null,
  configId?: string | null,
): Promise<string> {
  if (!workspaceId || !configId || !isUuidLike(workspaceId) || !isUuidLike(configId)) {
    return 'Email';
  }

  const { data } = await supabase
    .from('email_provider_configs')
    .select('provider')
    .eq('workspace_id', workspaceId)
    .eq('id', configId)
    .maybeSingle();

  const provider = typeof data?.provider === 'string' ? data.provider.trim() : '';
  return provider || 'Email';
}

Deno.serve(async (req) => {
  const startMs = Date.now();
  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }

    assertWorkerToken(req);
    const supabase = createServiceClient();

    const batchSize = Number(Deno.env.get('BB_IMPORT_BATCH_SIZE') || '6');
    const jobs = await readQueue<ImportFetchJob>(
      supabase,
      QUEUE_NAME,
      VT_SECONDS,
      Math.max(1, Math.min(20, batchSize)),
    );

    let processed = 0;
    for (const record of jobs) {
      if (!withinBudget(startMs, DEFAULT_TIME_BUDGET_MS)) {
        break;
      }

      try {
        await processJob(record, startMs);
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const attempts = record.read_ct;
        const workspaceId = record.message?.workspace_id;
        const runId = record.message?.run_id;

        if (error instanceof RateLimitError) {
          if (attempts >= MAX_ATTEMPTS) {
            await deadletterJob(supabase, {
              fromQueue: QUEUE_NAME,
              msgId: record.msg_id,
              attempts,
              workspaceId,
              runId,
              jobPayload: record.message as unknown as Record<string, unknown>,
              error: `Rate limit max retries exceeded: ${message}`,
              scope: 'pipeline-worker-import',
            });
          } else {
            const delaySeconds = Math.max(
              error.retryAfterSeconds,
              calculateBackoffSeconds(attempts, 5, 300),
            );

            const retryJob = {
              ...record.message,
              rate_limit_count: Number(record.message?.rate_limit_count || 0) + 1,
            };

            await queueSend(
              supabase,
              QUEUE_NAME,
              retryJob as unknown as Record<string, unknown>,
              delaySeconds,
            );
            await queueDelete(supabase, QUEUE_NAME, record.msg_id);
            await auditJob(supabase, {
              workspaceId,
              runId,
              queueName: QUEUE_NAME,
              jobPayload: retryJob as unknown as Record<string, unknown>,
              outcome: 'requeued',
              error: `rate_limited delay=${delaySeconds}`,
              attempts,
            });
            await touchPipelineRun(supabase, {
              runId,
              metricsPatch: {
                rate_limit_count: Number(record.message?.rate_limit_count || 0) + 1,
              },
            });
          }

          continue;
        }

        if (isMailboxWarmupError(message)) {
          const providerName = await loadProviderNameForJob(
            supabase,
            workspaceId,
            record.message?.config_id ?? null,
          );

          if (attempts >= MAILBOX_WARMUP_MAX_ATTEMPTS) {
            const stuckMessage = buildMailboxWarmupStuckMessage(providerName);
            const now = new Date().toISOString();

            await supabase.from('email_import_progress').upsert(
              {
                workspace_id: workspaceId,
                current_phase: 'error',
                current_import_folder: record.message?.folder || null,
                last_error: stuckMessage,
                updated_at: now,
              },
              { onConflict: 'workspace_id' },
            );

            await touchPipelineRun(supabase, {
              runId,
              state: 'failed',
              lastError: stuckMessage,
              metricsPatch: {
                import_done: true,
                import_done_reason: 'mailbox_warmup_stuck',
                mailbox_warmup_attempts: attempts,
              },
            });

            await deadletterJob(supabase, {
              fromQueue: QUEUE_NAME,
              msgId: record.msg_id,
              attempts,
              workspaceId,
              runId,
              jobPayload: record.message as unknown as Record<string, unknown>,
              error: stuckMessage,
              scope: 'pipeline-worker-import',
            });
          } else {
            const retryMessage = buildMailboxWarmupRetryMessage(providerName, attempts);
            await queueSend(
              supabase,
              QUEUE_NAME,
              {
                ...record.message,
                pageToken: record.message?.pageToken ?? null,
                rate_limit_count: Number(record.message?.rate_limit_count || 0),
              } as unknown as Record<string, unknown>,
              MAILBOX_WARMUP_DELAY_SECONDS,
            );
            await queueDelete(supabase, QUEUE_NAME, record.msg_id);
            await auditJob(supabase, {
              workspaceId,
              runId,
              queueName: QUEUE_NAME,
              jobPayload: record.message as unknown as Record<string, unknown>,
              outcome: 'requeued',
              error: `mailbox_warmup delay=${MAILBOX_WARMUP_DELAY_SECONDS}`,
              attempts,
            });
            if (workspaceId && runId) {
              const now = new Date().toISOString();
              await supabase.from('email_import_progress').upsert(
                {
                  workspace_id: workspaceId,
                  current_phase: 'queued',
                  current_import_folder: record.message?.folder || null,
                  last_error: retryMessage,
                  updated_at: now,
                },
                { onConflict: 'workspace_id' },
              );
              await touchPipelineRun(supabase, {
                runId,
                lastError: retryMessage,
                metricsPatch: {
                  mailbox_warmup_attempts: attempts,
                },
              });
            }
          }

          continue;
        }

        console.error('pipeline-worker-import job error', {
          msg_id: record.msg_id,
          attempts,
          error: message,
        });

        if (attempts >= MAX_ATTEMPTS) {
          await deadletterJob(supabase, {
            fromQueue: QUEUE_NAME,
            msgId: record.msg_id,
            attempts,
            workspaceId,
            runId,
            jobPayload: record.message as unknown as Record<string, unknown>,
            error: message,
            scope: 'pipeline-worker-import',
          });
        } else {
          await auditJob(supabase, {
            workspaceId,
            runId,
            queueName: QUEUE_NAME,
            jobPayload: record.message as unknown as Record<string, unknown>,
            outcome: 'failed',
            error: message,
            attempts,
          });

          if (workspaceId && runId) {
            await touchPipelineRun(supabase, {
              runId,
              lastError: message,
            });
          }
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
    console.error('pipeline-worker-import fatal', error);
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
