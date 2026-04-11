import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import { isPreviewModeEnabled } from '@/lib/previewMode';
import { useWorkspace } from '@/hooks/useWorkspace';

export const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const location = useLocation();
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

    // Set up auth state listener first
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Then check for existing session
    supabase.auth.getSession().then(({ data: { session: existingSession }, error }) => {
      if (cancelled) return;

      if (error) {
        console.error('Error checking auth session:', error);
        setSession(null);
        setUser(null);
        setLoading(false);
        navigate('/auth', { replace: true });
        return;
      }

      if (existingSession) {
        setSession(existingSession);
        setUser(existingSession.user);
        setLoading(false);
        return;
      }

      setLoading(false);
      navigate('/auth', { replace: true });
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

    if (location.pathname === '/onboarding') {
      return;
    }

    if (!workspace?.id || needsOnboarding) {
      navigate('/onboarding', { replace: true });
    }
  }, [loading, location.pathname, navigate, needsOnboarding, session, user, workspace?.id, workspaceLoading]);

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
