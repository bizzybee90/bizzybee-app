import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AuthResult {
  userId: string;
  workspaceId: string;
}

interface SupabaseLikeError {
  code?: string;
  message?: string;
  details?: string;
}

interface SupabaseClientLike {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: SupabaseLikeError | null }>;
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        eq: (
          column: string,
          value: string,
        ) => {
          order: (
            column: string,
            options?: { ascending?: boolean; nullsFirst?: boolean },
          ) => {
            limit: (
              value: number,
            ) => Promise<{
              data: Array<Record<string, unknown>> | null;
              error: SupabaseLikeError | null;
            }>;
          };
          limit: (
            value: number,
          ) => Promise<{
            data: Array<Record<string, unknown>> | null;
            error: SupabaseLikeError | null;
          }>;
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: SupabaseLikeError | null;
          }>;
        };
        filter: (
          column: string,
          operator: string,
          value: string,
        ) => {
          order: (
            column: string,
            options?: { ascending?: boolean; nullsFirst?: boolean },
          ) => {
            limit: (
              value: number,
            ) => Promise<{
              data: Array<Record<string, unknown>> | null;
              error: SupabaseLikeError | null;
            }>;
          };
          limit: (
            value: number,
          ) => Promise<{
            data: Array<Record<string, unknown>> | null;
            error: SupabaseLikeError | null;
          }>;
        };
      };
    };
  };
}

function isSchemaDriftError(error: SupabaseLikeError | null): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === '42P01') return true;

  const combined = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return (
    combined.includes('does not exist') ||
    combined.includes('could not find the') ||
    combined.includes('schema cache')
  );
}

function isMissingAccessFunctionError(error: SupabaseLikeError | null): boolean {
  if (!error) return false;
  if (error.code === '42883' || error.code === 'PGRST202') return true;
  const combined = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return combined.includes('user_has_workspace_access') && combined.includes('could not find');
}

async function queryWorkspaceCandidates(
  serviceSupabase: SupabaseClientLike,
  userId: string,
): Promise<string[]> {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (workspaceId: unknown) => {
    if (typeof workspaceId !== 'string') return;
    if (!workspaceId) return;
    if (seen.has(workspaceId)) return;
    seen.add(workspaceId);
    candidates.push(workspaceId);
  };

  const addRows = (rows: Array<Record<string, unknown>> | null, field: string) => {
    for (const row of rows ?? []) {
      addCandidate(row[field]);
    }
  };

  const fromWorkspaceMembersByUser = await serviceSupabase
    .from('workspace_members')
    .select('workspace_id, joined_at, created_at')
    .eq('user_id', userId)
    .order('joined_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(50);

  if (fromWorkspaceMembersByUser.error && !isSchemaDriftError(fromWorkspaceMembersByUser.error)) {
    throw fromWorkspaceMembersByUser.error;
  }
  addRows(fromWorkspaceMembersByUser.data, 'workspace_id');

  // Legacy compatibility path if some environments still expose member_id instead of user_id.
  const fromWorkspaceMembersByMember = await serviceSupabase
    .from('workspace_members')
    .select('workspace_id, joined_at, created_at')
    .filter('member_id', 'eq', userId)
    .order('joined_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(50);

  if (
    fromWorkspaceMembersByMember.error &&
    !isSchemaDriftError(fromWorkspaceMembersByMember.error)
  ) {
    throw fromWorkspaceMembersByMember.error;
  }
  addRows(fromWorkspaceMembersByMember.data, 'workspace_id');

  const fromUsers = await serviceSupabase
    .from('users')
    .select('workspace_id')
    .eq('id', userId)
    .maybeSingle();

  if (fromUsers.error && !isSchemaDriftError(fromUsers.error)) {
    throw fromUsers.error;
  }
  addCandidate(fromUsers.data?.workspace_id);

  const fromWorkspaceOwner = await serviceSupabase
    .from('workspaces')
    .select('id, created_at')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(50);

  if (fromWorkspaceOwner.error && !isSchemaDriftError(fromWorkspaceOwner.error)) {
    throw fromWorkspaceOwner.error;
  }
  addRows(fromWorkspaceOwner.data, 'id');

  // Legacy compatibility for environments with workspaces.created_by.
  const fromWorkspaceCreator = await serviceSupabase
    .from('workspaces')
    .select('id, created_at')
    .filter('created_by', 'eq', userId)
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(50);

  if (fromWorkspaceCreator.error && !isSchemaDriftError(fromWorkspaceCreator.error)) {
    throw fromWorkspaceCreator.error;
  }
  addRows(fromWorkspaceCreator.data, 'id');

  return candidates;
}

async function hasCanonicalWorkspaceAccess(
  userSupabase: SupabaseClientLike,
  serviceSupabase: SupabaseClientLike,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const accessRpc = await userSupabase.rpc('user_has_workspace_access', {
    check_workspace_id: workspaceId,
  });

  if (!accessRpc.error && typeof accessRpc.data === 'boolean') {
    return accessRpc.data;
  }

  if (accessRpc.error && !isMissingAccessFunctionError(accessRpc.error)) {
    throw accessRpc.error;
  }

  const candidates = await queryWorkspaceCandidates(serviceSupabase, userId);
  return candidates.includes(workspaceId);
}

async function resolveBestCanonicalWorkspaceId(
  userSupabase: SupabaseClientLike,
  serviceSupabase: SupabaseClientLike,
  userId: string,
): Promise<string | null> {
  const candidates = await queryWorkspaceCandidates(serviceSupabase, userId);

  for (const candidate of candidates) {
    if (await hasCanonicalWorkspaceAccess(userSupabase, serviceSupabase, userId, candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Validates JWT authentication and workspace access.
 * Supports both user JWT tokens and service-to-service calls.
 *
 * For service-to-service calls (from other edge functions), the calling function
 * should pass the service role key in the Authorization header.
 */
export async function validateAuth(
  req: Request,
  requestedWorkspaceId?: string,
): Promise<AuthResult> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid Authorization header', 401);
  }

  const serviceBearer = `Bearer ${supabaseServiceKey}`;
  const token = authHeader.slice('Bearer '.length);
  const normalizedRequestedWorkspaceId = requestedWorkspaceId?.trim() || undefined;

  // Allow service-to-service calls only on exact bearer equality.
  if (authHeader === serviceBearer) {
    if (!normalizedRequestedWorkspaceId) {
      throw new AuthError('workspace_id is required for service calls', 400);
    }
    return { userId: 'service_role', workspaceId: normalizedRequestedWorkspaceId };
  }

  if (!token) {
    throw new AuthError('Missing or invalid Authorization header', 401);
  }

  // Validate user JWT
  const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await userSupabase.auth.getUser();
  if (error || !data?.user) {
    throw new AuthError('Invalid or expired authentication token', 401);
  }

  const userId = data.user.id;

  const serviceSupabase = createClient(
    supabaseUrl,
    supabaseServiceKey,
  ) as unknown as SupabaseClientLike;
  const typedUserSupabase = userSupabase as unknown as SupabaseClientLike;

  // If a specific workspace was requested, verify access using the canonical model.
  if (normalizedRequestedWorkspaceId) {
    const hasAccess = await hasCanonicalWorkspaceAccess(
      typedUserSupabase,
      serviceSupabase,
      userId,
      normalizedRequestedWorkspaceId,
    );

    if (!hasAccess) {
      throw new AuthError('Access denied: workspace mismatch', 403);
    }

    return { userId, workspaceId: normalizedRequestedWorkspaceId };
  }

  const workspaceId = await resolveBestCanonicalWorkspaceId(
    typedUserSupabase,
    serviceSupabase,
    userId,
  );

  if (!workspaceId) {
    throw new AuthError('User not found or not assigned to a workspace', 403);
  }

  return { userId, workspaceId };
}

export class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function authErrorResponse(error: AuthError): Response {
  return new Response(JSON.stringify({ error: error.message }), {
    status: error.statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
