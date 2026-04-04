import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateAuth, AuthError, authErrorResponse } from "../_shared/auth.ts";

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
// Helpers – Retell API
// ---------------------------------------------------------------------------

const RETELL_BASE = "https://api.retellai.com";

async function retellPost(path: string, body: Record<string, unknown>) {
  const apiKey = Deno.env.get("RETELL_API_KEY");
  if (!apiKey) throw new Error("RETELL_API_KEY is not configured");

  const res = await fetch(`${RETELL_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Retell ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Helpers – Twilio API
// ---------------------------------------------------------------------------

function twilioHeaders(): HeadersInit {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const token = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  return {
    Authorization: "Basic " + btoa(`${sid}:${token}`),
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function twilioGet(url: string) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const token = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const res = await fetch(url, {
    headers: {
      Authorization: "Basic " + btoa(`${sid}:${token}`),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio GET ${url} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function twilioPost(url: string, params: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: twilioHeaders(),
    body: formEncode(params),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio POST ${url} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(config: ProvisionRequest): string {
  const parts: string[] = [];

  parts.push(
    `You are ${config.business_name}'s AI phone receptionist. You answer calls professionally, helpfully and warmly on behalf of the business. You speak with a British English accent and tone.`
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
        `\nBOOKING RULES:\nDo not book appointments. Take a message and let the caller know someone will get back to them.`
      );
    }
  }

  if (config.transfer_number) {
    parts.push(
      `\nCALL TRANSFER:\nIf the caller insists on speaking to a human or the query is urgent/complex, transfer the call to ${config.transfer_number}.`
    );
  }

  parts.push(`\nRULES:
- Keep responses to 1-3 sentences. Be concise and natural.
- Never make up information about the business. If unsure, offer to take a message.
- Always be polite, professional and helpful.
- If the caller asks something outside your knowledge, take their name and number and say someone will call back.
- Do not discuss pricing unless listed above. Offer to have someone follow up with a quote.`);

  if (config.custom_instructions) {
    parts.push(`\nADDITIONAL INSTRUCTIONS:\n${config.custom_instructions}`);
  }

  const now = new Date().toISOString();
  parts.push(`\nCurrent date/time: ${now}`);
  parts.push(`This call may be recorded for quality purposes.`);

  return parts.join("\n");
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  let userId: string;
  let workspaceId: string;
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
    voice_id: body.voice_id ?? "11labs-Adrian",
    voice_name: body.voice_name ?? "Adrian",
    max_call_duration_seconds: body.max_call_duration_seconds ?? 300,
    transfer_number: body.transfer_number ?? null,
    data_retention_days: body.data_retention_days ?? 90,
  };

  const { data: config, error: insertErr } = await supabase
    .from("ai_phone_configs")
    .insert(configRow)
    .select("id")
    .single();

  if (insertErr || !config) {
    console.error("Failed to insert ai_phone_configs:", insertErr);
    return errorResponse(
      `Failed to create phone config: ${insertErr?.message ?? "unknown"}`,
      500
    );
  }

  const configId: string = config.id;

  // Helper to mark config as errored
  async function markError(step: string, message: string) {
    await supabase
      .from("ai_phone_configs")
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

    // ── Step 3: Create Retell LLM ─────────────────────────────────────
    console.log(`[${configId}] Creating Retell LLM...`);
    const llmResult = await retellPost("/create-retell-llm", {
      model: "claude-sonnet-4-6-20250514",
      general_prompt: systemPrompt,
    });
    const llmId: string = llmResult.llm_id;
    console.log(`[${configId}] Retell LLM created: ${llmId}`);

    // ── Step 4: Create Retell Agent ───────────────────────────────────
    console.log(`[${configId}] Creating Retell Agent...`);
    const webhookUrl = `${supabaseUrl}/functions/v1/retell-webhook`;
    const maxDurationMs =
      (body.max_call_duration_seconds ?? 300) * 1000;

    const agentResult = await retellPost("/create-agent", {
      agent_name: `${body.business_name} AI Receptionist`,
      response_engine: { type: "retell-llm", llm_id: llmId },
      voice_id: body.voice_id ?? "11labs-Adrian",
      voice_model: "eleven_flash_v2_5",
      language: "en-GB",
      webhook_url: webhookUrl,
      max_call_duration_ms: maxDurationMs,
      data_storage_setting: "everything_except_pii",
      ...(body.greeting_message
        ? { begin_message: body.greeting_message }
        : {}),
      post_call_analysis_data: [
        {
          name: "call_summary",
          type: "string",
          description: "1-2 sentence summary of the call",
        },
        {
          name: "caller_sentiment",
          type: "enum",
          choices: ["positive", "neutral", "negative"],
          description: "Overall caller sentiment",
        },
        {
          name: "call_outcome",
          type: "enum",
          choices: [
            "resolved",
            "booking_made",
            "message_taken",
            "transferred",
            "abandoned",
          ],
          description: "How the call concluded",
        },
        {
          name: "requires_followup",
          type: "boolean",
          description: "Whether this call needs human follow-up",
        },
        {
          name: "caller_name",
          type: "string",
          description: "Name of the caller if provided",
        },
        {
          name: "caller_phone",
          type: "string",
          description: "Phone number of the caller if provided",
        },
      ],
    });
    const agentId: string = agentResult.agent_id;
    console.log(`[${configId}] Retell Agent created: ${agentId}`);

    // ── Step 5: Search for available UK number ────────────────────────
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}`;

    console.log(`[${configId}] Searching for available UK numbers...`);
    const availableUrl = `${twilioBase}/AvailablePhoneNumbers/GB/Local.json?AreaCode=20&VoiceEnabled=true&Limit=1`;
    const availableResult = await twilioGet(availableUrl);

    if (
      !availableResult.available_phone_numbers?.length
    ) {
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

    // ── Step 7: Create SIP trunk ──────────────────────────────────────
    console.log(`[${configId}] Creating SIP trunk...`);
    const trunkResult = await twilioPost(
      "https://trunking.twilio.com/v1/Trunks",
      {
        FriendlyName: `BizzyBee - ${body.business_name}`,
      }
    );
    const trunkSid: string = trunkResult.sid;
    console.log(`[${configId}] SIP trunk created: ${trunkSid}`);

    // ── Step 8: Add origination URI to trunk ──────────────────────────
    console.log(`[${configId}] Adding origination URI...`);
    await twilioPost(
      `https://trunking.twilio.com/v1/Trunks/${trunkSid}/OriginationUrls`,
      {
        SipUrl: "sip:sip.retellai.com",
        Weight: "1",
        Priority: "1",
        Enabled: "true",
        FriendlyName: "Retell",
      }
    );
    console.log(`[${configId}] Origination URI added`);

    // ── Step 9: Associate number with trunk ───────────────────────────
    console.log(`[${configId}] Associating number with trunk...`);
    await twilioPost(
      `https://trunking.twilio.com/v1/Trunks/${trunkSid}/PhoneNumbers`,
      { PhoneNumberSid: twilioNumberSid }
    );
    console.log(`[${configId}] Number associated with trunk`);

    // ── Step 10: Import number into Retell ────────────────────────────
    console.log(`[${configId}] Importing number into Retell...`);
    const terminationUri = `${trunkSid}.pstn.twilio.com`;
    const importResult = await retellPost("/import-phone-number", {
      phone_number: purchasedNumber,
      termination_uri: terminationUri,
      inbound_agents: [{ agent_id: agentId, weight: 1 }],
    });
    const retellPhoneId: string = importResult.phone_number_id;
    console.log(`[${configId}] Number imported into Retell: ${retellPhoneId}`);

    // ── Step 11: Update config with all IDs ───────────────────────────
    const { error: updateErr } = await supabase
      .from("ai_phone_configs")
      .update({
        status: "active",
        retell_llm_id: llmId,
        retell_agent_id: agentId,
        retell_phone_number_id: retellPhoneId,
        phone_number: purchasedNumber,
        twilio_number_sid: twilioNumberSid,
        twilio_trunk_sid: trunkSid,
        system_prompt: systemPrompt,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", configId);

    if (updateErr) {
      console.error("Failed to update config with IDs:", updateErr);
      // Provisioning succeeded even if DB update fails — log but don't throw
    }

    // ── Step 12: Return success ───────────────────────────────────────
    console.log(`[${configId}] Provisioning complete!`);

    return jsonResponse({
      success: true,
      config_id: configId,
      phone_number: purchasedNumber,
      retell_agent_id: agentId,
      retell_llm_id: llmId,
      retell_phone_number_id: retellPhoneId,
      twilio_number_sid: twilioNumberSid,
      twilio_trunk_sid: trunkSid,
      status: "active",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${configId}] Provisioning failed:`, message);

    // Determine which step failed for the error message
    await markError("provision", message);

    return errorResponse(`Provisioning failed: ${message}`, 500);
  }
});
