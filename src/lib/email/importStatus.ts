export type EmailImportPhase =
  | 'idle'
  | 'queued'
  | 'fetching_inbox'
  | 'fetching_sent'
  | 'classifying'
  | 'learning'
  | 'complete'
  | 'rate_limited'
  | 'error';

export interface EmailImportProgressRow {
  current_phase?: string | null;
  current_import_folder?: string | null;
  emails_received?: number | null;
  emails_classified?: number | null;
  estimated_total_emails?: number | null;
  inbox_email_count?: number | null;
  sent_email_count?: number | null;
  last_error?: string | null;
  voice_profile_complete?: boolean | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface EmailProviderConfigStatus {
  sync_status?: string | null;
  sync_stage?: string | null;
  sync_progress?: number | null;
  inbound_emails_found?: number | null;
  outbound_emails_found?: number | null;
  inbound_total?: number | null;
  outbound_total?: number | null;
  sync_error?: string | null;
  sync_started_at?: string | null;
  sync_completed_at?: string | null;
}

export interface EmailPipelineRunStatus {
  state?: string | null;
  last_error?: string | null;
  started_at?: string | null;
  metrics?: Record<string, unknown> | null;
}

export interface DerivedEmailImportState {
  phase: EmailImportPhase;
  errorMessage: string | null;
  inboxCount: number;
  sentCount: number;
  emailsReceived: number;
  emailsClassified: number;
  estimatedTotal: number;
  syncProgress: number;
}

function normalizeToken(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function toWholeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function isRateLimitError(err: string | null | undefined): boolean {
  if (!err) return false;
  const s = err.toLowerCase();
  return (
    s.includes('429') ||
    s.includes('toomanyrequests') ||
    s.includes('limit exceeded') ||
    s.includes('rate limit')
  );
}

export function deriveEmailImportState(params: {
  progress?: EmailImportProgressRow | null;
  config?: EmailProviderConfigStatus | null;
  activeRun?: EmailPipelineRunStatus | null;
}): DerivedEmailImportState {
  const progress = params.progress ?? null;
  const config = params.config ?? null;
  const activeRun = params.activeRun ?? null;

  const errorMessage = progress?.last_error || config?.sync_error || activeRun?.last_error || null;

  const inboxCount = Math.max(
    toWholeNumber(progress?.inbox_email_count),
    toWholeNumber(config?.inbound_emails_found),
  );
  const sentCount = Math.max(
    toWholeNumber(progress?.sent_email_count),
    toWholeNumber(config?.outbound_emails_found),
  );
  const emailsReceived = Math.max(
    toWholeNumber(progress?.emails_received),
    inboxCount + sentCount,
    toWholeNumber(activeRun?.metrics?.fetched_so_far),
  );
  const emailsClassified = toWholeNumber(progress?.emails_classified);
  const estimatedTotal = Math.max(
    toWholeNumber(progress?.estimated_total_emails),
    toWholeNumber(config?.inbound_total) + toWholeNumber(config?.outbound_total),
  );
  const syncProgress = toWholeNumber(config?.sync_progress);

  if (isRateLimitError(errorMessage)) {
    return {
      phase: 'rate_limited',
      errorMessage,
      inboxCount,
      sentCount,
      emailsReceived,
      emailsClassified,
      estimatedTotal,
      syncProgress,
    };
  }

  const progressPhase = normalizeToken(progress?.current_phase);
  const currentFolder = normalizeToken(progress?.current_import_folder);
  const configStatus = normalizeToken(config?.sync_status);
  const configStage = normalizeToken(config?.sync_stage);
  const hasActiveRun = normalizeToken(activeRun?.state) === 'running';

  let phase: EmailImportPhase = 'idle';

  if (
    progressPhase === 'error' ||
    progressPhase === 'failed' ||
    progressPhase === 'blocked' ||
    configStatus === 'failed' ||
    configStatus === 'error'
  ) {
    phase = 'error';
  } else if (
    progress?.voice_profile_complete ||
    progressPhase === 'complete' ||
    progressPhase === 'completed' ||
    progressPhase === 'done' ||
    Boolean(progress?.completed_at) ||
    configStatus === 'completed' ||
    Boolean(config?.sync_completed_at)
  ) {
    phase = 'complete';
  } else if (progressPhase === 'learning') {
    phase = 'learning';
  } else if (progressPhase === 'classifying' || progressPhase === 'converting') {
    phase = 'classifying';
  } else if (progressPhase === 'importing') {
    phase =
      currentFolder.includes('sent') ||
      currentFolder.includes('outbound') ||
      sentCount > 0
        ? 'fetching_sent'
        : 'fetching_inbox';
  } else if (
    progressPhase === 'queued' ||
    progressPhase === 'pending' ||
    progressPhase === 'starting' ||
    progressPhase === 'connecting'
  ) {
    phase = hasActiveRun || emailsReceived > 0 ? 'fetching_inbox' : 'queued';
  } else if (configStage.includes('classif')) {
    phase = 'classifying';
  } else if (configStage.includes('learn')) {
    phase = 'learning';
  } else if (configStage.includes('sent') || configStage.includes('outbound')) {
    phase = 'fetching_sent';
  } else if (configStatus === 'syncing' || hasActiveRun || Boolean(config?.sync_started_at)) {
    phase = emailsReceived > 0 || sentCount > 0 ? 'fetching_sent' : 'fetching_inbox';
  } else if (
    configStatus === 'pending' ||
    configStatus === 'queued' ||
    configStage.includes('queue')
  ) {
    phase = 'queued';
  }

  return {
    phase,
    errorMessage,
    inboxCount,
    sentCount,
    emailsReceived,
    emailsClassified,
    estimatedTotal,
    syncProgress,
  };
}

export function getEmailImportProgressPercent(state: DerivedEmailImportState): number {
  if (state.phase === 'complete') return 100;
  if (state.phase === 'error') return 0;
  if (state.phase === 'rate_limited') return state.syncProgress;
  if (state.phase === 'queued') return state.syncProgress;

  if (state.phase === 'fetching_inbox') {
    const denominator = Math.max(state.estimatedTotal, state.inboxCount, 1);
    return Math.min(55, Math.round((state.inboxCount / denominator) * 55));
  }

  if (state.phase === 'fetching_sent') {
    const denominator = Math.max(state.estimatedTotal, state.emailsReceived, 1);
    const imported = state.inboxCount + state.sentCount;
    return Math.min(70, 35 + Math.round((imported / denominator) * 35));
  }

  if (state.phase === 'classifying') {
    if (state.emailsReceived > 0) {
      return Math.min(
        94,
        70 +
          Math.round(
            (Math.min(state.emailsClassified, state.emailsReceived) / state.emailsReceived) * 24,
          ),
      );
    }
    return 70;
  }

  if (state.phase === 'learning') return 95;

  return 0;
}

export function getEmailImportStatusMessage(state: DerivedEmailImportState): string {
  switch (state.phase) {
    case 'queued':
      return 'Email import is queued. Waiting for BizzyBee to start the worker.';
    case 'fetching_inbox':
      return state.inboxCount > 0
        ? `Importing inbox... ${state.inboxCount.toLocaleString()} received`
        : 'Importing inbox...';
    case 'fetching_sent':
      return state.sentCount > 0
        ? `Importing sent emails... ${state.sentCount.toLocaleString()} received`
        : 'Importing sent emails...';
    case 'classifying':
      return state.emailsReceived > 0
        ? `Classifying emails... ${state.emailsClassified.toLocaleString()} of ${state.emailsReceived.toLocaleString()}`
        : 'Classifying emails...';
    case 'learning':
      return 'Learning your writing style...';
    case 'rate_limited':
      return 'Email provider rate limit hit. Pausing briefly and retrying automatically.';
    case 'complete':
      return `Import complete! ${state.inboxCount.toLocaleString()} inbox, ${state.sentCount.toLocaleString()} sent`;
    case 'error':
      return state.errorMessage || 'Import failed';
    default:
      return '';
  }
}
