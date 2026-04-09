import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';

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

    // Create webhook subscription for incoming mail
    let subscriptionId: string | null = null;
    try {
      const subResponse = await fetchWithTimeout('https://api.aurinko.io/v1/subscriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resource: '/email/messages',
          notificationUrl: `${SUPABASE_URL}/functions/v1/aurinko-webhook`,
        }),
      });
      if (subResponse.ok) {
        const subData = await subResponse.json();
        subscriptionId = subData.id?.toString() ?? null;
      }
    } catch (subErr) {
      console.error('[aurinko-create-imap-account] Subscription failed:', subErr);
      // Continue anyway — the account itself is created
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
        current_phase: 'importing',
        emails_received: 0,
        emails_classified: 0,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' },
    );

    return new Response(JSON.stringify({ success: true, email }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[aurinko-create-imap-account] Error:', message);
    return errorResponse('INTERNAL_ERROR', message, {}, 500);
  }
});
