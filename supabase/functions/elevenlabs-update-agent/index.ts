import { validateAuth, AuthError, authErrorResponse } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpdateAgentRequest {
  business_name?: string;
  business_description?: string;
  services?: unknown[];
  opening_hours?: Record<string, unknown>;
  booking_rules?: Record<string, unknown>;
  custom_instructions?: string;
  greeting_message?: string;
  voice_id?: string;
  voice_name?: string;
  max_call_duration_seconds?: number;
  transfer_number?: string;
  data_retention_days?: number;
  is_active?: boolean;
}

function formatServices(services: unknown[]): string {
  if (!services || services.length === 0) return 'Not specified';
  return services
    .map((s: any) => {
      if (typeof s === 'string') return `- ${s}`;
      if (s.name && s.price) return `- ${s.name}: ${s.price}`;
      if (s.name) return `- ${s.name}`;
      return `- ${JSON.stringify(s)}`;
    })
    .join('\n');
}

function formatOpeningHours(hours: Record<string, unknown>): string {
  if (!hours || Object.keys(hours).length === 0) return 'Not specified';
  return Object.entries(hours)
    .map(([day, time]) => {
      if (typeof time === 'string') return `${day}: ${time}`;
      if (time && typeof time === 'object' && 'open' in (time as any) && 'close' in (time as any)) {
        return `${day}: ${(time as any).open} - ${(time as any).close}`;
      }
      return `${day}: ${JSON.stringify(time)}`;
    })
    .join('\n');
}

function formatBookingRules(rules: Record<string, unknown>): string {
  if (!rules || Object.keys(rules).length === 0) return 'No specific booking rules configured.';
  return Object.entries(rules)
    .map(([key, value]) => `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join('\n');
}

function buildSystemPrompt(
  config: Record<string, any>,
  kbEntries: Array<{ title: string; content: string }>
): string {
  const servicesFormatted = formatServices(config.services || []);
  const hoursFormatted = formatOpeningHours(config.opening_hours || {});
  const bookingFormatted = formatBookingRules(config.booking_rules || {});

  const kbSection = kbEntries.length > 0
    ? kbEntries.map((entry) => `## ${entry.title}\n${entry.content}`).join('\n\n')
    : 'No additional knowledge base entries.';

  const customInstructions = config.custom_instructions
    ? `\n${config.custom_instructions}`
    : '';

  return `You are a friendly, professional AI receptionist for ${config.business_name}.

Your role is to answer incoming calls, help callers with their enquiries, and ensure no call goes unanswered.

ABOUT THE BUSINESS:
${config.business_description || 'No description provided.'}

SERVICES OFFERED:
${servicesFormatted}

OPENING HOURS:
${hoursFormatted}

KNOWLEDGE BASE:
${kbSection}

BOOKING RULES:
${bookingFormatted}

RULES:
- Be warm, friendly, professional
- Use natural British English
- Keep responses concise
- If unsure, offer callback
- Never make up information
- Always collect callback number if enquiry unresolved
- If asked if AI, answer honestly
- Never deny being AI${customInstructions}`;
}

function interpolateGreeting(greeting: string, businessName: string): string {
  return greeting
    .replace(/{business_name}/g, businessName)
    .replace(/{businessName}/g, businessName);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Authenticate
    const { workspaceId } = await validateAuth(req);

    // 2. Parse request body
    const updates: UpdateAgentRequest = await req.json();

    // 3. Init Supabase admin client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 4. Fetch current config
    const { data: config, error: fetchError } = await supabase
      .from('elevenlabs_agents')
      .select('*')
      .eq('workspace_id', workspaceId)
      .single();

    if (fetchError || !config) {
      return new Response(
        JSON.stringify({ error: 'AI phone agent not found for this workspace' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Build update object — only include fields that were provided
    const allowedFields = [
      'business_name', 'business_description', 'services', 'opening_hours',
      'booking_rules', 'custom_instructions', 'greeting_message', 'voice_id',
      'voice_name', 'max_call_duration_seconds', 'transfer_number',
      'data_retention_days', 'is_active',
    ] as const;

    const dbUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const field of allowedFields) {
      if (field in updates) {
        dbUpdate[field] = (updates as any)[field];
      }
    }

    // 6. Update DB row
    const { data: updatedConfig, error: updateError } = await supabase
      .from('elevenlabs_agents')
      .update(dbUpdate)
      .eq('id', config.id)
      .select('*')
      .single();

    if (updateError) {
      return new Response(
        JSON.stringify({ error: 'Failed to update agent config', details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Fetch active KB entries
    const { data: kbEntries } = await supabase
      .from('ai_phone_knowledge_base')
      .select('title, content')
      .eq('agent_id', updatedConfig.id)
      .eq('is_active', true);

    // 8. Build system prompt
    const systemPrompt = buildSystemPrompt(updatedConfig, kbEntries || []);

    // 9. Build ElevenLabs PATCH body
    const greetingMessage = interpolateGreeting(
      updatedConfig.greeting_message,
      updatedConfig.business_name
    );

    const builtInTools: Record<string, unknown> = {
      end_call: {},
      voicemail_detection: {},
      language_detection: {},
    };

    if (updatedConfig.transfer_number) {
      builtInTools.transfer_to_number = {};
    }

    const elevenLabsBody = {
      agent: {
        first_message: greetingMessage,
        prompt: {
          prompt: systemPrompt,
          llm: updatedConfig.llm_model,
          temperature: 0.2,
          built_in_tools: builtInTools,
        },
      },
      conversation: {
        tts: {
          model_id: "eleven_flash_v2_5",
          voice_id: updatedConfig.voice_id,
        },
        conversation: {
          max_duration_seconds: updatedConfig.max_call_duration_seconds,
        },
      },
    };

    // 10. PATCH ElevenLabs agent
    const elevenLabsApiKey = Deno.env.get('ELEVENLABS_API_KEY');
    if (!elevenLabsApiKey) {
      return new Response(
        JSON.stringify({ error: 'ELEVENLABS_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const elevenLabsResponse = await fetch(
      `https://api.elevenlabs.io/v1/convai/agents/${updatedConfig.elevenlabs_agent_id}`,
      {
        method: 'PATCH',
        headers: {
          'xi-api-key': elevenLabsApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(elevenLabsBody),
      }
    );

    if (!elevenLabsResponse.ok) {
      const errorText = await elevenLabsResponse.text();
      console.error('ElevenLabs API error:', elevenLabsResponse.status, errorText);
      return new Response(
        JSON.stringify({
          error: 'Failed to update ElevenLabs agent',
          status: elevenLabsResponse.status,
          details: errorText,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 11. Return updated config
    return new Response(
      JSON.stringify(updatedConfig),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }

    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
