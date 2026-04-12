import { corsResponse, jsonOk } from '../_shared/response.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();
  return jsonOk({ status: 'not_implemented' });
});
