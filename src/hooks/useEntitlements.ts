import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import type { WorkspaceBillingOverride, WorkspaceEntitlements } from '@/lib/billing/entitlements';
import {
  getDefaultBillingEnforcementMode,
  resolveWorkspaceEntitlements,
} from '@/lib/billing/entitlements';
import { logger } from '@/lib/logger';

const BILLING_OVERRIDE_STORAGE_KEY = 'bizzybee.billing.workspace_overrides';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getOverrideFromEnv(): WorkspaceBillingOverride | null {
  const env = (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    }
  ).env;
  const allowPaidFeatures = env?.VITE_BILLING_ALLOW_PAID_FEATURES === 'true';

  if (!allowPaidFeatures) {
    return null;
  }

  return {
    source: 'env_override',
    allowPaidFeatures: true,
    note: 'Applied from VITE_BILLING_ALLOW_PAID_FEATURES.',
  };
}

function getOverrideFromStorage(workspaceId: string): WorkspaceBillingOverride | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(BILLING_OVERRIDE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const scopedValue = parsed[workspaceId] ?? parsed['*'];
    if (!isRecord(scopedValue)) {
      return null;
    }

    const override: WorkspaceBillingOverride = {
      source: 'workspace_override',
      note: typeof scopedValue.note === 'string' ? scopedValue.note : undefined,
    };

    if (typeof scopedValue.allowPaidFeatures === 'boolean') {
      override.allowPaidFeatures = scopedValue.allowPaidFeatures;
    }

    if (typeof scopedValue.rolloutMode === 'string') {
      override.rolloutMode = scopedValue.rolloutMode as WorkspaceBillingOverride['rolloutMode'];
    }

    if (typeof scopedValue.plan === 'string') {
      override.plan = scopedValue.plan as WorkspaceBillingOverride['plan'];
    }

    if (isRecord(scopedValue.addons)) {
      override.addons = scopedValue.addons as WorkspaceBillingOverride['addons'];
    }

    return override;
  } catch (error) {
    logger.warn('Failed to parse workspace billing override storage', {
      workspaceId,
      error,
    });
    return null;
  }
}

function resolveWorkspaceOverride(workspaceId: string): WorkspaceBillingOverride | null {
  if (workspaceId === 'preview-workspace') {
    return {
      source: 'preview_override',
      allowPaidFeatures: true,
      note: 'Preview workspace always bypasses paid feature enforcement.',
    };
  }

  return getOverrideFromStorage(workspaceId) ?? getOverrideFromEnv();
}

export function useEntitlements(workspaceId: string | null) {
  const rolloutMode = getDefaultBillingEnforcementMode();

  return useQuery<WorkspaceEntitlements>({
    queryKey: ['workspace-entitlements', workspaceId, rolloutMode],
    queryFn: async () => {
      if (!workspaceId) {
        throw new Error('workspaceId is required');
      }

      const workspaceOverride = resolveWorkspaceOverride(workspaceId);

      if (workspaceId === 'preview-workspace') {
        return resolveWorkspaceEntitlements(null, [], {
          rolloutMode,
          override: workspaceOverride,
          resolutionPath: 'missing_subscription',
        });
      }

      const [subscriptionResult, addonsResult] = await Promise.all([
        supabase
          .from('workspace_subscriptions')
          .select('*')
          .eq('workspace_id', workspaceId)
          .maybeSingle(),
        supabase.from('workspace_addons').select('*').eq('workspace_id', workspaceId),
      ]);

      if (subscriptionResult.error || addonsResult.error) {
        logger.warn('Falling back to legacy entitlements', {
          workspaceId,
          rolloutMode,
          workspaceOverrideSource: workspaceOverride?.source ?? 'none',
          subscriptionError: subscriptionResult.error,
          addonsError: addonsResult.error,
        });
        return resolveWorkspaceEntitlements(null, [], {
          rolloutMode,
          override: workspaceOverride,
          resolutionPath: 'read_error_fallback',
        });
      }

      return resolveWorkspaceEntitlements(subscriptionResult.data, addonsResult.data ?? [], {
        rolloutMode,
        override: workspaceOverride,
        resolutionPath: subscriptionResult.data ? 'subscription' : 'missing_subscription',
      });
    },
    enabled: Boolean(workspaceId),
    retry: false,
    staleTime: 30_000,
  });
}
