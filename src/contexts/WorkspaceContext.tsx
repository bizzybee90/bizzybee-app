import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Workspace } from '@/lib/types';
import { isPreviewModeEnabled } from '@/lib/previewMode';
import { isOnboardingComplete } from '@/lib/onboardingStatus';
import { logger } from '@/lib/logger';
import { useEntitlements } from '@/hooks/useEntitlements';
import { WorkspaceContext } from './workspace-context';

const PREVIEW_WORKSPACE: Workspace = {
  id: 'preview-workspace',
  name: 'Mac Cleaning',
  slug: 'mac-cleaning-preview',
  timezone: 'Europe/London',
  business_hours_start: '09:00',
  business_hours_end: '17:00',
  business_days: [1, 2, 3, 4, 5],
  created_at: new Date('2026-01-01T09:00:00.000Z').toISOString(),
};

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboardingStep, setOnboardingStep] = useState<string | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const { data: entitlements, isLoading: entitlementsLoading } = useEntitlements(
    workspace?.id ?? null,
  );

  useEffect(() => {
    let cancelled = false;

    const isPlaceholderWorkspace = (nextWorkspace: Workspace | null) => {
      if (!nextWorkspace) return true;
      const normalizedName = nextWorkspace.name.trim().toLowerCase();
      const normalizedSlug = nextWorkspace.slug.trim().toLowerCase();

      return (
        normalizedName === 'my workspace' ||
        normalizedName === 'bizzybee test' ||
        normalizedSlug.startsWith('workspace-')
      );
    };

    const fetchWorkspace = async () => {
      if (isPreviewModeEnabled()) {
        if (!cancelled) {
          setWorkspace(PREVIEW_WORKSPACE);
          setOnboardingStep('complete');
          setOnboardingComplete(true);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setLoading(true);
      }

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (cancelled) return;

        if (userError) {
          throw userError;
        }

        if (!user) {
          setWorkspace(null);
          setOnboardingStep(null);
          setOnboardingComplete(false);
          return;
        }

        const { data: userData, error: profileError } = await supabase
          .from('users')
          .select('workspace_id, onboarding_completed, onboarding_step')
          .eq('id', user.id)
          .maybeSingle();

        if (cancelled) return;

        if (profileError) {
          throw profileError;
        }

        setOnboardingStep(userData?.onboarding_step ?? null);

        if (!userData?.workspace_id) {
          setOnboardingComplete(false);
          setWorkspace(null);
          return;
        }

        const [
          { data: workspaceData, error: workspaceError },
          { data: businessContextData, error: businessContextError },
        ] = await Promise.all([
          supabase.from('workspaces').select('*').eq('id', userData.workspace_id).maybeSingle(),
          supabase
            .from('business_context')
            .select('company_name')
            .eq('workspace_id', userData.workspace_id)
            .maybeSingle(),
        ]);

        if (cancelled) return;

        if (workspaceError) {
          throw workspaceError;
        }

        if (businessContextError) {
          throw businessContextError;
        }

        const nextWorkspace = workspaceData ?? null;
        const hasBusinessIdentity = Boolean(businessContextData?.company_name?.trim());
        const nextOnboardingComplete =
          isOnboardingComplete(userData) &&
          hasBusinessIdentity &&
          !isPlaceholderWorkspace(nextWorkspace);

        setOnboardingComplete(nextOnboardingComplete);
        setWorkspace(nextWorkspace);
      } catch (error) {
        if (!cancelled) {
          logger.error('Failed to load workspace context', error);
          setWorkspace(null);
          setOnboardingStep(null);
          setOnboardingComplete(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchWorkspace();

    // Re-fetch if auth state changes (sign in/out)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        fetchWorkspace();
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        loading,
        onboardingStep,
        onboardingComplete,
        needsOnboarding: !onboardingComplete,
        entitlements: entitlements ?? null,
        entitlementsLoading,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
