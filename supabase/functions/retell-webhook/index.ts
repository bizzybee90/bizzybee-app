import {
  createServiceClient,
  getRequiredEnv,
  jsonResponse,
} from "../_shared/pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RetellCall {
  call_id: string;
  agent_id: string;
  call_type?: string;
  from_number?: string;
  to_number?: string;
  direction?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  transcript?: string;
  transcript_object?: unknown[];
  disconnection_reason?: string;
  recording_url?: string;
  call_analysis?: CallAnalysis;
}

interface CallAnalysis {
  call_summary?: string;
  caller_sentiment?: string;
  call_outcome?: string;
  requires_followup?: boolean;
  caller_name?: string;
  caller_phone?: string;
  [key: string]: unknown;
}

interface WebhookPayload {
  event: string;
  call: RetellCall;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function verifyRetellApiKey(req: Request): void {
  const retellApiKey = getRequiredEnv("RETELL_API_KEY");

  // Retell sends the API key in the x-retell-api-key header
  const provided =
    req.headers.get("x-retell-api-key")?.trim() ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  if (!provided || provided !== retellApiKey) {
    throw new Error("Unauthorized: invalid Retell API key");
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleCallStarted(call: RetellCall): Promise<void> {
  const supabase = createServiceClient();

  // Look up the phone config by Retell agent_id
  const { data: config, error: configErr } = await supabase
    .from("ai_phone_configs")
    .select("id, workspace_id")
    .eq("retell_agent_id", call.agent_id)
    .maybeSingle();

  if (configErr) {
    console.error("Config lookup error:", configErr.message);
    throw new Error(`Config lookup failed: ${configErr.message}`);
  }

  if (!config) {
    console.warn(`No config found for agent_id=${call.agent_id}, skipping`);
    return;
  }

  const { error: insertErr } = await supabase
    .from("ai_phone_call_logs")
    .insert({
      workspace_id: config.workspace_id,
      config_id: config.id,
      retell_call_id: call.call_id,
      direction: call.direction ?? "inbound",
      caller_number: call.from_number ?? null,
      called_number: call.to_number ?? null,
      status: "in_progress",
      start_time: call.start_timestamp
        ? new Date(call.start_timestamp).toISOString()
        : new Date().toISOString(),
    });

  if (insertErr) {
    console.error("Insert call log error:", insertErr.message);
    throw new Error(`Insert call log failed: ${insertErr.message}`);
  }

  console.log(`call_started logged: ${call.call_id}`);
}

async function handleCallEnded(call: RetellCall): Promise<void> {
  const supabase = createServiceClient();

  const durationSeconds = call.duration_ms
    ? Math.round(call.duration_ms / 1000)
    : 0;
  const durationMinutes = durationSeconds / 60;
  const costCents = Math.round(20 * durationMinutes); // 20p per minute

  // 1. Update the call log
  const { data: updatedLog, error: updateErr } = await supabase
    .from("ai_phone_call_logs")
    .update({
      status: "completed",
      end_time: call.end_timestamp
        ? new Date(call.end_timestamp).toISOString()
        : new Date().toISOString(),
      duration_seconds: durationSeconds,
      transcript: call.transcript ?? null,
      transcript_object: call.transcript_object ?? null,
      disconnection_reason: call.disconnection_reason ?? null,
      cost_cents: costCents,
    })
    .eq("retell_call_id", call.call_id)
    .select("workspace_id")
    .maybeSingle();

  if (updateErr) {
    console.error("Update call log error:", updateErr.message);
    throw new Error(`Update call log failed: ${updateErr.message}`);
  }

  if (!updatedLog) {
    console.warn(`No call log found for retell_call_id=${call.call_id}`);
    return;
  }

  // 2. Upsert usage for this workspace + month
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  // Use RPC or raw upsert — increment totals
  const { error: usageErr } = await supabase.rpc("upsert_ai_phone_usage", {
    p_workspace_id: updatedLog.workspace_id,
    p_month: monthKey,
    p_calls: 1,
    p_minutes: durationMinutes,
    p_cost_cents: costCents,
  });

  if (usageErr) {
    // Fallback: try manual upsert if the RPC doesn't exist yet
    console.warn("RPC upsert_ai_phone_usage failed, trying manual upsert:", usageErr.message);

    const { data: existing } = await supabase
      .from("ai_phone_usage")
      .select("id, total_calls, total_minutes, cost_cents")
      .eq("workspace_id", updatedLog.workspace_id)
      .eq("month", monthKey)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("ai_phone_usage")
        .update({
          total_calls: existing.total_calls + 1,
          total_minutes: existing.total_minutes + durationMinutes,
          cost_cents: existing.cost_cents + costCents,
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("ai_phone_usage").insert({
        workspace_id: updatedLog.workspace_id,
        month: monthKey,
        total_calls: 1,
        total_minutes: durationMinutes,
        cost_cents: costCents,
      });
    }
  }

  console.log(
    `call_ended logged: ${call.call_id}, duration=${durationSeconds}s, cost=${costCents}p`
  );
}

async function handleCallAnalyzed(call: RetellCall): Promise<void> {
  const supabase = createServiceClient();
  const analysis = call.call_analysis;

  if (!analysis) {
    console.warn(`call_analyzed event with no call_analysis for ${call.call_id}`);
    return;
  }

  const { error: updateErr } = await supabase
    .from("ai_phone_call_logs")
    .update({
      summary: analysis.call_summary ?? null,
      sentiment: analysis.caller_sentiment ?? null,
      outcome: analysis.call_outcome ?? null,
      requires_followup: analysis.requires_followup ?? false,
      call_analysis: analysis,
      outcome_details: {
        caller_name: analysis.caller_name ?? null,
        caller_phone: analysis.caller_phone ?? null,
      },
    })
    .eq("retell_call_id", call.call_id);

  if (updateErr) {
    console.error("Update call analysis error:", updateErr.message);
    throw new Error(`Update call analysis failed: ${updateErr.message}`);
  }

  console.log(`call_analyzed logged: ${call.call_id}`);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    // Verify the request comes from Retell
    verifyRetellApiKey(req);

    const payload: WebhookPayload = await req.json();

    if (!payload.event || !payload.call) {
      return jsonResponse({ error: "Invalid payload: missing event or call" }, 400);
    }

    console.log(`Retell webhook: event=${payload.event}, call_id=${payload.call.call_id}`);

    switch (payload.event) {
      case "call_started":
        await handleCallStarted(payload.call);
        break;

      case "call_ended":
        await handleCallEnded(payload.call);
        break;

      case "call_analyzed":
        await handleCallAnalyzed(payload.call);
        break;

      default:
        console.log(`Unhandled Retell event: ${payload.event}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("retell-webhook error:", message);

    const status = message.startsWith("Unauthorized") ? 401 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
