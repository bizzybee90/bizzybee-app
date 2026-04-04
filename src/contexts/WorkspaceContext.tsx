import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Workspace } from '@/lib/types';

interface WorkspaceContextValue {
  workspace: Workspace | null;
  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: null,
  loading: true,
});

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchWorkspace = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user.id)
        .single();

      if (cancelled) return;

      if (userData?.workspace_id) {
        const { data: workspaceData } = await supabase
          .from('workspaces')
          .select('*')
          .eq('id', userData.workspace_id)
          .single();

        if (!cancelled) {
          setWorkspace(workspaceData);
        }
      }
      if (!cancelled) {
        setLoading(false);
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
    <WorkspaceContext.Provider value={{ workspace, loading }}>{children}</WorkspaceContext.Provider>
  );
}

/**
 * Returns the current workspace. Fetched once at app level and shared via Context.
 * Replaces the old useWorkspace() hook which re-fetched on every component mount.
 */
export function useWorkspace() {
  return useContext(WorkspaceContext);
}
