/**
 * Standardized HTTP response helpers for edge functions.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function corsResponse(): Response {
  return new Response(null, { headers: corsHeaders });
}

export function jsonOk(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function jsonError(
  message: string,
  status = 400,
  extra?: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
