import { ArrowLeft, ArrowRight, Lock, Mail, Phone, Sparkles, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PhoneNumberDisplay } from '@/components/ai-phone/PhoneNumberDisplay';
import { useAiPhoneConfig } from '@/hooks/useAiPhoneConfig';
import { useWorkspace } from '@/hooks/useWorkspace';
import { cn } from '@/lib/utils';

interface FlagshipActivationStepProps {
  workspaceId: string;
  businessContext: {
    companyName: string;
    websiteUrl: string;
    serviceArea: string;
    businessType: string;
  };
  knowledgeSummary: {
    industryFaqs: number;
    websiteFaqs: number;
  };
  voiceExperience: {
    selectedVoiceId: string;
    selectedVoiceName: string;
    receptionistName?: string;
    toneDescriptors: string[];
    greeting: string;
    signoff: string;
  };
  connectedEmail: string | null;
  onNext: () => void;
  onBack: () => void;
}

function formatWebsiteHost(websiteUrl: string) {
  try {
    return new URL(websiteUrl).host.replace(/^www\./, '');
  } catch {
    return websiteUrl;
  }
}

function formatBusinessType(businessType: string) {
  return businessType.replace(/_/g, ' ');
}

function buildToneSummary(toneDescriptors: string[]) {
  const tones = toneDescriptors
    .map((tone) => tone.trim())
    .filter(Boolean)
    .slice(0, 3);
  return tones.length > 0 ? tones.join(' · ') : 'warm · reassuring';
}

function buildProvisionPayload(params: {
  businessContext: FlagshipActivationStepProps['businessContext'];
  voiceExperience: FlagshipActivationStepProps['voiceExperience'];
}) {
  const { businessContext, voiceExperience } = params;
  const businessDescription = [
    formatBusinessType(businessContext.businessType),
    businessContext.serviceArea,
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .join(' • ');

  const toneSummary = buildToneSummary(voiceExperience.toneDescriptors);

  return {
    business_name: businessContext.companyName,
    business_description: businessDescription || null,
    services: [],
    opening_hours: {},
    voice_id: voiceExperience.selectedVoiceId,
    voice_name: voiceExperience.receptionistName || voiceExperience.selectedVoiceName || 'Eric',
    custom_instructions: [
      `Tone: ${toneSummary}`,
      voiceExperience.signoff ? `Sign off with: ${voiceExperience.signoff.trim()}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    greeting_message: voiceExperience.greeting.trim(),
  };
}

function statusBadgeClassName(kind: 'neutral' | 'success' | 'warning' | 'locked') {
  switch (kind) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'locked':
      return 'border-slate-200 bg-slate-50 text-slate-700';
    case 'neutral':
    default:
      return 'border-bb-border bg-bb-cream text-bb-text-secondary';
  }
}

export function FlagshipActivationStep({
  workspaceId: _workspaceId,
  businessContext,
  knowledgeSummary,
  voiceExperience,
  connectedEmail,
  onNext,
  onBack,
}: FlagshipActivationStepProps) {
  const { entitlements } = useWorkspace();
  const { config, createConfig, isProvisioning } = useAiPhoneConfig();

  const canUseAiPhone = entitlements?.canUseAiPhone !== false;
  const isLocked = !canUseAiPhone;
  const isActive = config?.status === 'active' && Boolean(config.phone_number);
  const isProvisioningState = config?.status === 'provisioning' || (isProvisioning && !isActive);
  const statusKind: 'neutral' | 'success' | 'warning' | 'locked' = isLocked
    ? 'locked'
    : isActive
      ? 'success'
      : isProvisioningState
        ? 'warning'
        : 'neutral';

  const handleProvision = () => {
    createConfig.mutate(buildProvisionPayload({ businessContext, voiceExperience }));
  };

  const toneSummary = buildToneSummary(voiceExperience.toneDescriptors);
  const websiteHost = formatWebsiteHost(businessContext.websiteUrl);
  const locationLabel = businessContext.serviceArea.trim();
  const businessTypeLabel = formatBusinessType(businessContext.businessType);
  const businessSummary = locationLabel
    ? `${businessTypeLabel} in ${locationLabel}`
    : businessTypeLabel || 'Business profile ready';
  const workspaceSubline = [websiteHost, locationLabel].filter(Boolean).join(' · ');

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-3xl border border-bb-border/70 bg-gradient-to-br from-bb-white via-bb-white to-bb-gold/10 p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1.5 uppercase tracking-[0.12em]">
            <Sparkles className="h-3.5 w-3.5" />
            Flagship channels
          </Badge>
          <Badge variant="outline" className="border-bb-gold/20 bg-bb-gold/10 text-bb-text">
            Next up: inbox setup
          </Badge>
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
          <div className="space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight text-bb-text sm:text-3xl">
              Bring Email and AI Phone online
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-bb-warm-gray">
              BizzyBee has already learned your business, your website, and the voice to use on
              calls. These are the two flagship channels to activate before the wider channel
              rollout.
            </p>
          </div>

          <div className="rounded-2xl border border-bb-border bg-bb-white/90 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-bb-warm-gray">
              Current workspace
            </p>
            <p className="mt-2 text-sm font-medium text-bb-text">{businessContext.companyName}</p>
            {workspaceSubline ? (
              <p className="mt-1 text-sm text-bb-warm-gray">{workspaceSubline}</p>
            ) : null}
          </div>
        </div>
      </div>

      <Card className="border-bb-border/70 bg-bb-white">
        <CardHeader className="space-y-1">
          <CardTitle className="text-lg">What BizzyBee has already learned</CardTitle>
          <CardDescription>
            The onboarding context below is already in place, so this step can stay focused on the
            two channels that matter most.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-bb-border bg-bb-cream/40 p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-bb-warm-gray">Business</p>
              <p className="mt-1 text-sm font-medium text-bb-text">{businessContext.companyName}</p>
              <p className="mt-1 text-xs text-bb-warm-gray">{businessSummary}</p>
            </div>
            <div className="rounded-2xl border border-bb-border bg-bb-cream/40 p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-bb-warm-gray">Website</p>
              <p className="mt-1 text-sm font-medium text-bb-text">{websiteHost}</p>
              <p className="mt-1 text-xs text-bb-warm-gray">{businessContext.websiteUrl}</p>
            </div>
            <div className="rounded-2xl border border-bb-border bg-bb-cream/40 p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-bb-warm-gray">
                Knowledge base
              </p>
              <p className="mt-1 text-sm font-medium text-bb-text">
                {knowledgeSummary.industryFaqs + knowledgeSummary.websiteFaqs} FAQs
              </p>
              <p className="mt-1 text-xs text-bb-warm-gray">
                {knowledgeSummary.industryFaqs} industry · {knowledgeSummary.websiteFaqs} website
              </p>
            </div>
            <div className="rounded-2xl border border-bb-border bg-bb-cream/40 p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-bb-warm-gray">Voice</p>
              <p className="mt-1 text-sm font-medium text-bb-text">
                {voiceExperience.receptionistName || voiceExperience.selectedVoiceName}
              </p>
              <p className="mt-1 text-xs text-bb-warm-gray">{toneSummary}</p>
            </div>
            <div className="rounded-2xl border border-bb-border bg-bb-cream/40 p-4 sm:col-span-2 xl:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-bb-warm-gray">
                Greeting and close
              </p>
              <p className="mt-1 text-sm text-bb-text">
                {voiceExperience.greeting.trim() || 'BizzyBee has a default greeting ready.'}
              </p>
              <p className="mt-1 text-xs text-bb-warm-gray">
                Sign-off: {voiceExperience.signoff.trim() || 'Thanks, speak soon.'}
              </p>
            </div>
            <div className="rounded-2xl border border-bb-border bg-bb-cream/40 p-4 sm:col-span-2 xl:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-bb-warm-gray">
                Existing email
              </p>
              <p className="mt-1 text-sm font-medium text-bb-text">
                {connectedEmail || 'No inbox connected yet'}
              </p>
              <p className="mt-1 text-xs text-bb-warm-gray">
                Email remains the primary inbox for live replies and follow-up.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden border-bb-border/70 bg-gradient-to-br from-bb-white via-bb-white to-bb-cream/50">
          <CardHeader className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-bb-gold" />
                  <CardTitle className="text-lg">Email</CardTitle>
                </div>
                <CardDescription>
                  The inbox BizzyBee works from first. Once connected, it becomes the main operating
                  surface for replies and routing.
                </CardDescription>
              </div>
              <Badge
                variant="outline"
                className="border-bb-border bg-bb-cream text-bb-text-secondary"
              >
                {connectedEmail ? 'Connected' : 'Next step'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-bb-border bg-bb-white p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-bb-warm-gray">Mailbox</p>
              <p className="mt-1 text-base font-medium text-bb-text">
                {connectedEmail || 'No email mailbox connected yet'}
              </p>
              <p className="mt-1 text-sm text-bb-warm-gray">
                Email setup is next in line so BizzyBee can start handling real threads.
              </p>
            </div>
            <div className="rounded-2xl border border-dashed border-bb-border bg-bb-cream/40 p-4 text-sm text-bb-warm-gray">
              <p className="font-medium text-bb-text">Why it matters</p>
              <p className="mt-1">
                The inbox gives BizzyBee a place to draft, learn, and respond once the workspace
                moves beyond onboarding.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-bb-border/70 bg-gradient-to-br from-bb-white via-bb-white to-bb-gold/5">
          <CardHeader className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-bb-gold" />
                  <CardTitle className="text-lg">AI Phone</CardTitle>
                </div>
                <CardDescription>
                  The managed number that gives BizzyBee a voice. Provision it once and the call
                  layer can stay consistent with the tone you already defined.
                </CardDescription>
              </div>
              <Badge variant="outline" className={cn('border', statusBadgeClassName(statusKind))}>
                {isLocked
                  ? 'Locked'
                  : isActive
                    ? 'Live'
                    : isProvisioningState
                      ? 'Provisioning'
                      : 'Not provisioned'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLocked ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <div className="flex items-start gap-3">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium text-slate-900">AI Phone is locked on this plan</p>
                    <p>
                      The workspace does not have the <span className="font-medium">ai_phone</span>{' '}
                      entitlement yet, so BizzyBee will keep this channel parked until the plan
                      changes.
                    </p>
                  </div>
                </div>
              </div>
            ) : isActive ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-emerald-700">
                      Managed number
                    </p>
                    <p className="text-sm font-medium text-emerald-900">
                      BizzyBee-managed line is active
                    </p>
                  </div>
                  <Badge variant="outline" className="border-emerald-200 bg-white text-emerald-700">
                    Ready
                  </Badge>
                </div>
                <div className="mt-4">
                  <PhoneNumberDisplay phoneNumber={config?.phone_number ?? null} isActive />
                </div>
              </div>
            ) : isProvisioningState ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                <div className="flex items-start gap-3">
                  <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-amber-700" />
                  <div className="space-y-1">
                    <p className="font-medium text-amber-950">Provisioning the managed number</p>
                    <p className="text-sm text-amber-800">
                      BizzyBee is setting up the line now. The workspace can continue forward while
                      the phone number finishes provisioning.
                    </p>
                    {config?.phone_number ? (
                      <p className="text-sm font-medium text-amber-950">
                        Reserved number: {config.phone_number}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-bb-border bg-bb-cream/50 p-4 text-sm text-bb-warm-gray">
                  <p className="font-medium text-bb-text">No managed number yet</p>
                  <p className="mt-1">
                    Provision a BizzyBee-managed phone number with the business name, voice, and
                    greeting you just defined.
                  </p>
                </div>

                <Button
                  type="button"
                  onClick={handleProvision}
                  disabled={createConfig.isPending || isProvisioning}
                  className="w-full justify-center"
                >
                  {createConfig.isPending || isProvisioning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Provision BizzyBee-managed number
                </Button>
              </div>
            )}

            <div className="rounded-2xl border border-dashed border-bb-border bg-bb-cream/40 p-4 text-sm text-bb-warm-gray">
              <p className="font-medium text-bb-text">Why this is the flagship lane</p>
              <p className="mt-1">
                The same voice profile that BizzyBee uses in replies also sets the tone for calls,
                so the experience feels consistent across the two highest-value channels.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-bb-border/70 bg-bb-white">
        <CardHeader className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="uppercase tracking-[0.12em]">
              Next page
            </Badge>
            <CardTitle className="text-lg">Connect your inbox</CardTitle>
          </div>
          <CardDescription>
            The next screen opens email setup directly, so BizzyBee can start learning from live
            threads before you widen out into the rest of the channel surface.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-bb-warm-gray">
          <div className="flex items-start gap-3">
            <div className="mt-2 h-1.5 w-1.5 rounded-full bg-bb-gold" />
            <p>
              Choose the mailbox provider next, then decide how much inbox history BizzyBee should
              start with on this plan.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-2 h-1.5 w-1.5 rounded-full bg-bb-gold" />
            <p>
              AI Phone can be provisioned now or just after inbox setup. The other channels stay
              ready for later once the core messaging and voice lanes are live.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button type="button" onClick={onNext} className="gap-2">
          Continue to inbox setup
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
