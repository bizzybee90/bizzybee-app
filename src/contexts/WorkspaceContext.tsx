import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Workspace } from '@/lib/types';
import { WorkspaceContext } from './workspace-context';

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchWorkspace = async () => {
      if (!cancelled) {
        setLoading(true);
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;

      if (!user) {
        setWorkspace(null);
        setLoading(false);
        return;
      }

      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user.id)
        .single();

      if (cancelled) return;

      if (!userData?.workspace_id) {
        setWorkspace(null);
        setLoading(false);
        return;
      }

      const { data: workspaceData } = await supabase
        .from('workspaces')
        .select('*')
        .eq('id', userData.workspace_id)
        .single();

      if (!cancelled) {
        setWorkspace(workspaceData ?? null);
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
