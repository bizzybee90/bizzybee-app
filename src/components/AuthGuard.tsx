import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import { isOnboardingComplete } from '@/lib/onboardingStatus';
import { isPreviewModeEnabled } from '@/lib/previewMode';

export const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const checkingOnboardingRef = useRef(false);
  const hasCheckedOnboarding = useRef(false);
  const lastCheckedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isPreviewModeEnabled()) {
      setLoading(false);
      return;
    }

    // Set up auth state listener first
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Then check for existing session
    supabase.auth.getSession().then(async ({ data: { session: existingSession } }) => {
      if (existingSession) {
        setSession(existingSession);
        setUser(existingSession.user);
        setLoading(false);
        return;
      }

      setLoading(false);
      navigate('/auth');
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  // Check onboarding status ONCE after user is loaded
  useEffect(() => {
    if (isPreviewModeEnabled()) {
      return;
    }

    const checkOnboarding = async () => {
      if (!user || checkingOnboardingRef.current || hasCheckedOnboarding.current) return;

      // If user changes (sign out/in), allow a new check.
      if (lastCheckedUserIdRef.current && lastCheckedUserIdRef.current !== user.id) {
        hasCheckedOnboarding.current = false;
      }

      // Skip onboarding check if already on onboarding page
      if (location.pathname === '/onboarding') return;

      checkingOnboardingRef.current = true;
      try {
        const { data: userData, error } = await supabase
          .from('users')
          .select('onboarding_completed, onboarding_step')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error checking onboarding status:', error);
          return;
        }

        if (!userData) {
          navigate('/onboarding');
          return;
        }

        hasCheckedOnboarding.current = true;
        lastCheckedUserIdRef.current = user.id;

        // Redirect to onboarding if not completed
        if (!isOnboardingComplete(userData)) {
          navigate('/onboarding');
        }
      } catch (error) {
        console.error('Error in onboarding check:', error);
      } finally {
        checkingOnboardingRef.current = false;
      }
    };

    checkOnboarding();
  }, [user, navigate, location.pathname]);

  if (isPreviewModeEnabled()) {
    return <>{children}</>;
  }

  if (loading) {
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
