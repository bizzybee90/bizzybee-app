import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { RotateCcw, Loader2 } from 'lucide-react';

export function OnboardingTriggerPanel() {
  const [isResetting, setIsResetting] = useState(false);
  const navigate = useNavigate();

  const handleRerunOnboarding = async () => {
    setIsResetting(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('users')
        .update({
          onboarding_completed: false,
          onboarding_step: 'welcome',
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) {
        throw error;
      }

      // Clear localStorage draft so wizard doesn't resume from old step
      try {
        const keys = Object.keys(localStorage);
        keys.forEach((key) => {
          if (key.startsWith('bizzybee:onboarding:')) {
            localStorage.removeItem(key);
          }
        });
      } catch {
        // Ignore localStorage cleanup failures and continue into onboarding.
      }

      toast.success('Redirecting to onboarding...');
      navigate('/onboarding?reset=true');
    } catch (error) {
      console.error('Error resetting onboarding:', error);
      toast.error('Failed to start onboarding');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Re-run the setup wizard to update your business details, connect channels again, or revisit
        your automation choices without starting from scratch.
      </p>
      <Button onClick={handleRerunOnboarding} disabled={isResetting} variant="outline">
        {isResetting ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <RotateCcw className="h-4 w-4 mr-2" />
        )}
        Re-run Setup Wizard
      </Button>
    </div>
  );
}
