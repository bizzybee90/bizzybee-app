import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { BusinessContextStep } from './BusinessContextStep';
import { KnowledgeBaseStep } from './KnowledgeBaseStep';
import { VoiceExperienceStep } from './VoiceExperienceStep';
import { FlagshipActivationStep } from './FlagshipActivationStep';
import type { VoiceExperienceDraft } from './VoiceExperienceStep.config';
import { DEFAULT_VOICE_EXPERIENCE_DRAFT } from './VoiceExperienceStep.config';
import { SearchTermsStep } from './SearchTermsStep';
import { EmailConnectionStep } from './EmailConnectionStep';
import { ChannelsSetupStep } from './ChannelsSetupStep';
import { ProgressScreen } from './ProgressScreen';
import { BizzyBeeLogo } from '@/components/branding/BizzyBeeLogo';
import { CheckCircle2, Mail, BookOpen, MessageCircle, Phone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  clearOnboardingHandoff,
  isPreviewModeEnabled,
  readOnboardingHandoff,
} from '@/lib/previewMode';
import { useAiPhoneConfig } from '@/hooks/useAiPhoneConfig';

interface OnboardingWizardProps {
  workspaceId: string;
  forceFresh?: boolean;
  onComplete: () => void;
}

// New step order: welcome → business → knowledge → voice → activate → email → channels → search_terms → progress → complete
type Step =
  | 'welcome'
  | 'business'
  | 'knowledge'
  | 'voice'
  | 'activate'
  | 'email'
  | 'channels'
  | 'search_terms'
  | 'progress'
  | 'complete';

const STEPS: Step[] = [
  'welcome',
  'business',
  'knowledge',
  'voice',
  'activate',
  'email',
  'channels',
  'search_terms',
  'progress',
  'complete',
];

export function OnboardingWizard({
  workspaceId,
  forceFresh = false,
  onComplete,
}: OnboardingWizardProps) {
  const storageKey = `bizzybee:onboarding:${workspaceId}`;
  const isPreviewMode = isPreviewModeEnabled();
  const handoff = readOnboardingHandoff();

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
    voiceExperience?: VoiceExperienceDraft;
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
    if (handoff?.step && STEPS.includes(handoff.step as Step)) {
      return handoff.step as Step;
    }
    return stored.step && STEPS.includes(stored.step) ? stored.step : 'welcome';
  });

  const [businessContext, setBusinessContext] = useState(() => {
    const base = {
      ...businessContextDefaults,
      ...(stored.businessContext ?? {}),
      ...(handoff?.businessContext ?? {}),
    };
    // Pre-fill website URL from marketing site if not already set
    if (!base.websiteUrl) {
      const prefill = sessionStorage.getItem('bizzybee_prefill_website');
      if (prefill) base.websiteUrl = prefill;
    }
    return base;
  });
  const [voiceExperience, setVoiceExperience] = useState(() => {
    return { ...DEFAULT_VOICE_EXPERIENCE_DRAFT, ...(stored.voiceExperience ?? {}) };
  });
  const [knowledgeResults, setKnowledgeResults] = useState({ industryFaqs: 0, websiteFaqs: 0 });
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [liveFaqCount, setLiveFaqCount] = useState<number | null>(null);
  const { config: aiPhoneConfig } = useAiPhoneConfig();

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

  useEffect(() => {
    if (!handoff?.step || isPreviewMode) return;

    void saveProgress(handoff.step as Step);
    clearOnboardingHandoff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreviewMode]);

  useEffect(() => {
    if (currentStep !== 'voice') return;

    setVoiceExperience((prev) => {
      const companyName = businessContext.companyName.trim() || 'your business';
      const receptionistName =
        prev.receptionistName.trim() || prev.selectedVoiceName.trim() || 'your receptionist';
      const legacyGreeting = `Hi, thanks for calling ${companyName}. You’re speaking with BizzyBee.`;
      const suggestedGreeting = `Hi, thanks for calling ${companyName}. You’re speaking with ${receptionistName}.`;

      if (prev.greeting.trim() && prev.greeting.trim() !== legacyGreeting && prev.signoff.trim()) {
        return prev;
      }

      return {
        ...prev,
        receptionistName: prev.receptionistName.trim()
          ? prev.receptionistName
          : prev.selectedVoiceName,
        greeting:
          !prev.greeting.trim() || prev.greeting.trim() === legacyGreeting
            ? suggestedGreeting
            : prev.greeting,
        signoff: prev.signoff.trim() ? prev.signoff : 'Thanks, speak soon.',
      };
    });
  }, [currentStep, businessContext.companyName]);

  useEffect(() => {
    writeStored({ voiceExperience });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceExperience, workspaceId]);

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

          if (
            !handoff?.step &&
            data?.onboarding_step &&
            STEPS.includes(data.onboarding_step as Step)
          ) {
            const dbStep = data.onboarding_step as Step;
            setCurrentStep(dbStep);
            writeStored({ step: dbStep });
          }

          // Check if email is already connected
          const { data: emailConfigs } = await supabase
            .from('email_provider_configs')
            .select('email_address')
            .eq('workspace_id', workspaceId)
            .limit(1);

          const emailConfig = emailConfigs?.[0];
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
  const wizardWidthClass =
    currentStep === 'voice'
      ? 'max-w-[1480px]'
      : currentStep === 'activate'
        ? 'max-w-[1440px]'
        : currentStep === 'welcome' || currentStep === 'complete'
          ? 'max-w-[1280px]'
          : 'max-w-[1320px]';

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-5 lg:px-8 lg:py-6">
      <Card
        className={`mx-auto flex min-h-[calc(100dvh-2.5rem)] w-full ${wizardWidthClass} flex-col rounded-[34px] border-border/60 shadow-[0_24px_60px_rgba(28,21,16,0.08)] ${currentStep === 'welcome' ? 'p-10' : ''}`}
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
              <div className="space-y-5">
                <div className="inline-flex items-center rounded-full border border-border/70 bg-muted/40 px-3 py-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Website-first setup
                </div>
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
                  Start with your website. We&apos;ll shape the rest around it.
                </h1>
                <p className="text-muted-foreground/80 max-w-sm mx-auto leading-relaxed">
                  BizzyBee reads your site, learns the basics of your business, and then expands
                  into email and channels only after the core setup makes sense.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3 text-left max-w-xl mx-auto">
                <div className="rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm shadow-black/5">
                  <BookOpen className="h-5 w-5 text-primary mb-3" />
                  <h2 className="font-medium">Start with the site</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    We use your website to understand services, tone, and common questions.
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm shadow-black/5">
                  <Mail className="h-5 w-5 text-primary mb-3" />
                  <h2 className="font-medium">Shape the inbox</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Then we learn the kind of messages you want BizzyBee to sort and answer.
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm shadow-black/5">
                  <MessageCircle className="h-5 w-5 text-primary mb-3" />
                  <h2 className="font-medium">Expand when ready</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Email, phone, and other channels come in once the assistant already feels
                    useful.
                  </p>
                </div>
              </div>
              <Button
                onClick={handleNext}
                size="lg"
                className="px-14 py-7 text-base font-medium rounded-2xl bg-primary hover:bg-primary/90 shadow-md shadow-primary/20 transition-all hover:shadow-lg hover:shadow-primary/25"
              >
                Start setup
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
              forceFresh={forceFresh}
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

          {currentStep === 'voice' && (
            <VoiceExperienceStep
              workspaceId={workspaceId}
              businessContext={{
                companyName: businessContext.companyName,
                businessType: businessContext.businessType,
                websiteUrl: businessContext.websiteUrl,
              }}
              knowledgeSummary={knowledgeResults}
              value={voiceExperience}
              onChange={setVoiceExperience}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}

          {currentStep === 'activate' && (
            <FlagshipActivationStep
              workspaceId={workspaceId}
              businessContext={{
                companyName: businessContext.companyName,
                businessType: businessContext.businessType,
                websiteUrl: businessContext.websiteUrl,
                serviceArea: businessContext.serviceArea,
              }}
              knowledgeSummary={knowledgeResults}
              voiceExperience={voiceExperience}
              connectedEmail={connectedEmail}
              onNext={handleNext}
              onBack={handleBack}
            />
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

          {currentStep === 'search_terms' && (
            <SearchTermsStep workspaceId={workspaceId} onNext={handleNext} onBack={handleBack} />
          )}

          {currentStep === 'progress' && (
            <ProgressScreen
              workspaceId={workspaceId}
              connectedEmail={connectedEmail}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}

          {currentStep === 'complete' && (
            <div className="text-center space-y-6 py-8">
              <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
              <div className="space-y-2">
                <CardTitle className="text-2xl">Your AI Agent is Ready!</CardTitle>
                <CardDescription className="text-base">
                  BizzyBee has learned your business, your voice, and the core channels it should
                  power first.
                </CardDescription>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
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
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <div className="text-lg font-bold text-foreground">
                    {voiceExperience.selectedVoiceName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {voiceExperience.toneDescriptors.slice(0, 3).join(' · ') || 'Warm voice'}
                  </div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <div className="text-lg font-bold text-foreground">
                    {aiPhoneConfig?.phone_number || 'Provision next'}
                  </div>
                  <div className="text-xs text-muted-foreground">AI phone</div>
                </div>
              </div>

              <div className="grid gap-3 text-left md:grid-cols-2 max-w-3xl mx-auto">
                <div className="rounded-2xl border border-border/60 bg-background p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Mail className="h-4 w-4 text-primary" />
                    Inbox
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {connectedEmail
                      ? `Connected: ${connectedEmail}`
                      : 'Connect your inbox to start sorting, learning, and drafting in your real email.'}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Phone className="h-4 w-4 text-primary" />
                    AI Phone
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {aiPhoneConfig?.phone_number
                      ? `Managed number ready: ${aiPhoneConfig.phone_number}`
                      : 'Provision a BizzyBee-managed number when you are ready to switch phone on.'}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background p-4 md:col-span-2">
                  <p className="text-sm font-medium text-foreground">Next actions</p>
                  <div className="mt-2 space-y-2 text-sm text-muted-foreground">
                    <p>1. Send a test email through the inbox connection.</p>
                    <p>2. Test a phone call if your BizzyBee number is provisioned.</p>
                    <p>3. Expand into WhatsApp, SMS, Instagram, Facebook, or Google later.</p>
                  </div>
                </div>
              </div>

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
