import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';
import {
  ALLOWED_VOICE_IDS,
  PREVIEW_COOLDOWN_SECONDS,
  PREVIEW_HOURLY_LIMIT,
  hashPreviewText,
  sanitizePreviewText,
} from '../_shared/voicePreview.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let auth: { userId: string; workspaceId: string };
  try {
    auth = await validateAuth(req);
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    return jsonResponse({ error: 'Authentication failed' }, 401);
  }

  let payload: { voice_id?: string; text?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const voiceId = payload.voice_id?.trim();
  if (!voiceId || !ALLOWED_VOICE_IDS.has(voiceId)) {
    return jsonResponse({ error: 'Unsupported voice selected for preview' }, 400);
  }

  const previewText = sanitizePreviewText(payload.text);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const now = Date.now();
  const cooldownCutoff = new Date(now - PREVIEW_COOLDOWN_SECONDS * 1000).toISOString();
  const hourCutoff = new Date(now - 60 * 60 * 1000).toISOString();

  const { data: recentRequests, error: recentError } = await supabase
    .from('voice_preview_requests')
    .select('created_at')
    .eq('workspace_id', auth.workspaceId)
    .eq('user_id', auth.userId)
    .gte('created_at', hourCutoff)
    .order('created_at', { ascending: false });

  if (recentError) {
    console.error('[elevenlabs-voice-preview] Failed to read preview audit log:', recentError);
    return jsonResponse({ error: 'Could not validate preview request' }, 500);
  }

  if ((recentRequests?.length ?? 0) >= PREVIEW_HOURLY_LIMIT) {
    return jsonResponse(
      { error: 'You have reached the hourly voice preview limit. Please try again later.' },
      429,
    );
  }

  if ((recentRequests?.[0]?.created_at ?? '') >= cooldownCutoff) {
    return jsonResponse(
      { error: 'Please wait a few seconds before previewing another voice.' },
      429,
    );
  }

  const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
  if (!apiKey) {
    console.error('[elevenlabs-voice-preview] ELEVENLABS_API_KEY not configured');
    return jsonResponse({ error: 'Voice previews are not configured' }, 500);
  }

  const elevenLabsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: previewText,
      model_id: 'eleven_flash_v2_5',
      output_format: 'mp3_44100_128',
    }),
  });

  if (!elevenLabsResponse.ok) {
    const errorText = await elevenLabsResponse.text();
    console.error(
      `[elevenlabs-voice-preview] ElevenLabs request failed (${elevenLabsResponse.status}): ${errorText}`,
    );
    return jsonResponse({ error: 'Failed to generate voice preview' }, 502);
  }

  const previewTextHash = await hashPreviewText(previewText);
  const { error: insertError } = await supabase.from('voice_preview_requests').insert({
    workspace_id: auth.workspaceId,
    user_id: auth.userId,
    voice_id: voiceId,
    preview_text_hash: previewTextHash,
  });

  if (insertError) {
    console.error('[elevenlabs-voice-preview] Failed to insert preview audit row:', insertError);
  }

  return new Response(elevenLabsResponse.body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
});
