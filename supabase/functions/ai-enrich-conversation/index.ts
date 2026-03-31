import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // --- DUAL AUTH CHECK (user JWT or service role) ---
  const authHeader = req.headers.get('Authorization');
  const isServiceRole = authHeader?.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if (!isServiceRole) {
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
  // --- END DUAL AUTH CHECK ---

  const startTime = Date.now();

  try {
    const { conversation_id, workspace_id } = await req.json();

    if (!conversation_id || !workspace_id) {
      return new Response(JSON.stringify({ error: 'Missing conversation_id or workspace_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch conversation + customer + messages
    const { data: conversation } = await supabase
      .from('conversations')
      .select('*, customer:customers(name, email, vip_status, sentiment_trend, intelligence, topics_discussed)')
      .eq('id', conversation_id)
      .single();

    if (!conversation) {
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: messages } = await supabase
      .from('messages')
      .select('body, direction, actor_name, created_at')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: true })
      .limit(10);

    if (!messages || messages.length === 0) {
      console.log('No messages found for conversation:', conversation_id);
      return new Response(JSON.stringify({ status: 'no_messages' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. Fetch relevant FAQs for draft context
    const { data: faqs } = await supabase
      .from('faqs')
      .select('question, answer')
      .eq('workspace_id', workspace_id)
      .eq('is_active', true)
      .limit(10);

    // 3. Fetch workspace context
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('name, industry, business_context')
      .eq('id', workspace_id)
      .single();

    // 4. Build the conversation thread text
    const threadText = messages.map(m =>
      `[${m.direction === 'inbound' ? 'CUSTOMER' : 'BUSINESS'}] ${m.actor_name || 'Unknown'}: ${(m.body || '').substring(0, 500)}`
    ).join('\n\n');

    const customerName = conversation.customer?.name || 'Unknown Customer';
    const customerEmail = conversation.customer?.email || '';
    const businessName = workspace?.name || 'the business';

    // 5. Build FAQ context for drafting
    const faqContext = (faqs && faqs.length > 0)
      ? `\nRelevant FAQs for this business:\n${faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}`
      : '';

    // 6. Single AI call - Claude Haiku generates everything
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

${faqContext}

IMPORTANT: Return ONLY valid JSON. No markdown, no backticks, no explanation.`;

    const userPrompt = `Email subject: ${conversation.title || 'No subject'}
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
        messages: [
          { role: 'user', content: userPrompt }
        ],
        system: systemPrompt,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('Anthropic API error:', aiResponse.status, errText);
      return new Response(JSON.stringify({ error: 'AI call failed', status: aiResponse.status }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const aiData = await aiResponse.json();
    const rawText = aiData.content?.[0]?.text || '';

    // Parse JSON response, handling potential markdown wrapping
    let enrichment;
    try {
      const cleanJson = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      enrichment = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error('Failed to parse AI response:', rawText.substring(0, 200));
      return new Response(JSON.stringify({ error: 'AI response parse failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 7. Write everything back to the conversation in ONE update
    const updatePayload: Record<string, any> = {
      summary_for_human: enrichment.summary || null,
      ai_sentiment: enrichment.sentiment || null,
      ai_reason_for_escalation: enrichment.why_this_needs_you || null,
      email_classification: enrichment.classification || null,
      requires_reply: enrichment.requires_reply ?? true,
      ai_draft_response: enrichment.draft_response || null,
      ai_confidence: 0.85,
    };

    // Only override pre-triage decision_bucket if pre-triage didn't set one
    if (!conversation.decision_bucket || conversation.decision_bucket === 'wait') {
      updatePayload.decision_bucket = enrichment.decision_bucket || 'wait';
      updatePayload.why_this_needs_you = enrichment.why_this_needs_you || null;
    }

    // Add urgency if column exists
    if (enrichment.urgency) {
      updatePayload.urgency = enrichment.urgency;
    }

    const { error: updateError } = await supabase
      .from('conversations')
      .update(updatePayload)
      .eq('id', conversation_id);

    if (updateError) {
      console.error('Failed to update conversation:', updateError);
      // Try with fewer fields in case some columns don't exist
      const safePayload = {
        summary_for_human: enrichment.summary || null,
        ai_sentiment: enrichment.sentiment || null,
        requires_reply: enrichment.requires_reply ?? true,
        ai_draft_response: enrichment.draft_response || null,
      };
      await supabase
        .from('conversations')
        .update(safePayload)
        .eq('id', conversation_id);
    }

    // 8. Update customer intelligence if we have a customer
    if (conversation.customer_id) {
      const existingIntel = (conversation.customer?.intelligence || {}) as Record<string, any>;
      const existingTopics = (conversation.customer as any)?.topics_discussed || [];

      // Merge new topics with existing, deduplicate
      const newTopics = enrichment.customer_topics || [];
      const mergedTopics = [...new Set([...existingTopics, ...newTopics])].slice(0, 15);

      // Compute message length from this conversation
      const avgMessageLength = messages
        ? Math.round(messages.filter((m: any) => m.direction === 'inbound').reduce((sum: number, m: any) => sum + (m.body?.length || 0), 0) / Math.max(1, messages.filter((m: any) => m.direction === 'inbound').length))
        : existingIntel?.communication_patterns?.message_length || null;

      // Build insights array from the enrichment
      const insights: Array<{ type: string; description: string; confidence: number }> = [];
      if (enrichment.customer_summary) {
        insights.push({ type: 'profile', description: enrichment.customer_summary, confidence: 0.85 });
      }
      if (enrichment.sentiment) {
        insights.push({ type: 'sentiment', description: `Customer sentiment is ${enrichment.sentiment}`, confidence: 0.8 });
      }
      if (enrichment.urgency) {
        insights.push({ type: 'urgency', description: `Typical urgency level: ${enrichment.urgency}`, confidence: 0.75 });
      }

      // Build the full intelligence JSON the frontend expects
      const intelligence = {
        ...existingIntel,
        summary: enrichment.customer_summary || existingIntel.summary || null,
        communication_patterns: {
          ...(existingIntel.communication_patterns || {}),
          tone: enrichment.customer_tone || existingIntel?.communication_patterns?.tone || null,
          message_length: avgMessageLength,
          typical_response_time: existingIntel?.communication_patterns?.typical_response_time || null,
        },
        topics_discussed: mergedTopics,
        insights: [
          ...(existingIntel.insights || []),
          ...insights,
        ].slice(-20),
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
        .eq('id', conversation.customer_id);

      // Write to customer_insights table
      const insightRows = insights.map(ins => ({
        customer_id: conversation.customer_id,
        workspace_id,
        insight_type: ins.type,
        insight_text: ins.description,
        confidence: ins.confidence,
      }));

      if (insightRows.length > 0) {
        const { error: insightsError } = await supabase
          .from('customer_insights')
          .upsert(insightRows, { onConflict: 'customer_id,insight_type' });

        if (insightsError) {
          console.warn('[ai-enrich] customer_insights upsert failed (table may not exist):', insightsError.message);
        }
      }
    }

    const processingTime = Date.now() - startTime;
    console.log(`[ai-enrich] Conversation ${conversation_id} enriched in ${processingTime}ms`);

    return new Response(JSON.stringify({
      status: 'enriched',
      processing_time_ms: processingTime,
      summary: enrichment.summary,
      decision_bucket: enrichment.decision_bucket,
      has_draft: !!enrichment.draft_response,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ai-enrich] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
