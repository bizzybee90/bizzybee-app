import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';
import {
  FeatureGuardError,
  featureGuardErrorResponse,
  requireFeature,
} from '../_shared/entitlements.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EnrichRequest {
  conversation_id?: string;
  workspace_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    let body: EnrichRequest;
    try {
      body = await req.clone().json();
    } catch {
      body = {};
    }

    const conversationId = body.conversation_id?.trim();
    if (!conversationId) {
      return new Response(JSON.stringify({ error: 'Missing conversation_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve workspace from the conversation record first; never trust workspace_id from caller body.
    const { data: scopedConversation, error: scopedConversationError } = await supabase
      .from('conversations')
      .select('id, workspace_id')
      .eq('id', conversationId)
      .maybeSingle();

    if (scopedConversationError) {
      throw new Error(`Failed to resolve conversation workspace: ${scopedConversationError.message}`);
    }

    if (!scopedConversation?.workspace_id) {
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const workspaceId = scopedConversation.workspace_id;

    try {
      await validateAuth(req, workspaceId);
    } catch (authErr: unknown) {
      if (authErr instanceof AuthError) return authErrorResponse(authErr);
      throw authErr;
    }

    try {
      await requireFeature({
        supabase,
        workspaceId,
        featureKey: 'ai_inbox',
        functionName: 'ai-enrich-conversation',
        action: 'enrich_conversation',
        context: { conversationId },
      });
    } catch (guardErr: unknown) {
      if (guardErr instanceof FeatureGuardError) {
        return featureGuardErrorResponse(guardErr, corsHeaders);
      }
      throw guardErr;
    }

    // Fetch the conversation with explicit workspace scoping.
    const { data: conversationData } = await supabase
      .from('conversations')
      .select(
        '*, customer:customers(name, email, vip_status, sentiment_trend, intelligence, topics_discussed)',
      )
      .eq('id', conversationId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!conversationData) {
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const conversation = conversationData as Record<string, unknown>;

    const { data: messages } = await supabase
      .from('messages')
      .select('body, direction, actor_name, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(10);

    if (!messages || messages.length === 0) {
      console.log('No messages found for conversation:', conversationId);
      return new Response(JSON.stringify({ status: 'no_messages' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: faqs } = await supabase
      .from('faqs')
      .select('question, answer')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .limit(10);

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('name, industry, business_context')
      .eq('id', workspaceId)
      .single();

    const threadText = messages
      .map(
        (message) =>
          `[${message.direction === 'inbound' ? 'CUSTOMER' : 'BUSINESS'}] ${
            message.actor_name || 'Unknown'
          }: ${(message.body || '').substring(0, 500)}`,
      )
      .join('\n\n');

    const customer = (conversation.customer as Record<string, unknown> | null) ?? null;
    const customerName = (customer?.name as string | undefined) || 'Unknown Customer';
    const customerEmail = (customer?.email as string | undefined) || '';
    const businessName = workspace?.name || 'the business';

    const { data: houseRules } = await supabase
      .from('house_rules')
      .select('rule_text')
      .eq('workspace_id', workspaceId)
      .eq('active', true)
      .order('created_at', { ascending: true });

    const faqContext =
      faqs && faqs.length > 0
        ? `\nRelevant FAQs for this business:\n${faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}`
        : '';

    const rulesContext =
      houseRules && houseRules.length > 0
        ? `\nBrand rules you must always follow — no exceptions:\n${houseRules.map((r: { rule_text: string }, i: number) => `${i + 1}. ${r.rule_text}`).join('\n')}`
        : '';

    const systemPrompt = `You are an AI assistant for ${businessName}, a UK-based service business. Analyze the email conversation and return a JSON object with these exact fields:

1. "summary" - A 1-2 sentence summary of what this conversation is about. Be specific.
2. "decision_bucket" - One of: "act_now" (urgent/complaint/cancellation), "quick_win" (simple reply needed), "wait" (FYI only, no action needed), "auto_handled" (newsletter/receipt/notification)
3. "why_this_needs_you" - A brief human-readable explanation of WHY this email needs attention (or why it doesn't). Be specific to the content.
4. "classification" - One of: "booking_request", "booking_change", "booking_cancellation", "quote_request", "complaint", "payment_query", "general_inquiry", "marketing_newsletter", "automated_notification", "receipt_confirmation", "spam", "other"
5. "requires_reply" - boolean, true if the customer is expecting a response
6. "sentiment" - One of: "positive", "negative", "neutral"
7. "urgency" - One of: "high", "medium", "low"
8. "draft_response" - If requires_reply is true, write a professional, friendly reply from ${businessName}. Match a warm but professional UK tone. Keep it concise. If requires_reply is false, set this to null.
9. "customer_summary" - A 1-2 sentence profile of this customer based on this conversation (e.g., "Regular residential customer, polite communicator, primarily interested in window cleaning services")
10. "customer_topics" - Array of 1-5 topic keywords discussed (e.g., ["window cleaning", "scheduling", "pricing"])
11. "customer_tone" - The customer's communication tone: one of "formal", "casual", "friendly", "frustrated", "neutral"

${faqContext}${rulesContext}

IMPORTANT: Return ONLY valid JSON. No markdown, no backticks, no explanation.`;

    const userPrompt = `Email subject: ${(conversation.title as string | undefined) || 'No subject'}
Customer: ${customerName} (${customerEmail})

Conversation thread:
${threadText}`;

    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('Anthropic API error:', aiResponse.status, errText);
      return new Response(JSON.stringify({ error: 'AI call failed', status: aiResponse.status }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiData = await aiResponse.json();
    const rawText = aiData.content?.[0]?.text || '';

    let enrichment: Record<string, unknown>;
    try {
      const cleanJson = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      enrichment = JSON.parse(cleanJson);
    } catch {
      console.error('Failed to parse AI response:', rawText.substring(0, 200));
      return new Response(JSON.stringify({ error: 'AI response parse failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const updatePayload: Record<string, unknown> = {
      summary_for_human: enrichment.summary || null,
      ai_sentiment: enrichment.sentiment || null,
      ai_reason_for_escalation: enrichment.why_this_needs_you || null,
      email_classification: enrichment.classification || null,
      requires_reply:
        typeof enrichment.requires_reply === 'boolean' ? enrichment.requires_reply : true,
      ai_draft_response: enrichment.draft_response || null,
      ai_confidence: 0.85,
    };

    if (!conversation.decision_bucket || conversation.decision_bucket === 'wait') {
      updatePayload.decision_bucket = enrichment.decision_bucket || 'wait';
      updatePayload.why_this_needs_you = enrichment.why_this_needs_you || null;
    }

    if (enrichment.urgency) {
      updatePayload.urgency = enrichment.urgency;
    }

    const { error: updateError } = await supabase
      .from('conversations')
      .update(updatePayload)
      .eq('id', conversationId)
      .eq('workspace_id', workspaceId);

    if (updateError) {
      console.error('Failed to update conversation:', updateError);
      const safePayload = {
        summary_for_human: enrichment.summary || null,
        ai_sentiment: enrichment.sentiment || null,
        requires_reply:
          typeof enrichment.requires_reply === 'boolean' ? enrichment.requires_reply : true,
        ai_draft_response: enrichment.draft_response || null,
      };
      await supabase
        .from('conversations')
        .update(safePayload)
        .eq('id', conversationId)
        .eq('workspace_id', workspaceId);
    }

    if (conversation.customer_id) {
      const existingIntel =
        ((customer?.intelligence as Record<string, unknown> | undefined) || {}) as Record<
          string,
          unknown
        >;
      const existingTopics = ((customer?.topics_discussed as string[] | undefined) || []) as string[];
      const newTopics = (enrichment.customer_topics as string[] | undefined) || [];
      const mergedTopics = [...new Set([...existingTopics, ...newTopics])].slice(0, 15);

      const inboundMessages = messages.filter((m: Record<string, unknown>) => m.direction === 'inbound');
      const avgMessageLength =
        inboundMessages.length > 0
          ? Math.round(
              inboundMessages.reduce((sum, m) => sum + String(m.body || '').length, 0) /
                inboundMessages.length,
            )
          : ((existingIntel.communication_patterns as Record<string, unknown> | undefined)
              ?.message_length as number | null) || null;

      const insights: Array<{ type: string; description: string; confidence: number }> = [];
      if (enrichment.customer_summary) {
        insights.push({
          type: 'profile',
          description: String(enrichment.customer_summary),
          confidence: 0.85,
        });
      }
      if (enrichment.sentiment) {
        insights.push({
          type: 'sentiment',
          description: `Customer sentiment is ${String(enrichment.sentiment)}`,
          confidence: 0.8,
        });
      }
      if (enrichment.urgency) {
        insights.push({
          type: 'urgency',
          description: `Typical urgency level: ${String(enrichment.urgency)}`,
          confidence: 0.75,
        });
      }

      const communicationPatterns = (existingIntel.communication_patterns ||
        {}) as Record<string, unknown>;

      const intelligence = {
        ...existingIntel,
        summary: enrichment.customer_summary || existingIntel.summary || null,
        communication_patterns: {
          ...communicationPatterns,
          tone: enrichment.customer_tone || communicationPatterns.tone || null,
          message_length: avgMessageLength,
          typical_response_time: communicationPatterns.typical_response_time || null,
        },
        topics_discussed: mergedTopics,
        insights: [...(((existingIntel.insights as unknown[]) || []) as unknown[]), ...insights].slice(-20),
        lifetime_value_estimate: existingIntel.lifetime_value_estimate || null,
        last_analyzed_at: new Date().toISOString(),
      };

      await supabase
        .from('customers')
        .update({
          sentiment_trend: enrichment.sentiment || null,
          topics_discussed: mergedTopics,
          intelligence,
          last_analyzed_at: new Date().toISOString(),
        })
        .eq('id', String(conversation.customer_id))
        .eq('workspace_id', workspaceId);

      const insightRows = insights.map((insight) => ({
        customer_id: conversation.customer_id,
        workspace_id: workspaceId,
        insight_type: insight.type,
        insight_text: insight.description,
        confidence: insight.confidence,
      }));

      if (insightRows.length > 0) {
        const { error: insightsError } = await supabase
          .from('customer_insights')
          .upsert(insightRows, { onConflict: 'customer_id,insight_type' });

        if (insightsError) {
          console.warn(
            '[ai-enrich] customer_insights upsert failed (table may not exist):',
            insightsError.message,
          );
        }
      }
    }

    const processingTime = Date.now() - startTime;
    console.log(`[ai-enrich] Conversation ${conversationId} enriched in ${processingTime}ms`);

    return new Response(
      JSON.stringify({
        status: 'enriched',
        processing_time_ms: processingTime,
        summary: enrichment.summary,
        decision_bucket: enrichment.decision_bucket,
        has_draft: Boolean(enrichment.draft_response),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    if (error instanceof FeatureGuardError) {
      return featureGuardErrorResponse(error, corsHeaders);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ai-enrich] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
