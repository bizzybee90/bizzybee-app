import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  Mail,
  RefreshCw,
  Trash2,
  Clock,
  CheckCircle,
  Plus,
  X,
  Loader2,
  Rocket,
  Pencil,
  Eye,
  Pause,
  ChevronDown,
  Zap,
  AlertTriangle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface EmailConfig {
  id: string;
  email_address: string;
  provider: string;
  import_mode: string;
  last_sync_at: string | null;
  connected_at: string;
  workspace_id: string;
  aliases?: string[];
  automation_level?: string;
  subscription_id?: string;
  subscription_expires_at?: string;
}

interface EmailAccountCardProps {
  config: EmailConfig;
  onDisconnect: () => void;
  onUpdate: () => void;
}

const providerIcons: Record<string, string> = {
  Google: '📧',
  Office365: '📬',
  iCloud: '🍎',
  IMAP: '📨',
};

const providerLabels: Record<string, string> = {
  Google: 'Gmail',
  Office365: 'Outlook',
  iCloud: 'Apple Mail',
  IMAP: 'IMAP',
};

const AUTOMATION_LEVELS = [
  {
    value: 'automatic',
    label: 'Automatic',
    icon: Rocket,
    description: 'AI drafts and sends automatically',
    color: 'text-green-600 bg-green-500/10 border-green-500/30',
  },
  {
    value: 'draft_only',
    label: 'Draft Only',
    icon: Pencil,
    description: 'AI drafts, you click to send',
    color: 'text-blue-600 bg-blue-500/10 border-blue-500/30',
  },
  {
    value: 'review_required',
    label: 'Review Mode',
    icon: Eye,
    description: 'All responses go to review queue',
    color: 'text-amber-600 bg-amber-500/10 border-amber-500/30',
  },
  {
    value: 'disabled',
    label: 'Manual',
    icon: Pause,
    description: 'No AI assistance',
    color: 'text-muted-foreground bg-muted border-border',
  },
];

export const EmailAccountCard = ({ config, onDisconnect, onUpdate }: EmailAccountCardProps) => {
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [aliasesOpen, setAliasesOpen] = useState(false);
  const [newAlias, setNewAlias] = useState('');
  const [addingAlias, setAddingAlias] = useState(false);
  const [updatingAutomation, setUpdatingAutomation] = useState(false);
  const [refreshingWebhook, setRefreshingWebhook] = useState(false);

  const aliases = config.aliases || [];
  const currentLevel =
    AUTOMATION_LEVELS.find((l) => l.value === (config.automation_level || 'draft_only')) ||
    AUTOMATION_LEVELS[1];

  // Check if subscription is active
  const isSubscriptionActive = config.subscription_expires_at
    ? new Date(config.subscription_expires_at) > new Date()
    : false;

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('trigger-n8n-workflow', {
        body: { workflow_type: 'email_import', configId: config.id, mode: config.import_mode },
      });

      if (error) throw error;

      toast({
        title: 'Sync complete',
        description: `Processed ${data?.messagesProcessed || 0} messages`,
      });
      onUpdate();
    } catch (error: any) {
      logger.error('Error syncing email', error);
      const message =
        (typeof error?.message === 'string' && error.message) ||
        (typeof error?.details === 'string' && error.details) ||
        'Unknown error';
      toast({
        title: 'Sync failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleRefreshWebhook = async () => {
    setRefreshingWebhook(true);
    try {
      const { data, error } = await supabase.functions.invoke('refresh-aurinko-subscriptions', {
        body: { configId: config.id },
      });

      if (error) throw error;

      toast({
        title: 'Webhook refreshed',
        description: 'Real-time email sync is now active',
      });
      onUpdate();
    } catch (error: any) {
      logger.error('Error refreshing webhook', error);
      toast({
        title: 'Failed to refresh webhook',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setRefreshingWebhook(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { error } = await supabase.from('email_provider_configs').delete().eq('id', config.id);

      if (error) throw error;

      toast({ title: 'Email disconnected', description: 'Account has been removed' });
      onDisconnect();
    } catch (error) {
      logger.error('Error disconnecting email', error);
      toast({ title: 'Failed to disconnect', variant: 'destructive' });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleAddAlias = async () => {
    if (!newAlias.trim()) return;

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newAlias.trim())) {
      toast({
        title: 'Invalid email',
        description: 'Please enter a valid email address',
        variant: 'destructive',
      });
      return;
    }

    // Check if alias already exists
    if (aliases.includes(newAlias.trim().toLowerCase())) {
      toast({
        title: 'Alias exists',
        description: 'This alias is already added',
        variant: 'destructive',
      });
      return;
    }

    setAddingAlias(true);
    try {
      const updatedAliases = [...aliases, newAlias.trim().toLowerCase()];
      const { error } = await supabase
        .from('email_provider_configs')
        .update({ aliases: updatedAliases })
        .eq('id', config.id);

      if (error) throw error;

      toast({ title: 'Alias added', description: `${newAlias} added as an alias` });
      setNewAlias('');
      onUpdate();
    } catch (error) {
      logger.error('Error adding alias', error);
      toast({ title: 'Failed to add alias', variant: 'destructive' });
    } finally {
      setAddingAlias(false);
    }
  };

  const handleRemoveAlias = async (aliasToRemove: string) => {
    try {
      const updatedAliases = aliases.filter((a) => a !== aliasToRemove);
      const { error } = await supabase
        .from('email_provider_configs')
        .update({ aliases: updatedAliases })
        .eq('id', config.id);

      if (error) throw error;

      toast({ title: 'Alias removed', description: `${aliasToRemove} removed` });
      onUpdate();
    } catch (error) {
      logger.error('Error removing alias', error);
      toast({ title: 'Failed to remove alias', variant: 'destructive' });
    }
  };

  const handleAutomationChange = async (level: string) => {
    setUpdatingAutomation(true);
    try {
      const { error } = await supabase
        .from('email_provider_configs')
        .update({ automation_level: level })
        .eq('id', config.id);

      if (error) throw error;

      const levelInfo = AUTOMATION_LEVELS.find((l) => l.value === level);
      toast({
        title: 'Automation mode updated',
        description: `${config.email_address} is now in ${levelInfo?.label} mode`,
      });
      onUpdate();
    } catch (error) {
      logger.error('Update automation error', error);
      toast({ title: 'Failed to update automation level', variant: 'destructive' });
    } finally {
      setUpdatingAutomation(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="space-y-4">
        {/* Header Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{config.email_address}</span>
                <Badge variant="secondary" className="text-xs">
                  {providerIcons[config.provider] || '📧'}{' '}
                  {providerLabels[config.provider] || config.provider}
                </Badge>
                <Badge variant="outline" className="text-xs text-green-600">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Connected
                </Badge>
                {isSubscriptionActive ? (
                  <Badge variant="outline" className="text-xs text-emerald-600 bg-emerald-500/10">
                    <Zap className="h-3 w-3 mr-1" />
                    Real-time
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-amber-600 bg-amber-500/10">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Manual sync only
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Connected{' '}
                  {formatDistanceToNow(new Date(config.connected_at), { addSuffix: true })}
                </span>
                {config.last_sync_at && (
                  <span>
                    Last synced{' '}
                    {formatDistanceToNow(new Date(config.last_sync_at), { addSuffix: true })}
                  </span>
                )}
                {config.subscription_expires_at && isSubscriptionActive && (
                  <span className="text-emerald-600">
                    Webhook expires{' '}
                    {formatDistanceToNow(new Date(config.subscription_expires_at), {
                      addSuffix: true,
                    })}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isSubscriptionActive && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshWebhook}
                disabled={refreshingWebhook}
                className="text-amber-600 hover:text-amber-700"
              >
                <Zap className={`h-4 w-4 mr-1 ${refreshingWebhook ? 'animate-pulse' : ''}`} />
                {refreshingWebhook ? 'Activating...' : 'Enable Real-time'}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync'}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect email account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove {config.email_address} from your workspace. You won't receive
                    new emails from this account, but existing conversations will be preserved.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Automation Level Selector */}
        <div className="p-3 bg-muted/50 rounded-lg border">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-sm font-medium">AI Automation Mode</Label>
              <p className="text-xs text-muted-foreground">How should AI handle responses?</p>
            </div>
            <Select
              value={config.automation_level || 'draft_only'}
              onValueChange={handleAutomationChange}
              disabled={updatingAutomation}
            >
              <SelectTrigger className={`w-[180px] ${currentLevel.color}`}>
                {updatingAutomation ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SelectValue>
                    <div className="flex items-center gap-2">
                      <currentLevel.icon className="h-4 w-4" />
                      {currentLevel.label}
                    </div>
                  </SelectValue>
                )}
              </SelectTrigger>
              <SelectContent>
                {AUTOMATION_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    <div className="flex items-center gap-2">
                      <level.icon className="h-4 w-4" />
                      <div>
                        <div className="font-medium">{level.label}</div>
                        <div className="text-xs text-muted-foreground">{level.description}</div>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Aliases Section */}
        <Collapsible open={aliasesOpen} onOpenChange={setAliasesOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between text-muted-foreground"
            >
              <span className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email Aliases ({aliases.length})
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${aliasesOpen ? 'rotate-180' : ''}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Add email aliases that route to this account. Replies will be sent from the address
              the customer originally emailed.
            </p>

            {/* Existing aliases */}
            {aliases.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {aliases.map((alias) => (
                  <Badge key={alias} variant="secondary" className="flex items-center gap-1 pr-1">
                    {alias}
                    <button
                      onClick={() => handleRemoveAlias(alias)}
                      className="ml-1 p-0.5 rounded-full hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Add new alias */}
            <div className="flex gap-2">
              <Input
                placeholder="Enter alias email (e.g., info@maccleaning.uk)"
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddAlias()}
                className="flex-1"
              />
              <Button size="sm" onClick={handleAddAlias} disabled={addingAlias || !newAlias.trim()}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Card>
  );
};
