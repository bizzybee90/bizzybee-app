import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { isPreviewModeEnabled } from '@/lib/previewMode';
import { useWorkspace } from '@/hooks/useWorkspace';

export default function Onboarding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isPreview = isPreviewModeEnabled();
  const { workspace, loading: workspaceLoading, refreshWorkspace } = useWorkspace();
  const [bootstrapWorkspaceId, setBootstrapWorkspaceId] = useState<string | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const resolvedWorkspaceId = workspace?.id ?? bootstrapWorkspaceId;

  const bootstrapWorkspace = useCallback(async () => {
    if (isPreview) {
      return;
    }

    setBootstrapping(true);
    setBootstrapError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        navigate('/auth');
        return;
      }

      const { data, error } = await supabase.functions.invoke('bootstrap-workspace', {
        body: { reset: searchParams.get('reset') === 'true' },
      });

      if (error) {
        throw error;
      }

      const nextWorkspaceId = data?.workspace_id ?? data?.workspace?.id ?? null;
      if (!nextWorkspaceId) {
        throw new Error('BizzyBee could not prepare your workspace.');
      }

      setBootstrapWorkspaceId(nextWorkspaceId);
      await refreshWorkspace();
    } catch (error) {
      logger.error('Error preparing onboarding workspace', error);
      setBootstrapError(
        error instanceof Error ? error.message : 'BizzyBee could not prepare your workspace.',
      );
    } finally {
      setBootstrapping(false);
    }
  }, [isPreview, navigate, refreshWorkspace, searchParams]);

  const handleComplete = async () => {
    if (isPreview) {
      navigate('/?preview=1');
      return;
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('users')
          .update({
            onboarding_completed: true,
            onboarding_step: 'complete',
          })
          .eq('id', user.id);
      }
      await refreshWorkspace();
      navigate('/');
    } catch (err) {
      logger.error('Error completing onboarding', err);
      navigate('/');
    }
  };

  useEffect(() => {
    if (isPreview || workspaceLoading || resolvedWorkspaceId || bootstrapping) {
      return;
    }

    void bootstrapWorkspace();
  }, [bootstrapWorkspace, bootstrapping, isPreview, resolvedWorkspaceId, workspaceLoading]);

  // Still loading workspace from context
  if (workspaceLoading || bootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bb-linen">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-bb-gold border-t-transparent mx-auto mb-4" />
          <p className="text-bb-warm-gray">
            {bootstrapping ? 'Preparing your workspace...' : 'Loading onboarding...'}
          </p>
        </div>
      </div>
    );
  }

  if (!resolvedWorkspaceId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bb-linen">
        <div className="text-center max-w-md p-6">
          <h2 className="text-lg font-medium text-bb-text mb-2">We couldn&apos;t continue setup</h2>
          <p className="text-bb-warm-gray mb-4">
            {bootstrapError ??
              'BizzyBee could not prepare your workspace yet. Try again and we will restart onboarding from the beginning.'}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => void bootstrapWorkspace()}
              className="px-4 py-2 bg-bb-gold text-bb-espresso rounded-lg hover:opacity-90"
            >
              Try again
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 border border-bb-border rounded-lg text-bb-text hover:bg-white"
            >
              Back to app
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <OnboardingWizard workspaceId={resolvedWorkspaceId} onComplete={handleComplete} />;
}
