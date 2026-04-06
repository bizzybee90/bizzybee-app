import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { BusinessContextStep } from './BusinessContextStep';
import { KnowledgeBaseStep } from './KnowledgeBaseStep';
import { SearchTermsStep } from './SearchTermsStep';
import { EmailConnectionStep } from './EmailConnectionStep';
import { ChannelsSetupStep } from './ChannelsSetupStep';
import { ProgressScreen } from './ProgressScreen';
import { BizzyBeeLogo } from '@/components/branding/BizzyBeeLogo';
import { CheckCircle2, Mail, BookOpen, MessageCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { isPreviewModeEnabled } from '@/lib/previewMode';

interface OnboardingWizardProps {
  workspaceId: string;
  onComplete: () => void;
}

// New step order: welcome → business → knowledge → search_terms → email → channels → progress → complete
type Step =
  | 'welcome'
  | 'business'
  | 'knowledge'
  | 'search_terms'
  | 'email'
  | 'channels'
  | 'progress'
  | 'complete';

const STEPS: Step[] = [
  'welcome',
  'business',
  'knowledge',
  'search_terms',
  'email',
  'channels',
  'progress',
  'complete',
];

export function OnboardingWizard({ workspaceId, onComplete }: OnboardingWizardProps) {
  const storageKey = `bizzybee:onboarding:${workspaceId}`;
  const isPreviewMode = isPreviewModeEnabled();

  const businessContextDefaults = {
    companyName: '',
    businessType: '',
    isHiring: false,
    receivesInvoices: true,
    emailDomain: '',
    websiteUrl: '',
    serviceArea: '',
  };

  type StoredOnboardingDraft = {
    step?: Step;
    businessContext?: typeof businessContextDefaults;
    updatedAt?: number;
  };

  const readStored = (): StoredOnboardingDraft => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as StoredOnboardingDraft) : {};
    } catch {
      return {};
    }
  };

  const writeStored = (patch: Partial<StoredOnboardingDraft>) => {
    try {
      const prev = readStored();
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          ...prev,
          ...patch,
          updatedAt: Date.now(),
        } satisfies StoredOnboardingDraft),
      );
    } catch {
      // ignore
    }
  };

  const stored = readStored();

  const [currentStep, setCurrentStep] = useState<Step>(() => {
    return stored.step && STEPS.includes(stored.step) ? stored.step : 'welcome';
  });

  const [businessContext, setBusinessContext] = useState(() => {
    return { ...businessContextDefaults, ...(stored.businessContext ?? {}) };
  });
  const [knowledgeResults, setKnowledgeResults] = useState({ industryFaqs: 0, websiteFaqs: 0 });
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [liveFaqCount, setLiveFaqCount] = useState<number | null>(null);

  // Fetch live FAQ count and trigger inbox hydration when reaching complete step
  useEffect(() => {
    if (currentStep !== 'complete') return;
    if (isPreviewMode) return;

    const fetchCount = async () => {
      const { count } = await supabase
        .from('faq_database')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId);
      setLiveFaqCount(count || 0);
    };
    fetchCount();

    // Email import is handled automatically by the aurinko-webhook
    // as emails arrive. No batch import needed.
    console.log('Onboarding complete. Emails will be classified as they arrive via webhook.');
  }, [currentStep, isPreviewMode, workspaceId]);

  useEffect(() => {
    writeStored({ businessContext });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessContext, workspaceId]);

  // Save progress to database
  const saveProgress = async (step: Step) => {
    writeStored({ step });
    if (isPreviewMode) return;

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('users')
          .update({
            workspace_id: workspaceId,
            onboarding_step: step,
            onboarding_completed: false,
          })
          .eq('id', user.id);
      }
    } catch (error) {
      console.error('Error saving progress:', error);
    }
  };

  // Load saved progress on mount
  useEffect(() => {
    const loadProgress = async () => {
      if (isPreviewMode) {
        return;
      }

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase
            .from('users')
            .select('onboarding_step')
            .eq('id', user.id)
            .single();

          if (data?.onboarding_step && STEPS.includes(data.onboarding_step as Step)) {
            const dbStep = data.onboarding_step as Step;
            setCurrentStep(dbStep);
            writeStored({ step: dbStep });
          }

          // Check if email is already connected
          const { data: emailConfig } = await supabase
            .from('email_provider_configs')
            .select('email_address')
            .eq('workspace_id', workspaceId)
            .limit(1)
            .single();

          if (emailConfig?.email_address) {
            setConnectedEmail(emailConfig.email_address);
          }
        }
      } catch (error) {
        console.error('Error loading progress:', error);
      }
    };
    loadProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreviewMode, workspaceId]);

  const stepIndex = STEPS.indexOf(currentStep);
  const progress = (stepIndex / (STEPS.length - 1)) * 100;

  const handleNext = async () => {
    const nextIndex = stepIndex + 1;
    if (nextIndex < STEPS.length) {
      const nextStep = STEPS[nextIndex];
      setCurrentStep(nextStep);
      await saveProgress(nextStep);
    }
  };

  const handleBack = async () => {
    const prevIndex = stepIndex - 1;
    if (prevIndex >= 0) {
      const prevStep = STEPS[prevIndex];
      setCurrentStep(prevStep);
      await saveProgress(prevStep);
    }
  };

  const totalFaqs = knowledgeResults.industryFaqs + knowledgeResults.websiteFaqs;

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-6">
      <Card
        className={`w-full max-w-2xl shadow-lg shadow-black/5 border-border/50 ${currentStep === 'welcome' ? 'p-10' : ''}`}
      >
        <CardHeader className="text-center pb-2">
          {/* Skip button */}
          <div className="flex justify-end mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                if (isPreviewMode) {
                  window.location.href = '/?preview=1';
                  return;
                }

                const {
                  data: { user },
                } = await supabase.auth.getUser();
                if (user) {
                  await supabase
                    .from('users')
                    .update({
                      onboarding_completed: true,
                      onboarding_step: 'skipped',
                    })
                    .eq('id', user.id);
                }
                window.location.href = '/settings';
              }}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              Skip setup →
            </Button>
          </div>
          {/* Logo - Bold, prominent brand presence */}
          <div
            className={`flex justify-center ${currentStep === 'welcome' ? 'pt-4 mb-14' : 'mb-8'}`}
          >
            <BizzyBeeLogo
              variant="full"
              size={currentStep === 'welcome' ? 'hero' : 'xl'}
              imgClassName={
                currentStep === 'welcome' ? 'max-w-[240px] sm:max-w-[300px]' : 'max-w-[180px]'
              }
            />
          </div>
          {currentStep !== 'welcome' && currentStep !== 'complete' && (
            <Progress value={progress} className="h-2 mb-4" />
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          {currentStep === 'welcome' && (
            <div className="text-center space-y-10 py-2">
              {/* Headline - Reassuring and confident */}
              <div className="space-y-5">
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
                  Your calm inbox starts here
                </h1>
                {/* Supporting copy - Softer, unified paragraph */}
                <p className="text-muted-foreground/80 max-w-sm mx-auto leading-relaxed">
                  We'll set things up together so BizzyBee learns how you work. It only takes a few
                  minutes.
                </p>
              </div>
              {/* CTA - Intentional, inviting */}
              <Button
                onClick={handleNext}
                size="lg"
                className="px-14 py-7 text-base font-medium rounded-2xl bg-primary hover:bg-primary/90 shadow-md shadow-primary/20 transition-all hover:shadow-lg hover:shadow-primary/25"
              >
                Get started
              </Button>
            </div>
          )}

          {currentStep === 'business' && (
            <BusinessContextStep
              workspaceId={workspaceId}
              value={businessContext}
              onChange={setBusinessContext}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}

          {currentStep === 'knowledge' && (
            <KnowledgeBaseStep
              workspaceId={workspaceId}
              businessContext={{
                companyName: businessContext.companyName,
                businessType: businessContext.businessType,
                websiteUrl: businessContext.websiteUrl,
              }}
              onComplete={(results) => {
                setKnowledgeResults(results);
                handleNext();
              }}
              onBack={handleBack}
            />
          )}

          {currentStep === 'search_terms' && (
            <SearchTermsStep workspaceId={workspaceId} onNext={handleNext} onBack={handleBack} />
          )}

          {currentStep === 'email' && (
            <EmailConnectionStep
              workspaceId={workspaceId}
              onEmailConnected={(email) => setConnectedEmail(email)}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}

          {currentStep === 'channels' && (
            <ChannelsSetupStep workspaceId={workspaceId} onNext={handleNext} onBack={handleBack} />
          )}

          {currentStep === 'progress' && (
            <ProgressScreen workspaceId={workspaceId} onNext={handleNext} onBack={handleBack} />
          )}

          {currentStep === 'complete' && (
            <div className="text-center space-y-6 py-8">
              <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
              <div className="space-y-2">
                <CardTitle className="text-2xl">Your AI Agent is Ready!</CardTitle>
                <CardDescription className="text-base">
                  BizzyBee has learned from your competitors and email patterns.
                </CardDescription>
              </div>

              <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-primary">
                    {liveFaqCount ?? knowledgeResults.websiteFaqs + knowledgeResults.industryFaqs}
                  </div>
                  <div className="text-xs text-muted-foreground">FAQs ready</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-success">✓</div>
                  <div className="text-xs text-muted-foreground">AI trained</div>
                </div>
              </div>

              {connectedEmail && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  <span>Connected: {connectedEmail}</span>
                </div>
              )}

              <div className="flex flex-col gap-3">
                <Button onClick={onComplete} size="lg" className="px-8 gap-2">
                  <MessageCircle className="h-4 w-4" />
                  Start Using BizzyBee
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    window.open('/knowledge-base', '_blank');
                  }}
                  className="gap-2"
                >
                  <BookOpen className="h-4 w-4" />
                  View Knowledge Base
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                  className="text-muted-foreground"
                >
                  ← Back
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
