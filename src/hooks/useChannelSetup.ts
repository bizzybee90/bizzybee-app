import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import {
  CHANNEL_DEFINITIONS,
  CHANNEL_PROVIDER_GROUPS,
  deriveChannelConnectionState,
  getChannelDefinitionsForSurface,
  normalizeChannelKey,
  type ChannelConnectionState,
  type ChannelKey,
  type EmailChannelRecord,
  type WorkspaceChannelRecord,
} from '@/lib/channels';

type ProviderGroupStatusTone =
  | 'ready'
  | 'needs_setup'
  | 'not_enabled'
  | 'coming_soon'
  | 'separate_module';

export interface ProviderGroupSummary {
  id: string;
  title: string;
  description: string;
  status: string;
  channels: Array<{
    channelKey: ChannelKey;
    definition: (typeof CHANNEL_DEFINITIONS)[ChannelKey];
    enabled: boolean;
    state: ChannelConnectionState;
  }>;
  enabledCount: number;
  readyCount: number;
  needsSetupCount: number;
  statusLabel: string;
  statusTone: ProviderGroupStatusTone;
}

const isPreviewWorkspace = (id?: string | null) =>
  !id || id === 'preview-workspace' || !id.match(/^[0-9a-f]{8}-/i);

export function useChannelSetup(workspaceId?: string | null) {
  const [channels, setChannels] = useState<WorkspaceChannelRecord[]>([]);
  const [emailConfigs, setEmailConfigs] = useState<EmailChannelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isPreview = isPreviewWorkspace(workspaceId);

  const dashboardDefinitions = useMemo(
    () =>
      getChannelDefinitionsForSurface('dashboard').filter(
        (definition) => definition.module === 'channels',
      ),
    [],
  );
  const messagingChannelDefinitions = useMemo(
    () =>
      getChannelDefinitionsForSurface('settings').filter(
        (definition) => definition.module === 'channels' && definition.key !== 'email',
      ),
    [],
  );

  const refreshChannels = useCallback(async () => {
    if (!workspaceId || isPreview) {
      setChannels([]);
      return [];
    }

    const { data, error: fetchError } = await supabase
      .from('workspace_channels')
      .select('id, channel, enabled, automation_level, config')
      .eq('workspace_id', workspaceId)
      .order('channel');

    if (fetchError) {
      throw fetchError;
    }

    const nextChannels = data || [];
    setChannels(nextChannels);
    return nextChannels;
  }, [workspaceId]);

  const refreshEmailConfigs = useCallback(async () => {
    if (!workspaceId || isPreview) {
      setEmailConfigs([]);
      return [];
    }

    const { data, error: fetchError } = await supabase
      .from('email_provider_configs')
      .select('id, email_address, provider, import_mode, last_sync_at, connected_at, workspace_id')
      .eq('workspace_id', workspaceId);

    if (fetchError) {
      throw fetchError;
    }

    const nextConfigs = data || [];
    setEmailConfigs(nextConfigs);
    return nextConfigs;
  }, [workspaceId]);

  const refresh = useCallback(async () => {
    if (!workspaceId || isPreview) {
      setChannels([]);
      setEmailConfigs([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await Promise.all([refreshChannels(), refreshEmailConfigs()]);
    } catch (loadError) {
      logger.error('Error loading channel setup', loadError);
      setError('Failed to load channel setup.');
    } finally {
      setLoading(false);
    }
  }, [refreshChannels, refreshEmailConfigs, workspaceId]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!workspaceId || isPreview) {
        setChannels([]);
        setEmailConfigs([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [nextChannels, nextEmailConfigs] = await Promise.all([
          refreshChannels(),
          refreshEmailConfigs(),
        ]);

        if (!cancelled) {
          setChannels(nextChannels);
          setEmailConfigs(nextEmailConfigs);
        }
      } catch (loadError) {
        logger.error('Error loading channel setup', loadError);
        if (!cancelled) {
          setError('Failed to load channel setup.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    if (!workspaceId || isPreview) {
      return () => {
        cancelled = true;
      };
    }

    const realtimeChannel = supabase
      .channel(`channel-setup-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspace_channels',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          void refreshChannels();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'email_provider_configs',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          void refreshEmailConfigs();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      realtimeChannel.unsubscribe();
      supabase.removeChannel(realtimeChannel);
    };
  }, [refreshChannels, refreshEmailConfigs, workspaceId]);

  const configuredChannelMap = useMemo(
    () =>
      new Map(
        channels.map((channel) => [
          normalizeChannelKey(channel.channel) ?? channel.channel,
          channel,
        ]),
      ),
    [channels],
  );

  const enabledChannelsByKey = useMemo(() => {
    const enabled: Record<string, boolean> = {};

    channels.forEach((channel) => {
      const channelKey = normalizeChannelKey(channel.channel);
      if (channelKey) {
        enabled[channelKey] = !!channel.enabled;
      }
    });

    return enabled;
  }, [channels]);

  const displayedMessagingChannels = useMemo(
    () =>
      messagingChannelDefinitions.map(
        (definition) =>
          configuredChannelMap.get(definition.key) ?? {
            channel: definition.key,
            enabled: false,
            automation_level: 'draft_only',
            config: null,
          },
      ),
    [configuredChannelMap, messagingChannelDefinitions],
  );

  const connectionSummary = useMemo(
    () =>
      displayedMessagingChannels.reduce(
        (summary, channel) => {
          const channelKey = normalizeChannelKey(channel.channel);
          if (!channelKey) {
            return summary;
          }

          const definition = CHANNEL_DEFINITIONS[channelKey];
          const state = deriveChannelConnectionState(definition, channel, emailConfigs);

          if (channel.enabled) {
            summary.enabled += 1;
          }

          if (state === 'ready') {
            summary.ready += 1;
          }

          if (state === 'needs_connection' || state === 'provider_setup_required') {
            summary.needsSetup += 1;
          }

          return summary;
        },
        { enabled: 0, ready: 0, needsSetup: 0 },
      ),
    [displayedMessagingChannels, emailConfigs],
  );

  const providerGroupSummaries = useMemo<ProviderGroupSummary[]>(
    () =>
      CHANNEL_PROVIDER_GROUPS.map((group) => {
        const providerChannels = group.channelKeys.map((channelKey) => {
          const definition = CHANNEL_DEFINITIONS[channelKey];

          if (channelKey === 'email') {
            const state: ChannelConnectionState =
              emailConfigs.length > 0 ? 'ready' : 'needs_connection';

            return {
              channelKey,
              definition,
              enabled: emailConfigs.length > 0,
              state,
            };
          }

          const record = configuredChannelMap.get(channelKey) ?? null;
          const state = deriveChannelConnectionState(definition, record, emailConfigs);

          return {
            channelKey,
            definition,
            enabled: !!record?.enabled,
            state,
          };
        });

        const enabledCount = providerChannels.filter((channel) => channel.enabled).length;
        const readyCount = providerChannels.filter((channel) => channel.state === 'ready').length;
        const needsSetupCount = providerChannels.filter(
          (channel) =>
            channel.enabled &&
            (channel.state === 'needs_connection' || channel.state === 'provider_setup_required'),
        ).length;

        let statusLabel = 'Not enabled yet';
        let statusTone: ProviderGroupStatusTone = 'not_enabled';

        if (group.id === 'webchat') {
          statusLabel = 'Coming soon';
          statusTone = 'coming_soon';
        } else if (group.id === 'ai-phone') {
          statusLabel = 'Separate module';
          statusTone = 'separate_module';
        } else if (enabledCount > 0 && needsSetupCount === 0 && readyCount === enabledCount) {
          statusLabel = enabledCount === providerChannels.length ? 'Ready' : `${readyCount} ready`;
          statusTone = 'ready';
        } else if (needsSetupCount > 0) {
          statusLabel = `${needsSetupCount} need setup`;
          statusTone = 'needs_setup';
        } else if (enabledCount > 0 && readyCount === 0) {
          statusLabel = 'Enabled, not connected';
          statusTone = 'needs_setup';
        }

        return {
          ...group,
          channels: providerChannels,
          enabledCount,
          readyCount,
          needsSetupCount,
          statusLabel,
          statusTone,
        };
      }),
    [configuredChannelMap, emailConfigs],
  );

  const channelConnectionStates = useMemo(
    () =>
      new Map<ChannelKey, { state: ChannelConnectionState; enabled: boolean }>(
        dashboardDefinitions.map((definition) => {
          const record = configuredChannelMap.get(definition.key) ?? null;
          return [
            definition.key,
            {
              state: deriveChannelConnectionState(definition, record, emailConfigs),
              enabled: !!record?.enabled,
            },
          ];
        }),
      ),
    [configuredChannelMap, dashboardDefinitions, emailConfigs],
  );

  const channelsNeedingSetup = useMemo(
    () =>
      dashboardDefinitions.filter((definition) => {
        const record = configuredChannelMap.get(definition.key);
        const state = deriveChannelConnectionState(definition, record, emailConfigs);

        return (
          record?.enabled && (state === 'needs_connection' || state === 'provider_setup_required')
        );
      }),
    [configuredChannelMap, dashboardDefinitions, emailConfigs],
  );

  return {
    channels,
    setChannels,
    emailConfigs,
    setEmailConfigs,
    loading,
    error,
    refresh,
    refreshChannels,
    refreshEmailConfigs,
    configuredChannelMap,
    enabledChannelsByKey,
    dashboardDefinitions,
    messagingChannelDefinitions,
    displayedMessagingChannels,
    connectionSummary,
    providerGroupSummaries,
    channelConnectionStates,
    channelsNeedingSetup,
  };
}
