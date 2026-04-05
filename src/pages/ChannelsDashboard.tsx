import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Mail,
  MessageCircle,
  Phone,
  Smartphone,
  Monitor,
  Settings,
  Eye,
  EyeOff,
} from 'lucide-react';
import { format } from 'date-fns';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useChannelSetup } from '@/hooks/useChannelSetup';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MetricPillCard } from '@/components/shared/MetricPillCard';
import { useIsMobile } from '@/hooks/use-mobile';
import { PanelNotice } from '@/components/settings/PanelNotice';
import {
  CHANNEL_DEFINITIONS,
  getChannelSetupHref,
  getChannelSetupActionLabel,
  getChannelConnectionLabel,
  getChannelSetupDescription,
  normalizeChannelKey,
  type ChannelKey,
} from '@/lib/channels';

interface ChannelStats {
  channel: ChannelKey;
  unread: number;
  total: number;
  avgResponseTime: number | null;
  recentConversations: Array<{
    id: string;
    title: string;
    status: string;
    created_at: string;
  }>;
}

const channelConfig: Record<
  ChannelKey,
  {
    icon: typeof Mail;
    label: string;
    color: string;
    bgColor: string;
    emoji: string;
  }
> = {
  email: {
    icon: Mail,
    label: 'Email',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-950/20',
    emoji: '📧',
  },
  whatsapp: {
    icon: MessageCircle,
    label: 'WhatsApp',
    color: 'text-green-600',
    bgColor: 'bg-green-50 dark:bg-green-950/20',
    emoji: '💬',
  },
  sms: {
    icon: Smartphone,
    label: 'SMS',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-950/20',
    emoji: '📱',
  },
  phone: {
    icon: Phone,
    label: 'AI Phone',
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 dark:bg-orange-950/20',
    emoji: '📞',
  },
  webchat: {
    icon: Monitor,
    label: 'Web Chat',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50 dark:bg-indigo-950/20',
    emoji: '💻',
  },
  facebook: {
    icon: MessageCircle,
    label: 'Facebook Messenger',
    color: 'text-sky-600',
    bgColor: 'bg-sky-50',
    emoji: '📘',
  },
  instagram: {
    icon: MessageCircle,
    label: 'Instagram DMs',
    color: 'text-pink-600',
    bgColor: 'bg-pink-50',
    emoji: '📸',
  },
  google_business: {
    icon: Mail,
    label: 'Google Business',
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    emoji: '📍',
  },
};

export default function ChannelsDashboard() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [channelStats, setChannelStats] = useState<ChannelStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [hiddenChannels, setHiddenChannels] = useState<Record<string, boolean>>({});
  const [showSettings, setShowSettings] = useState(false);
  const {
    loading: channelSetupLoading,
    enabledChannelsByKey,
    dashboardDefinitions,
    channelConnectionStates,
    channelsNeedingSetup,
  } = useChannelSetup(workspace?.id);
  const supportedChannels = useMemo(
    () => dashboardDefinitions.map((definition) => definition.key),
    [dashboardDefinitions],
  );

  const fetchChannelStats = useCallback(async () => {
    if (!workspace?.id) {
      setChannelStats([]);
      setLoading(false);
      return;
    }
    setFetchError(null);

    try {
      // Show last 7 days instead of just today
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      sevenDaysAgo.setHours(0, 0, 0, 0);
      const sevenDaysAgoStr = sevenDaysAgo.toISOString();

      // Fetch conversations from last 7 days
      const { data: conversations, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('workspace_id', workspace.id)
        .gte('created_at', sevenDaysAgoStr)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (conversations) {
        const stats = supportedChannels.map((channel) => {
          const channelConvos = conversations.filter(
            (conversation) => normalizeChannelKey(conversation.channel) === channel,
          );
          const unread = channelConvos.filter((c) => c.status === 'new').length;

          // Calculate average response time (in minutes)
          const withResponseTimes = channelConvos.filter(
            (c) => c.first_response_at && c.created_at,
          );
          const avgResponseTime =
            withResponseTimes.length > 0
              ? withResponseTimes.reduce((acc, c) => {
                  const created = new Date(c.created_at).getTime();
                  const responded = new Date(c.first_response_at!).getTime();
                  return acc + (responded - created) / 1000 / 60; // convert to minutes
                }, 0) / withResponseTimes.length
              : null;

          return {
            channel,
            unread,
            total: channelConvos.length,
            avgResponseTime,
            recentConversations: channelConvos.slice(0, 5).map((c) => ({
              id: c.id,
              title: c.title || 'Untitled',
              status: c.status || 'new',
              created_at: c.created_at,
            })),
          };
        });

        setChannelStats(stats);
      }
    } catch (err) {
      console.error('Error fetching channel stats:', err);
      setFetchError('Failed to load channel data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [supportedChannels, workspace?.id]);

  useEffect(() => {
    if (workspaceLoading) {
      return;
    }

    if (!workspace?.id) {
      setLoading(false);
      setFetchError(null);
      return;
    }

    // Load hidden channels from localStorage
    const saved = localStorage.getItem('hiddenChannels');
    if (saved) {
      setHiddenChannels(JSON.parse(saved));
    }

    fetchChannelStats();

    // Set up realtime subscription with workspace-specific channel name
    const realtimeChannel = supabase
      .channel(`channels-dashboard-${workspace.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `workspace_id=eq.${workspace.id}`,
        },
        () => {
          fetchChannelStats();
        },
      )
      .subscribe();

    return () => {
      realtimeChannel.unsubscribe();
      supabase.removeChannel(realtimeChannel);
    };
  }, [fetchChannelStats, workspace?.id, workspaceLoading]);

  const toggleChannelVisibility = (channel: string) => {
    const updated = { ...hiddenChannels, [channel]: !hiddenChannels[channel] };
    setHiddenChannels(updated);
    localStorage.setItem('hiddenChannels', JSON.stringify(updated));
  };

  const formatResponseTime = (minutes: number | null) => {
    if (minutes === null) return 'N/A';
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'resolved':
        return 'default';
      case 'in_progress':
        return 'secondary';
      case 'new':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const visibleChannelStats = channelStats.filter(
    (stat) =>
      (enabledChannelsByKey[stat.channel] === true || stat.total > 0 || stat.channel === 'email') &&
      !hiddenChannels[stat.channel] &&
      channelConfig[stat.channel],
  );
  const statsByChannel = new Map(channelStats.map((stat) => [stat.channel, stat]));
  const mainContent =
    workspaceLoading || loading || channelSetupLoading ? (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-bb-warm-gray">Loading channels...</p>
        </div>
      </div>
    ) : !workspace?.id ? (
      <div className="p-4 md:p-8">
        <PanelNotice
          icon={Settings}
          title="Channels appear after workspace setup"
          description="Finish onboarding first, then enable Email, WhatsApp, SMS, Facebook, Instagram, Google Business, and web chat from Settings > Channels & Integrations."
          actionLabel="Open onboarding"
          actionTo="/onboarding?reset=true"
        />
      </div>
    ) : (
      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="min-w-0 flex-1 w-full sm:w-auto">
            <h1 className="text-[18px] font-medium text-bb-text">Channels Dashboard</h1>
            <p className="text-sm text-bb-warm-gray mt-1">
              Monitor activity across all channels (last 7 days)
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
            className="self-start sm:self-auto"
          >
            <Settings className="h-4 w-4 mr-2" />
            {showSettings ? 'Hide' : 'Show'}
          </Button>
        </div>

        {showSettings && (
          <div className="bg-bb-white rounded-lg border-[0.5px] border-bb-border p-6">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray mb-4">
              Channel Visibility
            </h3>
            <div className="space-y-3">
              {supportedChannels.map((channelKey) => {
                const config = channelConfig[channelKey];
                const Icon = config.icon;
                const stat = statsByChannel.get(channelKey);
                return (
                  <div
                    key={channelKey}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`h-5 w-5 ${config.color}`} />
                      <Label
                        htmlFor={`toggle-${channelKey}`}
                        className="cursor-pointer font-medium"
                      >
                        {config.label}
                      </Label>
                      {enabledChannelsByKey[channelKey] === false && (
                        <Badge variant="outline" className="text-xs">
                          Disabled in workspace
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`toggle-${channelKey}`}
                        checked={
                          !hiddenChannels[channelKey] && enabledChannelsByKey[channelKey] !== false
                        }
                        onCheckedChange={() => toggleChannelVisibility(channelKey)}
                        disabled={
                          enabledChannelsByKey[channelKey] === false && (stat?.total ?? 0) === 0
                        }
                      />
                      {hiddenChannels[channelKey] ? (
                        <EyeOff className="h-4 w-4 text-bb-warm-gray" />
                      ) : (
                        <Eye className="h-4 w-4 text-bb-warm-gray" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-bb-border-light">
              <Button
                variant="link"
                size="sm"
                onClick={() => navigate('/settings?category=connections')}
                className="text-xs p-0 text-bb-gold"
              >
                Manage workspace channel settings →
              </Button>
            </div>
          </div>
        )}

        {fetchError && (
          <Card className="p-4 border-destructive bg-destructive/5">
            <div className="flex items-center gap-2 text-destructive">
              <p className="text-sm font-medium">{fetchError}</p>
              <Button variant="outline" size="sm" onClick={fetchChannelStats}>
                Retry
              </Button>
            </div>
          </Card>
        )}

        {channelsNeedingSetup.length > 0 &&
          (() => {
            const primaryChannel = channelsNeedingSetup[0];
            const primaryState =
              channelConnectionStates.get(primaryChannel.key)?.state ?? 'needs_connection';
            const primaryDescription = getChannelSetupDescription(primaryChannel, primaryState);

            return (
              <PanelNotice
                icon={Settings}
                title="Some enabled channels still need setup"
                description={
                  channelsNeedingSetup.length === 1
                    ? `${primaryChannel.shortLabel} is enabled in this workspace, but ${primaryDescription.charAt(0).toLowerCase()}${primaryDescription.slice(1)}`
                    : `${channelsNeedingSetup.map((definition) => definition.shortLabel).join(', ')} are enabled in this workspace, but still need connection or provider setup before they are fully ready.`
                }
                actionLabel={
                  channelsNeedingSetup.length === 1
                    ? getChannelSetupActionLabel(primaryChannel, primaryState)
                    : 'Open channel setup'
                }
                actionTo={
                  channelsNeedingSetup.length === 1
                    ? getChannelSetupHref(primaryChannel.key)
                    : '/settings?category=connections&section=messaging'
                }
              />
            );
          })()}

        <PanelNotice
          icon={MapPin}
          title="Google reviews now live separately from Channels"
          description="This dashboard covers Google Business messages, not public reviews. Reviews now has its own dedicated module for reply workflow, alerts, and reputation analytics."
          actionLabel="Open Reviews"
          actionTo="/reviews"
        />

        <div
          className={
            isMobile ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6'
          }
        >
          {visibleChannelStats.map((stat) => {
            const config = channelConfig[stat.channel];
            const Icon = config.icon;
            const connection = channelConnectionStates.get(stat.channel);
            const definition = CHANNEL_DEFINITIONS[stat.channel];
            const routeTo =
              connection?.enabled &&
              (connection.state === 'needs_connection' ||
                connection.state === 'provider_setup_required') &&
              stat.total === 0
                ? getChannelSetupHref(stat.channel)
                : `/channel/${stat.channel}`;

            if (isMobile) {
              return (
                <div key={stat.channel} onClick={() => navigate(routeTo)}>
                  <MetricPillCard
                    title={config.label}
                    value={`${stat.unread}`}
                    subtitle={`${stat.total} total`}
                    icon={<Icon className="h-5 w-5" />}
                    iconColor={config.color}
                    bgColor={config.bgColor}
                    className="cursor-pointer active:scale-[0.98] transition-transform"
                  />
                </div>
              );
            }

            return (
              <Card
                key={stat.channel}
                className={`p-4 md:p-6 ${config.bgColor} cursor-pointer hover:shadow-lg transition-all active:scale-[0.98]`}
                onClick={() => navigate(routeTo)}
              >
                <div className="flex items-start justify-between mb-4 gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-2.5 md:p-3 rounded-lg bg-bb-white flex-shrink-0">
                      <Icon className={`h-5 w-5 md:h-6 md:w-6 ${config.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base md:text-lg font-medium text-bb-text flex items-center gap-2 truncate">
                        <span className="text-lg md:text-xl">{config.emoji}</span>
                        <span className="truncate">{config.label}</span>
                      </h3>
                      <p className="text-xs md:text-sm text-bb-warm-gray truncate">
                        {stat.total} conversation{stat.total !== 1 ? 's' : ''} (7 days)
                      </p>
                    </div>
                  </div>
                  {stat.unread > 0 && (
                    <Badge
                      variant="destructive"
                      className="text-sm md:text-lg px-2 md:px-3 py-0.5 md:py-1 flex-shrink-0"
                    >
                      {stat.unread}
                    </Badge>
                  )}
                  {stat.unread === 0 && connection?.enabled && connection.state !== 'ready' && (
                    <Badge
                      variant="outline"
                      className="border-amber-200 bg-amber-50 text-amber-700"
                    >
                      {getChannelConnectionLabel(definition, connection.state)}
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 md:gap-4 mb-4 p-3 md:p-4 bg-bb-white rounded-lg">
                  <div>
                    <p className="text-xs text-bb-warm-gray mb-1">Unread</p>
                    <p className={`text-xl md:text-2xl font-medium ${config.color}`}>
                      {stat.unread}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-bb-warm-gray mb-1">Avg Response</p>
                    <p className="text-xl md:text-2xl font-medium text-bb-text truncate">
                      {formatResponseTime(stat.avgResponseTime)}
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray mb-2">
                    Recent Activity
                  </h4>
                  {connection?.enabled &&
                    (connection.state === 'needs_connection' ||
                      connection.state === 'provider_setup_required') &&
                    stat.total === 0 && (
                      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {getChannelSetupDescription(definition, connection.state)}
                      </div>
                    )}
                  {stat.channel === 'google_business' && (
                    <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                      This card covers Google Business messages only. Public reviews now live in the
                      Reviews module.
                    </div>
                  )}
                  <ScrollArea className="h-[160px] md:h-[200px]">
                    {stat.recentConversations.length > 0 ? (
                      <div className="space-y-2 pr-3">
                        {stat.recentConversations.map((conv) => (
                          <div
                            key={conv.id}
                            className="p-2.5 md:p-3 bg-bb-white rounded-lg hover:bg-accent/50 active:bg-accent transition-colors"
                          >
                            <div className="flex items-center justify-between mb-1 gap-2 min-w-0">
                              <p className="font-medium text-xs md:text-sm truncate flex-1 min-w-0">
                                {conv.title}
                              </p>
                              <Badge
                                variant={getStatusColor(conv.status)}
                                className="ml-2 text-xs flex-shrink-0"
                              >
                                {conv.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-bb-warm-gray">
                              {format(new Date(conv.created_at), 'HH:mm')}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-bb-warm-gray text-center py-8">
                        No conversations in the last 7 days
                      </p>
                    )}
                  </ScrollArea>
                </div>
              </Card>
            );
          })}

          {visibleChannelStats.length === 0 && (
            <div className="col-span-2">
              <PanelNotice
                icon={Settings}
                title="No channels are enabled yet"
                description="Turn on the channels you want BizzyBee to monitor and reply on from Settings > Channels & Integrations."
                actionLabel="Open connection settings"
                actionTo="/settings?category=connections&section=messaging"
              />
            </div>
          )}
        </div>
      </div>
    );

  if (isMobile) {
    return <MobilePageLayout>{mainContent}</MobilePageLayout>;
  }

  return <ThreeColumnLayout sidebar={<Sidebar />} main={mainContent} />;
}
