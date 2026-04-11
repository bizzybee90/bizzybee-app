import { useCallback, useEffect, useRef, useState } from 'react';
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
  const mountedRef = useRef(true);
  const latestRefreshIdRef = useRef(0);
  const { data: entitlements, isLoading: entitlementsLoading } = useEntitlements(
    workspace?.id ?? null,
  );

  const refreshWorkspace = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }

    const refreshId = ++latestRefreshIdRef.current;
    const isStale = () => !mountedRef.current || refreshId !== latestRefreshIdRef.current;

    if (isPreviewModeEnabled()) {
      if (isStale()) {
        return;
      }
      setWorkspace(PREVIEW_WORKSPACE);
      setOnboardingStep('complete');
      setOnboardingComplete(true);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (isStale()) return;

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

      if (isStale()) return;

      if (profileError) {
        throw profileError;
      }

      setOnboardingStep(userData?.onboarding_step ?? null);

      if (!userData?.workspace_id) {
        setOnboardingComplete(false);
        setWorkspace(null);
        return;
      }

      const { data: workspaceData, error: workspaceError } = await supabase
        .from('workspaces')
        .select('*')
        .eq('id', userData.workspace_id)
        .maybeSingle();

      if (isStale()) return;

      if (workspaceError) {
        throw workspaceError;
      }

      const nextWorkspace = workspaceData ?? null;
      const nextOnboardingComplete =
        Boolean(nextWorkspace?.id) && isOnboardingComplete(userData);

      setOnboardingComplete(nextOnboardingComplete);
      setWorkspace(nextWorkspace);
    } catch (error) {
      if (!isStale()) {
        logger.error('Failed to load workspace context', error);
        setWorkspace(null);
        setOnboardingStep(null);
        setOnboardingComplete(false);
      }
    } finally {
      if (!isStale()) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const fetchWorkspace = async () => {
      if (isPreviewModeEnabled()) {
        await refreshWorkspace();
        return;
      }

      await refreshWorkspace();
    };

    void fetchWorkspace();

    // Re-fetch if auth state changes (sign in/out)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        void refreshWorkspace();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [refreshWorkspace]);

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
        refreshWorkspace,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
