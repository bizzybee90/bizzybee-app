import { createServiceClient, HttpError, isUuidLike, jsonResponse } from '../_shared/pipeline.ts';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';
import type { Channel, Direction, UnifiedMessage } from '../_shared/types.ts';

const VALID_CHANNELS = new Set<Channel>([
  'email',
  'whatsapp',
  'sms',
  'facebook',
  'instagram',
  'google_business',
  'voice',
]);
const VALID_DIRECTIONS = new Set<Direction>(['inbound', 'outbound']);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function corsResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function normalizeMessage(input: Record<string, unknown>): UnifiedMessage {
  const externalId = String(input.external_id || '').trim();
  const threadId = String(input.thread_id || '').trim();
  const channel = String(input.channel || '').trim() as Channel;
  const direction = String(input.direction || '').trim() as Direction;
  const fromIdentifier = String(input.from_identifier || '').trim();
  const toIdentifier = String(input.to_identifier || '').trim();

  if (!externalId || !threadId || !fromIdentifier || !toIdentifier) {
    throw new HttpError(
      400,
      'Each message must include external_id, thread_id, from_identifier, to_identifier',
    );
  }

  if (!VALID_CHANNELS.has(channel)) {
    throw new HttpError(400, `Unsupported message channel: ${channel}`);
  }

  if (!VALID_DIRECTIONS.has(direction)) {
    throw new HttpError(400, `Unsupported message direction: ${direction}`);
  }

  return {
    external_id: externalId,
    thread_id: threadId,
    channel,
    direction,
    from_identifier: fromIdentifier,
    from_name: input.from_name ? String(input.from_name) : null,
    to_identifier: toIdentifier,
    subject: input.subject ? String(input.subject) : null,
    body: input.body ? String(input.body) : '',
    body_html: input.body_html ? String(input.body_html) : null,
    timestamp: input.timestamp ? String(input.timestamp) : new Date().toISOString(),
    is_read: typeof input.is_read === 'boolean' ? input.is_read : true,
    metadata:
      typeof input.metadata === 'object' && input.metadata
        ? (input.metadata as Record<string, unknown>)
        : {},
    raw_payload:
      typeof input.raw_payload === 'object' && input.raw_payload
        ? (input.raw_payload as Record<string, unknown>)
        : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }

    const body = (await req.json()) as {
      workspace_id?: string;
      config_id?: string;
      run_id?: string | null;
      channel?: Channel;
      messages?: Record<string, unknown>[];
    };

    const workspaceId = body.workspace_id?.trim();
    const configId = body.config_id?.trim();
    const runId = body.run_id?.trim() || null;
    const channel = body.channel;
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (!workspaceId || !isUuidLike(workspaceId)) {
      throw new HttpError(400, 'workspace_id must be a UUID');
    }

    if (!configId || !isUuidLike(configId)) {
      throw new HttpError(400, 'config_id must be a UUID');
    }

    if (runId && !isUuidLike(runId)) {
      throw new HttpError(400, 'run_id must be a UUID when provided');
    }

    if (!channel || !VALID_CHANNELS.has(channel)) {
      throw new HttpError(400, 'channel must be one of: email, whatsapp, sms, facebook, voice');
    }

    const auth = await validateAuth(req, workspaceId);
    const canonicalWorkspaceId = auth.workspaceId;

    if (messages.length === 0) {
      return corsResponse({
        ok: true,
        received_count: 0,
        enqueued_count: 0,
        run_id: runId,
      });
    }

    const normalizedMessages = messages.map(normalizeMessage);
    for (const message of normalizedMessages) {
      if (message.channel !== channel) {
        throw new HttpError(400, 'All message.channel values must match request channel');
      }
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('bb_ingest_unified_messages', {
      p_workspace_id: canonicalWorkspaceId,
      p_config_id: configId,
      p_run_id: runId,
      p_channel: channel,
      p_messages: normalizedMessages,
    });

    if (error) {
      throw new Error(`bb_ingest_unified_messages failed: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return corsResponse({
      ok: true,
      received_count: row?.received_count ?? 0,
      enqueued_count: row?.enqueued_count ?? 0,
      run_id: row?.run_id ?? runId,
    });
  } catch (error) {
    console.error('unified-ingest error', error);
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    if (error instanceof HttpError) {
      return corsResponse({ ok: false, error: error.message }, error.status);
    }

    return corsResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected error',
      },
      500,
    );
  }
});
