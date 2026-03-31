import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalyzeRequest {
  workspace_id: string;
  image_url: string;
  analysis_type: 'quote' | 'damage' | 'receipt' | 'property' | 'general';
  message_id?: string;
  customer_message?: string;
  context?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // --- AUTH CHECK ---
  const authHeader = req.headers.get('Authorization');
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
  // --- END AUTH CHECK ---

  const startTime = Date.now();
  const functionName = 'image-analyze';

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body: AnalyzeRequest = await req.json();
    console.log(`[${functionName}] Request:`, { 
      workspace_id: body.workspace_id,
      analysis_type: body.analysis_type,
      has_image: !!body.image_url
    });

    if (!body.workspace_id) throw new Error('workspace_id is required');
    if (!body.image_url) throw new Error('image_url is required');

    const analysisType = body.analysis_type || 'general';

    // Get business context for tailored analysis
    const { data: businessProfile } = await supabase
      .from('business_profile')
      .select('business_name, industry, services')
      .eq('workspace_id', body.workspace_id)
      .single();

    const industry = businessProfile?.industry || 'general services';
    const services = businessProfile?.services || [];

    // Build analysis prompt based on type
    let analysisPrompt = '';
    
    switch (analysisType) {
      case 'quote':
        analysisPrompt = `You are a ${industry} professional analyzing an image to help provide a quote.

Customer's message: ${body.customer_message || 'No message provided'}

Analyze this image and extract:
1. What work is needed (describe the job/project)
2. Size/scope estimate (e.g., square footage, number of items, complexity)
3. Condition assessment (current state, any challenges)
4. Special considerations (access issues, safety concerns, materials needed)
5. Suggested quote range based on typical industry pricing

${services.length > 0 ? `Our services include: ${services.join(', ')}` : ''}

Return JSON:
{
  "job_description": "detailed description of the work needed",
  "scope": {
    "size_estimate": "measurement or quantity",
    "complexity": "simple|moderate|complex",
    "estimated_duration": "time estimate"
  },
  "condition": {
    "current_state": "description",
    "challenges": ["challenge1", "challenge2"]
  },
  "materials_needed": ["material1", "material2"],
  "quote_factors": ["factor affecting price 1", "factor 2"],
  "suggested_response": "A professional response to send the customer",
  "confidence": 0.0-1.0
}`;
        break;

      case 'damage':
        analysisPrompt = `You are an insurance/damage assessment professional analyzing an image.

Customer's message: ${body.customer_message || 'No message provided'}

Analyze this image and assess:
1. Type of damage visible
2. Severity level (minor/moderate/severe)
3. Likely cause if apparent
4. Areas affected
5. Safety concerns
6. Recommended next steps

Return JSON:
{
  "damage_type": "type of damage (water, fire, structural, etc.)",
  "severity": "minor|moderate|severe|critical",
  "areas_affected": ["area1", "area2"],
  "likely_cause": "description of probable cause",
  "safety_concerns": ["concern1", "concern2"],
  "recommended_actions": ["action1", "action2"],
  "urgency": "immediate|soon|routine",
  "suggested_response": "A professional response to send the customer",
  "confidence": 0.0-1.0
}`;
        break;

      case 'receipt':
        analysisPrompt = `Extract information from this receipt/invoice image.

Customer's message: ${body.customer_message || 'No message provided'}

Extract:
1. Vendor/business name
2. Date
3. Items/services listed
4. Amounts
5. Total

Return JSON:
{
  "vendor": "business name on receipt",
  "date": "date if visible",
  "items": [{"description": "item name", "quantity": 1, "amount": 0.00}],
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00,
  "payment_method": "cash|card|other if visible",
  "relevant_notes": ["any important notes or terms"],
  "suggested_response": "A professional response acknowledging the receipt",
  "confidence": 0.0-1.0
}`;
        break;

      case 'property':
        analysisPrompt = `You are a property assessment professional analyzing an image.

Customer's message: ${body.customer_message || 'No message provided'}

Analyze this image and identify:
1. Property type and characteristics
2. Approximate size/dimensions if visible
3. Current condition
4. Notable features
5. Potential service needs

Return JSON:
{
  "property_type": "residential|commercial|industrial",
  "characteristics": ["feature1", "feature2"],
  "size_estimate": "approximate dimensions or area",
  "condition": "excellent|good|fair|poor",
  "notable_features": ["feature1", "feature2"],
  "potential_services": ["service1", "service2"],
  "suggested_response": "A professional response to send the customer",
  "confidence": 0.0-1.0
}`;
        break;

      default:
        analysisPrompt = `Analyze this image in the context of customer service for a ${industry} business.

Customer's message: ${body.customer_message || 'No message provided'}

Describe what you see and extract any relevant information for responding to the customer.

Return JSON:
{
  "description": "detailed description of image contents",
  "relevant_details": ["detail1", "detail2"],
  "customer_intent": "what the customer likely wants",
  "action_items": ["action1", "action2"],
  "suggested_response": "A professional response to send the customer",
  "confidence": 0.0-1.0
}`;
    }

    // Analyze with vision model
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    console.log(`[${functionName}] Analyzing image with Claude Vision...`);

    // Fetch the image and convert to base64 for Anthropic's Messages API
    const imageResponse = await fetch(body.image_url);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    }
    const imageContentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBase64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));

    // Determine supported media type
    const supportedMediaTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const mediaType = supportedMediaTypes.includes(imageContentType)
      ? imageContentType
      : 'image/jpeg';

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
        system: 'You are an expert at analyzing images for business purposes. Be specific and practical. Return valid JSON only.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: imageBase64
                }
              },
              { type: 'text', text: analysisPrompt }
            ]
          }
        ]
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`Anthropic API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const analysisText = aiData.content?.[0]?.text || '';

    // Parse analysis
    let analysis;
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      analysis = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`[${functionName}] Failed to parse analysis:`, analysisText);
      analysis = {
        description: analysisText,
        confidence: 0.5,
        suggested_response: 'Thank you for sharing this image. Let me take a closer look and get back to you with more details.'
      };
    }

    console.log(`[${functionName}] Analysis complete, confidence: ${analysis.confidence}`);

    // Store analysis result
    const { data: storedAnalysis, error: insertError } = await supabase
      .from('image_analyses')
      .insert({
        workspace_id: body.workspace_id,
        message_id: body.message_id,
        image_url: body.image_url,
        analysis_type: analysisType,
        extracted_data: analysis,
        description: analysis.description || analysis.job_description || JSON.stringify(analysis).slice(0, 500),
        suggested_response: analysis.suggested_response,
        confidence: analysis.confidence
      })
      .select('id')
      .single();

    if (insertError) {
      console.error(`[${functionName}] Failed to store analysis:`, insertError);
    }

    // Update message if provided
    if (body.message_id) {
      await supabase
        .from('messages')
        .update({ has_attachments: true })
        .eq('id', body.message_id);
    }

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        analysis_id: storedAnalysis?.id,
        analysis_type: analysisType,
        result: analysis,
        suggested_response: analysis.suggested_response,
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
