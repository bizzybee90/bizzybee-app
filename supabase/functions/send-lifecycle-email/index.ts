import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { corsResponse, jsonError, jsonOk } from '../_shared/response.ts';
import { createLogger } from '../_shared/logging.ts';
import { isTransactionalEmailKind, type TransactionalEmailKind } from '../_shared/resend.ts';
import { sendWorkspaceLifecycleEmail } from '../_shared/lifecycleEmail.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-bb-worker-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type SendLifecycleEmailRequest = {
  workspace_id?: string;
  kind?: TransactionalEmailKind;
};

function getInternalAuthError(): Response {
  return jsonError('Unauthorized', 401);
}

function hasInternalAccess(req: Request): boolean {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  const workerToken = Deno.env.get('BB_WORKER_TOKEN')?.trim();
  const authHeader = req.headers.get('Authorization')?.trim();
  const workerHeader = req.headers.get('x-bb-worker-token')?.trim();

  if (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`) {
    return true;
  }

  if (workerToken && workerHeader === workerToken) {
    return true;
  }

  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const logger = createLogger('send-lifecycle-email');

  try {
    if (req.method !== 'POST') {
      return jsonError('Method not allowed', 405);
    }

    if (!hasInternalAccess(req)) {
      return getInternalAuthError();
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    const resendApiKey = Deno.env.get('RESEND_API_KEY')?.trim();
    const appUrl = Deno.env.get('APP_URL')?.trim() || 'https://bizzybee.app';
    const supportEmail = Deno.env.get('BIZZYBEE_SUPPORT_EMAIL')?.trim() || 'support@bizzyb.ee';
    const transactionalFrom =
      Deno.env.get('RESEND_TRANSACTIONAL_FROM')?.trim() || 'BizzyBee <noreply@bizzyb.ee>';

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonError('Server misconfigured', 500);
    }

    if (!resendApiKey) {
      logger.error('Missing RESEND_API_KEY');
      return jsonError('Transactional email service unavailable', 500);
    }

    const bodyRaw = (await req.json().catch(() => ({}))) as SendLifecycleEmailRequest;
    const workspaceId = bodyRaw.workspace_id?.trim();
    const kind = bodyRaw.kind;

    if (!workspaceId) {
      return jsonError('workspace_id is required', 400);
    }

    if (!isTransactionalEmailKind(kind)) {
      return jsonError('Unsupported lifecycle email kind', 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-bb-component': 'transactional-email' } },
    });

    const result = await sendWorkspaceLifecycleEmail({
      supabase,
      resendApiKey,
      workspaceId,
      kind,
      appUrl,
      supportEmail,
      transactionalFrom,
      idempotencyKey: `lifecycle:${workspaceId}:${kind}`,
    });

    if (!result.sent) {
      if (result.reason === 'workspace_not_found') {
        return jsonError('Workspace not found', 404);
      }

      return jsonError('No recipient email found for workspace', 404);
    }

    logger.info('Sent lifecycle email', {
      workspace_id: workspaceId,
      kind,
      message_id: result.messageId ?? 'unknown',
    });

    return jsonOk({
      ok: true,
      workspace_id: workspaceId,
      kind,
      sent: true,
    });
  } catch (error) {
    logger.error('Lifecycle email failed', error as Error);
    return jsonError('Failed to send lifecycle email', 500);
  }
});
