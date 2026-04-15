import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SubProcessor {
  name: string;
  purpose: string;
  location: string;
}

interface GDPRSettingsPayload {
  id?: string;
  workspace_id?: string;
  dpa_version?: string;
  dpa_accepted_at?: string | null;
  dpa_accepted_by?: string | null;
  privacy_policy_url?: string | null;
  custom_privacy_policy?: string | null;
  company_legal_name?: string | null;
  company_address?: string | null;
  data_protection_officer_email?: string | null;
  sub_processors?: SubProcessor[];
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSubProcessors(value: unknown): SubProcessor[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const name = normalizeText(record.name);
      const purpose = normalizeText(record.purpose);
      const location = normalizeText(record.location);
      if (!name) return null;
      return {
        name,
        purpose: purpose ?? '',
        location: location ?? '',
      } satisfies SubProcessor;
    })
    .filter((item): item is SubProcessor => Boolean(item));
}

function buildDefaultSettings(workspaceId: string) {
  return {
    workspace_id: workspaceId,
    dpa_version: 'v1.0',
    dpa_accepted_at: null,
    dpa_accepted_by: null,
    privacy_policy_url: null,
    custom_privacy_policy: null,
    company_legal_name: null,
    company_address: null,
    data_protection_officer_email: null,
    sub_processors: [] as SubProcessor[],
  };
}

async function isWorkspaceAdmin(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .limit(1);

  if (error) {
    throw error;
  }

  return Array.isArray(data) && data.length > 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let auth;
  try {
    auth = await validateAuth(req);
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    return jsonResponse({ error: error instanceof Error ? error.message : 'Auth failed' }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase service credentials are not configured');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = typeof body?.action === 'string' ? body.action : 'load';

    if (action === 'load') {
      const { data, error } = await supabase
        .from('workspace_gdpr_settings')
        .select('*')
        .eq('workspace_id', auth.workspaceId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return jsonResponse({
        success: true,
        settings: data
          ? {
              ...data,
              sub_processors: Array.isArray(data.sub_processors) ? data.sub_processors : [],
            }
          : buildDefaultSettings(auth.workspaceId),
      });
    }

    const isAdmin = await isWorkspaceAdmin(supabase, auth.userId);
    if (!isAdmin) {
      return jsonResponse({ error: 'Only admins can manage GDPR settings' }, 403);
    }

    if (action === 'save') {
      const incoming = (body?.settings ?? {}) as GDPRSettingsPayload;
      const payload = {
        workspace_id: auth.workspaceId,
        dpa_version: normalizeText(incoming.dpa_version) ?? 'v1.0',
        dpa_accepted_at: incoming.dpa_accepted_at ?? null,
        dpa_accepted_by: incoming.dpa_accepted_by ?? null,
        privacy_policy_url: normalizeText(incoming.privacy_policy_url),
        custom_privacy_policy: normalizeText(incoming.custom_privacy_policy),
        company_legal_name: normalizeText(incoming.company_legal_name),
        company_address: normalizeText(incoming.company_address),
        data_protection_officer_email: normalizeText(incoming.data_protection_officer_email),
        sub_processors: normalizeSubProcessors(incoming.sub_processors),
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('workspace_gdpr_settings')
        .upsert(payload, { onConflict: 'workspace_id' })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return jsonResponse({ success: true, settings: data });
    }

    if (action === 'accept_dpa') {
      const { data, error } = await supabase
        .from('workspace_gdpr_settings')
        .upsert(
          {
            workspace_id: auth.workspaceId,
            dpa_version: normalizeText(body?.dpa_version) ?? 'v1.0',
            dpa_accepted_at: new Date().toISOString(),
            dpa_accepted_by: auth.userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id' },
        )
        .select()
        .single();

      if (error) {
        throw error;
      }

      return jsonResponse({ success: true, settings: data });
    }

    return jsonResponse({ error: 'Unsupported action' }, 400);
  } catch (error) {
    console.error('[workspace-gdpr-settings]', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unexpected error' },
      500,
    );
  }
});
