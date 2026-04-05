import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PowerModeLayout } from '@/components/layout/PowerModeLayout';
import { PanelNotice } from '@/components/settings/PanelNotice';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useChannelSetup } from '@/hooks/useChannelSetup';
import {
  getChannelDefinition,
  getChannelSetupActionLabel,
  getChannelSetupDescription,
  getChannelSetupHref,
  normalizeChannelKey,
} from '@/lib/channels';
import { Settings } from 'lucide-react';

export default function ChannelConversations() {
  const { channel } = useParams<{ channel: string }>();
  const { workspace } = useWorkspace();
  const normalizedChannel = normalizeChannelKey(channel) ?? channel;
  const channelDefinition = getChannelDefinition(channel);
  const { channelConnectionStates } = useChannelSetup(workspace?.id);
  const channelSetupState = channelDefinition
    ? channelConnectionStates.get(channelDefinition.key)
    : null;

  const topNotice = useMemo(() => {
    if (!channelDefinition) {
      return (
        <PanelNotice
          icon={Settings}
          title="Unknown channel"
          description="This channel route does not match the current BizzyBee channel model."
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/channels">Back to channels</Link>
            </Button>
          }
        />
      );
    }

    if (!workspace?.id) {
      return (
        <PanelNotice
          icon={Settings}
          title="Finish setup before opening channel views"
          description="Create or reconnect your workspace first so BizzyBee knows which business these conversations belong to."
          actionLabel="Open onboarding"
          actionTo="/onboarding?reset=true"
        />
      );
    }

    if (
      channelSetupState?.enabled &&
      (channelSetupState.state === 'needs_connection' ||
        channelSetupState.state === 'provider_setup_required')
    ) {
      return (
        <PanelNotice
          icon={Settings}
          title={`${channelDefinition.shortLabel} still needs setup`}
          description={`This channel is enabled for the workspace, but it is not fully ready yet. ${getChannelSetupDescription(
            channelDefinition,
            channelSetupState.state,
          )}`}
          actionLabel={getChannelSetupActionLabel(channelDefinition, channelSetupState.state)}
          actionTo={getChannelSetupHref(channelDefinition.key)}
        />
      );
    }

    return null;
  }, [channelDefinition, channelSetupState, workspace?.id]);

  return (
    <PowerModeLayout filter="all-open" channelFilter={normalizedChannel} topNotice={topNotice} />
  );
}
