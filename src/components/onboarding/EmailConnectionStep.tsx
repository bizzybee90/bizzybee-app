import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';
import { Mail, CheckCircle2, Loader2, Clock, AlertCircle, Sparkles, Brain } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { ImapConnectionModal } from './ImapConnectionModal';
import { useEntitlements } from '@/hooks/useEntitlements';
import { getPlanDefinition } from '@/lib/billing/plans';
import {
  deriveEmailImportState,
  shouldKickEmailImport,
  type EmailImportPhase,
  type EmailImportProgressRow,
  type EmailPipelineRunStatus,
  type EmailProviderConfigStatus,
} from '@/lib/email/importStatus';

interface EmailConnectionStepProps {
  workspaceId: string;
  onNext: () => void;
  onBack: () => void;
  onEmailConnected: (email: string) => void;
}

type Provider = 'gmail' | 'outlook' | 'icloud' | 'imap';
type ImportMode = 'new_only' | 'last_1000' | 'last_10000' | 'last_30000' | 'all_history';

interface MakeProgress {
  status: 'idle' | 'queued' | 'importing' | 'classifying' | 'learning' | 'complete' | 'error';
  emails_imported: number;
  emails_classified: number;
  emails_total: number;
  voice_profile_complete: boolean;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

function normalizeProgressStatus(phase: EmailImportPhase): MakeProgress['status'] {
  switch (phase) {
    case 'idle':
      return 'idle';
    case 'queued':
      return 'queued';
    case 'classifying':
      return 'classifying';
    case 'learning':
      return 'learning';
    case 'complete':
      return 'complete';
    case 'error':
    case 'rate_limited':
      return 'error';
    default:
      return 'importing';
  }
}

function mapDerivedStateToMakeProgress(
  state: ReturnType<typeof deriveEmailImportState>,
): MakeProgress | null {
  if (state.phase === 'idle') return null;
  return {
    status: normalizeProgressStatus(state.phase),
    emails_imported: state.emailsReceived,
    emails_classified: state.emailsClassified,
    emails_total: Math.max(state.estimatedTotal, state.emailsReceived),
    voice_profile_complete: state.phase === 'complete',
    error_message: state.errorMessage,
    started_at: null,
    completed_at: state.phase === 'complete' ? new Date().toISOString() : null,
  };
}

function getConnectionProgressCopy(progress: MakeProgress | null): {
  icon:
    | typeof Clock
    | typeof Loader2
    | typeof Sparkles
    | typeof Brain
    | typeof CheckCircle2
    | typeof AlertCircle;
  title: string;
  description: string;
  className: string;
} | null {
  if (!progress || progress.status === 'idle') return null;

  switch (progress.status) {
    case 'queued':
      return {
        icon: Clock,
        title: 'Import queued',
        description: 'BizzyBee has the connection and the import worker will pick it up shortly.',
        className: 'border-border bg-muted/50 text-muted-foreground',
      };
    case 'importing':
      return {
        icon: Loader2,
        title: 'Importing emails',
        description: 'BizzyBee is pulling messages from your inbox in the background.',
        className: 'border-primary/20 bg-primary/5 text-foreground',
      };
    case 'classifying':
      return {
        icon: Sparkles,
        title: 'Classifying emails',
        description: 'BizzyBee is categorising messages automatically after import.',
        className: 'border-primary/20 bg-primary/5 text-foreground',
      };
    case 'learning':
      return {
        icon: Brain,
        title: 'Learning your voice',
        description: 'BizzyBee is training on the imported emails in the background.',
        className: 'border-primary/20 bg-primary/5 text-foreground',
      };
    case 'complete':
      return {
        icon: CheckCircle2,
        title: 'Import complete',
        description: 'BizzyBee has finished this import pass and is ready for the next step.',
        className: 'border-success/20 bg-success/5 text-success',
      };
    case 'error':
      return {
        icon: AlertCircle,
        title: 'Import blocked',
        description: progress.error_message || 'BizzyBee could not start or continue the import.',
        className: 'border-destructive/20 bg-destructive/5 text-destructive',
      };
    default:
      return null;
  }
}

function getFunctionErrorMessage(error: unknown, data: any, fallback: string): string {
  const payload = data && typeof data === 'object' ? data : null;
  const message =
    (payload && typeof payload.message === 'string' && payload.message) ||
    (payload && typeof payload.error === 'string' && payload.error) ||
    (payload && typeof payload.details === 'string' && payload.details) ||
    (error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : null);

  return message || fallback;
}

async function getFunctionErrorMessageAsync(
  error: unknown,
  data: any,
  fallback: string,
): Promise<string> {
  const directMessage = getFunctionErrorMessage(error, data, '');
  if (directMessage && directMessage !== 'Edge Function returned a non-2xx status code') {
    return directMessage;
  }

  const errorContext =
    error && typeof error === 'object' && 'context' in error
      ? ((error as { context?: unknown }).context as Response | undefined)
      : undefined;

  if (errorContext && typeof errorContext.clone === 'function') {
    try {
      const payload = await errorContext.clone().json();
      const payloadMessage = getFunctionErrorMessage(null, payload, '');
      if (payloadMessage) {
        return payloadMessage;
      }
    } catch {
      // Ignore non-JSON error bodies and fall back below.
    }
  }

  return fallback;
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

const IMPORT_MODE_LIMITS: Record<ImportMode, number> = {
  new_only: 0,
  last_1000: 1_000,
  last_10000: 10_000,
  last_30000: 30_000,
  all_history: Number.POSITIVE_INFINITY,
};

function getAllowedImportModes(emailHistoryImportLimit: number, aiInboxEnabled: boolean) {
  if (!aiInboxEnabled || emailHistoryImportLimit <= 0) {
    return importModes.filter((mode) => mode.value === 'new_only');
  }

  return importModes.filter((mode) => {
    if (mode.value === 'new_only') {
      return true;
    }

    return IMPORT_MODE_LIMITS[mode.value] <= emailHistoryImportLimit;
  });
}

function getDefaultImportMode(
  emailHistoryImportLimit: number,
  aiInboxEnabled: boolean,
): ImportMode {
  if (!aiInboxEnabled || emailHistoryImportLimit <= 0) {
    return 'new_only';
  }

  if (emailHistoryImportLimit >= 30_000) {
    return 'last_30000';
  }

  if (emailHistoryImportLimit >= 10_000) {
    return 'last_10000';
  }

  if (emailHistoryImportLimit >= 1_000) {
    return 'last_1000';
  }

  return 'new_only';
}

function formatEmailHistoryLimit(limit: number): string {
  if (limit >= 30_000) return '30,000 emails';
  if (limit >= 10_000) return '10,000 emails';
  if (limit >= 1_000) return '1,000 emails';
  return 'new emails only';
}

// Supabase project URL for edge functions
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export function EmailConnectionStep({
  workspaceId,
  onNext,
  onBack,
  onEmailConnected,
}: EmailConnectionStepProps) {
  const isPreview = workspaceId === 'preview-workspace';
  const { data: entitlements } = useEntitlements(workspaceId);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [imapModalOpen, setImapModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('last_1000');
  const [initialLoading, setInitialLoading] = useState(true);
  const [importStarted, setImportStarted] = useState(false);
  const [progress, setProgress] = useState<MakeProgress | null>(null);
  const [emailConfigId, setEmailConfigId] = useState<string | null>(null);

  const toastedEmailRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<number | undefined>(undefined);
  const aiInboxEnabled = entitlements?.canUseAiInbox ?? true;
  const emailHistoryImportLimit = entitlements?.limits.emailHistoryImportLimit ?? 30_000;
  const currentPlan = getPlanDefinition(entitlements?.plan ?? 'connect');
  const allowedImportModes = useMemo(
    () => getAllowedImportModes(emailHistoryImportLimit, aiInboxEnabled),
    [emailHistoryImportLimit, aiInboxEnabled],
  );
  const importLimitLabel = formatEmailHistoryLimit(emailHistoryImportLimit);
  const isNewEmailsOnlyPlan =
    allowedImportModes.length === 1 && allowedImportModes[0]?.value === 'new_only';
  const importLimitCopy = aiInboxEnabled
    ? importLimitLabel === 'new emails only'
      ? 'Your current plan starts with new emails only. You can upgrade later to import historical inbox context.'
      : `Your current plan includes up to ${importLimitLabel} of email history for AI learning.`
    : 'Connect includes the unified inbox only. You can start receiving new emails now, and upgrade later to train BizzyBee on history.';

  useEffect(() => {
    if (!allowedImportModes.some((mode) => mode.value === importMode)) {
      setImportMode(getDefaultImportMode(emailHistoryImportLimit, aiInboxEnabled));
    }
  }, [allowedImportModes, aiInboxEnabled, emailHistoryImportLimit, importMode]);

  const checkEmailConnection = useCallback(
    async (isInitialLoad = false) => {
      if (isPreview) {
        setInitialLoading(false);
        setIsConnecting(false);
        return;
      }

      try {
        const [configResult, progressResult, pipelineResult] = await Promise.all([
          supabase
            .from('email_provider_configs')
            .select(
              'id, import_mode, email_address, sync_status, sync_stage, sync_progress, inbound_emails_found, outbound_emails_found, inbound_total, outbound_total, sync_error, sync_started_at, sync_completed_at',
            )
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false })
            .limit(1),
          supabase
            .from('email_import_progress')
            .select('*')
            .eq('workspace_id', workspaceId)
            .maybeSingle(),
          supabase
            .from('pipeline_runs')
            .select('id, state, started_at, completed_at, last_error, metrics')
            .eq('workspace_id', workspaceId)
            .eq('channel', 'email')
            .eq('state', 'running')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        const latestConfig = !configResult.error
          ? ((configResult.data?.[0] as
              | (EmailProviderConfigStatus & {
                  id?: string | null;
                  email_address?: string | null;
                })
              | undefined) ?? null)
          : null;

        const derivedState = deriveEmailImportState({
          progress: !progressResult.error
            ? (progressResult.data as EmailImportProgressRow | null)
            : null,
          config: latestConfig,
          activeRun: !pipelineResult.error
            ? (pipelineResult.data as EmailPipelineRunStatus | null)
            : null,
        });
        const effectiveProgress = mapDerivedStateToMakeProgress(derivedState);

        setProgress(effectiveProgress);
        setImportStarted(
          Boolean(
            effectiveProgress &&
            (effectiveProgress.status === 'importing' ||
              effectiveProgress.status === 'classifying' ||
              effectiveProgress.status === 'learning'),
          ),
        );

        if (latestConfig?.email_address) {
          setEmailConfigId(latestConfig.id ?? null);
          const email = latestConfig.email_address;
          setConnectedEmail(email);
          onEmailConnected(email);

          if (toastedEmailRef.current !== email && !isInitialLoad) {
            toastedEmailRef.current = email;
            toast.success(`Connected to ${email}`);
          }
        } else {
          setEmailConfigId(null);
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
      const [progressResult, pipelineResult] = await Promise.all([
        supabase
          .from('email_import_progress')
          .select('*')
          .eq('workspace_id', workspaceId)
          .maybeSingle(),
        supabase
          .from('pipeline_runs')
          .select('id, state, started_at, completed_at, last_error, metrics')
          .eq('workspace_id', workspaceId)
          .eq('channel', 'email')
          .eq('state', 'running')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (progressResult.error) return;

      const derivedState = deriveEmailImportState({
        progress: !progressResult.error
          ? (progressResult.data as EmailImportProgressRow | null)
          : null,
        activeRun: !pipelineResult.error
          ? (pipelineResult.data as EmailPipelineRunStatus | null)
          : null,
      });
      const effectiveProgress = mapDerivedStateToMakeProgress(derivedState);

      if (!effectiveProgress) return;

      setProgress(effectiveProgress);

      // Stop polling if complete or error
      if (effectiveProgress.status === 'complete' || effectiveProgress.status === 'error') {
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
        toast.error(getFunctionErrorMessage(error, data, 'Failed to start email connection'));
        setIsConnecting(false);
        return;
      }

      if (!data?.authUrl) {
        logger.error('No auth URL returned');
        toast.error(getFunctionErrorMessage(null, data, 'Failed to get authentication URL'));
        setIsConnecting(false);
        return;
      }

      // Always use same-tab redirect for seamless experience
      window.location.href = data.authUrl;
    } catch (error) {
      logger.error('Error starting OAuth', error);
      toast.error(getFunctionErrorMessage(error, null, 'Failed to start email connection'));
      setIsConnecting(false);
    }
  };

  const startImport = async () => {
    if (!workspaceId || importStarted || isPreview) return;

    setImportStarted(true);

    try {
      let configId = emailConfigId;

      if (!configId) {
        const { data: latestConfigs, error: lookupError } = await supabase
          .from('email_provider_configs')
          .select('id')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(1);

        if (lookupError) {
          throw lookupError;
        }

        configId = latestConfigs?.[0]?.id ?? null;
      }

      if (!configId) {
        throw new Error('No email connection found for this workspace');
      }

      const { data, error: fnError } = await supabase.functions.invoke('start-email-import', {
        body: { workspace_id: workspaceId, config_id: configId, mode: 'onboarding' },
      });

      if (fnError || data?.ok === false || data?.success === false) {
        logger.error('Edge function error', fnError);
        throw new Error(
          await getFunctionErrorMessageAsync(fnError, data, 'Failed to queue email import'),
        );
      }

      const isAlreadyRunning = Boolean(data?.already_running);
      toast.success(
        isAlreadyRunning
          ? 'Email import is already running. BizzyBee will keep learning in the background.'
          : 'Email import queued. BizzyBee will keep learning in the background.',
      );
      onNext();
    } catch (error) {
      logger.error('Error starting email import', error);
      toast.error(await getFunctionErrorMessageAsync(error, null, 'Failed to queue email import'));
      setImportStarted(false);
    }
  };

  const handleDisconnect = async () => {
    if (isPreview) return;

    try {
      const { data: existingConfigs, error: lookupError } = await supabase
        .from('email_provider_configs')
        .select('id, provider')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (lookupError) {
        throw lookupError;
      }

      const existingConfig = existingConfigs?.[0];
      if (existingConfig?.id) {
        const { data, error } = await supabase.functions.invoke('aurinko-reset-account', {
          body: {
            workspaceId,
            configId: existingConfig.id,
          },
        });

        if (error || data?.success === false || data?.ok === false) {
          throw new Error(getFunctionErrorMessage(error, data, 'Failed to disconnect email'));
        }

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
      setEmailConfigId(null);
      onEmailConnected('');
    } catch (error) {
      logger.error('Failed to disconnect email connection', error);
      toast.error(getFunctionErrorMessage(error, null, 'Failed to disconnect'));
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
      toast.error(getFunctionErrorMessage(error, null, 'Failed to retry import'));
    }
  };

  const handleContinue = () => {
    if (!connectedEmail) return;

    // IMAP connect now seeds current_phase='queued' (see aurinko-create-imap-account).
    // If we don't treat 'queued' as kickable, new IMAP connections would silently
    // never start their import. start-email-import dedupes so this is safe to call
    // even if a run is already queued.
    if (shouldKickEmailImport(progress?.status)) {
      void startImport();
    }

    onNext();
  };

  // Loading state
  if (initialLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CardTitle className="text-xl">Connect Your Email</CardTitle>
          <CardDescription className="mt-2">
            {aiInboxEnabled
              ? 'BizzyBee will learn from your inbox to handle emails just like you would.'
              : 'BizzyBee will sync this inbox into one place. AI learning unlocks on Starter and above.'}
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
          {aiInboxEnabled
            ? 'BizzyBee will learn from your inbox to handle emails just like you would.'
            : 'BizzyBee will sync this inbox into one place. AI learning unlocks on Starter and above.'}
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

          {progress && getConnectionProgressCopy(progress) && (
            <div
              className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${getConnectionProgressCopy(progress)!.className}`}
            >
              {(() => {
                const copy = getConnectionProgressCopy(progress)!;
                const Icon = copy.icon;
                return (
                  <>
                    <div className="shrink-0 pt-0.5">
                      <Icon
                        className={`h-4 w-4 ${progress.status === 'queued' ? 'animate-pulse' : progress.status === 'importing' ? 'animate-spin' : ''}`}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium">{copy.title}</p>
                      <p className="text-xs opacity-80">{copy.description}</p>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          <div className="space-y-3">
            <Button onClick={handleContinue} className="w-full gap-2">
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
              {isNewEmailsOnlyPlan
                ? 'How should we start your inbox?'
                : aiInboxEnabled
                  ? 'How much email history should we learn from?'
                  : 'How should we start your inbox?'}
            </Label>
            <p className="text-sm text-muted-foreground">{importLimitCopy}</p>
            {isNewEmailsOnlyPlan ? (
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {currentPlan.name} starts with new emails only
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      This keeps setup light on day one. Historical inbox learning unlocks on
                      Starter and above once you want BizzyBee to train on older conversations.
                    </p>
                  </div>
                  <div className="rounded-full border border-primary/20 bg-background px-3 py-1 text-xs font-medium text-primary">
                    {currentPlan.name} plan
                  </div>
                </div>
              </div>
            ) : null}
            <RadioGroup
              value={importMode}
              onValueChange={(v) => setImportMode(v as ImportMode)}
              className="space-y-2"
            >
              {allowedImportModes.map((mode) => (
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
                  className="relative flex h-auto min-h-[112px] flex-col items-center gap-2 px-3 py-4 text-center whitespace-normal"
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
                    <span className="max-w-full break-words px-1 text-center text-[10px] leading-tight text-muted-foreground whitespace-normal">
                      {provider.subtitle}
                    </span>
                  )}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Button variant="outline" onClick={onNext} className="w-full">
              Skip email for now
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              You can finish the rest of onboarding now and connect the inbox later from settings.
            </p>
            <Button variant="outline" onClick={onBack} className="w-full">
              Back
            </Button>
          </div>
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
