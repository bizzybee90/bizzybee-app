import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';
import { queueSend, wakeWorker } from '../_shared/pipeline.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ImportMode = 'new_only' | 'last_1000' | 'last_10000' | 'last_30000' | 'all_history';

interface CreateImapBody {
  workspaceId: string;
  email: string;
  password: string;
  host: string;
  port: number;
  secure?: boolean;
  importMode: ImportMode;
}

type ErrorCode =
  | 'INVALID_REQUEST'
  | 'AUTHENTICATION_FAILED'
  | 'IMAP_UNREACHABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

function errorResponse(
  code: ErrorCode,
  message: string,
  extras: Record<string, unknown> = {},
  status = 400,
) {
  return new Response(JSON.stringify({ success: false, error: code, message, ...extras }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 30000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function inferProviderName(host: string): string {
  const lowerHost = host.toLowerCase();
  if (lowerHost === 'imap.mail.me.com') return 'icloud';
  if (lowerHost === 'imap.fastmail.com') return 'fastmail';
  if (lowerHost === 'imap.zoho.com') return 'zoho';
  if (lowerHost === 'imap.mail.yahoo.com') return 'yahoo';
  if (lowerHost === 'imap.aol.com') return 'aol';
  return 'generic';
}

/**
 * Maps an IMAP server host to Aurinko's serviceProvider enum value.
 * Aurinko uses these to track which "brand" of IMAP provider is connected,
 * which improves their internal monitoring and may enable provider-specific
 * optimizations.
 */
function inferAurinkoServiceProvider(host: string): string {
  const lowerHost = host.toLowerCase();
  if (lowerHost === 'imap.mail.me.com') return 'iCloud';
  if (lowerHost === 'imap.fastmail.com') return 'Fastmail';
  if (lowerHost === 'imap.mail.yahoo.com') return 'Yahoo';
  if (lowerHost === 'imap.aol.com') return 'AOL';
  if (lowerHost === 'imap.zoho.com') return 'Zoho';
  if (lowerHost === 'imap.gmail.com') return 'Google';
  if (lowerHost === 'outlook.office365.com') return 'Office365';
  return 'IMAP'; // generic fallback
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as CreateImapBody;
    const { workspaceId, email, password, host, port, secure = true, importMode } = body;

    // Basic validation — be specific about which field is missing so the
    // modal can show actionable feedback (and to make debugging easy)
    const missing: string[] = [];
    if (!workspaceId) missing.push('workspaceId');
    if (!email) missing.push('email');
    if (!password) missing.push('password');
    if (!host) missing.push('host');
    if (!port) missing.push('port');
    if (!importMode) missing.push('importMode');
    if (missing.length > 0) {
      console.warn(
        '[aurinko-create-imap-account] INVALID_REQUEST — missing fields:',
        missing.join(', '),
        '— received keys:',
        Object.keys(body || {}).join(', '),
      );
      return errorResponse('INVALID_REQUEST', `Missing required fields: ${missing.join(', ')}`, {
        missingFields: missing,
      });
    }

    // Verify the caller owns this workspace
    try {
      await validateAuth(req, workspaceId);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err);
      throw err;
    }

    const AURINKO_CLIENT_ID = Deno.env.get('AURINKO_CLIENT_ID');
    const AURINKO_CLIENT_SECRET = Deno.env.get('AURINKO_CLIENT_SECRET');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (
      !AURINKO_CLIENT_ID ||
      !AURINKO_CLIENT_SECRET ||
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      return errorResponse('INTERNAL_ERROR', 'Server configuration missing', {}, 500);
    }

    // Idempotency: bail if a recent import is already in progress for this workspace
    {
      const supabaseEarly = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: existingProgress } = await supabaseEarly
        .from('email_import_progress')
        .select('current_phase, updated_at')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      const isAlreadyRunning =
        existingProgress &&
        ['importing', 'classifying', 'learning'].includes(existingProgress.current_phase) &&
        new Date(existingProgress.updated_at).getTime() > Date.now() - 2 * 60 * 1000;

      if (isAlreadyRunning) {
        console.log('[aurinko-create-imap-account] Import already running, skipping trigger');
        return new Response(JSON.stringify({ success: true, email, alreadyRunning: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Call Aurinko's native IMAP account create endpoint
    let aurinkoResponse: Response;
    try {
      aurinkoResponse = await fetchWithTimeout('https://api.aurinko.io/v1/am/accounts', {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + btoa(`${AURINKO_CLIENT_ID}:${AURINKO_CLIENT_SECRET}`),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          serviceType: 'IMAP',
          serviceProvider: inferAurinkoServiceProvider(host),
          serverUrl: host,
          // NOTE: Aurinko's API doesn't accept a port field — it infers the port
          // from the serviceProvider/serverUrl. For custom domains on non-standard
          // ports (e.g. 143 with STARTTLS) the user can't currently express that.
          // If this becomes a real issue, file a request with Aurinko for a serverPort field.
          email: email,
          password: password,
          active: true,
        }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return errorResponse(
          'SERVICE_UNAVAILABLE',
          'Email service timed out. Please try again.',
          { retryable: true },
          503,
        );
      }
      throw err;
    }

    if (aurinkoResponse.status === 401 || aurinkoResponse.status === 403) {
      return errorResponse('AUTHENTICATION_FAILED', 'Email or password is incorrect', {
        providerHint: inferProviderName(host),
      });
    }

    if (aurinkoResponse.status >= 500) {
      return errorResponse(
        'SERVICE_UNAVAILABLE',
        'Our email service is temporarily unavailable. Please try again.',
        { retryable: true },
        503,
      );
    }

    if (!aurinkoResponse.ok) {
      const errorText = await aurinkoResponse.text();
      console.error('[aurinko-create-imap-account] Aurinko error:', errorText);
      const normalizedError = errorText.toLowerCase();

      if (
        normalizedError.includes('mailbox.unavailable') ||
        normalizedError.includes('loading imap folders')
      ) {
        const providerName = inferProviderName(host);
        const providerSpecificHint =
          providerName === 'fastmail'
            ? ' Delete the stuck Aurinko account, then reconnect with a fresh Fastmail app password using Mail (IMAP/POP/SMTP) scope.'
            : ' Delete the stuck Aurinko account and reconnect this inbox from scratch.';

        return errorResponse(
          'SERVICE_UNAVAILABLE',
          `The email provider is still loading mailbox folders.${providerSpecificHint}`,
          {
            retryable: true,
            providerHint: providerName,
            aurinkoStatus: aurinkoResponse.status,
            aurinkoHint: errorText.slice(0, 200),
          },
          503,
        );
      }

      return errorResponse(
        'IMAP_UNREACHABLE',
        `Couldn't reach ${host}. Check your server settings.`,
        {
          aurinkoStatus: aurinkoResponse.status,
          aurinkoHint: errorText.slice(0, 200),
        },
      );
    }

    const accountData = await aurinkoResponse.json();
    const { accountId, accessToken, refreshToken } = accountData;

    if (!accountId || !accessToken) {
      console.error(
        '[aurinko-create-imap-account] Aurinko response missing accountId or accessToken:',
        accountData,
      );
      return errorResponse('INTERNAL_ERROR', 'Unexpected response from email service', {}, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Create webhook subscription for incoming mail.
    //
    // IMPORTANT: the notificationUrl MUST include ?apikey=<anon-key> and the body MUST
    // specify events. Without the apikey, inbound Aurinko webhook POSTs are 401'd at the
    // Supabase gateway. Without events, Aurinko's defaults may drop message.updated
    // (read-status changes). See refresh-aurinko-subscriptions/index.ts:130,184-188
    // for the canonical shape; this path was previously missing both.
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const webhookUrl = SUPABASE_ANON_KEY
      ? `${SUPABASE_URL}/functions/v1/aurinko-webhook?apikey=${SUPABASE_ANON_KEY}`
      : `${SUPABASE_URL}/functions/v1/aurinko-webhook`;

    let subscriptionId: string | null = null;
    let subscriptionFailure: { status: number | null; body: string } | null = null;
    try {
      const subResponse = await fetchWithTimeout('https://api.aurinko.io/v1/subscriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resource: '/email/messages',
          notificationUrl: webhookUrl,
          events: ['message.created', 'message.updated'],
        }),
      });
      if (subResponse.ok) {
        const subData = await subResponse.json();
        subscriptionId = subData.id?.toString() ?? null;
      } else {
        const errorText = await subResponse.text().catch(() => '');
        subscriptionFailure = { status: subResponse.status, body: errorText.slice(0, 400) };
      }
    } catch (subErr) {
      subscriptionFailure = {
        status: null,
        body: subErr instanceof Error ? subErr.message : String(subErr),
      };
    }

    // HARD REQUIREMENT: without a subscription, live mail never webhooks in and the
    // user sees "connected" state while new messages silently never import — the
    // 2026-04-15 Fastmail stuck state. Previously we swallowed the failure; now we
    // fail loudly AND clean up the orphan Aurinko account so the user can retry
    // cleanly without accumulating half-created accounts on Aurinko's side.
    if (!subscriptionId) {
      console.error(
        '[aurinko-create-imap-account] Subscription create failed:',
        JSON.stringify(subscriptionFailure),
      );

      try {
        await fetchWithTimeout(
          `https://api.aurinko.io/v1/am/accounts/${encodeURIComponent(accountId.toString())}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: 'Basic ' + btoa(`${AURINKO_CLIENT_ID}:${AURINKO_CLIENT_SECRET}`),
            },
          },
          10000,
        );
      } catch (cleanupErr) {
        console.error(
          '[aurinko-create-imap-account] Failed to clean up orphan Aurinko account',
          accountId,
          cleanupErr,
        );
      }

      return errorResponse(
        'SERVICE_UNAVAILABLE',
        "Connected to your mail server, but BizzyBee couldn't register the live-mail webhook. Please try again in a minute.",
        {
          retryable: true,
          subscriptionStatus: subscriptionFailure?.status ?? null,
          subscriptionHint: subscriptionFailure?.body ?? null,
        },
        503,
      );
    }

    // Upsert email_provider_configs WITHOUT plaintext tokens (same as OAuth path)
    const { data: configData, error: dbError } = await supabase
      .from('email_provider_configs')
      .upsert(
        {
          workspace_id: workspaceId,
          provider: 'imap',
          account_id: accountId.toString(),
          access_token: null,
          refresh_token: null,
          email_address: email,
          import_mode: importMode,
          connected_at: new Date().toISOString(),
          subscription_id: subscriptionId,
          sync_status: 'pending',
          sync_stage: 'queued',
        },
        { onConflict: 'workspace_id,email_address' },
      )
      .select()
      .single();

    if (dbError || !configData) {
      console.error(
        '[aurinko-create-imap-account] DB insert failed — ORPHANED Aurinko accountId:',
        accountId,
        'workspace:',
        workspaceId,
        'error:',
        dbError,
      );
      return errorResponse('INTERNAL_ERROR', 'Failed to save email configuration', {}, 500);
    }

    // Encrypt tokens via RPC (same as OAuth callback)
    const { error: encryptError } = await supabase.rpc('store_encrypted_token', {
      p_config_id: configData.id,
      p_access_token: accessToken,
      p_refresh_token: refreshToken ?? null,
    });

    if (encryptError) {
      console.error('[aurinko-create-imap-account] Token encryption failed:', encryptError);
      // Don't fail the flow — the access token is not stored, user will reconnect if decryption fails later
    }

    // Seed import progress
    await supabase.from('email_import_progress').upsert(
      {
        workspace_id: workspaceId,
        current_phase: 'queued',
        emails_received: 0,
        emails_classified: 0,
        last_error: null,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' },
    );

    // Server-side kick: create a pipeline_runs row + enqueue bb_import_jobs so the
    // import begins immediately. The frontend Continue-button gate (see
    // shouldKickEmailImport in src/lib/email/importStatus.ts) is a second line of
    // defence. Without this server-side enqueue, a user closing the tab after
    // connect but before Continue would leave the mailbox in 'queued' forever.
    // start-email-import and pipeline-worker-import both dedupe on
    // (workspace_id, config_id, state='running'), so calling this when a run is
    // already in flight is harmless.
    try {
      const { data: existingRun } = await supabase
        .from('pipeline_runs')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('config_id', configData.id)
        .eq('state', 'running')
        .limit(1)
        .maybeSingle();

      if (!existingRun) {
        const defaultCap = 2500;
        const { data: runRow, error: runError } = await supabase
          .from('pipeline_runs')
          .insert({
            workspace_id: workspaceId,
            config_id: configData.id,
            channel: 'email',
            mode: 'onboarding',
            state: 'running',
            params: {
              cap: defaultCap,
              folder_order: ['SENT', 'INBOX'],
              speed_phase: 'fast',
            },
            metrics: {
              fetched_so_far: 0,
              pages: 0,
              rate_limit_count: 0,
              import_done: false,
            },
          })
          .select('id')
          .single();

        if (!runError && runRow?.id) {
          await queueSend(
            supabase,
            'bb_import_jobs',
            {
              job_type: 'IMPORT_FETCH',
              workspace_id: workspaceId,
              run_id: runRow.id,
              config_id: configData.id,
              folder: 'SENT',
              pageToken: null,
              cap: defaultCap,
              fetched_so_far: 0,
              pages: 0,
              rate_limit_count: 0,
            },
            0,
          );

          // Best-effort worker wake. If this fails the pg_cron worker tick (10s)
          // will pick it up, so swallowing the error is intentional.
          try {
            await wakeWorker(supabase, 'pipeline-worker-import');
          } catch (wakeErr) {
            console.warn(
              '[aurinko-create-imap-account] wakeWorker pipeline-worker-import failed (pg_cron will retry):',
              wakeErr,
            );
          }
        } else if (runError) {
          console.error(
            '[aurinko-create-imap-account] Failed to create pipeline_runs row (frontend Continue will retry):',
            runError,
          );
        }
      }
    } catch (kickErr) {
      console.error(
        '[aurinko-create-imap-account] Server-side import kick failed (frontend Continue will retry):',
        kickErr,
      );
    }

    return new Response(JSON.stringify({ success: true, email }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[aurinko-create-imap-account] Error:', message);
    return errorResponse('INTERNAL_ERROR', message, {}, 500);
  }
});
