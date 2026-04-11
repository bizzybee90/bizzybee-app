import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-token',
  'Content-Type': 'application/json',
};

type PlanKey = 'connect' | 'starter';
type AddonKey =
  | 'whatsapp_routing'
  | 'sms_routing'
  | 'whatsapp_ai'
  | 'sms_ai'
  | 'ai_phone';
type OnboardingState = 'email' | 'complete';

type TestWorkspaceConfig = {
  plan: PlanKey;
  email: string;
  password: string;
  userName: string;
  workspaceName: string;
  workspaceSlug: string;
  companyName: string;
  addons: AddonKey[];
};

type SeedRequest = {
  onboarding_state?: OnboardingState;
};

const DEFAULT_PASSWORD = 'BizzyBee!Billing2026';

const TEST_WORKSPACES: TestWorkspaceConfig[] = [
  {
    plan: 'connect',
    email: 'billing-connect-test@bizzybee.app',
    password: DEFAULT_PASSWORD,
    userName: 'Billing Connect Test',
    workspaceName: 'Billing Connect Test',
    workspaceSlug: 'billing-connect-test',
    companyName: 'Billing Connect Test',
    addons: ['whatsapp_routing', 'sms_routing'],
  },
  {
    plan: 'starter',
    email: 'billing-starter-test@bizzybee.app',
    password: DEFAULT_PASSWORD,
    userName: 'Billing Starter Test',
    workspaceName: 'Billing Starter Test',
    workspaceSlug: 'billing-starter-test',
    companyName: 'Billing Starter Test',
    addons: ['whatsapp_ai', 'sms_ai', 'ai_phone'],
  },
];

const CHANNEL_SEED_ROWS = [
  { channel: 'email', enabled: true, automation_level: 'draft_only' },
  { channel: 'sms', enabled: false, automation_level: 'draft_only' },
  { channel: 'whatsapp', enabled: false, automation_level: 'draft_only' },
  { channel: 'facebook', enabled: false, automation_level: 'draft_only' },
  { channel: 'instagram', enabled: false, automation_level: 'draft_only' },
  { channel: 'google_business', enabled: false, automation_level: 'draft_only' },
];

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });

function getOnboardingPayload(onboardingState: OnboardingState) {
  if (onboardingState === 'complete') {
    return {
      onboarding_completed: true,
      onboarding_step: 'complete',
    };
  }

  return {
    onboarding_completed: false,
    onboarding_step: 'email',
  };
}

async function ensureAuthUser(
  supabase: ReturnType<typeof createClient>,
  config: TestWorkspaceConfig,
) {
  const { data: existingUserRow, error: existingUserError } = await supabase
    .from('users')
    .select('id, workspace_id')
    .eq('email', config.email)
    .maybeSingle();

  if (existingUserError) {
    throw existingUserError;
  }

  if (existingUserRow?.id) {
    const { error: updateAuthError } = await supabase.auth.admin.updateUserById(existingUserRow.id, {
      email: config.email,
      password: config.password,
      email_confirm: true,
      user_metadata: { name: config.userName },
    });

    if (updateAuthError) {
      throw updateAuthError;
    }

    return {
      userId: existingUserRow.id,
      workspaceId: existingUserRow.workspace_id,
      created: false,
    };
  }

  const { data: createdUserData, error: createUserError } = await supabase.auth.admin.createUser({
    email: config.email,
    password: config.password,
    email_confirm: true,
    user_metadata: { name: config.userName },
  });

  if (createUserError || !createdUserData.user) {
    throw createUserError ?? new Error(`Failed to create auth user for ${config.plan}`);
  }

  return {
    userId: createdUserData.user.id,
    workspaceId: null as string | null,
    created: true,
  };
}

async function ensureWorkspace(
  supabase: ReturnType<typeof createClient>,
  config: TestWorkspaceConfig,
  userId: string,
  existingWorkspaceId: string | null,
) {
  if (existingWorkspaceId) {
    const { data: existingWorkspace, error: workspaceLookupError } = await supabase
      .from('workspaces')
      .select('id')
      .eq('id', existingWorkspaceId)
      .maybeSingle();

    if (workspaceLookupError) {
      throw workspaceLookupError;
    }

    if (existingWorkspace?.id) {
      return {
        workspaceId: existingWorkspace.id,
        created: false,
      };
    }
  }

  const slugCandidate = `${config.workspaceSlug}-${userId.slice(0, 8)}`;
  const { data: createdWorkspace, error: createWorkspaceError } = await supabase
    .from('workspaces')
    .insert({
      name: config.workspaceName,
      slug: slugCandidate,
    })
    .select('id')
    .single();

  if (createWorkspaceError || !createdWorkspace) {
    throw createWorkspaceError ?? new Error(`Failed to create workspace for ${config.plan}`);
  }

  return {
    workspaceId: createdWorkspace.id,
    created: true,
  };
}

async function ensureWorkspaceState(
  supabase: ReturnType<typeof createClient>,
  config: TestWorkspaceConfig,
  userId: string,
  workspaceId: string,
  onboardingState: OnboardingState,
) {
  const onboardingPayload = getOnboardingPayload(onboardingState);

  const { error: upsertUserError } = await supabase.from('users').upsert(
    {
      id: userId,
      name: config.userName,
      email: config.email,
      workspace_id: workspaceId,
      updated_at: new Date().toISOString(),
      ...onboardingPayload,
    },
    { onConflict: 'id' },
  );

  if (upsertUserError) {
    throw upsertUserError;
  }

  const { error: upsertBusinessContextError } = await supabase.from('business_context').upsert(
    {
      workspace_id: workspaceId,
      company_name: config.companyName,
      email_domain: config.email.split('@')[1] ?? 'bizzybee.app',
      business_type: 'service_business',
      automation_level: 'safe',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  );

  if (upsertBusinessContextError) {
    throw upsertBusinessContextError;
  }

  const { error: deleteWorkspaceMembershipsError } = await supabase
    .from('workspace_members')
    .delete()
    .eq('user_id', userId);

  if (deleteWorkspaceMembershipsError) {
    throw deleteWorkspaceMembershipsError;
  }

  const { error: insertWorkspaceMembershipError } = await supabase
    .from('workspace_members')
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      role: 'admin',
      joined_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

  if (insertWorkspaceMembershipError) {
    throw insertWorkspaceMembershipError;
  }

  const { error: deleteRolesError } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', userId);

  if (deleteRolesError) {
    throw deleteRolesError;
  }

  const { error: insertAdminRoleError } = await supabase.from('user_roles').insert({
    user_id: userId,
    role: 'admin',
  });

  if (insertAdminRoleError) {
    throw insertAdminRoleError;
  }

  const { error: channelsUpsertError } = await supabase.from('workspace_channels').upsert(
    CHANNEL_SEED_ROWS.map((row) => ({
      workspace_id: workspaceId,
      channel: row.channel,
      enabled: row.enabled,
      automation_level: row.automation_level,
    })),
    {
      onConflict: 'workspace_id,channel',
      ignoreDuplicates: false,
    },
  );

  if (channelsUpsertError) {
    throw channelsUpsertError;
  }

  const { error: upsertSubscriptionError } = await supabase.from('workspace_subscriptions').upsert(
    {
      workspace_id: workspaceId,
      plan_key: config.plan,
      status: 'active',
      cancel_at_period_end: false,
      metadata: {
        seeded_by: 'seed-billing-test-workspaces',
        workspace_type: config.plan,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  );

  if (upsertSubscriptionError) {
    throw upsertSubscriptionError;
  }

  const { error: deleteAddonsError } = await supabase
    .from('workspace_addons')
    .delete()
    .eq('workspace_id', workspaceId);

  if (deleteAddonsError) {
    throw deleteAddonsError;
  }

  if (config.addons.length > 0) {
    const { error: insertAddonsError } = await supabase.from('workspace_addons').insert(
      config.addons.map((addonKey) => ({
        workspace_id: workspaceId,
        addon_key: addonKey,
        status: 'active',
        quantity: 1,
        metadata: {
          seeded_by: 'seed-billing-test-workspaces',
        },
      })),
    );

    if (insertAddonsError) {
      throw insertAddonsError;
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const { requireAdminToken } = await import('../_shared/auth.ts');
    requireAdminToken(req, ['BILLING_SEED_TOKEN', 'ADMIN_EDGE_TOKEN']);

    const body = ((await req.json().catch(() => ({}))) as SeedRequest) ?? {};
    const onboardingState = body.onboarding_state ?? 'email';

    if (onboardingState !== 'email' && onboardingState !== 'complete') {
      return json(400, { error: 'onboarding_state must be "email" or "complete"' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: 'Missing Supabase environment variables' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const seededWorkspaces: Array<Record<string, unknown>> = [];

    for (const config of TEST_WORKSPACES) {
      const ensuredUser = await ensureAuthUser(supabase, config);
      const ensuredWorkspace = await ensureWorkspace(
        supabase,
        config,
        ensuredUser.userId,
        ensuredUser.workspaceId,
      );

      await ensureWorkspaceState(
        supabase,
        config,
        ensuredUser.userId,
        ensuredWorkspace.workspaceId,
        onboardingState,
      );

      seededWorkspaces.push({
        plan: config.plan,
        email: config.email,
        password: config.password,
        user_id: ensuredUser.userId,
        workspace_id: ensuredWorkspace.workspaceId,
        workspace_name: config.workspaceName,
        onboarding_state: onboardingState,
        addons: config.addons,
        created_user: ensuredUser.created,
        created_workspace: ensuredWorkspace.created,
      });
    }

    return json(200, {
      success: true,
      onboarding_state: onboardingState,
      seeded_workspaces: seededWorkspaces,
    });
  } catch (error) {
    console.error('[seed-billing-test-workspaces] Failed to seed test workspaces:', error);

    return json(500, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
