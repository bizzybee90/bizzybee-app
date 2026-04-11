import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import { isPreviewModeEnabled } from '@/lib/previewMode';
import { useWorkspace } from '@/hooks/useWorkspace';

export const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const { workspace, loading: workspaceLoading, needsOnboarding } = useWorkspace();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isPreviewModeEnabled()) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const applySession = (nextSession: Session | null) => {
      if (cancelled) {
        return;
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        applySession(null);
        return;
      }

      applySession(session);
    });

    void supabase.auth
      .getSession()
      .then(({ data: { session: existingSession }, error }) => {
        if (error) {
          console.error('Error checking auth session:', error);
          applySession(null);
          return;
        }

        applySession(existingSession);
      })
      .catch((error) => {
        console.error('Unexpected auth session error:', error);
        applySession(null);
      });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate]);

  useEffect(() => {
    if (isPreviewModeEnabled()) {
      return;
    }

    if (loading) {
      return;
    }

    if (!user || !session) {
      navigate('/auth', { replace: true });
      return;
    }

    if (workspaceLoading) {
      return;
    }

    if (!workspace?.id || needsOnboarding) {
      navigate('/onboarding', { replace: true });
    }
  }, [loading, navigate, needsOnboarding, session, user, workspace?.id, workspaceLoading]);

  if (isPreviewModeEnabled()) {
    return <>{children}</>;
  }

  if (loading || workspaceLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || !session) {
    // Show loading state instead of null to prevent flash
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
