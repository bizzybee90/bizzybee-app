import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Workspace } from '@/lib/types';
import { isPreviewModeEnabled } from '@/lib/previewMode';
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

  const fetchWorkspace = useCallback(async (cancelled?: () => boolean) => {
    const isCancelled = cancelled ?? (() => false);

    if (isPreviewModeEnabled()) {
      if (!isCancelled()) {
        setWorkspace(PREVIEW_WORKSPACE);
        setLoading(false);
      }
      return;
    }

    if (!isCancelled()) {
      setLoading(true);
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (isCancelled()) return;

      if (!user) {
        setWorkspace(null);
        setLoading(false);
        return;
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user.id)
        .maybeSingle();

      if (userError) {
        console.error('Error loading user workspace link:', userError);
        setWorkspace(null);
        return;
      }

      if (isCancelled()) return;

      if (!userData?.workspace_id) {
        setWorkspace(null);
        return;
      }

      const { data: workspaceData, error: workspaceError } = await supabase
        .from('workspaces')
        .select('*')
        .eq('id', userData.workspace_id)
        .maybeSingle();

      if (workspaceError) {
        console.error('Error loading workspace:', workspaceError);
      }

      if (!isCancelled()) {
        setWorkspace(workspaceData ?? null);
      }
    } finally {
      if (!isCancelled()) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetchWorkspace(() => cancelled);

    // Re-fetch if auth state changes (sign in/out)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        void fetchWorkspace(() => cancelled);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchWorkspace]);

  return (
    <WorkspaceContext.Provider
      value={{ workspace, loading, refreshWorkspace: () => fetchWorkspace() }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
