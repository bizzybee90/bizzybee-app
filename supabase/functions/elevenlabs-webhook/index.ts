import { createServiceClient } from '../_shared/pipeline.ts';
import { EntitlementGuardError, requireEntitlement } from '../_shared/entitlements.ts';
import { captureEdgeException } from '../_shared/sentry.ts';
import { verifyElevenLabsSignatureValue } from '../_shared/elevenlabsWebhookAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

class WebhookAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

async function verifyElevenLabsSignature(rawBody: string, req: Request): Promise<void> {
  const secret = Deno.env.get('ELEVENLABS_WEBHOOK_SECRET')?.trim();
  if (!secret) {
    console.error('[elevenlabs-webhook] ELEVENLABS_WEBHOOK_SECRET not set');
    throw new WebhookAuthError('Server misconfigured', 500);
  }

  const provided = req.headers.get('ElevenLabs-Signature')?.trim();
  if (!provided) {
    throw new WebhookAuthError('Missing ElevenLabs-Signature header');
  }

  try {
    await verifyElevenLabsSignatureValue({
      header: provided,
      rawBody,
      secret,
    });
  } catch (error) {
    console.error('[elevenlabs-webhook] Signature verification failed:', error);
    throw new WebhookAuthError('Invalid ElevenLabs signature');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveSentiment(analysis: Record<string, unknown> | undefined): string {
  if (!analysis) return 'neutral';
  const summary = (analysis.transcript_summary as string) || '';
  const lower = summary.toLowerCase();
  if (
    lower.includes('angry') ||
    lower.includes('frustrated') ||
    lower.includes('upset') ||
    lower.includes('complaint')
  ) {
    return 'negative';
  }
  if (
    lower.includes('happy') ||
    lower.includes('pleased') ||
    lower.includes('thank') ||
    lower.includes('great')
  ) {
    return 'positive';
  }
  return 'neutral';
}

function deriveOutcome(success: string | undefined): string {
  return success === 'success' ? 'resolved' : 'abandoned';
}

function currentMonthFirst(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const rawBody = await req.text();

    // Verify signature
    await verifyElevenLabsSignature(rawBody, req);

    const payload = JSON.parse(rawBody);
    const eventType: string = payload.type ?? 'unknown';

    // Only process post_call_transcription
    if (eventType !== 'post_call_transcription') {
      console.log(`[elevenlabs-webhook] Ignoring event type: ${eventType}`);
      return new Response(JSON.stringify({ ok: true, skipped: eventType }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = payload.data ?? {};
    const agentId: string = data.agent_id;
    const conversationId: string = data.conversation_id;
    const transcript: unknown[] = data.transcript ?? [];
    const analysis = data.analysis as Record<string, unknown> | undefined;
    const metadata = data.metadata as Record<string, unknown> | undefined;
    const initMeta = data.conversation_initiation_metadata as Record<string, unknown> | undefined;

    const summary = (analysis?.transcript_summary as string) ?? null;
    const success = (analysis?.call_successful as string) ?? null;
    const duration = (metadata?.call_duration_secs as number) ?? 0;
    const cost = (metadata?.cost as number) ?? 0;
    const callerNumber = (initMeta?.caller_id as string) ?? null;

    const sentiment = deriveSentiment(analysis);
    const outcome = deriveOutcome(success ?? undefined);
    const costCents = Math.round((duration / 60) * 18);
    const requiresFollowup =
      sentiment === 'negative' || outcome === 'message_taken' || outcome === 'transferred';

    // DB operations
    const supabase = createServiceClient();

    // Look up the agent
    const { data: agentRow, error: agentErr } = await supabase
      .from('elevenlabs_agents')
      .select('id, workspace_id')
      .eq('elevenlabs_agent_id', agentId)
      .maybeSingle();

    if (agentErr) {
      console.error(`[elevenlabs-webhook] Error looking up agent: ${agentErr.message}`);
      return new Response(JSON.stringify({ ok: true, error: 'agent_lookup_failed' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!agentRow) {
      console.warn(`[elevenlabs-webhook] No agent found for elevenlabs_agent_id=${agentId}`);
      return new Response(JSON.stringify({ ok: true, warning: 'agent_not_found' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const workspaceId: string = agentRow.workspace_id;
    const dbAgentId: string = agentRow.id;

    try {
      await requireEntitlement({
        supabase,
        workspaceId,
        entitlementKey: 'ai_phone',
        functionName: 'elevenlabs-webhook',
        action: 'process_ai_phone_call_event',
        context: {
          eventType,
          conversationId,
          agentId,
        },
      });
    } catch (error) {
      if (error instanceof EntitlementGuardError) {
        return new Response(
          JSON.stringify({
            ok: true,
            skipped: 'billing_guard_blocked',
            entitlement_key: error.evaluation.entitlementKey,
            rollout_mode: error.evaluation.rolloutMode,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }
      throw error;
    }

    // Insert call log
    const { error: insertErr } = await supabase.from('call_logs').insert({
      workspace_id: workspaceId,
      agent_id: dbAgentId,
      elevenlabs_conversation_id: conversationId,
      direction: 'inbound',
      caller_number: callerNumber,
      status: 'completed',
      duration_seconds: duration,
      transcript: transcript,
      summary: summary,
      success_evaluation: success === 'success',
      cost_cents: costCents,
      sentiment: sentiment,
      outcome: outcome,
      requires_followup: requiresFollowup,
      actions_taken: requiresFollowup
        ? {
            suggested_followup: true,
            source: 'native_ai_phone_post_call',
            reason: sentiment === 'negative' ? 'negative_sentiment' : outcome,
          }
        : null,
    });

    if (insertErr) {
      console.error(`[elevenlabs-webhook] Error inserting call_log: ${insertErr.message}`);
      // Still return 200 so ElevenLabs doesn't retry
    } else {
      console.log(
        `[elevenlabs-webhook] Saved call_log for conversation=${conversationId} workspace=${workspaceId}`,
      );
    }

    // Upsert usage
    const { error: usageErr } = await supabase.rpc('upsert_ai_phone_usage', {
      p_workspace_id: workspaceId,
      p_month: currentMonthFirst(),
      p_calls: 1,
      p_minutes: duration / 60,
      p_cost_cents: costCents,
    });

    if (usageErr) {
      console.error(`[elevenlabs-webhook] Error upserting usage: ${usageErr.message}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof WebhookAuthError) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: err.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const message = err instanceof Error ? err.message : String(err);
    console.error(`[elevenlabs-webhook] Unhandled error: ${message}`);
    await captureEdgeException({
      functionName: 'elevenlabs-webhook',
      error: err,
    });

    return new Response(JSON.stringify({ ok: false, error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
