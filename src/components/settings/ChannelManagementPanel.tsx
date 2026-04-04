import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/hooks/useWorkspace';
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
} from 'lucide-react';
import { EmailAccountCard } from './EmailAccountCard';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Channel {
  id: string;
  channel: string;
  enabled: boolean;
  automation_level: string;
}

interface EmailConfig {
  id: string;
  email_address: string;
  provider: string;
  import_mode: string;
  last_sync_at: string | null;
  connected_at: string;
  workspace_id: string;
}

export const ChannelManagementPanel = () => {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [emailConfigs, setEmailConfigs] = useState<EmailConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('gmail');
  const [selectedImportMode, setSelectedImportMode] = useState<string>('all_historical_90_days');

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
      searchParams.delete('email_connected');
      searchParams.delete('email');
      searchParams.delete('tab');
      setSearchParams(searchParams, { replace: true });
      // Refresh email configs
      fetchEmailConfigs();
    }
  }, [searchParams]);

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

  const channelIcons: Record<string, any> = {
    sms: Phone,
    whatsapp: MessageSquare,
    email: Mail,
    webchat: Globe,
    facebook: Facebook,
    instagram: Instagram,
    google_business: MapPin,
  };

  const channelLabels: Record<string, string> = {
    sms: 'SMS',
    whatsapp: 'WhatsApp',
    email: 'Email',
    webchat: 'Web Chat',
    facebook: 'Facebook Messenger',
    instagram: 'Instagram DMs',
    google_business: 'Google Business Messages',
  };

  const providerLabels: Record<string, string> = {
    gmail: 'Gmail',
    outlook: 'Outlook / Microsoft 365',
    icloud: 'Apple Mail / iCloud',
    imap: 'Other (IMAP)',
  };

  useEffect(() => {
    fetchChannels();
    fetchEmailConfigs();

    // Set up realtime subscription for email configs
    if (!workspace?.id) return;

    const channel = supabase
      .channel('email-configs-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'email_provider_configs',
          filter: `workspace_id=eq.${workspace.id}`,
        },
        (payload) => {
          logger.debug('Email config change detected');
          fetchEmailConfigs();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspace?.id]);

  const fetchChannels = async () => {
    if (!workspace?.id) return;

    try {
      const { data, error } = await supabase
        .from('workspace_channels')
        .select('id, channel, enabled, automation_level')
        .eq('workspace_id', workspace.id)
        .order('channel');

      if (error) throw error;
      setChannels(data || []);
    } catch (error) {
      logger.error('Error fetching channels', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmailConfigs = async () => {
    if (!workspace?.id) return;

    try {
      const { data, error } = await supabase
        .from('email_provider_configs')
        .select(
          'id, email_address, provider, import_mode, last_sync_at, connected_at, workspace_id',
        )
        .eq('workspace_id', workspace.id);

      if (error) throw error;
      setEmailConfigs(data || []);
    } catch (error) {
      logger.error('Error fetching email configs', error);
    }
  };

  const handleConnectEmail = async () => {
    logger.debug('handleConnectEmail called', {
      workspaceId: workspace?.id,
      selectedProvider,
      selectedImportMode,
    });

    if (!workspace?.id) {
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
          workspaceId: workspace.id,
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

  const toggleChannel = async (channelId: string, currentState: boolean) => {
    try {
      const { error } = await supabase
        .from('workspace_channels')
        .update({ enabled: !currentState })
        .eq('id', channelId);

      if (error) throw error;

      setChannels(channels.map((c) => (c.id === channelId ? { ...c, enabled: !currentState } : c)));

      toast({
        title: 'Channel updated',
        description: `Channel ${!currentState ? 'enabled' : 'disabled'} successfully`,
      });
    } catch (error) {
      logger.error('Error toggling channel', error);
      toast({ title: 'Error', description: 'Failed to update channel', variant: 'destructive' });
    }
  };

  const updateChannelAutomation = async (channelId: string, automationLevel: string) => {
    try {
      const { error } = await supabase
        .from('workspace_channels')
        .update({ automation_level: automationLevel })
        .eq('id', channelId);

      if (error) throw error;

      setChannels(
        channels.map((c) => (c.id === channelId ? { ...c, automation_level: automationLevel } : c)),
      );

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

  if (loading) {
    return <div className="p-6">Loading channels...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Email Integration Section */}
      <div className="space-y-4">
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
                onDisconnect={fetchEmailConfigs}
                onUpdate={fetchEmailConfigs}
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

      {/* Other Channels Section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Other Channels
          </h3>
          <p className="text-sm text-muted-foreground">
            Enable channels and configure AI automation levels for each
          </p>
        </div>

        <div className="space-y-3">
          {channels
            .filter((c) => c.channel !== 'email')
            .map((channel) => {
              const Icon = channelIcons[channel.channel];
              const currentMode = automationModes.find(
                (m) => m.value === (channel.automation_level || 'draft_only'),
              );
              const ModeIcon = currentMode?.icon || FileEdit;

              return (
                <Card key={channel.id} className="p-4">
                  <div className="space-y-3">
                    {/* Header row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-2 rounded-lg ${channel.enabled ? 'bg-primary/10 text-primary' : 'bg-muted'}`}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{channelLabels[channel.channel]}</span>
                            {channel.enabled && (
                              <Badge variant="secondary" className="text-xs">
                                Active
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {channel.channel === 'sms' && 'Text message communication'}
                            {channel.channel === 'whatsapp' && 'WhatsApp Business messaging'}
                            {channel.channel === 'webchat' && 'Website chat widget (coming soon)'}
                            {channel.channel === 'facebook' &&
                              'Facebook Messenger for your business page'}
                            {channel.channel === 'instagram' && 'Instagram Direct Messages'}
                            {channel.channel === 'google_business' &&
                              'Messages from Google Business Profile'}
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={channel.enabled}
                        onCheckedChange={() => toggleChannel(channel.id, channel.enabled)}
                        disabled={channel.channel === 'webchat'}
                      />
                    </div>

                    {/* Automation level selector */}
                    {channel.enabled && channel.channel !== 'webchat' && (
                      <div className="pl-11 pt-2 border-t">
                        <div className="flex items-center gap-2 mb-2">
                          <ModeIcon className={`h-3.5 w-3.5 ${currentMode?.color}`} />
                          <span className="text-xs font-medium">AI Automation Mode</span>
                        </div>
                        <Select
                          value={channel.automation_level || 'draft_only'}
                          onValueChange={(value) => updateChannelAutomation(channel.id, value)}
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
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
        </div>
      </div>
    </div>
  );
};
