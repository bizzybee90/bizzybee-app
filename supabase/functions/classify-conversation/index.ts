import { createServiceClient } from '../_shared/pipeline.ts';
import {
  applyClassification,
  classifySingleConversation,
  decisionForClassification,
} from '../_shared/classification.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  conversation_id?: string;
  workspace_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { validateAuth, AuthError, authErrorResponse } = await import('../_shared/auth.ts');
    let body: RequestBody;
    try {
      body = await req.clone().json();
    } catch {
      body = {};
    }

    const conversationId = body.conversation_id?.trim();
    if (!conversationId) {
      throw new Error('conversation_id is required');
    }

    const supabase = createServiceClient();
    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select(
        'id, workspace_id, title, channel, email_classification, decision_bucket, triage_confidence, last_inbound_message_id, last_classified_message_id',
      )
      .eq('id', conversationId)
      .single();

    if (conversationError || !conversation) {
      throw new Error(`Conversation not found: ${conversationError?.message || conversationId}`);
    }

    const workspaceId = body.workspace_id?.trim() || conversation.workspace_id;

    try {
      await validateAuth(req, workspaceId);
    } catch (authErr: unknown) {
      if (authErr instanceof AuthError) {
        return authErrorResponse(authErr);
      }
      throw authErr;
    }

    if (conversation.channel !== 'email') {
      throw new Error('Only email conversations can be re-triaged');
    }

    if (!conversation.last_inbound_message_id) {
      throw new Error('Conversation has no inbound message to classify');
    }

    const { data: recentMessages, error: recentMessagesError } = await supabase
      .from('messages')
      .select('direction, body')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(6);

    if (recentMessagesError) {
      throw new Error(`Failed to load recent messages: ${recentMessagesError.message}`);
    }

    const classification = await classifySingleConversation({
      workspaceId,
      conversationId,
      eventId: conversation.last_inbound_message_id,
      targetMessageId: conversation.last_inbound_message_id,
      recentMessages: (recentMessages || []) as Array<{ direction: string; body: string }>,
    });

    const updatedDecision = decisionForClassification(
      classification.result,
      classification.forcedDecisionBucket,
      classification.forcedStatus,
    );

    await applyClassification({
      job: {
        workspace_id: workspaceId,
        run_id: null,
        conversation_id: conversationId,
        target_message_id: conversation.last_inbound_message_id,
        event_id: conversation.last_inbound_message_id,
      },
      result: classification.result,
      forcedDecisionBucket: classification.forcedDecisionBucket,
      forcedStatus: classification.forcedStatus,
      forceReclassify: true,
    });

    const originalClassification = conversation.email_classification || 'unknown';
    const originalBucket = conversation.decision_bucket || 'quick_win';
    const originalConfidence = conversation.triage_confidence ?? null;
    const changed =
      originalClassification !== classification.result.category ||
      originalBucket !== updatedDecision.decisionBucket;

    return new Response(
      JSON.stringify({
        success: true,
        changed,
        source: classification.source,
        original: {
          classification: originalClassification,
          bucket: originalBucket,
          confidence: originalConfidence,
        },
        updated: {
          classification: classification.result.category,
          bucket: updatedDecision.decisionBucket,
          confidence: classification.result.confidence,
          why_this_needs_you: classification.result.why_this_needs_you || null,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[classify-conversation] Error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
