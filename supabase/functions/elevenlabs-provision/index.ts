import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateAuth, AuthError, authErrorResponse } from "../_shared/auth.ts";
import {
  EntitlementGuardError,
  entitlementGuardErrorResponse,
  requireEntitlement,
} from "../_shared/entitlements.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Service {
  name: string;
  description: string;
  price_from?: number;
  price_to?: number;
  duration_minutes?: number;
}

interface OpeningHour {
  open: string;
  close: string;
  closed?: boolean;
}

interface BookingRules {
  allow_booking: boolean;
  booking_url?: string;
  booking_instructions?: string;
}

interface ProvisionRequest {
  business_name: string;
  business_description?: string;
  services?: Service[];
  opening_hours?: Record<string, OpeningHour>;
  booking_rules?: BookingRules;
  custom_instructions?: string;
  greeting_message?: string;
  voice_id?: string;
  voice_name?: string;
  max_call_duration_seconds?: number;
  transfer_number?: string;
  data_retention_days?: number;
}

// ---------------------------------------------------------------------------
// Helpers – Twilio API
// ---------------------------------------------------------------------------

function twilioAuthHeader(): string {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const token = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  return "Basic " + btoa(`${sid}:${token}`);
}

function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function twilioGet(url: string) {
  const res = await fetch(url, {
    headers: { Authorization: twilioAuthHeader() },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio GET failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function twilioPost(url: string, params: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: twilioAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formEncode(params),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio POST failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildSystemPrompt(config: ProvisionRequest): string {
  const parts: string[] = [];

  parts.push(
    `You are a friendly, professional AI receptionist for ${config.business_name}.`
  );
  parts.push(
    `\nYour role is to answer incoming calls, help callers with their enquiries, and ensure no call goes unanswered.`
  );

  if (config.business_description) {
    parts.push(`\nABOUT THE BUSINESS:\n${config.business_description}`);
  }

  if (config.services?.length) {
    const formatted = config.services
      .map((s) => {
        let line = `- ${s.name}`;
        if (s.description) line += `: ${s.description}`;
        if (s.price_from != null && s.price_to != null) {
          line += ` (£${s.price_from}–£${s.price_to})`;
        } else if (s.price_from != null) {
          line += ` (from £${s.price_from})`;
        }
        if (s.duration_minutes) line += ` [~${s.duration_minutes} min]`;
        return line;
      })
      .join("\n");
    parts.push(`\nSERVICES OFFERED:\n${formatted}`);
  }

  if (config.opening_hours) {
    const dayOrder = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    const formatted = dayOrder
      .map((day) => {
        const h = config.opening_hours![day];
        if (!h || h.closed) return `- ${capitalise(day)}: Closed`;
        return `- ${capitalise(day)}: ${h.open} – ${h.close}`;
      })
      .join("\n");
    parts.push(`\nOPENING HOURS:\n${formatted}`);
  }

  if (config.booking_rules) {
    const br = config.booking_rules;
    if (br.allow_booking) {
      let line = "Booking is available.";
      if (br.booking_url) line += ` Direct callers to: ${br.booking_url}`;
      if (br.booking_instructions) line += ` ${br.booking_instructions}`;
      parts.push(`\nBOOKING RULES:\n${line}`);
    } else {
      parts.push(
        `\nBOOKING RULES:\nTake the caller's preferred date/time and say someone will confirm.`
      );
    }
  }

  parts.push(`\nRULES:
- Be warm, friendly, and professional — like the best receptionist they've ever spoken to
- Use natural British English
- Keep responses concise — this is a phone call, not an essay
- If you're not sure about something, say so honestly and offer to have someone call them back
- Never make up information about pricing, availability, or services that isn't in your knowledge base
- Always collect a callback number before ending if you couldn't fully resolve the enquiry
- If asked whether you are a real person or AI, always answer honestly: "I'm an AI assistant for ${config.business_name}. I can help with most enquiries, or I can put you through to someone if you'd prefer."
- Never deny being AI`);

  if (config.custom_instructions) {
    parts.push(`- ${config.custom_instructions}`);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// JSON response helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  let workspaceId: string;
  let userId: string;
  try {
    const auth = await validateAuth(req);
    userId = auth.userId;
    workspaceId = auth.workspaceId;
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    return errorResponse("Authentication failed", 401);
  }

  // ── Parse body ────────────────────────────────────────────────────────
  let body: ProvisionRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (!body.business_name?.trim()) {
    return errorResponse("business_name is required", 400);
  }

  // ── Supabase service client ───────────────────────────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const functionName = "elevenlabs-provision";

  try {
    await requireEntitlement({
      supabase,
      workspaceId,
      entitlementKey: "ai_phone",
      functionName,
      action: "provision_ai_phone_agent",
      context: {
        userId,
      },
    });
  } catch (error) {
    if (error instanceof EntitlementGuardError) {
      return entitlementGuardErrorResponse(error, corsHeaders);
    }
    throw error;
  }

  // ── Step 1: Insert initial config row ─────────────────────────────────
  const configRow = {
    workspace_id: workspaceId,
    created_by: userId,
    status: "provisioning",
    business_name: body.business_name,
    business_description: body.business_description ?? null,
    services: body.services ?? [],
    opening_hours: body.opening_hours ?? {},
    booking_rules: body.booking_rules ?? null,
    custom_instructions: body.custom_instructions ?? null,
    greeting_message: body.greeting_message ?? null,
    voice_id: body.voice_id ?? "cjVigY5qzO86Huf0OWal",
    voice_name: body.voice_name ?? "Eric",
    max_call_duration_seconds: body.max_call_duration_seconds ?? 300,
    transfer_number: body.transfer_number ?? null,
    data_retention_days: body.data_retention_days ?? 90,
  };

  const { data: config, error: insertErr } = await supabase
    .from("elevenlabs_agents")
    .insert(configRow)
    .select("id")
    .single();

  if (insertErr || !config) {
    console.error("Failed to insert elevenlabs_agents:", insertErr);
    return errorResponse(
      `Failed to create agent config: ${insertErr?.message ?? "unknown"}`,
      500
    );
  }

  const configId: string = config.id;

  // Helper to mark config as errored
  async function markError(step: string, message: string) {
    await supabase
      .from("elevenlabs_agents")
      .update({
        status: "error",
        error_message: `[${step}] ${message}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", configId);
  }

  try {
    // ── Step 2: Build system prompt ───────────────────────────────────
    const systemPrompt = buildSystemPrompt(body);

    // ── Step 3: Build ElevenLabs agent payload ────────────────────────
    const elevenLabsApiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!elevenLabsApiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

    const defaultGreeting = `Hello, thank you for calling ${body.business_name}. How can I help you today?`;
    const greeting = body.greeting_message
      ? body.greeting_message.replace(/\{business_name\}/g, body.business_name)
      : defaultGreeting;

    const maxDuration = body.max_call_duration_seconds ?? 300;
    const voiceId = body.voice_id ?? "cjVigY5qzO86Huf0OWal";

    // Build built-in tools
    const builtInTools: Record<string, unknown> = {
      end_call: {},
      voicemail_detection: {},
      language_detection: {},
    };

    if (body.transfer_number) {
      builtInTools.transfer_to_number = {
        description:
          "Transfer the call to a human when the caller requests it or for emergencies",
        phone_number: body.transfer_number,
      };
    }

    const agentPayload = {
      agent: {
        first_message: greeting,
        language: "en",
        prompt: {
          prompt: systemPrompt,
          llm: "gemini-2.5-flash",
          temperature: 0.2,
          built_in_tools: builtInTools,
        },
      },
      conversation: {
        tts: {
          model_id: "eleven_flash_v2_5",
          voice_id: voiceId,
          stability: 0.5,
          speed: 1.0,
          similarity_boost: 0.8,
        },
        conversation: {
          max_duration_seconds: maxDuration,
        },
        turn: {
          turn_eagerness: "normal",
        },
      },
    };

    // ── Step 4: Create ElevenLabs agent ───────────────────────────────
    console.log(`[${configId}] Creating ElevenLabs agent...`);

    const elevenLabsRes = await fetch(
      "https://api.elevenlabs.io/v1/convai/agents/create",
      {
        method: "POST",
        headers: {
          "xi-api-key": elevenLabsApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(agentPayload),
      }
    );

    if (!elevenLabsRes.ok) {
      const errText = await elevenLabsRes.text();
      throw new Error(
        `ElevenLabs agent creation failed (${elevenLabsRes.status}): ${errText}`
      );
    }

    const elevenLabsResult = await elevenLabsRes.json();
    const agentId: string = elevenLabsResult.agent_id;
    console.log(`[${configId}] ElevenLabs agent created: ${agentId}`);

    // ── Step 5: Search for available UK number ────────────────────────
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}`;

    console.log(`[${configId}] Searching for available UK numbers...`);
    const availableUrl = `${twilioBase}/AvailablePhoneNumbers/GB/Local.json?VoiceEnabled=true&Limit=1`;
    const availableResult = await twilioGet(availableUrl);

    if (!availableResult.available_phone_numbers?.length) {
      throw new Error(
        "No available UK phone numbers found. Try again later or contact support."
      );
    }

    const selectedNumber: string =
      availableResult.available_phone_numbers[0].phone_number;
    console.log(`[${configId}] Found available number: ${selectedNumber}`);

    // ── Step 6: Purchase the number ───────────────────────────────────
    console.log(`[${configId}] Purchasing number ${selectedNumber}...`);
    const purchaseResult = await twilioPost(
      `${twilioBase}/IncomingPhoneNumbers.json`,
      { PhoneNumber: selectedNumber }
    );
    const twilioNumberSid: string = purchaseResult.sid;
    const purchasedNumber: string = purchaseResult.phone_number;
    console.log(
      `[${configId}] Number purchased: ${purchasedNumber} (${twilioNumberSid})`
    );

    // ── Step 7: Update config with all IDs ───────────────────────────
    const { error: updateErr } = await supabase
      .from("elevenlabs_agents")
      .update({
        elevenlabs_agent_id: agentId,
        phone_number: purchasedNumber,
        twilio_number_sid: twilioNumberSid,
        system_prompt: systemPrompt,
        status: "active",
        is_active: true,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", configId);

    if (updateErr) {
      console.error("Failed to update config with IDs:", updateErr);
      // Provisioning succeeded even if DB update fails — log but don't throw
    }

    // ── Step 8: Return success ───────────────────────────────────────
    console.log(`[${configId}] Provisioning complete!`);

    return jsonResponse({
      success: true,
      agent_id: agentId,
      phone_number: purchasedNumber,
      config_id: configId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${configId}] Provisioning failed:`, message);

    await markError("provision", message);

    return errorResponse("Provisioning failed. Please try again or contact support.", 500);
  }
});
