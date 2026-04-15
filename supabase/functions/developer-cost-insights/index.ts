import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ApiUsageRow = {
  provider: string;
  function_name: string | null;
  task_type: string | null;
  model: string | null;
  requests: number | null;
  tokens_used: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_estimate: number | null;
  created_at: string | null;
  request_metadata: unknown;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function parseAllowlist(rawValue: string | undefined) {
  return new Set(
    (rawValue ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function safeMetadata(record: unknown) {
  return record && typeof record === 'object' && !Array.isArray(record)
    ? (record as Record<string, unknown>)
    : {};
}

function summarizeMetadata(metadata: Record<string, unknown>) {
  const candidates = [
    metadata.stage,
    metadata.step,
    metadata.operation,
    metadata.part,
    metadata.domain,
    metadata.url,
  ];

  return candidates
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .slice(0, 2)
    .join(' · ');
}

function buildPartLabel(row: ApiUsageRow) {
  const metadata = safeMetadata(row.request_metadata);
  const functionLabel = row.function_name?.trim() || 'unknown_function';
  const taskLabel = row.task_type?.trim() || 'general';
  const metadataLabel = summarizeMetadata(metadata);
  return metadataLabel
    ? `${functionLabel} · ${taskLabel} · ${metadataLabel}`
    : `${functionLabel} · ${taskLabel}`;
}

function toNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const allowlist = parseAllowlist(Deno.env.get('DEVELOPER_COST_EMAIL_ALLOWLIST'));
    const authHeader = req.headers.get('Authorization');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: 'Supabase credentials are not configured' }, 500);
    }

    if (allowlist.size === 0) {
      return jsonResponse({ error: 'Developer cost allowlist is not configured' }, 503);
    }

    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing authentication' }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user?.email) {
      return jsonResponse({ error: 'Invalid or expired authentication token' }, 401);
    }

    const viewerEmail = user.email.trim().toLowerCase();
    if (!allowlist.has(viewerEmail)) {
      return jsonResponse({ error: 'Developer-only cost insights' }, 403);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const now = Date.now();
    const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await serviceClient
      .from('api_usage')
      .select(
        'provider, function_name, task_type, model, requests, tokens_used, input_tokens, output_tokens, cost_estimate, created_at, request_metadata',
      )
      .gte('created_at', since7d)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    const rows = ((data ?? []) as ApiUsageRow[]).filter((row) => row.created_at);

    const totals = {
      cost24h: 0,
      cost7d: 0,
      requests24h: 0,
      requests7d: 0,
      tokens24h: 0,
      tokens7d: 0,
    };

    const providerMap = new Map<
      string,
      { provider: string; cost: number; requests: number; tokens: number; lastSeen: string | null }
    >();
    const partMap = new Map<
      string,
      {
        part: string;
        provider: string;
        functionName: string;
        taskType: string;
        cost: number;
        requests: number;
        tokens: number;
        lastSeen: string | null;
      }
    >();

    for (const row of rows) {
      const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
      const cost = toNumber(row.cost_estimate);
      const requests = toNumber(row.requests);
      const tokens = toNumber(row.tokens_used);
      const providerKey = row.provider || 'unknown';
      const partKey = `${row.provider}::${row.function_name ?? 'unknown'}::${row.task_type ?? 'general'}::${buildPartLabel(row)}`;

      totals.cost7d += cost;
      totals.requests7d += requests;
      totals.tokens7d += tokens;

      if (createdAt >= Date.parse(since24h)) {
        totals.cost24h += cost;
        totals.requests24h += requests;
        totals.tokens24h += tokens;
      }

      const existingProvider = providerMap.get(providerKey) ?? {
        provider: providerKey,
        cost: 0,
        requests: 0,
        tokens: 0,
        lastSeen: row.created_at,
      };
      existingProvider.cost += cost;
      existingProvider.requests += requests;
      existingProvider.tokens += tokens;
      existingProvider.lastSeen =
        existingProvider.lastSeen && row.created_at
          ? existingProvider.lastSeen > row.created_at
            ? existingProvider.lastSeen
            : row.created_at
          : (existingProvider.lastSeen ?? row.created_at);
      providerMap.set(providerKey, existingProvider);

      const existingPart = partMap.get(partKey) ?? {
        part: buildPartLabel(row),
        provider: providerKey,
        functionName: row.function_name ?? 'unknown',
        taskType: row.task_type ?? 'general',
        cost: 0,
        requests: 0,
        tokens: 0,
        lastSeen: row.created_at,
      };
      existingPart.cost += cost;
      existingPart.requests += requests;
      existingPart.tokens += tokens;
      existingPart.lastSeen =
        existingPart.lastSeen && row.created_at
          ? existingPart.lastSeen > row.created_at
            ? existingPart.lastSeen
            : row.created_at
          : (existingPart.lastSeen ?? row.created_at);
      partMap.set(partKey, existingPart);
    }

    const byProvider = Array.from(providerMap.values()).sort((a, b) => b.cost - a.cost);
    const byPart = Array.from(partMap.values()).sort((a, b) => b.cost - a.cost);
    const recent = rows.slice(0, 25).map((row) => ({
      provider: row.provider,
      functionName: row.function_name ?? 'unknown',
      taskType: row.task_type ?? 'general',
      model: row.model ?? null,
      part: buildPartLabel(row),
      cost: toNumber(row.cost_estimate),
      requests: toNumber(row.requests),
      tokens: toNumber(row.tokens_used),
      createdAt: row.created_at,
      metadataSummary: summarizeMetadata(safeMetadata(row.request_metadata)),
    }));

    return jsonResponse({
      success: true,
      viewer: viewerEmail,
      totals,
      byProvider,
      byPart: byPart.slice(0, 30),
      recent,
    });
  } catch (error) {
    console.error('[developer-cost-insights]', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unexpected error' },
      500,
    );
  }
});
