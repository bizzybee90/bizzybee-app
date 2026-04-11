import { useEffect, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useUserRole } from '@/hooks/useUserRole';
import { useChannelSetup } from '@/hooks/useChannelSetup';
import {
  ModuleLockBadge,
  resolveModuleLockState,
  type ModuleLockResolution,
} from '@/components/ProtectedRoute';
import {
  MessageSquare,
  Phone,
  Mail,
  Globe,
  Plus,
  Cloud,
  Info,
  CheckCircle,
  Zap,
  FileEdit,
  Eye,
  Pause,
  Settings2,
  Facebook,
  Instagram,
  MapPin,
  Loader2,
  Store,
  ChevronDown,
} from 'lucide-react';
import { EmailAccountCard } from './EmailAccountCard';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PanelNotice } from './PanelNotice';
import { resolveWorkspaceEntitlements } from '@/lib/billing/entitlements';
import {
  CHANNEL_ROUTING_FIELDS,
  getChannelConnectionLabel,
  getChannelDefinition,
  getChannelSetupProgress,
  getChannelSetupActionLabel,
  getChannelSetupDescription,
  getMissingChannelRoutingLabels,
  getChannelSettingsSection,
  deriveChannelConnectionState,
  type ChannelConnectionState,
  type ChannelKey,
  type WorkspaceChannelRecord,
} from '@/lib/channels';

interface ChannelManagementPanelProps {
  mode?: 'settings' | 'onboarding';
  workspaceId?: string;
  showEmailSection?: boolean;
  showProviderStatus?: boolean;
  /** When set, scroll to the matching channel card and expand it. */
  focusChannelKey?: ChannelKey | null;
  /** Invoked after the panel has handled a focus request so the parent
   *  can clear its focus state. */
  onFocusHandled?: () => void;
}

const providerChecklists: Record<string, { title: string; steps: string[] }> = {
  email: {
    title: 'Best next step',
    steps: [
      'Connect at least one shared inbox or owner mailbox.',
      'Choose whether to import new mail only or recent history as well.',
    ],
  },
  twilio: {
    title: 'What BizzyBee needs',
    steps: [
      'Enable SMS or WhatsApp for this workspace.',
      'Save the exact business phone number BizzyBee should match inbound messages against.',
      'Make sure your Twilio credentials and webhook destination are configured operationally.',
    ],
  },
  'meta-google': {
    title: 'What BizzyBee needs',
    steps: [
      'Enable the channel you actually want to support.',
      'Save the page, Instagram account, or Google agent identifiers for this workspace.',
      'Finish the external business account linking on the provider side.',
    ],
  },
  webchat: {
    title: 'What to expect',
    steps: [
      'Website chat is planned as part of the Channels product.',
      'You do not need to configure it yet.',
    ],
  },
  'ai-phone': {
    title: 'What to expect',
    steps: [
      'AI Phone has its own provisioning flow.',
      'Use the separate AI Phone module when you are ready to set up voice.',
    ],
  },
};

export const ChannelManagementPanel = ({
  mode = 'settings',
  workspaceId: forcedWorkspaceId,
  showEmailSection = true,
  showProviderStatus = true,
  focusChannelKey = null,
  onFocusHandled,
}: ChannelManagementPanelProps) => {
  const { workspace, loading: workspaceLoading, entitlements } = useWorkspace();
  const { isAdmin } = useUserRole();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [channelConfigDrafts, setChannelConfigDrafts] = useState<
    Record<string, Record<string, string>>
  >({});
  const [savingChannelKey, setSavingChannelKey] = useState<ChannelKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('gmail');
  const [selectedImportMode, setSelectedImportMode] = useState<string>('all_historical_90_days');
  const activeWorkspaceId = forcedWorkspaceId ?? workspace?.id;
  const activeEntitlements = entitlements ?? resolveWorkspaceEntitlements(null, []);
  const canManageChannels = mode === 'onboarding' || isAdmin;
  const emailSectionRef = useRef<HTMLDivElement>(null);
  const messagingSectionRef = useRef<HTMLDivElement>(null);
  const providerStatusRef = useRef<HTMLDivElement>(null);
  const channelCardRefs = useRef<Partial<Record<ChannelKey, HTMLDivElement | null>>>({});
  const {
    channels,
    setChannels,
    emailConfigs,
    loading,
    refresh,
    refreshEmailConfigs,
    messagingChannelDefinitions,
    displayedMessagingChannels,
    connectionSummary,
    providerGroupSummaries,
  } = useChannelSetup(activeWorkspaceId);

  // Collapsible messaging channels: onboarding starts fully collapsed so the
  // step stays scannable; settings keeps everything expanded so admins can
  // edit routing identifiers without clicking into each row.
  const [collapsedChannelKeys, setCollapsedChannelKeys] = useState<Set<string>>(() =>
    mode === 'onboarding' ? new Set(messagingChannelDefinitions.map((d) => d.key)) : new Set(),
  );
  const isChannelExpanded = (key: string) => !collapsedChannelKeys.has(key);
  const toggleChannelCollapsed = (key: string) => {
    setCollapsedChannelKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Handle focus requests from parent (e.g. clicking a badge in
  // ChannelsSetupStep). Scroll to the matching card and expand it.
  //
  // - Query the DOM via `data-channel-key` instead of the callback ref on
  //   the <Card>, which has proved unreliable here: by the time the deferred
  //   callback fires the ref entry is sometimes null or stale, which is why
  //   the badges first appeared "clickable but did nothing".
  //
  // - Defer via `setTimeout(0)` rather than `requestAnimationFrame`. RAF
  //   callbacks are paused in backgrounded tabs and can be throttled by
  //   Chrome in various concurrent-render scenarios — we want the scroll
  //   to land whenever the user gets back to the tab, not "maybe later".
  //   A zero-delay timer runs after React commits the state update below.
  //
  // - Omit `behavior: 'smooth'`. It's silently swallowed on this onboarding
  //   surface (instant scrolls 0→435 in prod, smooth stays at 0 even after
  //   2s) — not worth root-causing for this use case.
  useEffect(() => {
    if (!focusChannelKey) {
      return;
    }
    setCollapsedChannelKeys((current) => {
      if (!current.has(focusChannelKey)) {
        return current;
      }
      const next = new Set(current);
      next.delete(focusChannelKey);
      return next;
    });
    const timer = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-channel-key="${focusChannelKey}"]`);
      target?.scrollIntoView({ block: 'center' });
      onFocusHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusChannelKey, onFocusHandled]);

  const importModeLabels: Record<string, string> = {
    new_only: 'New emails only',
    unread_only: 'Unread emails + new',
    all_historical_90_days: 'Last 90 days + new',
  };

  const importModeDescriptions: Record<string, string> = {
    new_only: 'Only receive emails after connecting',
    unread_only: 'Import existing unread emails, then all new',
    all_historical_90_days: 'Import all emails from the last 90 days, then all new',
  };

  const channelIcons: Record<ChannelKey, any> = {
    sms: Phone,
    whatsapp: MessageSquare,
    email: Mail,
    webchat: Globe,
    facebook: Facebook,
    instagram: Instagram,
    google_business: MapPin,
    phone: Phone,
  };

  const providerLabels: Record<string, string> = {
    gmail: 'Gmail',
    outlook: 'Outlook / Microsoft 365',
    icloud: 'Apple Mail / iCloud',
    imap: 'Other (IMAP)',
  };

  const getChannelEntitlement = (channelKey: ChannelKey) => {
    switch (channelKey) {
      case 'email':
        return {
          available: activeEntitlements.features.unified_inbox,
          aiAutomation: activeEntitlements.canUseAiInbox,
          message: activeEntitlements.canUseAiInbox
            ? null
            : 'This plan includes the unified inbox. Upgrade to Starter or above for AI drafts and learning.',
        };
      case 'sms':
        return {
          available: activeEntitlements.canUseSmsRouting || activeEntitlements.canUseSmsAi,
          aiAutomation: activeEntitlements.canUseSmsAi,
          message: activeEntitlements.canUseSmsAi
            ? null
            : activeEntitlements.canUseSmsRouting
              ? 'SMS routing is included on your current plan. Upgrade to SMS AI for drafting and automation.'
              : 'Add SMS Routing on Connect or SMS AI on Starter and above to use SMS here.',
        };
      case 'whatsapp':
        return {
          available:
            activeEntitlements.canUseWhatsAppRouting || activeEntitlements.canUseWhatsAppAi,
          aiAutomation: activeEntitlements.canUseWhatsAppAi,
          message: activeEntitlements.canUseWhatsAppAi
            ? null
            : activeEntitlements.canUseWhatsAppRouting
              ? 'WhatsApp routing is included on your current plan. Upgrade to WhatsApp AI for drafting and automation.'
              : 'Add WhatsApp Routing on Connect or WhatsApp AI on Starter and above to use WhatsApp here.',
        };
      case 'facebook':
      case 'instagram':
      case 'google_business':
        return {
          available: true,
          aiAutomation: activeEntitlements.canUseAiInbox,
          message: activeEntitlements.canUseAiInbox
            ? null
            : 'This plan includes routing only. Upgrade to Starter or above for AI replies and automation.',
        };
      case 'phone':
        return {
          available: activeEntitlements.canUseAiPhone,
          aiAutomation: activeEntitlements.canUseAiPhone,
          message: 'Add AI Phone to unlock voice setup and automation.',
        };
      case 'webchat':
        return {
          available: false,
          aiAutomation: false,
          message: 'Web Chat is still planned and is not yet ready for self-serve activation.',
        };
      default:
        return {
          available: true,
          aiAutomation: activeEntitlements.canUseAiInbox,
          message: null,
        };
    }
  };

  const getChannelAvailabilityState = (channelKey: ChannelKey): ModuleLockResolution =>
    resolveModuleLockState({
      isAllowed: getChannelEntitlement(channelKey).available,
      workspaceId: activeWorkspaceId ?? null,
      entitlements: activeEntitlements,
    });

  const getChannelAutomationState = (channelKey: ChannelKey): ModuleLockResolution =>
    resolveModuleLockState({
      isAllowed: getChannelEntitlement(channelKey).aiAutomation,
      workspaceId: activeWorkspaceId ?? null,
      entitlements: activeEntitlements,
    });

  const getConfigValue = (config: unknown, key: string) => {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return '';
    }

    const value = (config as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : '';
  };

  useEffect(() => {
    const nextDrafts: Record<string, Record<string, string>> = {};

    channels.forEach((channel) => {
      const definition = getChannelDefinition(channel.channel);
      if (!definition) return;

      const fields = CHANNEL_ROUTING_FIELDS[definition.key];
      if (!fields?.length) return;

      nextDrafts[definition.key] = fields.reduce<Record<string, string>>((draft, field) => {
        draft[field.key] = getConfigValue(channel.config, field.key);
        return draft;
      }, {});
    });

    setChannelConfigDrafts((current) => ({ ...nextDrafts, ...current }));
  }, [channels]);

  // Handle email_connected redirect from OAuth callback
  useEffect(() => {
    const emailConnected = searchParams.get('email_connected');
    const connectedEmail = searchParams.get('email');

    if (emailConnected === 'true') {
      toast({
        title: 'Email connected successfully!',
        description: connectedEmail ? `${connectedEmail} is now connected.` : undefined,
      });
      // Remove the query params
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('email_connected');
      nextParams.delete('email');
      nextParams.delete('tab');
      setSearchParams(nextParams, { replace: true });
      // Refresh email configs
      void refreshEmailConfigs();
    }
  }, [refreshEmailConfigs, searchParams, setSearchParams, toast]);

  // Handle meta_connected redirect from Meta OAuth callback
  useEffect(() => {
    const metaConnected = searchParams.get('meta_connected');
    const pageName = searchParams.get('page_name');

    if (metaConnected === 'true') {
      toast({
        title: 'Facebook connected!',
        description: pageName
          ? `${pageName} is now connected for Messenger and Instagram.`
          : 'Messenger and Instagram are ready.',
      });
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('meta_connected');
      nextParams.delete('meta');
      nextParams.delete('page_name');
      nextParams.delete('instagram');
      nextParams.delete('step');
      setSearchParams(nextParams, { replace: true });
      void refresh();
    }
  }, [refresh, searchParams, setSearchParams, toast]);

  useEffect(() => {
    if (loading || (mode === 'settings' && workspaceLoading)) {
      return;
    }

    const section = searchParams.get('section');
    const channel = searchParams.get('channel');

    if (!section && !channel) {
      return;
    }

    const refMap = {
      email: emailSectionRef,
      messaging: messagingSectionRef,
      provider: providerStatusRef,
    } as const;

    const targetRef = refMap[section as keyof typeof refMap];

    window.requestAnimationFrame(() => {
      if (targetRef?.current) {
        targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      const normalizedChannel = channel as ChannelKey | null;
      if (normalizedChannel && channelCardRefs.current[normalizedChannel]) {
        channelCardRefs.current[normalizedChannel]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    });
  }, [loading, mode, searchParams, workspaceLoading]);

  const handleConnectMeta = async () => {
    if (!activeWorkspaceId) {
      toast({
        title: 'Workspace not loaded',
        description: 'Please refresh the page',
        variant: 'destructive',
      });
      return;
    }

    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-auth-start', {
        body: { workspaceId: activeWorkspaceId, origin: window.location.origin },
      });

      if (error) throw error;

      if (data?.authUrl) {
        window.location.href = data.authUrl;
      } else {
        toast({ title: 'Failed to get Facebook auth URL', variant: 'destructive' });
        setConnecting(false);
      }
    } catch (error) {
      logger.error('Error starting Meta OAuth', error);
      toast({ title: 'Failed to connect Facebook', variant: 'destructive' });
      setConnecting(false);
    }
  };

  const handleConnectEmail = async () => {
    logger.debug('handleConnectEmail called', {
      workspaceId: activeWorkspaceId,
      selectedProvider,
      selectedImportMode,
    });

    if (!activeWorkspaceId) {
      logger.error('No workspace ID available');
      toast({
        title: 'Workspace not loaded',
        description: 'Please refresh the page',
        variant: 'destructive',
      });
      return;
    }

    setConnecting(true);
    try {
      logger.debug('Calling aurinko-auth-start');
      const { data, error } = await supabase.functions.invoke('aurinko-auth-start', {
        body: {
          workspaceId: activeWorkspaceId,
          provider: selectedProvider,
          importMode: selectedImportMode,
          origin: window.location.origin,
        },
      });

      logger.debug('aurinko-auth-start response received', {
        hasAuthUrl: !!data?.authUrl,
        hasError: !!error,
      });

      if (error) throw error;

      if (data?.authUrl) {
        logger.debug('Redirecting to auth URL');
        window.location.href = data.authUrl;
      } else {
        logger.error('No authUrl in response');
        toast({ title: 'Failed to get auth URL', variant: 'destructive' });
        setConnecting(false);
      }
    } catch (error) {
      logger.error('Error starting email OAuth', error);
      toast({ title: 'Failed to connect email', variant: 'destructive' });
      setConnecting(false);
    }
  };

  const toggleChannel = async (channel: WorkspaceChannelRecord) => {
    if (!activeWorkspaceId) {
      toast({
        title: 'Finish setup first',
        description: 'Create or reconnect your workspace before changing channel settings.',
        variant: 'destructive',
      });
      return;
    }

    const definition = getChannelDefinition(channel.channel);
    const entitlement = definition ? getChannelEntitlement(definition.key) : null;
    const availabilityState = definition ? getChannelAvailabilityState(definition.key) : null;
    const automationState = definition ? getChannelAutomationState(definition.key) : null;

    if (definition && entitlement && availabilityState?.state === 'locked') {
      toast({
        title: `${definition.label} needs a plan upgrade`,
        description: entitlement.message ?? 'This channel is not included on the current plan.',
        variant: 'destructive',
      });
      return;
    }

    if (definition && availabilityState?.state === 'shadow-preview') {
      toast({
        title: `${definition.label} is in shadow preview`,
        description:
          entitlement?.message ??
          'This channel is outside the current plan and would be blocked once hard enforcement is enabled.',
      });
    }

    try {
      if (channel.id) {
        const { error } = await supabase
          .from('workspace_channels')
          .update({
            enabled: !channel.enabled,
            automation_level:
              !channel.enabled && automationState?.state === 'locked'
                ? 'disabled'
                : channel.automation_level,
          })
          .eq('id', channel.id);

        if (error) throw error;

        setChannels(
          channels.map((currentChannel) =>
            currentChannel.id === channel.id
              ? { ...currentChannel, enabled: !channel.enabled }
              : currentChannel,
          ),
        );
      } else {
        const { data, error } = await supabase
          .from('workspace_channels')
          .insert({
            workspace_id: activeWorkspaceId,
            channel: channel.channel,
            enabled: true,
            automation_level:
              automationState?.state === 'locked'
                ? 'disabled'
                : channel.automation_level || 'draft_only',
            config: channel.config ?? null,
          })
          .select('id, channel, enabled, automation_level, config')
          .single();

        if (error) throw error;

        setChannels((currentChannels) => [...currentChannels, data]);
      }

      toast({
        title: 'Channel updated',
        description: `Channel ${!channel.enabled ? 'enabled' : 'disabled'} successfully`,
      });
    } catch (error) {
      logger.error('Error toggling channel', error);
      toast({ title: 'Error', description: 'Failed to update channel', variant: 'destructive' });
    }
  };

  const updateChannelAutomation = async (
    channel: WorkspaceChannelRecord,
    automationLevel: string,
  ) => {
    try {
      const definition = getChannelDefinition(channel.channel);
      const entitlement = definition ? getChannelEntitlement(definition.key) : null;
      const availabilityState = definition ? getChannelAvailabilityState(definition.key) : null;
      const automationState = definition ? getChannelAutomationState(definition.key) : null;

      if (definition && entitlement && availabilityState?.state === 'locked') {
        throw new Error(entitlement.message ?? `${definition.label} is not included on this plan`);
      }

      if (definition && automationState?.state === 'locked' && automationLevel !== 'disabled') {
        throw new Error(
          entitlement.message ??
            `${definition.label} needs AI access before automation can be enabled`,
        );
      }

      if (
        definition &&
        availabilityState?.state === 'shadow-preview' &&
        automationLevel !== 'disabled'
      ) {
        toast({
          title: `${definition.label} automation in shadow preview`,
          description:
            entitlement?.message ??
            'This automation setting is in preview and would be blocked with hard billing enforcement.',
        });
      }

      if (!activeWorkspaceId) {
        throw new Error('Workspace not loaded');
      }

      if (channel.id) {
        const { error } = await supabase
          .from('workspace_channels')
          .update({ automation_level: automationLevel })
          .eq('id', channel.id);

        if (error) throw error;

        setChannels(
          channels.map((currentChannel) =>
            currentChannel.id === channel.id
              ? { ...currentChannel, automation_level: automationLevel }
              : currentChannel,
          ),
        );
      } else {
        const { data, error } = await supabase
          .from('workspace_channels')
          .insert({
            workspace_id: activeWorkspaceId,
            channel: channel.channel,
            enabled: true,
            automation_level: automationState?.state === 'locked' ? 'disabled' : automationLevel,
            config: channel.config ?? null,
          })
          .select('id, channel, enabled, automation_level, config')
          .single();

        if (error) throw error;

        setChannels((currentChannels) => [...currentChannels, data]);
      }

      toast({
        title: 'Automation mode updated',
        description: `Channel automation set to ${automationModes.find((m) => m.value === automationLevel)?.label || automationLevel}`,
      });
    } catch (error) {
      logger.error('Error updating channel automation', error);
      toast({
        title: 'Error',
        description: 'Failed to update automation mode',
        variant: 'destructive',
      });
    }
  };

  const updateChannelConfigDraft = (channelKey: ChannelKey, fieldKey: string, value: string) => {
    setChannelConfigDrafts((current) => ({
      ...current,
      [channelKey]: {
        ...(current[channelKey] || {}),
        [fieldKey]: value,
      },
    }));
  };

  const buildConfigFromDraft = (channelKey: ChannelKey) => {
    const fields = CHANNEL_ROUTING_FIELDS[channelKey];
    if (!fields?.length) {
      return {};
    }

    const draft = channelConfigDrafts[channelKey] || {};
    return fields.reduce<Record<string, string>>((config, field) => {
      const value = draft[field.key]?.trim();
      if (value) {
        config[field.key] = value;
      }
      return config;
    }, {});
  };

  const saveChannelConfig = async (
    channel: WorkspaceChannelRecord,
    definition: NonNullable<ReturnType<typeof getChannelDefinition>>,
  ) => {
    if (!activeWorkspaceId) {
      toast({
        title: 'Workspace not loaded',
        description: 'Please refresh and try again.',
        variant: 'destructive',
      });
      return;
    }

    const fields = CHANNEL_ROUTING_FIELDS[definition.key];
    if (!fields?.length) return;

    const nextConfig = buildConfigFromDraft(definition.key);

    try {
      setSavingChannelKey(definition.key);
      if (channel.id) {
        const { error } = await supabase
          .from('workspace_channels')
          .update({ config: nextConfig })
          .eq('id', channel.id);

        if (error) throw error;

        setChannels((currentChannels) =>
          currentChannels.map((currentChannel) =>
            currentChannel.id === channel.id
              ? { ...currentChannel, config: nextConfig }
              : currentChannel,
          ),
        );
      } else {
        const { data, error } = await supabase
          .from('workspace_channels')
          .insert({
            workspace_id: activeWorkspaceId,
            channel: definition.key,
            enabled: false,
            automation_level: 'draft_only',
            config: nextConfig,
          })
          .select('id, channel, enabled, automation_level, config')
          .single();

        if (error) throw error;

        setChannels((currentChannels) => [...currentChannels, data]);
      }

      toast({
        title: 'Routing details saved',
        description: `${definition.label} now has the identifiers BizzyBee needs for inbound routing.`,
      });
    } catch (error) {
      logger.error('Error saving channel config', error);
      toast({
        title: 'Could not save routing details',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSavingChannelKey(null);
    }
  };

  const automationModes = [
    {
      value: 'automatic',
      label: 'Automatic',
      icon: Zap,
      description: 'AI drafts and sends automatically',
      color: 'text-success',
    },
    {
      value: 'draft_only',
      label: 'Draft Only',
      icon: FileEdit,
      description: 'AI drafts, you send',
      color: 'text-amber-500',
    },
    {
      value: 'review_required',
      label: 'Review Mode',
      icon: Eye,
      description: 'Everything goes to review',
      color: 'text-purple-500',
    },
    {
      value: 'disabled',
      label: 'Manual',
      icon: Pause,
      description: 'No AI assistance',
      color: 'text-muted-foreground',
    },
  ];

  const getConnectionBadgeClasses = (state: ChannelConnectionState) => {
    switch (state) {
      case 'ready':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700';
      case 'provider_setup_required':
        return 'border-amber-200 bg-amber-50 text-amber-700';
      case 'needs_connection':
        return 'border-sky-200 bg-sky-50 text-sky-700';
      case 'coming_soon':
        return 'border-bb-border bg-bb-linen text-bb-warm-gray';
      case 'separate_module':
        return 'border-indigo-200 bg-indigo-50 text-indigo-700';
      default:
        return 'border-bb-border bg-bb-white text-bb-warm-gray';
    }
  };

  const getGroupStatusClasses = (
    status: 'ready' | 'needs_setup' | 'not_enabled' | 'coming_soon' | 'separate_module',
  ) => {
    switch (status) {
      case 'ready':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700';
      case 'needs_setup':
        return 'border-amber-200 bg-amber-50 text-amber-700';
      case 'coming_soon':
        return 'border-bb-border bg-bb-linen text-bb-warm-gray';
      case 'separate_module':
        return 'border-indigo-200 bg-indigo-50 text-indigo-700';
      default:
        return 'border-bb-border bg-bb-white text-bb-warm-gray';
    }
  };

  const scrollToRef = (ref: React.RefObject<HTMLDivElement>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const firstIncompleteMessagingChannel = displayedMessagingChannels.find((channel) => {
    const definition = getChannelDefinition(channel.channel);
    if (!definition) return false;

    const state = deriveChannelConnectionState(definition, channel, emailConfigs);
    return state === 'needs_connection' || state === 'provider_setup_required';
  });
  const channelLaunchChecklist = [
    {
      label: 'At least one email account connected',
      complete: emailConfigs.length > 0,
      action: () => openSettingsSection('email'),
      actionLabel: 'Connect email',
    },
    {
      label: 'At least one channel enabled',
      complete: connectionSummary.enabled > 0,
      action: () => openSettingsSection('messaging'),
      actionLabel: 'Enable channels',
    },
    {
      label: 'Enabled channels are fully ready',
      complete: connectionSummary.enabled > 0 && connectionSummary.needsSetup === 0,
      action: () =>
        firstIncompleteMessagingChannel
          ? openSettingsSection(
              getChannelSettingsSection(
                getChannelDefinition(firstIncompleteMessagingChannel.channel)?.key ?? 'email',
              ),
              getChannelDefinition(firstIncompleteMessagingChannel.channel)?.key,
            )
          : openSettingsSection('messaging'),
      actionLabel: firstIncompleteMessagingChannel
        ? `Finish ${getChannelDefinition(firstIncompleteMessagingChannel.channel)?.shortLabel ?? 'channel'}`
        : 'Review setup',
    },
    {
      label: 'Provider groups have a clear status',
      complete: providerGroupSummaries.length > 0,
      action: () => openSettingsSection('provider'),
      actionLabel: 'Review providers',
    },
  ];
  const nextChannelLaunchStep = channelLaunchChecklist.find((item) => !item.complete) ?? null;

  const openSettingsSection = (
    section: 'email' | 'messaging' | 'provider',
    channelKey?: ChannelKey,
  ) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('category', 'connections');
    nextParams.set('section', section);
    if (channelKey && channelKey !== 'email') {
      nextParams.set('channel', channelKey);
    } else {
      nextParams.delete('channel');
    }
    setSearchParams(nextParams, { replace: true });

    const refMap = {
      email: emailSectionRef,
      messaging: messagingSectionRef,
      provider: providerStatusRef,
    } as const;

    scrollToRef(refMap[section]);
    if (channelKey && channelKey !== 'email') {
      window.requestAnimationFrame(() => {
        channelCardRefs.current[channelKey]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
    }
  };

  const focusFirstIncompleteChannel = (
    channels: Array<{ channelKey: ChannelKey; state: ChannelConnectionState }>,
  ) => {
    const nextChannel =
      channels.find(
        (channel) =>
          channel.state === 'needs_connection' || channel.state === 'provider_setup_required',
      )?.channelKey ?? channels[0]?.channelKey;

    openSettingsSection('messaging', nextChannel);
  };

  const getConnectionHelpText = (
    definition: ReturnType<typeof getChannelDefinition>,
    state: ChannelConnectionState,
    config?: unknown,
  ) => {
    if (!definition) {
      return '';
    }
    return getChannelSetupDescription(definition, state, config);
  };

  const renderConnectionAction = (
    definition: NonNullable<ReturnType<typeof getChannelDefinition>>,
    state: ChannelConnectionState,
  ) => {
    if (state === 'ready') {
      return (
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
          Ready for live traffic
        </Badge>
      );
    }

    if (definition.key === 'email' && state === 'needs_connection') {
      return (
        <Button size="sm" variant="outline" onClick={() => openSettingsSection('email')}>
          {getChannelSetupActionLabel(definition, state)}
        </Button>
      );
    }

    if (
      (definition.key === 'facebook' || definition.key === 'instagram') &&
      state === 'needs_connection'
    ) {
      return (
        <Button size="sm" variant="outline" onClick={handleConnectMeta} disabled={connecting}>
          {connecting ? 'Connecting...' : 'Connect with Facebook'}
        </Button>
      );
    }

    if (state === 'needs_connection' || state === 'provider_setup_required') {
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            openSettingsSection(getChannelSettingsSection(definition.key), definition.key)
          }
        >
          {getChannelSetupActionLabel(definition, state)}
        </Button>
      );
    }

    if (state === 'coming_soon') {
      return (
        <Badge variant="outline" className="border-bb-border bg-bb-linen text-bb-warm-gray">
          Planned rollout
        </Badge>
      );
    }

    return null;
  };

  if ((mode === 'settings' && workspaceLoading) || loading) {
    return (
      <Card className="flex items-center justify-center border-[0.5px] border-bb-border bg-bb-white p-6">
        <Loader2 className="h-5 w-5 animate-spin text-bb-warm-gray" />
      </Card>
    );
  }

  if (!activeWorkspaceId) {
    return (
      <PanelNotice
        icon={Settings2}
        title="Finish setup before connecting channels"
        description="BizzyBee needs a workspace first so email, WhatsApp, Facebook, Instagram, and Google Business channels can be attached to the right business."
        actionLabel="Open onboarding"
        actionTo="/onboarding?reset=true"
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* In onboarding the parent step already shows a summary card and the
          provider badges, so rendering another "at a glance" card here just
          duplicates the numbers and (on narrow layouts) breaks visually. */}
      {mode !== 'onboarding' && (
        <Card className="border-[0.5px] border-bb-border bg-bb-white p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-bb-text">Channels at a glance</h3>
              <p className="mt-1 text-sm text-bb-warm-gray">
                BizzyBee now treats Channels as one shared system across onboarding, settings, and
                the dashboard. These counts show what is enabled versus actually ready.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-bb-border bg-bb-linen px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-bb-warm-gray">Enabled</p>
                <p className="mt-1 text-2xl font-semibold text-bb-text">
                  {connectionSummary.enabled}
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-emerald-700">Ready</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-700">
                  {connectionSummary.ready}
                </p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-amber-700">Need setup</p>
                <p className="mt-1 text-2xl font-semibold text-amber-700">
                  {connectionSummary.needsSetup}
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {mode !== 'onboarding' && (
        <Card className="border-[0.5px] border-bb-border bg-bb-white p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-bb-warm-gray">
                Launch readiness
              </p>
              <h3 className="text-sm font-medium text-bb-text">Channels control center</h3>
              <p className="max-w-2xl text-sm leading-6 text-bb-warm-gray">
                Channels should not just show status. They should make it obvious what is enabled,
                what is truly ready, and what the next blocking setup step is.
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                channelLaunchChecklist.every((item) => item.complete)
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-bb-border bg-bb-linen text-bb-warm-gray'
              }
            >
              {channelLaunchChecklist.filter((item) => item.complete).length}/
              {channelLaunchChecklist.length} ready
            </Badge>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {channelLaunchChecklist.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-xl border border-bb-border bg-bb-linen/50 px-3 py-3"
              >
                <span className="text-sm text-bb-text">{item.label}</span>
                <Badge
                  className={
                    item.complete
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                      : 'border-bb-border bg-bb-white text-bb-warm-gray hover:bg-bb-white'
                  }
                >
                  {item.complete ? 'Ready' : 'Pending'}
                </Badge>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-bb-border bg-bb-linen/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-bb-text">Next channel step</p>
                <p className="text-sm leading-6 text-bb-warm-gray">
                  {nextChannelLaunchStep
                    ? `${nextChannelLaunchStep.label} is the next blocker before Channels feels fully production-ready.`
                    : 'Channels now has a strong internal setup foundation. The next layer is deeper provider self-serve linking.'}
                </p>
              </div>
              {nextChannelLaunchStep ? (
                <Button size="sm" variant="outline" onClick={nextChannelLaunchStep.action}>
                  {nextChannelLaunchStep.actionLabel}
                </Button>
              ) : (
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                  Internal handoff ready
                </Badge>
              )}
            </div>
          </div>
        </Card>
      )}

      {showEmailSection && (
        <div ref={emailSectionRef} className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Email Accounts
            </h3>
            <p className="text-sm text-muted-foreground">
              Connect email accounts to receive and send emails directly. Supports Gmail, Outlook,
              Apple Mail, and more.
            </p>
          </div>

          {emailConfigs.length > 0 && (
            <div className="space-y-3">
              {emailConfigs.map((config) => (
                <EmailAccountCard
                  key={config.id}
                  config={config}
                  onDisconnect={refreshEmailConfigs}
                  onUpdate={refreshEmailConfigs}
                />
              ))}
            </div>
          )}

          <Card className="p-6 border-dashed">
            <div className="text-center space-y-4">
              <Cloud className="h-10 w-10 mx-auto text-muted-foreground" />
              <div>
                <p className="font-medium">
                  {emailConfigs.length > 0
                    ? 'Add another email account'
                    : 'No email account connected'}
                </p>
                <p className="text-sm text-muted-foreground">
                  Connect your email to handle conversations across providers
                </p>
              </div>

              <div className="flex flex-col items-center gap-3">
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gmail">Gmail</SelectItem>
                      <SelectItem value="outlook">Outlook / Microsoft 365</SelectItem>
                      <SelectItem value="icloud">Apple Mail / iCloud</SelectItem>
                      <SelectItem value="imap">Other (IMAP)</SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="flex items-center gap-1">
                    <Select value={selectedImportMode} onValueChange={setSelectedImportMode}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Import mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all_historical_90_days">Last 90 days + new</SelectItem>
                        <SelectItem value="unread_only">Unread + new</SelectItem>
                        <SelectItem value="new_only">New emails only</SelectItem>
                      </SelectContent>
                    </Select>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="font-medium">{importModeLabels[selectedImportMode]}</p>
                        <p className="text-xs text-muted-foreground">
                          {importModeDescriptions[selectedImportMode]}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                <Button onClick={handleConnectEmail} disabled={connecting}>
                  <Plus className="h-4 w-4 mr-2" />
                  {connecting ? 'Connecting...' : `Connect ${providerLabels[selectedProvider]}`}
                </Button>

                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  Real-time sync enabled - new emails arrive instantly
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Other Channels Section */}
      <div ref={messagingSectionRef} className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Messaging Channels
          </h3>
          <p className="text-sm text-muted-foreground">
            Enable the channels your business uses and choose how much AI autonomy each one gets.
          </p>
        </div>

        <div className="space-y-3">
          {displayedMessagingChannels.map((channel) => {
            const definition = getChannelDefinition(channel.channel);

            if (!definition) {
              return null;
            }

            const Icon = channelIcons[definition.key];
            const currentMode = automationModes.find(
              (m) => m.value === (channel.automation_level || 'draft_only'),
            );
            const ModeIcon = currentMode?.icon || FileEdit;
            const connectionState = deriveChannelConnectionState(definition, channel, emailConfigs);
            const connectionLabel = getChannelConnectionLabel(definition, connectionState);
            const setupProgress = getChannelSetupProgress(definition.key, channel.config);
            const requiredFields = CHANNEL_ROUTING_FIELDS[definition.key] || [];
            const isTargetedChannel = searchParams.get('channel') === definition.key;
            const draftConfig = buildConfigFromDraft(definition.key);
            const hasDraftChanges =
              JSON.stringify(draftConfig) !== JSON.stringify(channel.config ?? {});
            const draftProgress = getChannelSetupProgress(definition.key, draftConfig);
            const isSavingConfig = savingChannelKey === definition.key;
            const entitlement = getChannelEntitlement(definition.key);
            const availabilityState = getChannelAvailabilityState(definition.key);
            const automationState = getChannelAutomationState(definition.key);
            const missingRoutingSummary =
              draftProgress.missingLabels.length > 0
                ? `${draftProgress.missingLabels.length} required ${
                    draftProgress.missingLabels.length === 1 ? 'field' : 'fields'
                  } missing`
                : 'All required identifiers saved';

            const expanded = isChannelExpanded(definition.key);

            return (
              <Card
                key={channel.id ?? definition.key}
                ref={(element) => {
                  channelCardRefs.current[definition.key] = element;
                }}
                data-channel-key={definition.key}
                className={`p-4 ${isTargetedChannel ? 'ring-2 ring-bb-gold/25 border-bb-gold/40' : ''}`}
              >
                <div className="space-y-3">
                  {/* Header row — clickable to toggle expansion */}
                  <div
                    className="flex items-center justify-between cursor-pointer select-none"
                    role="button"
                    tabIndex={0}
                    aria-expanded={expanded}
                    aria-controls={`channel-details-${definition.key}`}
                    onClick={() => toggleChannelCollapsed(definition.key)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleChannelCollapsed(definition.key);
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-lg ${channel.enabled ? 'bg-primary/10 text-primary' : 'bg-muted'}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{definition.label}</span>
                          {channel.enabled && (
                            <Badge variant="secondary" className="text-xs">
                              Active
                            </Badge>
                          )}
                          {!channel.id && (
                            <Badge variant="outline" className="text-xs">
                              Not configured yet
                            </Badge>
                          )}
                          <ModuleLockBadge state={availabilityState.state} />
                          <Badge
                            variant="outline"
                            className={`text-xs ${getConnectionBadgeClasses(connectionState)}`}
                          >
                            {connectionLabel}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{definition.description}</p>
                        {expanded && requiredFields.length > 0 && (
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-bb-warm-gray">
                            <span>
                              Setup progress: {setupProgress.completedCount}/
                              {setupProgress.requiredCount} required identifiers saved
                            </span>
                            {hasDraftChanges ? (
                              <Badge
                                variant="outline"
                                className="border-sky-200 bg-sky-50 text-sky-700"
                              >
                                Unsaved changes
                              </Badge>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Stop propagation so flipping the switch doesn't also
                          toggle the collapsible row. */}
                      <div onClick={(event) => event.stopPropagation()}>
                        <Switch
                          checked={channel.enabled}
                          onCheckedChange={() => toggleChannel(channel)}
                          disabled={
                            definition.key === 'webchat' ||
                            !canManageChannels ||
                            availabilityState.state === 'locked'
                          }
                          aria-label={`Toggle ${definition.label}`}
                        />
                      </div>
                      <ChevronDown
                        className={`h-4 w-4 text-bb-warm-gray transition-transform ${
                          expanded ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      />
                    </div>
                  </div>

                  {/* Automation level selector */}
                  {expanded && channel.enabled && definition.key !== 'webchat' && (
                    <div className="pl-11 pt-2 border-t space-y-3">
                      {automationState.state !== 'locked' ? (
                        <>
                          <div className="flex items-center gap-2 mb-2">
                            <ModeIcon className={`h-3.5 w-3.5 ${currentMode?.color}`} />
                            <span className="text-xs font-medium">AI Automation Mode</span>
                          </div>
                          {automationState.state === 'shadow-preview' ? (
                            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-700">
                              <p className="font-medium">Shadow preview</p>
                              <p className="mt-1">
                                {entitlement.message ??
                                  `${definition.label} automation would be blocked under hard billing enforcement.`}
                              </p>
                            </div>
                          ) : null}
                          <Select
                            value={channel.automation_level || 'draft_only'}
                            onValueChange={(value) => updateChannelAutomation(channel, value)}
                          >
                            <SelectTrigger className="w-full h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {automationModes.map((mode) => {
                                const MIcon = mode.icon;
                                return (
                                  <SelectItem key={mode.value} value={mode.value}>
                                    <div className="flex items-center gap-2">
                                      <MIcon className={`h-3.5 w-3.5 ${mode.color}`} />
                                      <div>
                                        <span className="font-medium">{mode.label}</span>
                                        <span className="text-muted-foreground ml-1">
                                          - {mode.description}
                                        </span>
                                      </div>
                                    </div>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </>
                      ) : (
                        <div className="rounded-xl border border-bb-border bg-bb-linen/70 p-3 text-sm text-bb-warm-gray">
                          <p className="font-medium text-bb-text">Manual routing on current plan</p>
                          <p className="mt-1">
                            {entitlement.message ??
                              'This channel is available for routing only until AI access is added.'}
                          </p>
                        </div>
                      )}

                      <div className="flex flex-col gap-2 rounded-xl border border-bb-border bg-bb-linen/70 p-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-bb-warm-gray">
                            Connection status
                          </p>
                          <p className="mt-1 text-sm text-bb-text-secondary">
                            {getConnectionHelpText(definition, connectionState, channel.config)}
                          </p>
                        </div>
                        <div className="shrink-0">
                          {renderConnectionAction(definition, connectionState)}
                        </div>
                      </div>

                      {availabilityState.state === 'shadow-preview' ? (
                        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-700">
                          <p className="font-medium">Channel access in shadow preview</p>
                          <p className="mt-1">
                            {entitlement.message ??
                              `${definition.label} is currently open for internal testing but would block with hard enforcement.`}
                          </p>
                        </div>
                      ) : null}

                      {CHANNEL_ROUTING_FIELDS[definition.key]?.length ? (
                        <div className="rounded-xl border border-bb-border bg-bb-white p-3 space-y-3">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-bb-warm-gray">
                              Routing identifiers
                            </p>
                            <p className="mt-1 text-sm text-bb-text-secondary">
                              These values let BizzyBee match incoming provider traffic to this
                              workspace.
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Badge
                                variant="outline"
                                className={
                                  draftProgress.missingLabels.length > 0
                                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                }
                              >
                                {missingRoutingSummary}
                              </Badge>
                              {draftProgress.missingLabels.slice(0, 2).map((label) => (
                                <Badge
                                  key={label}
                                  variant="outline"
                                  className="border-bb-border bg-bb-linen text-bb-text-secondary"
                                >
                                  Missing: {label}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            {CHANNEL_ROUTING_FIELDS[definition.key]?.map((field) => (
                              <div key={field.key} className="space-y-1.5">
                                <label className="text-xs font-medium text-bb-text">
                                  {field.label}
                                  {field.required === false ? (
                                    <span className="ml-1 text-bb-warm-gray">(optional)</span>
                                  ) : null}
                                </label>
                                <Input
                                  value={channelConfigDrafts[definition.key]?.[field.key] || ''}
                                  onChange={(event) =>
                                    updateChannelConfigDraft(
                                      definition.key,
                                      field.key,
                                      event.target.value,
                                    )
                                  }
                                  placeholder={field.placeholder}
                                  disabled={!canManageChannels}
                                />
                                <p className="text-xs text-bb-warm-gray">{field.helpText}</p>
                              </div>
                            ))}
                          </div>
                          {canManageChannels ? (
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => saveChannelConfig(channel, definition)}
                                disabled={isSavingConfig || !hasDraftChanges}
                              >
                                {isSavingConfig
                                  ? 'Saving...'
                                  : hasDraftChanges
                                    ? 'Save routing details'
                                    : 'Routing saved'}
                              </Button>
                            </div>
                          ) : (
                            <p className="text-xs text-bb-warm-gray">
                              Only an admin can save routing identifiers for this channel.
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        {!canManageChannels && (
          <PanelNotice
            icon={Info}
            title="Channel changes require admin access"
            description="You can see the supported channels here, but only an admin can enable them or change automation levels."
            actionLabel="Open Workspace & Access"
            actionTo="/settings?category=workspace"
          />
        )}
      </div>

      {showProviderStatus && (
        <div ref={providerStatusRef} className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Store className="h-5 w-5" />
              Provider Setup Status
            </h3>
            <p className="text-sm text-muted-foreground">
              BizzyBee now uses this single setup flow for channels. The cards below show what is
              already self-serve and what still depends on provider-level linking.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {providerGroupSummaries.map((card) => {
              const Icon = channelIcons[card.channelKeys[0]];
              const checklist = providerChecklists[card.id];
              const firstIncompleteChannel = card.channels.find(
                (channel) =>
                  channel.state === 'needs_connection' ||
                  channel.state === 'provider_setup_required',
              );
              const groupActionLabel = firstIncompleteChannel
                ? getChannelSetupActionLabel(
                    firstIncompleteChannel.definition,
                    firstIncompleteChannel.state,
                    channels.find((entry) => entry.channel === firstIncompleteChannel.channelKey)
                      ?.config,
                  )
                : null;

              return (
                <Card key={card.title} className="border-[0.5px] border-bb-border bg-bb-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="rounded-full bg-bb-linen p-2 text-bb-gold">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-medium text-bb-text">{card.title}</h3>
                        <p className="mt-1 text-sm text-bb-warm-gray">{card.description}</p>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`shrink-0 ${getGroupStatusClasses(card.statusTone)}`}
                    >
                      {card.statusLabel}
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {card.channels.map((channel) =>
                      (() => {
                        const channelConfig = channels.find(
                          (entry) => entry.channel === channel.channelKey,
                        )?.config;
                        const channelProgress = getChannelSetupProgress(
                          channel.channelKey,
                          channelConfig,
                        );

                        return (
                          <div
                            key={channel.channelKey}
                            className="rounded-xl border border-bb-border bg-bb-linen/70 px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-medium text-bb-text">
                                {channel.definition.shortLabel}
                              </span>
                              <Badge
                                variant="outline"
                                className={getConnectionBadgeClasses(channel.state)}
                              >
                                {getChannelConnectionLabel(channel.definition, channel.state)}
                              </Badge>
                            </div>
                            {channelProgress.requiredCount > 0 ? (
                              <p className="mt-1 text-xs text-bb-warm-gray">
                                {channelProgress.completedCount}/{channelProgress.requiredCount}{' '}
                                required identifiers saved
                                {channelProgress.missingLabels.length > 0
                                  ? ` • Missing ${channelProgress.missingLabels
                                      .slice(0, 2)
                                      .join(', ')}`
                                  : ''}
                              </p>
                            ) : null}
                          </div>
                        );
                      })(),
                    )}
                  </div>
                  {checklist ? (
                    <div className="mt-3 rounded-xl border border-bb-border bg-bb-linen/70 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-bb-warm-gray">
                        {checklist.title}
                      </p>
                      <div className="mt-2 space-y-1.5">
                        {checklist.steps.map((step) => (
                          <div
                            key={step}
                            className="flex items-start gap-2 text-sm text-bb-text-secondary"
                          >
                            <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-bb-gold" />
                            <p>{step}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center justify-between border-t border-bb-border pt-3">
                    <p className="text-xs text-bb-warm-gray">
                      {card.readyCount} ready
                      {card.enabledCount > 0 ? ` of ${card.enabledCount} enabled` : ''}
                    </p>
                    {card.id === 'email' && card.readyCount === 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openSettingsSection('email')}
                      >
                        Connect email
                      </Button>
                    ) : card.id === 'ai-phone' ? (
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/ai-phone">
                          {activeEntitlements.canUseAiPhone ? 'Open AI Phone' : 'Add AI Phone'}
                        </Link>
                      </Button>
                    ) : card.id === 'twilio' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => focusFirstIncompleteChannel(card.channels)}
                      >
                        {groupActionLabel ?? 'Add business numbers'}
                      </Button>
                    ) : card.id === 'meta-google' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => focusFirstIncompleteChannel(card.channels)}
                      >
                        {groupActionLabel ?? 'Save account IDs'}
                      </Button>
                    ) : card.statusTone === 'needs_setup' || card.statusTone === 'not_enabled' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => focusFirstIncompleteChannel(card.channels)}
                      >
                        Review channels
                      </Button>
                    ) : (
                      <Badge variant="outline" className="border-bb-border text-bb-warm-gray">
                        {card.status}
                      </Badge>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
