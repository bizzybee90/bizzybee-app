import {
  ArrowLeft,
  ArrowRight,
  Facebook,
  Globe,
  Instagram,
  MapPin,
  MessageSquare,
  Phone,
  Sparkles,
} from 'lucide-react';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChannelManagementPanel } from '@/components/settings/ChannelManagementPanel';
import { PanelNotice } from '@/components/settings/PanelNotice';
import { useChannelSetup } from '@/hooks/useChannelSetup';
import { getChannelDefinitionsForSurface, type ChannelKey } from '@/lib/channels';

interface ChannelsSetupStepProps {
  workspaceId: string;
  onNext: () => void;
  onBack: () => void;
}

const onboardingDefinitions = getChannelDefinitionsForSurface('onboarding');
const channelIcons: Record<ChannelKey, typeof MessageSquare> = {
  email: MessageSquare,
  sms: Phone,
  whatsapp: MessageSquare,
  facebook: Facebook,
  instagram: Instagram,
  google_business: MapPin,
  webchat: Globe,
  phone: Phone,
};

export function ChannelsSetupStep({ workspaceId, onNext, onBack }: ChannelsSetupStepProps) {
  const { connectionSummary, channelsNeedingSetup, displayedMessagingChannels } =
    useChannelSetup(workspaceId);
  const enabledChannelLabels = displayedMessagingChannels
    .filter((channel) => channel.enabled)
    .map(
      (channel) =>
        onboardingDefinitions.find((definition) => definition.key === channel.channel)?.shortLabel,
    )
    .filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-bb-gold/10 text-bb-gold">
          <Sparkles className="h-5 w-5" />
        </div>
        <CardTitle className="text-2xl text-bb-text">Choose your channels</CardTitle>
        <CardDescription className="mx-auto max-w-xl text-sm text-bb-warm-gray">
          Pick the places your customers contact you. These choices save straight into your
          workspace setup, so onboarding and Settings stay in sync.
        </CardDescription>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {onboardingDefinitions.map((channel) => {
          const Icon = channelIcons[channel.key];

          return (
            <Badge
              key={channel.key}
              variant="outline"
              className="border-bb-border bg-bb-white px-3 py-1.5 text-bb-text-secondary"
            >
              <Icon className="mr-1.5 h-3.5 w-3.5 text-bb-gold" />
              {channel.label}
            </Badge>
          );
        })}
      </div>

      <PanelNotice
        title="Enable the channels you want BizzyBee ready for"
        description="Email stays on its own step because it needs account connection. The options below handle your messaging channels and provider readiness."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-bb-border bg-bb-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-bb-warm-gray">Enabled</p>
          <p className="mt-1 text-2xl font-semibold text-bb-text">{connectionSummary.enabled}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-emerald-700">Ready</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">{connectionSummary.ready}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-amber-700">Need setup</p>
          <p className="mt-1 text-2xl font-semibold text-amber-700">
            {connectionSummary.needsSetup}
          </p>
        </div>
      </div>

      {enabledChannelLabels.length > 0 ? (
        <PanelNotice
          title="Your current channel selection"
          description={
            channelsNeedingSetup.length > 0
              ? `${enabledChannelLabels.join(', ')} ${
                  enabledChannelLabels.length === 1 ? 'is' : 'are'
                } enabled. You can continue onboarding now and finish any remaining provider setup later from Settings > Channels & Integrations.`
              : `${enabledChannelLabels.join(', ')} ${
                  enabledChannelLabels.length === 1 ? 'is' : 'are'
                } enabled and currently ready for BizzyBee to use.`
          }
        />
      ) : null}

      <ChannelManagementPanel
        workspaceId={workspaceId}
        mode="onboarding"
        showEmailSection={false}
        showProviderStatus={true}
      />

      <div className="rounded-2xl border border-bb-border bg-bb-white p-4">
        <p className="text-sm font-medium text-bb-text">What this means today</p>
        <div className="mt-2 space-y-2 text-sm text-bb-warm-gray">
          {onboardingDefinitions.map((channel) => (
            <div key={channel.key} className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 rounded-full bg-bb-gold" />
              <p>
                <span className="font-medium text-bb-text">{channel.label}:</span>{' '}
                {channel.onboardingNote || channel.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <PanelNotice
        icon={MapPin}
        title="Google reviews are a separate module"
        description="Channels still covers Google Business messages. BizzyBee Reviews will handle public reviews, replies, alerts, and reputation analytics as its own workspace module."
      />

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} className="gap-2 text-bb-warm-gray">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button onClick={onNext} className="gap-2">
          Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
