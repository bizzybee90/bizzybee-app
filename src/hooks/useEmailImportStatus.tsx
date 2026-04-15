import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface EmailProviderConfig {
  id: string;
  sync_status: string | null;
  sync_stage: string | null;
  sync_progress: number | null;
  inbound_emails_found: number | null;
  outbound_emails_found: number | null;
  inbound_total: number | null;
  outbound_total: number | null;
  sync_error: string | null;
  sync_started_at: string | null;
  sync_completed_at: string | null;
}

interface EmailProviderConfig {
  id: string;
  sync_status: string | null;
  sync_stage: string | null;
  sync_progress: number | null;
  inbound_emails_found: number | null;
  outbound_emails_found: number | null;
  inbound_total: number | null;
  outbound_total: number | null;
  sync_error: string | null;
  sync_started_at: string | null;
  sync_completed_at: string | null;
}

interface UseEmailImportStatusResult {
  isImporting: boolean;
  progress: number;
  statusMessage: string;
  phase: 'idle' | 'fetching_inbox' | 'fetching_sent' | 'complete' | 'rate_limited' | 'error';
  inboxCount: number;
  inboxTotal: number;
  sentCount: number;
  sentTotal: number;
  hasSentEmails: boolean;
  config: EmailProviderConfig | null;
}

function isRateLimitError(err: string | null | undefined): boolean {
  if (!err) return false;
  const s = err.toLowerCase();
  return (
    s.includes('429') ||
    s.includes('toomanyrequests') ||
    s.includes('limit exceeded') ||
    s.includes('rate limit')
  );
}

export function useEmailImportStatus(workspaceId: string | null): UseEmailImportStatusResult {
  const { data: config } = useQuery({
    queryKey: ['email-provider-config', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return null;

      const { data, error } = await supabase
        .from('email_provider_configs')
        .select(
          'id, sync_status, sync_stage, sync_progress, inbound_emails_found, outbound_emails_found, inbound_total, outbound_total, sync_error, sync_started_at, sync_completed_at',
        )
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        console.error('Error fetching email config:', error);
        return null;
      }

      return (data?.[0] as EmailProviderConfig | undefined) ?? null;
    },
    enabled: !!workspaceId,
    refetchInterval: (query) => {
      const data = query.state.data as EmailProviderConfig | null | undefined;
      // Poll every 10s while syncing; also poll on rate limit so UI can recover automatically.
      if (data && (data.sync_status === 'syncing' || isRateLimitError(data.sync_error))) {
        return 10000;
      }
      return false;
    },
    staleTime: 2000,
  });

  const getPhase = (config: EmailProviderConfig | null): UseEmailImportStatusResult['phase'] => {
    if (!config) return 'idle';

    if (isRateLimitError(config.sync_error)) return 'rate_limited';
    if (config.sync_error) return 'error';

    if (config.sync_status === 'completed' || config.sync_completed_at) return 'complete';
    if (config.sync_status !== 'syncing') return 'idle';

    // Determine stage based on sync_stage field
    const stage = config.sync_stage?.toLowerCase() || '';
    if (stage.includes('sent') || stage.includes('outbound')) return 'fetching_sent';
    return 'fetching_inbox';
  };

  const calculateProgress = (
    config: EmailProviderConfig | null,
    phase: UseEmailImportStatusResult['phase'],
  ): number => {
    if (!config) return 0;
    if (phase === 'complete') return 100;
    if (phase === 'error') return 0;
    if (phase === 'idle') return 0;

    // Keep last known progress for rate limited state.
    if (phase === 'rate_limited') return Math.max(0, Math.min(100, config.sync_progress || 0));

    const inboxFound = config.inbound_emails_found || 0;
    const inboxTotal = config.inbound_total || inboxFound || 1;
    const sentFound = config.outbound_emails_found || 0;
    const sentTotal = config.outbound_total || 0;

    if (phase === 'fetching_inbox') {
      // Inbox is 0-50%
      const inboxProgress = inboxTotal > 0 ? inboxFound / inboxTotal : 0;
      return Math.min(50, Math.floor(inboxProgress * 50));
    }

    if (phase === 'fetching_sent') {
      // Sent is 50-100%
      if (sentTotal === 0) return 50;
      const sentProgress = sentTotal > 0 ? sentFound / sentTotal : 0;
      return 50 + Math.min(50, Math.floor(sentProgress * 50));
    }

    return config.sync_progress || 0;
  };

  const getStatusMessage = (
    config: EmailProviderConfig | null,
    phase: UseEmailImportStatusResult['phase'],
  ): string => {
    if (!config) return '';

    const inboxFound = config.inbound_emails_found || 0;
    const inboxTotal = config.inbound_total || 0;
    const sentFound = config.outbound_emails_found || 0;
    const sentTotal = config.outbound_total || 0;

    switch (phase) {
      case 'fetching_inbox':
        if (inboxTotal > 0) {
          return `Importing inbox... ${inboxFound.toLocaleString()} / ${inboxTotal.toLocaleString()}`;
        }
        return `Importing inbox... ${inboxFound.toLocaleString()} found`;
      case 'fetching_sent':
        if (sentTotal > 0) {
          return `Importing sent emails... ${sentFound.toLocaleString()} / ${sentTotal.toLocaleString()}`;
        }
        return `Importing sent emails... ${sentFound.toLocaleString()} found`;
      case 'rate_limited':
        return 'Email provider rate limit hit. Pausing briefly and retrying automatically.';
      case 'complete':
        return `Import complete! ${inboxFound.toLocaleString()} inbox, ${sentFound.toLocaleString()} sent`;
      case 'error':
        return config.sync_error || 'Import failed';
      default:
        return '';
    }
  };

  const phase = getPhase(config);
  const isImporting = phase === 'fetching_inbox' || phase === 'fetching_sent';

  return {
    isImporting,
    config,
    progress: calculateProgress(config, phase),
    statusMessage: getStatusMessage(config, phase),
    phase,
    inboxCount: config?.inbound_emails_found || 0,
    inboxTotal: config?.inbound_total || 0,
    sentCount: config?.outbound_emails_found || 0,
    sentTotal: config?.outbound_total || 0,
    hasSentEmails: (config?.outbound_emails_found || 0) > 0,
  };
}
