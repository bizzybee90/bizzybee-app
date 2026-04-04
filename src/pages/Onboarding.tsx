import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { isOnboardingComplete } from '@/lib/onboardingStatus';

export default function Onboarding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isReset = searchParams.get('reset') === 'true';
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const clearSafetyTimeout = (timeoutId: number | undefined) => {
      if (timeoutId) window.clearTimeout(timeoutId);
    };

    // Prevent indefinite "Loading onboarding..." if auth events don't arrive for any reason
    const loadingSafetyTimeout = window.setTimeout(() => {
      if (!isMounted) return;
      setError('Onboarding is taking longer than expected. Please refresh the page.');
      setLoading(false);
    }, 20000);

    const initializeOnboarding = async (userId: string) => {
      try {
        logger.debug('Initializing for user', { userId });

        // Get user's workspace and onboarding status
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('workspace_id, onboarding_completed, onboarding_step')
          .eq('id', userId)
          .single();

        if (userError) {
          logger.error('Error fetching user', userError);
          // User might not exist yet - wait a bit for trigger
          await new Promise((resolve) => setTimeout(resolve, 1000));

          const { data: retryData, error: retryError } = await supabase
            .from('users')
            .select('workspace_id, onboarding_completed, onboarding_step')
            .eq('id', userId)
            .single();

          if (retryError) {
            logger.error('Retry failed', retryError);
            if (isMounted) {
              clearSafetyTimeout(loadingSafetyTimeout);
              setError('Failed to load user data. Please refresh the page.');
              setLoading(false);
            }
            return;
          }

          if (!isReset && isOnboardingComplete(retryData)) {
            navigate('/');
            return;
          }

          if (retryData?.workspace_id) {
            if (isMounted) {
              clearSafetyTimeout(loadingSafetyTimeout);
              setWorkspaceId(retryData.workspace_id);
              setLoading(false);
            }
            return;
          }
        }

        logger.debug('User data loaded', {
          workspaceId: userData?.workspace_id,
          onboardingCompleted: userData?.onboarding_completed,
        });

        // If already onboarded and NOT a reset, go to home
        if (!isReset && isOnboardingComplete(userData)) {
          logger.debug('Already completed, going home');
          clearSafetyTimeout(loadingSafetyTimeout);
          navigate('/');
          return;
        }

        // If workspace exists, use it
        if (userData?.workspace_id) {
          logger.debug('Using existing workspace', { workspaceId: userData.workspace_id });
          if (isMounted) {
            clearSafetyTimeout(loadingSafetyTimeout);
            setWorkspaceId(userData.workspace_id);
            setLoading(false);
          }
          return;
        }

        // Create a new workspace
        logger.debug('Creating workspace');
        const { data: workspace, error: wsError } = await supabase
          .from('workspaces')
          .insert({
            name: 'My Workspace',
            slug: `workspace-${userId.slice(0, 8)}`,
          })
          .select()
          .single();

        if (wsError) {
          logger.error('Error creating workspace', wsError);
          if (isMounted) {
            clearSafetyTimeout(loadingSafetyTimeout);
            setError('Failed to create workspace. Please refresh the page.');
            setLoading(false);
          }
          return;
        }

        // Update user with workspace
        const { error: updateError } = await supabase
          .from('users')
          .update({ workspace_id: workspace.id })
          .eq('id', userId);

        if (updateError) {
          logger.error('Error updating user', updateError);
        }

        logger.debug('Workspace created', { workspaceId: workspace.id });
        if (isMounted) {
          clearSafetyTimeout(loadingSafetyTimeout);
          setWorkspaceId(workspace.id);
          setLoading(false);
        }
      } catch (err) {
        logger.error('Unexpected error', err);
        if (isMounted) {
          clearSafetyTimeout(loadingSafetyTimeout);
          setError('An unexpected error occurred. Please refresh the page.');
          setLoading(false);
        }
      }
    };

    // 1) Immediate session check (handles refreshes where INITIAL_SESSION event can be missed)
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!isMounted) return;

      if (error) {
        logger.error('getSession error', error);
      }

      if (!session?.user) {
        clearSafetyTimeout(loadingSafetyTimeout);
        setLoading(false);
        navigate('/auth');
        return;
      }

      initializeOnboarding(session.user.id);
    });

    // 2) Keep listening for auth state changes (sign-in, refresh, sign-out)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      logger.debug('Auth event', { event });

      if (event === 'SIGNED_OUT' || !session?.user) {
        clearSafetyTimeout(loadingSafetyTimeout);
        if (isMounted) setLoading(false);
        navigate('/auth');
        return;
      }

      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
        initializeOnboarding(session.user.id);
      }
    });

    return () => {
      isMounted = false;
      clearSafetyTimeout(loadingSafetyTimeout);
      subscription.unsubscribe();
    };
  }, [isReset, navigate]);

  const handleComplete = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        // Mark onboarding as complete
        await supabase
          .from('users')
          .update({
            onboarding_completed: true,
            onboarding_step: 'complete',
          })
          .eq('id', user.id);

        // Fire-and-forget: trigger deep backfill import for remaining historical emails
        const { data: userData } = await supabase
          .from('users')
          .select('workspace_id')
          .eq('id', user.id)
          .single();

        if (userData?.workspace_id) {
          // Look up the email provider config for this workspace
          const { data: emailConfig } = await supabase
            .from('email_provider_configs')
            .select('id')
            .eq('workspace_id', userData.workspace_id)
            .limit(1)
            .maybeSingle();

          if (emailConfig?.id) {
            supabase.functions
              .invoke('start-email-import', {
                body: {
                  workspace_id: userData.workspace_id,
                  config_id: emailConfig.id,
                  mode: 'backfill',
                },
              })
              .catch((err) => logger.error('Deep backfill trigger failed (non-blocking)', err));
          }
        }
      }
      navigate('/');
    } catch (err) {
      logger.error('Error completing onboarding', err);
      navigate('/');
    }
  };

  // Show error state
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center max-w-md p-6">
          <div className="text-destructive mb-4">
            <svg
              className="h-12 w-12 mx-auto"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  // Show loading spinner while checking auth/onboarding status
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Loading onboarding...</p>
        </div>
      </div>
    );
  }

  // Show workspace setup if still waiting for workspace
  if (!workspaceId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Setting up your workspace...</p>
        </div>
      </div>
    );
  }

  return <OnboardingWizard workspaceId={workspaceId} onComplete={handleComplete} />;
}
