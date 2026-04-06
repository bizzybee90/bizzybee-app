import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { isPreviewModeEnabled } from '@/lib/previewMode';
import { useWorkspace } from '@/hooks/useWorkspace';

export default function Onboarding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { workspace, loading: workspaceLoading } = useWorkspace();

  const handleComplete = async () => {
    if (isPreviewModeEnabled()) {
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
      navigate('/');
    } catch (err) {
      logger.error('Error completing onboarding', err);
      navigate('/');
    }
  };

  // Still loading workspace from context
  if (workspaceLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bb-linen">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-bb-gold border-t-transparent mx-auto mb-4" />
          <p className="text-bb-warm-gray">Loading onboarding...</p>
        </div>
      </div>
    );
  }

  // No workspace yet — should not happen if AuthGuard and WorkspaceContext work,
  // but handle gracefully
  if (!workspace?.id) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bb-linen">
        <div className="text-center max-w-md p-6">
          <h2 className="text-lg font-medium text-bb-text mb-2">Workspace not found</h2>
          <p className="text-bb-warm-gray mb-4">
            Your account is not linked to a workspace yet. Please sign in again or contact support.
          </p>
          <button
            onClick={() => navigate('/auth')}
            className="px-4 py-2 bg-bb-gold text-bb-espresso rounded-lg hover:opacity-90"
          >
            Sign in again
          </button>
        </div>
      </div>
    );
  }

  return <OnboardingWizard workspaceId={workspace.id} onComplete={handleComplete} />;
}
