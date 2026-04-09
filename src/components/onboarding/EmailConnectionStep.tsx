import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';
import { Mail, CheckCircle2, Loader2 } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { EmailPipelineProgress } from './EmailPipelineProgress';
import { ImapConnectionModal } from './ImapConnectionModal';

interface EmailConnectionStepProps {
  workspaceId: string;
  onNext: () => void;
  onBack: () => void;
  onEmailConnected: (email: string) => void;
}

type Provider = 'gmail' | 'outlook' | 'icloud' | 'imap';
type ImportMode = 'new_only' | 'last_1000' | 'last_10000' | 'last_30000' | 'all_history';

interface MakeProgress {
  status: string;
  emails_imported: number;
  emails_classified: number;
  emails_total: number;
  voice_profile_complete: boolean;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

type ImportPhase =
  | 'idle'
  | 'connecting'
  | 'importing'
  | 'classifying'
  | 'analyzing'
  | 'learning'
  | 'complete'
  | 'error';

function mapImportProgressRowToMakeProgress(row: any): MakeProgress {
  // We intentionally keep this component’s existing UI model (MakeProgress)
  // and adapt the new pipeline table (`email_import_progress`) into it.
  const status = (row?.current_phase || 'idle') as ImportPhase;
  const emailsReceived = Number(row?.emails_received ?? 0);
  const emailsClassified = Number(row?.emails_classified ?? 0);
  const estimatedTotal = Number(row?.estimated_total_emails ?? 0);

  return {
    status,
    // Best-effort: older UI wants “emails_imported”; pipeline tracks received.
    emails_imported: emailsReceived,
    emails_classified: emailsClassified,
    emails_total: estimatedTotal,
    voice_profile_complete: Boolean(row?.voice_profile_complete ?? false),
    error_message: row?.last_error ?? null,
    started_at: row?.started_at ?? null,
    completed_at: row?.completed_at ?? null,
  };
}

const emailProviders = [
  {
    id: 'gmail' as Provider,
    name: 'Gmail',
    icon: 'https://www.google.com/gmail/about/static-2.0/images/logo-gmail.png',
    available: true,
  },
  {
    id: 'outlook' as Provider,
    name: 'Outlook',
    icon: null,
    iconColor: 'text-blue-600',
    available: true,
  },
  {
    id: 'icloud' as Provider,
    name: 'iCloud Mail',
    icon: null,
    iconColor: 'text-sky-500',
    available: true,
  },
  {
    id: 'imap' as Provider,
    name: 'Other',
    icon: null,
    iconColor: 'text-bb-warm-gray',
    available: true,
    subtitle: 'Fastmail, Yahoo, Zoho, custom domains, or another IMAP provider',
  },
];

const importModes = [
  {
    value: 'all_history' as ImportMode,
    label: 'Entire email history',
    description: 'Import everything — best for maximum AI accuracy',
    timeEstimate: '~5 mins setup, deep learning continues in background',
    recommended: false,
  },
  {
    value: 'last_30000' as ImportMode,
    label: 'Last 30,000 emails',
    description: 'Comprehensive learning with great coverage',
    timeEstimate: '~5 mins setup, deep learning continues in background',
    recommended: true,
  },
  {
    value: 'last_10000' as ImportMode,
    label: 'Last 10,000 emails',
    description: 'Strong learning data with faster import',
    timeEstimate: '~5 mins setup, continues in background',
  },
  {
    value: 'last_1000' as ImportMode,
    label: 'Last 1,000 emails',
    description: 'Quick start with decent learning data',
    timeEstimate: '~3 mins',
  },
  {
    value: 'new_only' as ImportMode,
    label: 'New emails only',
    description: 'Only receive new emails going forward (no history)',
    timeEstimate: 'Instant',
  },
];

// Supabase project URL for edge functions
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export function EmailConnectionStep({
  workspaceId,
  onNext,
  onBack,
  onEmailConnected,
}: EmailConnectionStepProps) {
  const isPreview = workspaceId === 'preview-workspace';
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [imapModalOpen, setImapModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('last_1000');
  const [initialLoading, setInitialLoading] = useState(true);
  const [importStarted, setImportStarted] = useState(false);
  const [progress, setProgress] = useState<MakeProgress | null>(null);

  const toastedEmailRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<number | undefined>(undefined);

  const checkEmailConnection = useCallback(
    async (isInitialLoad = false) => {
      if (isPreview) {
        setInitialLoading(false);
        setIsConnecting(false);
        return;
      }

      try {
        const [configResult, progressResult] = await Promise.all([
          supabase
            .from('email_provider_configs')
            .select('id, import_mode, email_address, sync_status')
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('email_import_progress')
            .select('*')
            .eq('workspace_id', workspaceId)
            .maybeSingle(),
        ]);

        if (!progressResult.error && progressResult.data) {
          const mapped = mapImportProgressRowToMakeProgress(progressResult.data);
          setProgress(mapped);
          if (mapped.status && mapped.status !== 'idle') {
            setImportStarted(true);
          } else {
            setImportStarted(false);
          }
        } else {
          // No progress record exists - reset state
          setProgress(null);
          setImportStarted(false);
        }

        if (!configResult.error && configResult.data?.email_address) {
          const email = configResult.data.email_address;
          setConnectedEmail(email);
          onEmailConnected(email);

          if (toastedEmailRef.current !== email && !isInitialLoad) {
            toastedEmailRef.current = email;
            toast.success(`Connected to ${email}`);
          }
        } else {
          setConnectedEmail(null);
          onEmailConnected('');
        }
      } catch (error) {
        logger.error('Error checking connection', error);
      } finally {
        setInitialLoading(false);
        setIsConnecting(false);
      }
    },
    [onEmailConnected, workspaceId, isPreview],
  );

  // Check for existing connection on mount
  useEffect(() => {
    void checkEmailConnection(true);
  }, [checkEmailConnection, workspaceId]);

  // Poll email_import_progress when import is started (new pipeline)
  useEffect(() => {
    if (!importStarted || !workspaceId || isPreview) return;

    const poll = async () => {
      const { data, error } = await supabase
        .from('email_import_progress')
        .select('*')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (error) return;
      if (!data) return;

      const mapped = mapImportProgressRowToMakeProgress(data);
      setProgress(mapped);

      // Stop polling if complete or error
      if (mapped.status === 'complete' || mapped.status === 'error') {
        if (pollIntervalRef.current) {
          window.clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = undefined;
        }
      }
    };

    // Initial poll
    poll();

    // Poll every 10 seconds
    pollIntervalRef.current = window.setInterval(poll, 10000);

    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }
    };
  }, [importStarted, workspaceId, isPreview]);

  // Handle OAuth redirect params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const aurinko = params.get('aurinko');

    if (aurinko === 'success') {
      toast.success('Email connected successfully');
      params.delete('aurinko');
      params.delete('message');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', newUrl);
      void checkEmailConnection();
    } else if (aurinko === 'error') {
      const errorMessage = params.get('message') || 'Email connection failed';
      toast.error(errorMessage, { duration: 8000 });
      params.delete('aurinko');
      params.delete('message');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', newUrl);
      setIsConnecting(false);
    }
  }, [checkEmailConnection]);

  const handleConnect = async (provider: Provider) => {
    if (isPreview) {
      toast.info('Email connection is not available in preview mode');
      return;
    }

    // Password-based providers → open BizzyBee modal
    if (provider === 'icloud' || provider === 'imap') {
      setSelectedProvider(provider);
      setImapModalOpen(true);
      return;
    }

    // OAuth providers (Gmail, Outlook) → existing Aurinko redirect flow (UNCHANGED)
    setIsConnecting(true);
    setSelectedProvider(provider);

    try {
      const { data, error } = await supabase.functions.invoke('aurinko-auth-start', {
        body: {
          workspaceId,
          provider,
          importMode,
          origin: window.location.origin,
        },
      });

      if (error) {
        logger.error('Error from aurinko-auth-start', error);
        toast.error('Failed to start email connection');
        setIsConnecting(false);
        return;
      }

      if (!data?.authUrl) {
        logger.error('No auth URL returned');
        toast.error('Failed to get authentication URL');
        setIsConnecting(false);
        return;
      }

      // Always use same-tab redirect for seamless experience
      window.location.href = data.authUrl;
    } catch (error) {
      logger.error('Error starting OAuth', error);
      toast.error('Failed to start email connection');
      setIsConnecting(false);
    }
  };

  const startImport = async () => {
    if (!workspaceId || importStarted || isPreview) return;

    setImportStarted(true);

    try {
      // Trigger n8n workflows via edge function (avoids CORS issues from browser)
      const { data, error: fnError } = await supabase.functions.invoke('trigger-n8n-workflow', {
        body: { workspace_id: workspaceId, workflow_type: 'email_classification' },
      });

      if (fnError) {
        logger.error('Edge function error', fnError);
        throw new Error('Failed to trigger AI training workflows');
      }

      toast.success('AI training started! This will take a few minutes...');
      onNext();
    } catch (error) {
      logger.error('Error triggering n8n workflows', error);
      toast.error('Failed to start AI training');
      setImportStarted(false);
    }
  };

  const handleDisconnect = async () => {
    if (isPreview) return;

    try {
      const { data: existingConfig, error: lookupError } = await supabase
        .from('email_provider_configs')
        .select('id, provider')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lookupError) {
        throw lookupError;
      }

      if (existingConfig?.id) {
        const { data, error } = await supabase.functions.invoke('aurinko-reset-account', {
          body: {
            workspaceId,
            configId: existingConfig.id,
          },
        });

        if (error) throw error;

        const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
        toast.success(
          warnings[0] || 'Email connection reset. You can reconnect this inbox from scratch now.',
        );
      } else {
        toast.success('No email connection was found for this workspace.');
      }

      setConnectedEmail(null);
      setProgress(null);
      setImportStarted(false);
      toastedEmailRef.current = null;
      onEmailConnected('');
    } catch (error) {
      logger.error('Failed to disconnect email connection', error);
      toast.error('Failed to disconnect');
    }
  };

  const handleRetry = async () => {
    if (isPreview) return;

    try {
      // Reset the new pipeline progress row so the UI can restart cleanly.
      // (If the row doesn't exist, this is a no-op.)
      await supabase
        .from('email_import_progress')
        .update({
          current_phase: 'idle',
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId);

      setImportStarted(false);
      setProgress(null);
      await startImport();
    } catch (error) {
      toast.error('Failed to retry import');
    }
  };

  // Loading state
  if (initialLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CardTitle className="text-xl">Connect Your Email</CardTitle>
          <CardDescription className="mt-2">
            BizzyBee will learn from your inbox to handle emails just like you would.
          </CardDescription>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">Checking connection...</span>
        </div>
      </div>
    );
  }

  // These are used in the conditional rendering below

  return (
    <div className="space-y-6">
      <div className="text-center">
        <CardTitle className="text-xl">Connect Your Email</CardTitle>
        <CardDescription className="mt-2">
          BizzyBee will learn from your inbox to handle emails just like you would.
        </CardDescription>
      </div>

      {!connectedEmail && !isConnecting && (
        <div className="flex items-start gap-3 p-3 bg-accent/50 dark:bg-accent/30 rounded-lg border border-border text-sm">
          <div className="shrink-0 mt-0.5">
            <svg
              className="h-4 w-4 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div className="text-foreground">
            <span className="font-medium">Heads up:</span> A secure login window will open in a
            popup or new tab.
          </div>
        </div>
      )}

      {connectedEmail ? (
        // Connected - show start button (no inline pipeline progress)
        <div className="space-y-6">
          {/* Connected status */}
          <div className="flex items-center justify-between gap-3 p-4 bg-success/10 rounded-lg border border-success/30">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-success" />
              <div>
                <p className="font-medium text-foreground">Email Connected!</p>
                <p className="text-sm text-muted-foreground">{connectedEmail}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-destructive"
              onClick={handleDisconnect}
            >
              Disconnect
            </Button>
          </div>

          {/* Fix B: simple Continue — email import is triggered automatically by aurinko-auth-callback */}
          <div className="space-y-3">
            <Button onClick={onNext} className="w-full gap-2">
              Continue
              <CheckCircle2 className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={onNext} className="w-full">
              Skip for Now
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Import Mode Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              How much email history should we learn from?
            </Label>
            <RadioGroup
              value={importMode}
              onValueChange={(v) => setImportMode(v as ImportMode)}
              className="space-y-2"
            >
              {importModes.map((mode) => (
                <div
                  key={mode.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    importMode === mode.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/50'
                  }`}
                  onClick={() => setImportMode(mode.value)}
                >
                  <RadioGroupItem value={mode.value} id={mode.value} className="mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={mode.value} className="font-medium cursor-pointer">
                        {mode.label}
                      </Label>
                      {mode.recommended && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{mode.description}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">{mode.timeEstimate}</p>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Provider Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Select your email provider</Label>
            <div className="grid grid-cols-2 gap-3">
              {emailProviders.map((provider) => (
                <Button
                  key={provider.id}
                  variant="outline"
                  className="h-auto py-4 flex flex-col items-center gap-2 relative"
                  onClick={() => handleConnect(provider.id)}
                  disabled={!provider.available || isConnecting}
                >
                  {isConnecting && selectedProvider === provider.id ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : provider.icon ? (
                    <img
                      src={provider.icon}
                      alt={provider.name}
                      className="h-6 w-6 object-contain"
                    />
                  ) : (
                    <Mail className={`h-6 w-6 ${provider.iconColor || ''}`} />
                  )}
                  <span className="text-sm font-medium">{provider.name}</span>
                  {'subtitle' in provider && provider.subtitle && (
                    <span className="text-[10px] text-muted-foreground text-center leading-tight">
                      {provider.subtitle}
                    </span>
                  )}
                </Button>
              ))}
            </div>
          </div>

          <Button variant="outline" onClick={onBack} className="w-full">
            Back
          </Button>
        </div>
      )}

      {imapModalOpen &&
        selectedProvider &&
        (selectedProvider === 'icloud' || selectedProvider === 'imap') && (
          <ImapConnectionModal
            open={imapModalOpen}
            workspaceId={workspaceId}
            provider={selectedProvider}
            importMode={importMode}
            onClose={() => {
              setImapModalOpen(false);
              setSelectedProvider(null);
            }}
            onConnected={(email) => {
              setImapModalOpen(false);
              setSelectedProvider(null);
              setConnectedEmail(email);
              onEmailConnected(email);
              void checkEmailConnection();
            }}
          />
        )}
    </div>
  );
}
