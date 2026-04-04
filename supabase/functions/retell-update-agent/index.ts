import { validateAuth, AuthError, authErrorResponse } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ServiceItem {
  name: string;
  description?: string;
  price_range?: string;
}

interface OpeningHoursDay {
  day: string;
  open: string;
  close: string;
  is_closed: boolean;
}

interface KnowledgeBaseEntry {
  title: string;
  content: string;
}

function buildSystemPrompt(config: Record<string, any>, knowledgeEntries: KnowledgeBaseEntry[]): string {
  // Format services
  const services = (config.services || []) as ServiceItem[];
  const servicesText = services.length > 0
    ? services.map(s => {
        let line = `- ${s.name}`;
        if (s.description) line += `: ${s.description}`;
        if (s.price_range) line += ` (${s.price_range})`;
        return line;
      }).join('\n')
    : 'No services listed.';

  // Format opening hours
  const hours = (config.opening_hours || []) as OpeningHoursDay[];
  const hoursText = hours.length > 0
    ? hours.map(h => {
        if (h.is_closed) return `- ${h.day}: Closed`;
        return `- ${h.day}: ${h.open} - ${h.close}`;
      }).join('\n')
    : 'Not specified.';

  // Format knowledge base
  const kbText = knowledgeEntries.length > 0
    ? knowledgeEntries.map(e => `${e.title}:\n${e.content}`).join('\n\n')
    : '';

  // Format booking rules
  const bookingRules = config.booking_rules
    ? config.booking_rules
    : "Take caller's preferred date/time and say someone will confirm.";

  // Transfer target
  const transferTarget = config.transfer_number
    ? `transfer to ${config.transfer_number}`
    : 'take a message';

  let prompt = `You are ${config.business_name || 'the business'}'s AI phone receptionist. You answer calls professionally, warmly, and concisely.

ABOUT THE BUSINESS:
${config.business_description || 'No description provided.'}

SERVICES OFFERED:
${servicesText}

OPENING HOURS:
${hoursText}`;

  if (kbText) {
    prompt += `\n\nKNOWLEDGE BASE:\n${kbText}`;
  }

  prompt += `

BOOKING RULES:
${bookingRules}

RULES:
- Keep responses to 1-3 sentences. You are on a phone call, not writing an essay.
- Always ask for the caller's name early in the conversation.
- If asked about pricing, give the ranges provided. Never make up prices.
- If unsure, say "I'm not sure about that, but I can take a message and have someone get back to you."
- If the caller is angry or the issue is complex, offer to ${transferTarget}.`;

  if (config.custom_instructions) {
    prompt += `\n- ${config.custom_instructions}`;
  }

  prompt += `
- Current date/time: will be injected at call time
- This call may be recorded for quality purposes.`;

  return prompt;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let auth;
    try {
      auth = await validateAuth(req);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err);
      throw err;
    }

    const { workspaceId } = auth;
    const body = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const retellApiKey = Deno.env.get('RETELL_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch current config
    const { data: currentConfig, error: fetchError } = await supabase
      .from('ai_phone_configs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .single();

    if (fetchError || !currentConfig) {
      return new Response(
        JSON.stringify({ error: 'AI Phone config not found. Please provision first.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build update object from allowed fields
    const allowedFields = [
      'business_name', 'business_description', 'services', 'opening_hours',
      'booking_rules', 'custom_instructions', 'greeting_message', 'voice_id',
      'voice_name', 'max_call_duration_seconds', 'transfer_number',
      'data_retention_days', 'is_active',
    ];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid fields to update.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    updates.updated_at = new Date().toISOString();

    // Update config in DB
    const { data: updatedConfig, error: updateError } = await supabase
      .from('ai_phone_configs')
      .update(updates)
      .eq('id', currentConfig.id)
      .select('*')
      .single();

    if (updateError) {
      throw new Error(`Failed to update config: ${updateError.message}`);
    }

    // Fetch active knowledge base entries
    const { data: kbEntries } = await supabase
      .from('ai_phone_knowledge_base')
      .select('title, content')
      .eq('config_id', currentConfig.id)
      .eq('is_active', true);

    // Build system prompt
    const systemPrompt = buildSystemPrompt(updatedConfig, (kbEntries || []) as KnowledgeBaseEntry[]);

    // Update Retell LLM with new prompt
    if (updatedConfig.retell_llm_id) {
      const llmResponse = await fetch(
        `https://api.retellai.com/update-retell-llm/${updatedConfig.retell_llm_id}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${retellApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ general_prompt: systemPrompt }),
        }
      );

      if (!llmResponse.ok) {
        const errBody = await llmResponse.text();
        console.error('Retell LLM update failed:', errBody);
        throw new Error(`Failed to update Retell LLM: ${llmResponse.status}`);
      }
    }

    // If voice changed, update the Retell agent
    if (updates.voice_id && updatedConfig.retell_agent_id) {
      const agentResponse = await fetch(
        `https://api.retellai.com/update-agent/${updatedConfig.retell_agent_id}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${retellApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            voice_id: updates.voice_id,
            voice_model: 'eleven_flash_v2_5',
          }),
        }
      );

      if (!agentResponse.ok) {
        const errBody = await agentResponse.text();
        console.error('Retell agent voice update failed:', errBody);
        throw new Error(`Failed to update Retell agent voice: ${agentResponse.status}`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, config: updatedConfig }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('retell-update-agent error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
