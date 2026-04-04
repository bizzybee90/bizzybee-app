import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { chainNextBatch } from '../_shared/batch-processor.ts';

// =============================================================================
// ROBUST EMAIL IMPORT WITH RELAY RACE SELF-INVOCATION + WORKER LOCKS
// Handles 30,000+ emails autonomously without frontend polling
// Features: Adaptive throttling, single-worker enforcement, rate limit handling
// =============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AURINKO_API_BASE = 'https://api.aurinko.io/v1';
const FUNCTION_NAME = 'email-import-v2';
const BATCH_SIZE = 100; // Base batch size
const THROTTLED_BATCH_SIZE = 50; // Reduced when hitting rate limits
const TIMEOUT_BUFFER_MS = 50000; // Stop 10s before 60s timeout
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const THROTTLE_DELAY_MS = 200; // Delay between batches when throttled
const MAX_STALLED_RELAYS = 10; // Stop only if no progress for 10 consecutive relays
const TRANSIENT_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

interface ImportJob {
  id: string;
  workspace_id: string;
  config_id: string;
  status: string;
  import_mode: string;
  total_target: number;
  inbox_imported: number;
  sent_imported: number;
  inbox_page_token: string | null;
  sent_page_token: string | null;
  current_folder: 'SENT' | 'INBOX';
  error_message: string | null;
  retry_count: number;
  last_batch_at: string | null;
}

async function refreshQueueCounts(
  supabase: SupabaseClient,
  workspace_id: string,
  job: ImportJob,
): Promise<void> {
  const [{ count: sentCount }, { count: inboxCount }] = await Promise.all([
    supabase
      .from('email_import_queue')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)
      .eq('direction', 'outbound'),
    supabase
      .from('email_import_queue')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)
      .eq('direction', 'inbound'),
  ]);

  job.sent_imported = sentCount || 0;
  job.inbox_imported = inboxCount || 0;
}

function folderToJobStatus(folder: 'SENT' | 'INBOX'): 'scanning_sent' | 'scanning_inbox' {
  return folder === 'SENT' ? 'scanning_sent' : 'scanning_inbox';
}

// =============================================================================
// UTILITIES
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffDelay(attempt: number): number {
  const exponentialDelay = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(exponentialDelay + jitter, 30000);
}

function shouldContinueProcessing(startTime: number): boolean {
  return Date.now() - startTime < TIMEOUT_BUFFER_MS;
}

// =============================================================================
// WORKER LOCK FUNCTIONS - Prevent thundering herd
// =============================================================================

async function acquireLock(
  supabase: SupabaseClient,
  workspace_id: string,
  function_name: string,
): Promise<boolean> {
  try {
    // Try to insert a lock - will fail if one exists (unique constraint)
    const { error } = await supabase.from('pipeline_locks').insert({
      workspace_id,
      function_name,
      locked_at: new Date().toISOString(),
      locked_by: `${function_name}-${Date.now()}`,
    });

    if (error) {
      // Check if it's a duplicate key error (lock already exists)
      if (error.code === '23505') {
        console.log(`[${FUNCTION_NAME}] Lock already held for workspace ${workspace_id}`);
        return false;
      }
      console.error(`[${FUNCTION_NAME}] Lock acquisition error:`, error.message);
      return false;
    }

    console.log(`[${FUNCTION_NAME}] Acquired lock for workspace ${workspace_id}`);
    return true;
  } catch (e) {
    console.error(`[${FUNCTION_NAME}] Lock acquisition exception:`, e);
    return false;
  }
}

async function releaseLock(
  supabase: SupabaseClient,
  workspace_id: string,
  function_name: string,
): Promise<void> {
  try {
    await supabase
      .from('pipeline_locks')
      .delete()
      .eq('workspace_id', workspace_id)
      .eq('function_name', function_name);

    console.log(`[${FUNCTION_NAME}] Released lock for workspace ${workspace_id}`);
  } catch (e) {
    console.error(`[${FUNCTION_NAME}] Lock release error:`, e);
  }
}

async function refreshLock(
  supabase: SupabaseClient,
  workspace_id: string,
  function_name: string,
): Promise<void> {
  try {
    await supabase
      .from('pipeline_locks')
      .update({ locked_at: new Date().toISOString() })
      .eq('workspace_id', workspace_id)
      .eq('function_name', function_name);
  } catch (e) {
    // Non-fatal - just log
    console.warn(`[${FUNCTION_NAME}] Lock refresh failed:`, e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const {
      workspace_id,
      job_id,
      import_mode = 'full',
      speed_phase = false,
      _relay_depth = 0,
      _last_progress = 0,
      _stalled_count = 0,
      _sleep_ms = 0,
    } = body;

    if (!workspace_id) {
      throw new Error('workspace_id is required');
    }

    // -------------------------------------------------------------------------
    // Acquire Worker Lock - Only ONE import worker per workspace
    // -------------------------------------------------------------------------
    const lockAcquired = await acquireLock(supabase, workspace_id, FUNCTION_NAME);
    if (!lockAcquired) {
      console.log(
        `[${FUNCTION_NAME}] Another worker is already processing this workspace, exiting`,
      );
      return createResponse({
        success: true,
        status: 'skipped',
        reason: 'Another worker is already processing this workspace',
      });
    }

    // Optional backoff sleep used for self-invoked retries (e.g., rate limit handling)
    // NOTE: Avoid relying on setTimeout in edge runtimes; do backoff at the start of the next invocation instead.
    if (typeof _sleep_ms === 'number' && _sleep_ms > 0) {
      const ms = Math.min(Math.max(_sleep_ms, 0), 30000);
      console.log(`[${FUNCTION_NAME}] Backoff sleep ${ms}ms before continuing`);
      await sleep(ms);
    }

    // Note: No more hard depth limit - we use stall detection instead

    console.log(`[${FUNCTION_NAME}] Starting: relay_depth=${_relay_depth}`, {
      workspace_id,
      job_id,
      import_mode,
    });

    // -------------------------------------------------------------------------
    // Get Email Provider Config
    // -------------------------------------------------------------------------
    const { data: emailConfig, error: configError } = await supabase
      .from('email_provider_configs')
      .select('id, email_address')
      .eq('workspace_id', workspace_id)
      .single();

    if (configError || !emailConfig) {
      throw new Error('Email not connected. Please connect your email account first.');
    }

    // Get decrypted access token securely
    const { data: accessToken, error: tokenError } = await supabase.rpc(
      'get_decrypted_access_token',
      { p_config_id: emailConfig.id },
    );

    if (tokenError || !accessToken) {
      throw new Error('Email access token is missing. Please reconnect your email account.');
    }

    // -------------------------------------------------------------------------
    // Get or Create Import Job
    // -------------------------------------------------------------------------
    let job: ImportJob;

    if (job_id) {
      // Resume existing job
      const { data, error } = await supabase
        .from('email_import_jobs')
        .select('*')
        .eq('id', job_id)
        .single();

      if (error || !data) {
        throw new Error(`Job ${job_id} not found`);
      }
      job = data as ImportJob;
    } else {
      // Prefer resuming the most recent active job for this workspace to avoid
      // accidental parallel jobs when the user hits "restart".
      const { data: existingJob } = await supabase
        .from('email_import_jobs')
        .select('*')
        .eq('workspace_id', workspace_id)
        .in('status', ['queued', 'scanning_sent', 'scanning_inbox', 'importing', 'classifying'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingJob) {
        job = existingJob as ImportJob;
        console.log(`[${FUNCTION_NAME}] Resuming existing job ${job.id}, status: ${job.status}`);
      } else {
        // Create new job - use minimal insert, let DB defaults handle the rest
        // Speed phase: cap at 2,500 regardless of import_mode for fast onboarding
        const totalTarget = speed_phase
          ? 2500
          : import_mode === 'last_100'
            ? 100
            : import_mode === 'last_1000'
              ? 1000
              : 30000;

        console.log(
          `[${FUNCTION_NAME}] Creating new job for config_id: ${emailConfig.id}, mode: ${import_mode}, target: ${totalTarget}`,
        );

        const { data, error } = await supabase
          .from('email_import_jobs')
          .insert({
            workspace_id,
            config_id: emailConfig.id,
            import_mode,
            total_target: totalTarget,
            started_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (error) {
          console.error(`[${FUNCTION_NAME}] Job insert failed:`, JSON.stringify(error));
          throw new Error(`Failed to create import job: ${error.message}`);
        }

        job = data as ImportJob;
        // Initialize defaults for tracking fields if not returned
        job.inbox_imported = job.inbox_imported ?? 0;
        job.sent_imported = job.sent_imported ?? 0;
        job.current_folder = job.current_folder ?? 'SENT';

        console.log(`[${FUNCTION_NAME}] Created job ${job.id}, status: ${job.status}`);
      }
    }

    // Update job to active scanning status
    await supabase
      .from('email_import_jobs')
      .update({
        status: folderToJobStatus(job.current_folder),
        last_batch_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    // -------------------------------------------------------------------------
    // Process Emails in Batches
    // -------------------------------------------------------------------------
    let batchesProcessed = 0;
    let totalImportedThisRun = 0;
    const targetPerFolder = Math.floor(job.total_target / 2);

    // Continue with current folder
    while (shouldContinueProcessing(startTime)) {
      // IMPORTANT: use DB truth as the source of progress.
      // Job counters can be inflated if we previously counted duplicates.
      await refreshQueueCounts(supabase, workspace_id, job);

      const folder = job.current_folder;
      const imported = folder === 'SENT' ? job.sent_imported : job.inbox_imported;
      const pageToken = folder === 'SENT' ? job.sent_page_token : job.inbox_page_token;

      // Check if folder is complete
      if (imported >= targetPerFolder) {
        if (folder === 'SENT') {
          // Switch to INBOX
          job.current_folder = 'INBOX';
          await supabase
            .from('email_import_jobs')
            .update({ current_folder: 'INBOX' })
            .eq('id', job.id);
          continue;
        } else {
          // INBOX is complete - check if SENT still needs work
          if (job.sent_imported < targetPerFolder) {
            // Switch back to SENT to finish it
            job.current_folder = 'SENT';
            await supabase
              .from('email_import_jobs')
              .update({ current_folder: 'SENT' })
              .eq('id', job.id);
            continue;
          }
          // Both folders complete
          break;
        }
      }

      // Fetch batch from Aurinko
      const batchLimit = Math.min(BATCH_SIZE, targetPerFolder - imported);

      let response: Response | undefined;
      let retryCount = 0;

      while (retryCount < MAX_RETRIES) {
        const url = new URL(`${AURINKO_API_BASE}/email/messages`);
        url.searchParams.set('limit', String(batchLimit));
        url.searchParams.set('folder', folder);
        if (pageToken) {
          url.searchParams.set('pageToken', pageToken);
        }

        response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) break;

        // Treat Aurinko timeouts / transient upstream failures as retryable.
        // 408 in particular has been observed to stall the pipeline.
        if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : getBackoffDelay(retryCount);
          console.log(
            `[${FUNCTION_NAME}] Transient Aurinko error ${response.status}, waiting ${delay}ms`,
          );

          // If delay would exceed timeout, save checkpoint and self-invoke
          if (!shouldContinueProcessing(startTime)) {
            await saveCheckpoint(supabase, job, folderToJobStatus(job.current_folder));
            await updateProgress(
              supabase,
              workspace_id,
              'importing',
              job.sent_imported + job.inbox_imported,
            );

            console.log(
              `[${FUNCTION_NAME}] Timeout approaching, self-invoking with backoff ${delay}ms`,
            );

            // Self-invoke immediately and let the next invocation perform the backoff sleep.
            chainNextBatch(
              supabaseUrl,
              FUNCTION_NAME,
              {
                workspace_id,
                job_id: job.id,
                import_mode,
                _relay_depth: _relay_depth + 1,
                _last_progress: job.sent_imported + job.inbox_imported,
                _stalled_count: _stalled_count,
                _sleep_ms: delay,
              },
              supabaseServiceKey,
            );

            return createResponse({
              success: true,
              status: 'continuing',
              job_id: job.id,
              message: `Transient upstream error (${response.status}), continuing after delay`,
              progress: getProgress(job),
            });
          }

          await sleep(delay);
          retryCount++;
          continue;
        }

        if (response.status === 401) {
          throw new Error('Email access token expired. Please reconnect your email account.');
        }

        throw new Error(`Aurinko API error: ${response.status}`);
      }

      if (!response) {
        throw new Error('Failed to fetch emails after retries');
      }

      // Parse response
      const data = await response.json();
      const messages = data.records || [];

      if (messages.length === 0) {
        // No more emails in this folder
        if (folder === 'SENT') {
          job.current_folder = 'INBOX';
          job.sent_page_token = null;
        } else {
          // All done
          break;
        }
        continue;
      }

      // Transform and save emails to queue
      const emailsToSave = messages.map((msg: any) => ({
        workspace_id,
        config_id: emailConfig.id,
        external_id: msg.id,
        thread_id: msg.threadId,
        from_email: msg.from?.address || '',
        from_name: msg.from?.name || null,
        to_emails: msg.to?.map((t: any) => t.address) || [],
        subject: msg.subject || '',
        body: msg.textBody || msg.bodySnippet || '',
        body_html: msg.htmlBody || null,
        received_at: msg.receivedAt || msg.createdAt,
        direction: folder === 'SENT' ? 'outbound' : 'inbound',
        status: 'scanned',
        has_body: !!(msg.textBody || msg.bodySnippet),
        is_read: Array.isArray(msg.sysLabels) ? !msg.sysLabels.includes('unread') : false,
      }));

      const { error: insertError, data: insertedData } = await supabase
        .from('email_import_queue')
        .upsert(emailsToSave, {
          onConflict: 'workspace_id,external_id',
          ignoreDuplicates: true,
        })
        .select('id');

      if (insertError) {
        console.error(`[${FUNCTION_NAME}] Insert error:`, insertError.message);
      }

      // Track how many were newly inserted this run (best-effort for telemetry)
      const savedCount = insertedData?.length ?? 0;
      totalImportedThisRun += savedCount;
      batchesProcessed++;

      // Always advance page token even if this page was all duplicates.
      if (folder === 'SENT') {
        job.sent_page_token = data.nextPageToken || null;
      } else {
        job.inbox_page_token = data.nextPageToken || null;
      }

      // Recompute accurate counts from DB after upsert (source of truth)
      await refreshQueueCounts(supabase, workspace_id, job);

      // Save checkpoint every batch
      await saveCheckpoint(supabase, job, folderToJobStatus(job.current_folder));

      // Update progress for frontend UI
      await updateProgress(
        supabase,
        workspace_id,
        'importing',
        job.sent_imported + job.inbox_imported,
      );

      console.log(
        `[${FUNCTION_NAME}] Batch ${batchesProcessed}: ${folder} +${savedCount}, total: ${job.sent_imported + job.inbox_imported}`,
      );

      // No more pages
      if (!data.nextPageToken) {
        if (folder === 'SENT') {
          job.current_folder = 'INBOX';
        } else {
          break;
        }
      }
    }

    // -------------------------------------------------------------------------
    // Determine if Complete or Need Continuation
    // -------------------------------------------------------------------------
    const totalImported = job.sent_imported + job.inbox_imported;
    // Only consider "no more pages" as complete if we actually fetched at least
    // one batch from the INBOX (inbox_imported > 0). Otherwise we just switched
    // folders and haven't started scanning INBOX yet.
    const noMorePages =
      !job.inbox_page_token &&
      !job.sent_page_token &&
      job.current_folder === 'INBOX' &&
      job.inbox_imported > 0;
    const isComplete =
      totalImported >= job.total_target ||
      (job.inbox_imported >= targetPerFolder && job.sent_imported >= targetPerFolder) ||
      noMorePages;

    if (isComplete) {
      // =========================================================================
      // IMPORT COMPLETE - Chain to email-classify-v2
      // =========================================================================
      await supabase
        .from('email_import_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      // Update progress phase
      await updateProgress(supabase, workspace_id, 'classifying', totalImported);

      // If this was a speed phase, mark backfill as pending for later
      if (speed_phase) {
        await supabase.from('email_import_progress').upsert(
          {
            workspace_id,
            backfill_status: 'pending',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id' },
        );
        console.log(`[${FUNCTION_NAME}] Speed phase complete, backfill_status set to 'pending'`);
      }

      // Release lock before chaining
      await releaseLock(supabase, workspace_id, FUNCTION_NAME);

      console.log(
        `[${FUNCTION_NAME}] Import complete (${totalImported} emails), chaining to email-classify-bulk`,
      );

      // Chain to simplified bulk classification (ONE Gemini call for all emails)
      chainNextBatch(
        supabaseUrl,
        'email-classify-bulk',
        {
          workspace_id,
        },
        supabaseServiceKey,
      );

      return createResponse({
        success: true,
        status: 'completed',
        job_id: job.id,
        total_imported: totalImported,
        sent_count: job.sent_imported,
        inbox_count: job.inbox_imported,
        duration_ms: Date.now() - startTime,
        chained_to: 'email-classify-bulk',
      });
    }

    // -------------------------------------------------------------------------
    // More work to do - SELF INVOKE (Relay Race) with Stall Detection
    // -------------------------------------------------------------------------
    await saveCheckpoint(supabase, job, folderToJobStatus(job.current_folder));
    await updateProgress(supabase, workspace_id, 'importing', totalImported);

    // Stall detection: track if we're making progress
    const newStalledCount = totalImported <= _last_progress ? _stalled_count + 1 : 0;

    if (newStalledCount >= MAX_STALLED_RELAYS) {
      console.error(
        `[${FUNCTION_NAME}] Stalled for ${MAX_STALLED_RELAYS} consecutive relays, stopping`,
      );
      await releaseLock(supabase, workspace_id, FUNCTION_NAME);
      await supabase.from('email_import_progress').upsert(
        {
          workspace_id,
          current_phase: 'error',
          last_error: `Import stalled - no progress for ${MAX_STALLED_RELAYS} consecutive attempts`,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id' },
      );
      return createResponse({
        success: false,
        error: 'Import stalled',
        progress: getProgress(job),
      });
    }

    // Release lock before self-invoking (next invocation will acquire its own)
    await releaseLock(supabase, workspace_id, FUNCTION_NAME);

    console.log(
      `[${FUNCTION_NAME}] Self-invoking: depth=${_relay_depth + 1}, progress=${totalImported}/${job.total_target}, stalled=${newStalledCount}`,
    );

    // Fire and forget - self invoke
    chainNextBatch(
      supabaseUrl,
      FUNCTION_NAME,
      {
        workspace_id,
        job_id: job.id,
        import_mode,
        speed_phase,
        _relay_depth: _relay_depth + 1,
        _last_progress: totalImported,
        _stalled_count: newStalledCount,
      },
      supabaseServiceKey,
    );

    return createResponse({
      success: true,
      status: 'continuing',
      job_id: job.id,
      batches_this_run: batchesProcessed,
      imported_this_run: totalImportedThisRun,
      progress: getProgress(job),
      relay_depth: _relay_depth,
    });
  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Error:`, error.message);

    // Update progress with error and release lock
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      const body = await req
        .clone()
        .json()
        .catch(() => ({}));
      if (body.workspace_id) {
        // Release lock on error
        await releaseLock(supabase, body.workspace_id, FUNCTION_NAME);

        await supabase.from('email_import_progress').upsert(
          {
            workspace_id: body.workspace_id,
            current_phase: 'error',
            last_error: error.message,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id' },
        );
      }
    } catch (e) {
      // Ignore error logging errors
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: FUNCTION_NAME,
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// =============================================================================
// HELPERS
// =============================================================================

async function saveCheckpoint(
  supabase: SupabaseClient,
  job: ImportJob,
  status: string,
): Promise<void> {
  await supabase
    .from('email_import_jobs')
    .update({
      status,
      sent_imported: job.sent_imported,
      inbox_imported: job.inbox_imported,
      sent_page_token: job.sent_page_token,
      inbox_page_token: job.inbox_page_token,
      current_folder: job.current_folder,
      last_batch_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);
}

async function updateProgress(
  supabase: SupabaseClient,
  workspace_id: string,
  phase: string,
  emails_received: number,
): Promise<void> {
  await supabase.from('email_import_progress').upsert(
    {
      workspace_id,
      current_phase: phase,
      emails_received,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  );
}

function getProgress(job: ImportJob): {
  sent: number;
  inbox: number;
  total: number;
  percent: number;
} {
  const total = job.sent_imported + job.inbox_imported;
  return {
    sent: job.sent_imported,
    inbox: job.inbox_imported,
    total,
    percent: Math.round((total / job.total_target) * 100),
  };
}

function createResponse(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
