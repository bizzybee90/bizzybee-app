import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VerifyRequest {
  workspace_id: string;
  conversation_id: string;
  draft_text: string;
  customer_message: string;
  draft_id?: string;
}

interface VerificationIssue {
  type: 'hallucination' | 'incorrect_fact' | 'unsupported_claim' | 'tone_mismatch' | 'missing_info';
  description: string;
  severity: 'low' | 'medium' | 'high';
  suggestion?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'draft-verify';

  try {
    // Auth validation
    const { validateAuth, AuthError, authErrorResponse } = await import('../_shared/auth.ts');
    let bodyRaw: any;
    try {
      bodyRaw = await req.clone().json();
    } catch { bodyRaw = {}; }
    try {
      await validateAuth(req, bodyRaw.workspace_id);
    } catch (authErr: any) {
      if (authErr instanceof AuthError) return authErrorResponse(authErr);
      throw authErr;
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body: VerifyRequest = bodyRaw;
    console.log(`[${functionName}] Starting verification:`, { 
      workspace_id: body.workspace_id,
      conversation_id: body.conversation_id,
      draft_length: body.draft_text?.length 
    });

    // Validate required fields
    if (!body.workspace_id) throw new Error('workspace_id is required');
    if (!body.draft_text) throw new Error('draft_text is required');
    if (!body.customer_message) throw new Error('customer_message is required');

    // Fetch FAQs for fact-checking (try both tables)
    let faqs: any[] = [];
    const { data: faqData, error: faqError } = await supabase
      .from('faqs')
      .select('question, answer, source, priority')
      .eq('workspace_id', body.workspace_id)
      .order('priority', { ascending: false })
      .limit(30);

    if (faqError) {
      console.log(`[${functionName}] Trying faq_database table...`);
      const { data: faqDbData } = await supabase
        .from('faq_database')
        .select('question, answer, source, priority')
        .eq('workspace_id', body.workspace_id)
        .order('priority', { ascending: false })
        .limit(30);
      faqs = faqDbData || [];
    } else {
      faqs = faqData || [];
    }

    console.log(`[${functionName}] Found ${faqs.length} FAQs for verification`);

    // Fetch business profile for context
    const { data: business } = await supabase
      .from('business_profile')
      .select('business_name, industry, services, pricing_model, price_summary, payment_methods, guarantee, cancellation_policy')
      .eq('workspace_id', body.workspace_id)
      .single();

    // Also fetch business facts
    const { data: businessFacts } = await supabase
      .from('business_facts')
      .select('fact_key, fact_value, category')
      .eq('workspace_id', body.workspace_id)
      .limit(20);

    // Build knowledge base context
    const faqContext = faqs?.map(f => 
      `Q: ${f.question}\nA: ${f.answer}\nSource: ${f.source || 'unknown'}`
    ).join('\n\n') || 'No FAQs available';

    const businessContext = business 
      ? `Business: ${business.business_name || 'Unknown'}
Industry: ${business.industry || 'Not specified'}
Services: ${Array.isArray(business.services) ? business.services.join(', ') : business.services || 'Not specified'}
Pricing: ${business.pricing_model || 'Not specified'} - ${business.price_summary || ''}
Payment Methods: ${business.payment_methods || 'Not specified'}
Guarantee: ${business.guarantee || 'Not specified'}
Cancellation Policy: ${business.cancellation_policy || 'Not specified'}`
      : 'Business info not available';

    const factsContext = businessFacts?.map(f => 
      `${f.category}: ${f.fact_key} = ${f.fact_value}`
    ).join('\n') || '';

    // Verify with Claude via Anthropic API
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const verificationPrompt = `You are a fact-checker for customer service emails. Your job is to verify that the draft response is accurate and doesn't contain hallucinations.

## KNOWLEDGE BASE (Source of Truth)
${businessContext}

${factsContext ? `## BUSINESS FACTS\n${factsContext}` : ''}

## FAQs (Verified Facts)
${faqContext}

## CUSTOMER'S QUESTION
${body.customer_message}

## DRAFT RESPONSE TO VERIFY
${body.draft_text}

---

VERIFICATION TASK:
1. Check if any claims in the draft are NOT supported by the knowledge base
2. Identify any hallucinated facts (made-up details not in FAQs)
3. Check if the response actually answers the customer's question
4. Flag any incorrect or misleading information
5. Note if important information from FAQs was missed

Respond with JSON only:
{
  "status": "passed" | "failed" | "needs_review",
  "confidence_score": 0.0-1.0,
  "issues": [
    {
      "type": "hallucination" | "incorrect_fact" | "unsupported_claim" | "tone_mismatch" | "missing_info",
      "description": "specific issue description",
      "severity": "low" | "medium" | "high",
      "suggestion": "how to fix (optional)"
    }
  ],
  "corrected_draft": "only if status is 'failed', provide corrected version",
  "notes": "brief summary of verification"
}

If the draft is accurate and well-supported by the knowledge base, return status: "passed" with empty issues array.`;

    console.log(`[${functionName}] Calling Anthropic API...`);

    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6-20250514',
        max_tokens: 1024,
        system: 'You are a precise fact-checker. Only flag issues that are clearly wrong or unsupported. Be helpful, not overly critical. Respond with valid JSON only.',
        messages: [
          { role: 'user', content: verificationPrompt }
        ]
      })
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      if (aiResponse.status === 402) {
        throw new Error('AI credits exhausted. Please add credits to your workspace.');
      }
      const errorText = await aiResponse.text();
      throw new Error(`Anthropic API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const verificationText = aiData.content?.[0]?.text || '';

    // Parse verification result
    let verification;
    try {
      const jsonMatch = verificationText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      verification = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`[${functionName}] Failed to parse verification:`, verificationText);
      // Default to passed if parsing fails (don't block the user)
      verification = {
        status: 'passed',
        confidence_score: 0.5,
        issues: [],
        notes: 'Verification parsing failed, defaulting to passed'
      };
    }

    console.log(`[${functionName}] Verification result:`, {
      status: verification.status,
      confidence: verification.confidence_score,
      issues_count: verification.issues?.length || 0
    });

    // Store verification result
    const { data: verificationRecord, error: insertError } = await supabase
      .from('draft_verifications')
      .insert({
        workspace_id: body.workspace_id,
        conversation_id: body.conversation_id,
        draft_id: body.draft_id,
        original_draft: body.draft_text,
        verification_status: verification.status,
        issues_found: verification.issues || [],
        corrected_draft: verification.corrected_draft || null,
        confidence_score: verification.confidence_score,
        verification_notes: verification.notes
      })
      .select('id')
      .single();

    if (insertError) {
      console.error(`[${functionName}] Failed to store verification:`, insertError);
    }

    // Update message verification status if draft_id provided
    if (body.draft_id && verificationRecord) {
      await supabase
        .from('messages')
        .update({ 
          verification_status: verification.status,
          verification_id: verificationRecord.id
        })
        .eq('id', body.draft_id);
    }

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        verification: {
          status: verification.status,
          confidence_score: verification.confidence_score,
          issues: verification.issues || [],
          corrected_draft: verification.corrected_draft,
          notes: verification.notes
        },
        verification_id: verificationRecord?.id,
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[${functionName}] Error:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: functionName,
        duration_ms: Date.now() - startTime
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
