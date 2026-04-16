import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import {
  CheckCircle2,
  Loader2,
  Search,
  FileCheck,
  Sparkles,
  AlertCircle,
  ChevronRight,
  FileSearch,
  Download,
  Plus,
  Globe,
  Play,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useOnboardingProgress } from '@/hooks/useOnboardingProgress';
import { useOnboardingDiscoveryAutoTrigger } from '@/hooks/useOnboardingDiscoveryAutoTrigger';
import { isMailboxWarmupError } from '@/lib/email/importStatus';
import {
  deleteOnboardingCompetitor,
  listOnboardingCompetitors,
  toggleOnboardingCompetitorSelection,
} from '@/lib/onboarding/competitors';

interface ProgressScreenProps {
  workspaceId: string;
  connectedEmail?: string | null;
  onNext: () => void;
  onBack: () => void;
}

interface TrackState {
  status: string;
  counts: { label: string; value: number }[];
  error?: string | null;
  note?: string | null;
  currentCompetitor?: string | null;
  current?: number;
  total?: number;
  actualPercent?: number;
}

// Discovery phases (Workflow 1)
const DISCOVERY_PHASES = [
  { key: 'pending', label: 'Waiting to start', icon: Loader2 },
  { key: 'starting', label: 'Starting discovery...', icon: Search },
  { key: 'discovering', label: 'Searching for competitors...', icon: Search },
  { key: 'search_complete', label: 'Verifying results...', icon: FileCheck },
  { key: 'verification_complete', label: 'Checking domains...', icon: FileCheck },
  { key: 'health_check_complete', label: 'Finalising competitors...', icon: FileCheck },
  { key: 'complete', label: 'Complete', icon: CheckCircle2 },
  { key: 'failed', label: 'Failed', icon: AlertCircle },
];

// FAQ scrape phases (Workflow 2)
const SCRAPE_PHASES = [
  { key: 'waiting', label: 'Waiting for discovery...', icon: Loader2 },
  { key: 'validating', label: 'Validating competitors...', icon: Search },
  { key: 'review_ready', label: 'Ready for review', icon: CheckCircle2 },
  { key: 'pending', label: 'Queued for scraping', icon: Loader2 },
  { key: 'scraping', label: 'Scraping competitor websites...', icon: Search },
  { key: 'extracting', label: 'Extracting FAQs...', icon: Sparkles },
  { key: 'scrape_processing', label: 'Processing FAQs...', icon: Sparkles },
  { key: 'complete', label: 'Complete', icon: CheckCircle2 },
  { key: 'failed', label: 'Failed', icon: AlertCircle },
];

const EMAIL_IMPORT_PHASES = [
  { key: 'pending', label: 'Waiting to start', icon: Loader2 },
  { key: 'importing', label: 'Importing emails...', icon: Download },
  { key: 'complete', label: 'Complete', icon: CheckCircle2 },
  { key: 'failed', label: 'Failed', icon: AlertCircle },
];

const EMAIL_PHASES = [
  { key: 'pending', label: 'Waiting for import...', icon: Loader2 },
  { key: 'dispatched', label: 'Starting classification...', icon: FileCheck },
  { key: 'classifying', label: 'Classifying emails...', icon: FileCheck },
  { key: 'classification_complete', label: 'Complete', icon: CheckCircle2 },
  { key: 'complete', label: 'Complete', icon: CheckCircle2 },
  { key: 'failed', label: 'Failed', icon: AlertCircle },
];

const WORKER_NUDGE_COOLDOWN_MS = 5_000;
const WORKER_NUDGE_HEARTBEAT_MS = 5_000;

function getPhaseIndex(phases: typeof DISCOVERY_PHASES, currentStatus: string): number {
  const index = phases.findIndex((p) => p.key === currentStatus);
  return index >= 0 ? index : 0;
}

function TrackProgress({
  title,
  phases,
  currentStatus,
  counts,
  error,
  note,
  currentCompetitor,
  current,
  total,
  actualPercent,
}: {
  title: string;
  phases: typeof DISCOVERY_PHASES;
  currentStatus: string;
  counts?: { label: string; value: number }[];
  error?: string | null;
  note?: string | null;
  currentCompetitor?: string | null;
  current?: number;
  total?: number;
  actualPercent?: number;
}) {
  const currentIndex = getPhaseIndex(phases, currentStatus);
  const isComplete = currentStatus === 'complete' || currentStatus === 'classification_complete';
  const isFailed = currentStatus === 'failed';
  const isWaiting = currentStatus === 'waiting';
  const totalPhases = phases.length - 1; // exclude 'failed'

  let progressPercent: number;
  if (actualPercent !== undefined) {
    progressPercent = isComplete ? 100 : actualPercent;
  } else if (currentStatus === 'scraping' && current && total && total > 0) {
    const processingProgress = (current / total) * 60;
    progressPercent = 20 + processingProgress;
  } else {
    progressPercent = isComplete ? 100 : isWaiting ? 0 : (currentIndex / (totalPhases - 1)) * 100;
  }

  const CurrentIcon = phases[currentIndex]?.icon || Loader2;
  const currentLabel = phases[currentIndex]?.label || 'Processing...';

  return (
    <div
      className={cn(
        'p-4 rounded-lg border',
        isComplete && 'border-success/30 bg-success/5',
        isFailed && 'border-destructive/30 bg-destructive/5',
        !isComplete && !isFailed && 'border-border bg-muted/30',
      )}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            'h-10 w-10 rounded-full flex items-center justify-center',
            isComplete && 'bg-success/10 text-success',
            isFailed && 'bg-destructive/10 text-destructive',
            isWaiting && 'bg-muted text-muted-foreground',
            !isComplete && !isFailed && !isWaiting && 'bg-primary/10 text-primary',
          )}
        >
          {isComplete ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : isFailed ? (
            <AlertCircle className="h-5 w-5" />
          ) : (
            <CurrentIcon
              className={cn('h-5 w-5', !isWaiting && currentStatus !== 'pending' && 'animate-spin')}
            />
          )}
        </div>
        <div className="flex-1">
          <h3 className="font-medium">{title}</h3>
          <p
            className={cn(
              'text-sm',
              isComplete && 'text-success',
              isFailed && 'text-destructive',
              !isComplete && !isFailed && 'text-muted-foreground',
            )}
          >
            {isFailed ? error || 'An error occurred' : currentLabel}
          </p>
          {!isFailed && note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
          {(currentStatus === 'scraping' || currentStatus === 'extracting') &&
            currentCompetitor &&
            current &&
            total && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Competitor {current} of {total}:{' '}
                <span className="font-medium">{currentCompetitor}</span>
              </p>
            )}
        </div>
      </div>

      <Progress
        value={progressPercent}
        className={cn(
          'h-2 mb-2',
          isComplete && '[&>div]:bg-success',
          isFailed && '[&>div]:bg-destructive',
        )}
      />

      {counts && counts.length > 0 && (
        <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
          {counts.map((count, i) => (
            <span key={i}>
              <span className="font-medium text-foreground">{count.value}</span> {count.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

type OnboardingProgressTrack = {
  run_id: string | null;
  agent_status: string;
  current_step: string | null;
  counts: Record<string, number>;
  latest_error?: string | null;
  [key: string]: unknown;
};

function normalizeStepToken(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim().toLowerCase();
  const colonIndex = trimmed.indexOf(':');
  return colonIndex >= 0 ? trimmed.slice(colonIndex + 1) : trimmed;
}

function mapDiscoveryStatus(track: OnboardingProgressTrack | undefined): string {
  if (!track) return 'pending';
  if (track.agent_status === 'failed' || track.latest_error) return 'failed';
  if (track.agent_status === 'succeeded' || track.agent_status === 'completed') return 'complete';
  if (track.agent_status === 'queued') return 'pending';
  const discoveredCount = Number(track.counts?.sites_discovered || 0);
  const approvedCount = Number(track.counts?.sites_approved || 0);

  if (approvedCount > 0) return 'complete';

  switch (normalizeStepToken(track.current_step)) {
    case 'acquire':
      return discoveredCount > 0 ? 'search_complete' : 'discovering';
    case 'qualify':
      return 'verification_complete';
    case 'persist':
      return 'health_check_complete';
    default:
      return discoveredCount > 0 ? 'search_complete' : 'starting';
  }
}

function mapFaqStatus(
  discoveryTrack: OnboardingProgressTrack | undefined,
  faqTrack: OnboardingProgressTrack | undefined,
  competitorFaqCount: number,
): string {
  const faqRunActive =
    Boolean(faqTrack?.run_id) &&
    !['failed', 'succeeded', 'completed'].includes(faqTrack?.agent_status || '');

  if (!faqRunActive && (competitorFaqCount > 0 || Number(faqTrack?.counts?.faqs_added || 0) > 0)) {
    return 'complete';
  }
  if (faqTrack?.agent_status === 'failed' || faqTrack?.latest_error) return 'failed';
  if (faqTrack?.agent_status === 'succeeded' || faqTrack?.agent_status === 'completed')
    return 'complete';
  if (faqTrack?.agent_status === 'queued') return 'pending';

  switch (normalizeStepToken(faqTrack?.current_step)) {
    case 'load_context':
    case 'context_loaded':
      return 'validating';
    case 'fetch_pages':
    case 'fetch_started':
      return 'scraping';
    case 'fetch_complete':
    case 'generate_candidates':
    case 'candidates_generated':
      return 'extracting';
    case 'dedupe':
    case 'quality_review_complete':
    case 'finalize':
    case 'finalized':
    case 'persist':
      return 'scrape_processing';
    default:
      break;
  }

  if (mapDiscoveryStatus(discoveryTrack) === 'complete') {
    return faqTrack?.run_id ? 'pending' : 'review_ready';
  }

  return 'waiting';
}

function mapEmailImportStatus(track: OnboardingProgressTrack | undefined): string {
  if (!track) return 'pending';
  if (isMailboxWarmupError(track.latest_error as string | null | undefined)) return 'importing';
  if (track.latest_error && (track.counts?.emails_received || 0) === 0) return 'failed';
  if ((track.counts?.emails_received || 0) > 0) return 'complete';

  switch (track.current_step) {
    case 'importing':
      return 'importing';
    case 'classifying':
    case 'learning':
    case 'converting':
    case 'complete':
      return 'complete';
    default:
      return track.agent_status === 'running' ? 'importing' : 'pending';
  }
}

function mapEmailClassificationStatus(track: OnboardingProgressTrack | undefined): string {
  if (!track) return 'pending';
  if (isMailboxWarmupError(track.latest_error as string | null | undefined)) return 'pending';

  const received = track.counts?.emails_received || 0;
  const classified = track.counts?.emails_classified || 0;

  if (received > 0 && classified >= received) return 'complete';
  if (track.latest_error && classified === 0) return 'failed';
  if (classified > 0) return 'classifying';

  switch (track.current_step) {
    case 'classifying':
    case 'learning':
    case 'converting':
      return 'classifying';
    case 'complete':
      return 'complete';
    default:
      return 'pending';
  }
}

interface CompetitorItem {
  id: string;
  business_name: string | null;
  domain: string;
  url: string;
  is_selected: boolean;
  discovery_source?: string | null;
  validation_status?: string | null;
  temporary?: boolean;
}

function dedupeCompetitorItems(items: CompetitorItem[]): CompetitorItem[] {
  const byStableKey = new Map<string, CompetitorItem>();

  for (const item of items) {
    const stableKey = item.temporary
      ? `temp:${item.domain || item.url || item.id}`
      : item.id || item.domain || item.url;
    const existing = byStableKey.get(stableKey);

    if (!existing) {
      byStableKey.set(stableKey, item);
      continue;
    }

    const existingIsTemporary = existing.temporary === true;
    const nextIsTemporary = item.temporary === true;

    if (existingIsTemporary && !nextIsTemporary) {
      byStableKey.set(stableKey, item);
      continue;
    }

    const existingSelected = existing.is_selected === true;
    const nextSelected = item.is_selected === true;

    if (!existingSelected && nextSelected) {
      byStableKey.set(stableKey, item);
    }
  }

  return Array.from(byStableKey.values());
}

function InlineCompetitorReview({
  workspaceId,
  jobId,
  runId,
  onStartAnalysis,
  autoStarted = false,
  scrapeComplete = false,
  canStartAnalysis = true,
  analysisStatusMessage,
  onCompetitorSummaryChange,
}: {
  workspaceId: string;
  jobId?: string | null;
  runId?: string | null;
  onStartAnalysis: () => void;
  autoStarted?: boolean;
  scrapeComplete?: boolean;
  canStartAnalysis?: boolean;
  analysisStatusMessage?: string;
  onCompetitorSummaryChange?: (summary: {
    loadedCount: number;
    selectedCount: number;
    persistedLoadedCount: number;
    persistedSelectedCount: number;
    temporaryCount: number;
  }) => void;
}) {
  const [competitors, setCompetitors] = useState<CompetitorItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [manualUrl, setManualUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isRemovingId, setIsRemovingId] = useState<string | null>(null);
  const loadRequestIdRef = useRef(0);

  const loadCompetitors = useCallback(
    async (showLoading: boolean) => {
      if (!jobId) {
        setCompetitors([]);
        setIsLoading(false);
        return;
      }

      const requestId = ++loadRequestIdRef.current;
      if (showLoading) {
        setIsLoading(true);
      }

      try {
        const response = await listOnboardingCompetitors(workspaceId, jobId, runId);
        if (loadRequestIdRef.current !== requestId) return;
        setCompetitors(
          dedupeCompetitorItems(
            (response.competitors || []).map((c) => ({
              id: c.id,
              business_name: c.business_name,
              domain: c.domain,
              url: c.url,
              is_selected: c.is_selected ?? true,
              discovery_source: c.discovery_source,
              validation_status: c.validation_status,
              temporary: c.temporary === true,
            })),
          ),
        );
      } catch (error) {
        if (loadRequestIdRef.current !== requestId) return;
        logger.error('Failed to load discovered competitors', error);
        setCompetitors([]);
      }
      if (loadRequestIdRef.current !== requestId) return;
      setIsLoading(false);
    },
    [jobId, runId, workspaceId],
  );

  useEffect(() => {
    loadRequestIdRef.current += 1;
    setCompetitors([]);
    setIsLoading(Boolean(jobId));
    setManualUrl('');
    setIsRemovingId(null);
  }, [jobId, runId]);

  useEffect(() => {
    let active = true;

    const fetchCompetitors = async (showLoading: boolean) => {
      await loadCompetitors(showLoading);
      if (!active) return;
    };

    void fetchCompetitors(true);

    if (scrapeComplete) {
      return () => {
        active = false;
      };
    }

    const interval = window.setInterval(() => {
      void fetchCompetitors(false);
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [loadCompetitors, scrapeComplete]);

  const selectedCount = competitors.filter((c) => c.is_selected).length;
  const persistedLoadedCount = competitors.filter((c) => !c.temporary).length;
  const persistedSelectedCount = competitors.filter((c) => c.is_selected && !c.temporary).length;
  const temporaryCount = competitors.filter((c) => c.temporary).length;
  const allTemporary = competitors.length > 0 && persistedLoadedCount === 0;
  const effectiveSelectedCount =
    persistedSelectedCount > 0 ? persistedSelectedCount : selectedCount;

  useEffect(() => {
    onCompetitorSummaryChange?.({
      loadedCount: competitors.length,
      selectedCount,
      persistedLoadedCount,
      persistedSelectedCount,
      temporaryCount,
    });
  }, [
    competitors.length,
    onCompetitorSummaryChange,
    persistedLoadedCount,
    persistedSelectedCount,
    selectedCount,
    temporaryCount,
  ]);

  const toggleSelection = async (id: string, value: boolean) => {
    const target = competitors.find((c) => c.id === id);
    if (target?.temporary) {
      toast.message('Still preparing this competitor', {
        description:
          'BizzyBee has discovered the site, but it is still turning it into a reviewable competitor row.',
      });
      return;
    }
    setCompetitors((prev) => prev.map((c) => (c.id === id ? { ...c, is_selected: value } : c)));
    try {
      await toggleOnboardingCompetitorSelection(workspaceId, id, value);
    } catch (error) {
      logger.error('Failed to update competitor selection', error);
      setCompetitors((prev) => prev.map((c) => (c.id === id ? { ...c, is_selected: !value } : c)));
      toast.error('Failed to update selection');
    }
  };

  const addManualUrl = async () => {
    if (!manualUrl.trim()) return;
    setIsAdding(true);
    try {
      const { data, error } = await supabase.functions.invoke('add-manual-competitor', {
        body: {
          workspace_id: workspaceId,
          job_id: jobId,
          url: manualUrl.trim(),
        },
      });

      if (error || data?.ok === false || !data?.competitor) {
        throw error || new Error(data?.error || 'Failed to add competitor');
      }

      const competitor = data.competitor as CompetitorItem;
      await loadCompetitors(false);
      setManualUrl('');
      toast.success(
        data?.reused ? 'Competitor already existed and has been loaded' : 'Competitor added',
      );
    } catch (error) {
      logger.error('Failed to add manual competitor', error);
      toast.error(
        error instanceof Error && error.message ? error.message : 'Failed to add competitor',
      );
    } finally {
      setIsAdding(false);
    }
  };

  const removeCompetitor = async (id: string) => {
    const existing = competitors.find((c) => c.id === id);
    if (!existing) return;

    setIsRemovingId(id);
    setCompetitors((prev) => prev.filter((c) => c.id !== id));

    try {
      await deleteOnboardingCompetitor(workspaceId, id);
      toast.success('Competitor removed');
    } catch (error) {
      logger.error('Failed to remove competitor', error);
      setCompetitors((prev) => [existing, ...prev]);
      toast.error('Failed to remove');
    }
    setIsRemovingId(null);
  };

  const handleStart = async () => {
    if (effectiveSelectedCount === 0) {
      toast.error(
        allTemporary
          ? 'No discovered competitors are selected yet'
          : 'Select at least one competitor',
      );
      return;
    }
    setIsStarting(true);
    try {
      const selectedCompetitorIds = competitors
        .filter((competitor) => competitor.is_selected)
        .filter((competitor) => !competitor.temporary)
        .map((competitor) => competitor.id);

      const { data, error } = await supabase.functions.invoke('start-faq-generation', {
        body: {
          workspace_id: workspaceId,
          selected_competitor_ids: selectedCompetitorIds,
          target_count: effectiveSelectedCount,
          trigger_source: 'onboarding_progress_inline_review',
          discovery_job_id: jobId,
          discovery_run_id: runId,
        },
      });
      if (error) throw error;
      const analysedCount = Number(
        data?.sitesCountAnalysed || data?.sitesCount || effectiveSelectedCount,
      );
      if (data?.run_id) {
        void supabase.functions
          .invoke('onboarding-worker-nudge', {
            body: {
              workspace_id: workspaceId,
              workflow_key: 'faq_generation',
              run_id: data.run_id,
            },
          })
          .catch((nudgeError) => {
            logger.error('Failed to kick competitor FAQ worker after start', nudgeError);
          });
      }
      toast.success(`Analysis started for ${analysedCount} competitors`);
      onStartAnalysis();
    } catch (err: any) {
      toast.error(err.message || 'Failed to start');
      setIsStarting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3 mt-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Review your competitors
          <span className="text-muted-foreground font-normal ml-1">
            ({allTemporary ? `${temporaryCount} discovered` : `${selectedCount} selected`})
          </span>
        </p>
      </div>

      {/* Add custom competitor */}
      <div className="flex gap-2">
        <Input
          placeholder="Add a competitor URL..."
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addManualUrl()}
          className="h-8 text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={addManualUrl}
          disabled={isAdding || !manualUrl.trim()}
          className="h-8 px-3"
        >
          {isAdding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        </Button>
      </div>

      {/* Compact competitor list */}
      <ScrollArea className="h-[280px]">
        {competitors.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 bg-background/70 px-3 py-6 text-center text-sm text-muted-foreground">
            {canStartAnalysis
              ? 'No competitors loaded yet. You can add one manually below if you want to widen the set.'
              : 'BizzyBee is still loading the discovered competitors. You can add one manually now if you want to widen the set.'}
          </div>
        ) : (
          <div className="space-y-1">
            {allTemporary && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                These sites are already discovered and clickable now. BizzyBee can analyse them
                immediately while it saves them as reviewable competitors in the background.
              </div>
            )}
            {competitors.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 p-1.5 rounded hover:bg-accent/50 text-sm"
              >
                <Checkbox
                  checked={c.is_selected}
                  disabled={c.temporary}
                  onCheckedChange={(v) => toggleSelection(c.id, !!v)}
                />
                <Globe className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block min-w-0"
                  >
                    <div className="truncate font-medium text-foreground group-hover:text-primary">
                      {c.business_name || c.domain}
                    </div>
                    <div className="truncate text-xs text-muted-foreground group-hover:text-primary/80">
                      {c.domain}
                    </div>
                  </a>
                </div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {c.temporary
                    ? 'Discovered'
                    : c.discovery_source === 'manual'
                      ? 'Manual'
                      : 'Found'}
                </div>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  aria-label={`Open ${c.business_name || c.domain}`}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <Button
                  size="icon"
                  type="button"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  disabled={isRemovingId === c.id || c.temporary}
                  onClick={() => removeCompetitor(c.id)}
                >
                  {isRemovingId === c.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Start/Re-run button — hidden until competitor validation is ready */}
      {canStartAnalysis && (!autoStarted || scrapeComplete) && (
        <Button
          onClick={handleStart}
          disabled={isStarting || effectiveSelectedCount === 0}
          className="w-full gap-2"
          size="sm"
        >
          {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {scrapeComplete
            ? `Re-run Analysis (${effectiveSelectedCount} competitors)`
            : `Start Analysis (${effectiveSelectedCount} competitors)`}
        </Button>
      )}
      {!canStartAnalysis && analysisStatusMessage && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {analysisStatusMessage}
        </div>
      )}
      {autoStarted && !scrapeComplete && (
        <div className="flex items-center gap-2 text-sm text-primary py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Analysis started automatically — scraping in progress...
        </div>
      )}
    </div>
  );
}

export function ProgressScreen({
  workspaceId,
  connectedEmail = null,
  onNext,
  onBack,
}: ProgressScreenProps) {
  const isPreview = workspaceId === 'preview-workspace';
  const { data: onboardingProgress, loading: progressLoading } = useOnboardingProgress(
    isPreview ? null : workspaceId,
    !isPreview,
  );
  const [discoveryTrack, setDiscoveryTrack] = useState<TrackState>({
    status: 'pending',
    counts: [],
  });
  const [scrapeTrack, setScrapeTrack] = useState<TrackState>({ status: 'waiting', counts: [] });
  const [emailImportTrack, setEmailImportTrack] = useState<TrackState>({
    status: 'pending',
    counts: [],
  });
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [emailTrack, setEmailTrack] = useState<TrackState>({ status: 'pending', counts: [] });
  const [elapsedTime, setElapsedTime] = useState(0);
  const [liveFaqCount, setLiveFaqCount] = useState(0);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [competitorSummary, setCompetitorSummary] = useState({
    loadedCount: 0,
    selectedCount: 0,
    persistedLoadedCount: 0,
    persistedSelectedCount: 0,
    temporaryCount: 0,
  });
  const startTimeRef = useRef<number>(Date.now());
  const lastDiscoveryNudgeRef = useRef<number>(0);
  const lastFaqNudgeRef = useRef<number>(0);
  const lastEmailNudgeRef = useRef<number>(0);
  const discoveryProgressTrack = onboardingProgress?.tracks?.discovery as
    | OnboardingProgressTrack
    | undefined;
  const emailProgressTrack = onboardingProgress?.tracks?.email_import as
    | OnboardingProgressTrack
    | undefined;
  const discoveryJobId =
    typeof (onboardingProgress?.tracks.discovery as OnboardingProgressTrack | undefined)?.job_id ===
      'string' &&
    (
      (onboardingProgress?.tracks.discovery as OnboardingProgressTrack | undefined)
        ?.job_id as string
    ).trim().length > 0
      ? ((onboardingProgress?.tracks.discovery as OnboardingProgressTrack | undefined)
          ?.job_id as string)
      : null;

  // Safety-net autoTrigger: if the user lands on ProgressScreen and the server
  // has no discovery run recorded (e.g. the fire-and-forget invoke from
  // SearchTermsStep failed before the server could create the row), fire
  // start-onboarding-discovery ourselves. Fires at most once per component
  // mount; start-onboarding-discovery itself is idempotent.
  const autoTriggerHasDiscoveryRun =
    typeof discoveryProgressTrack?.run_id === 'string' &&
    discoveryProgressTrack.run_id.trim().length > 0;
  useOnboardingDiscoveryAutoTrigger({
    enabled: !isPreview && !progressLoading && Boolean(workspaceId) && Boolean(onboardingProgress),
    workspaceId,
    hasDiscoveryRun: autoTriggerHasDiscoveryRun,
    hasCompetitors: competitorSummary.loadedCount > 0,
  });

  useEffect(() => {
    setReviewDismissed(false);
    setCompetitorSummary({
      loadedCount: 0,
      selectedCount: 0,
      persistedLoadedCount: 0,
      persistedSelectedCount: 0,
      temporaryCount: 0,
    });
  }, [discoveryJobId]);

  useEffect(() => {
    if (isPreview || !onboardingProgress?.tracks) return;

    const discovery = onboardingProgress.tracks.discovery as OnboardingProgressTrack;
    const faq = onboardingProgress.tracks.faq_generation as OnboardingProgressTrack;
    const email = onboardingProgress.tracks.email_import as OnboardingProgressTrack;
    const loadedCompetitorCount = competitorSummary.loadedCount;
    const selectedCompetitorCount = competitorSummary.selectedCount;
    const persistedSelectedCompetitorCount = competitorSummary.persistedSelectedCount;
    const faqJobId =
      typeof faq.job_id === 'string' && faq.job_id.trim().length > 0 ? faq.job_id : null;
    const staleFaqRun =
      Boolean(faq.run_id) &&
      Boolean(discoveryJobId) &&
      Boolean(faqJobId) &&
      discoveryJobId !== faqJobId;
    const effectiveFaqTrack = staleFaqRun ? undefined : faq;
    const competitorFaqCount = Number(effectiveFaqTrack?.counts?.faqs_added || 0);
    const faqSelectedCount = Array.isArray(effectiveFaqTrack?.selected_competitor_ids)
      ? effectiveFaqTrack?.selected_competitor_ids.length
      : 0;

    const mappedDiscoveryStatus = mapDiscoveryStatus(discovery);
    const mappedFaqStatus = mapFaqStatus(discovery, effectiveFaqTrack, competitorFaqCount);
    const effectiveDiscoveryStatus =
      loadedCompetitorCount > 0
        ? 'complete'
        : mappedFaqStatus === 'complete' && mappedDiscoveryStatus === 'pending'
          ? 'complete'
          : mappedDiscoveryStatus;
    const mappedEmailImportStatus = mapEmailImportStatus(email);
    const mappedEmailStatus = mapEmailClassificationStatus(email);
    const discoveredCompetitorCount = Math.max(
      Number(discovery.counts?.sites_discovered || 0),
      Number(discovery.counts?.sites_approved || 0),
      Number(effectiveFaqTrack?.counts?.sites_scraped || 0),
      selectedCompetitorCount,
      loadedCompetitorCount,
    );
    const selectedForAnalysisCount = Math.max(
      Number(discovery.counts?.sites_approved || 0),
      persistedSelectedCompetitorCount,
      loadedCompetitorCount,
      selectedCompetitorCount,
      faqSelectedCount,
    );
    const sitesScrapedCount = Number(effectiveFaqTrack?.counts?.sites_scraped || 0);
    const displayedAnalysedCount =
      sitesScrapedCount > 0
        ? sitesScrapedCount
        : competitorFaqCount > 0
          ? selectedForAnalysisCount
          : selectedForAnalysisCount;
    const emailWarmup = isMailboxWarmupError(email.latest_error as string | null | undefined);

    setLiveFaqCount(competitorFaqCount);

    setDiscoveryTrack({
      status: effectiveDiscoveryStatus,
      counts: [
        {
          label: 'competitors found',
          value: discoveredCompetitorCount,
        },
        ...(selectedCompetitorCount > 0
          ? [
              {
                label: 'approved for review',
                value: selectedCompetitorCount,
              },
            ]
          : []),
      ],
      error: discovery.latest_error || null,
      note:
        discoveredCompetitorCount > 0 && effectiveDiscoveryStatus !== 'complete'
          ? 'BizzyBee has already found a shortlist. You can inspect and refine it while qualification finishes.'
          : null,
    });

    setScrapeTrack({
      status: mappedFaqStatus,
      counts: [
        {
          label:
            sitesScrapedCount > 0
              ? 'sites scraped'
              : competitorFaqCount > 0
                ? 'sites analysed'
                : 'sites selected',
          value: displayedAnalysedCount,
        },
        {
          label: 'FAQs generated',
          value: competitorFaqCount,
        },
      ],
      error: effectiveFaqTrack?.latest_error || null,
      current: sitesScrapedCount || undefined,
      total: selectedForAnalysisCount || undefined,
      note:
        competitorFaqCount > 0 && sitesScrapedCount === 0
          ? 'BizzyBee already extracted competitor FAQs from the shortlisted sites even though scrape counters are still catching up.'
          : selectedForAnalysisCount > 0 && discoveredCompetitorCount > selectedForAnalysisCount
            ? `BizzyBee found ${discoveredCompetitorCount} candidates and shortlisted ${selectedForAnalysisCount} stronger matches for analysis.`
            : null,
    });

    const totalEmails = Number(email.counts?.emails_received || 0);
    const classifiedEmails = Number(email.counts?.emails_classified || 0);
    const estimatedTotal = Number(email.counts?.estimated_total_emails || 0);

    setEmailImportTrack({
      status: mappedEmailImportStatus,
      counts: [
        { label: 'emails imported', value: totalEmails },
        ...(estimatedTotal > totalEmails
          ? [{ label: 'estimated total', value: estimatedTotal }]
          : []),
      ],
      error: email.latest_error || null,
      note: emailWarmup
        ? 'Fastmail is still exposing IMAP folders to Aurinko. BizzyBee will keep retrying automatically.'
        : null,
      actualPercent:
        totalEmails > 0 && estimatedTotal > 0
          ? Math.round((totalEmails / estimatedTotal) * 100)
          : emailWarmup
            ? 8
            : mappedEmailImportStatus === 'importing'
              ? 12
              : undefined,
    });

    setEmailTrack({
      status: mappedEmailStatus,
      counts:
        totalEmails > 0
          ? [
              { label: 'emails classified', value: classifiedEmails },
              { label: 'remaining', value: Math.max(totalEmails - classifiedEmails, 0) },
            ]
          : [],
      error: email.latest_error || null,
      actualPercent:
        totalEmails > 0 ? Math.round((classifiedEmails / totalEmails) * 100) : undefined,
    });
  }, [
    competitorSummary.loadedCount,
    competitorSummary.persistedSelectedCount,
    competitorSummary.selectedCount,
    discoveryJobId,
    isPreview,
    onboardingProgress,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isPreview || !workspaceId || !onboardingProgress?.tracks) return;

    const discovery = onboardingProgress.tracks.discovery as OnboardingProgressTrack;
    const hasLoadedCompetitors = competitorSummary.loadedCount > 0;
    const isQueued =
      discovery.agent_status === 'queued' ||
      (mapDiscoveryStatus(discovery) === 'pending' && !hasLoadedCompetitors);
    const lastHeartbeatAt = discovery.last_heartbeat_at
      ? new Date(String(discovery.last_heartbeat_at)).getTime()
      : 0;
    const heartbeatAgeMs = lastHeartbeatAt
      ? Date.now() - lastHeartbeatAt
      : Number.POSITIVE_INFINITY;
    const canNudge =
      isQueued &&
      !hasLoadedCompetitors &&
      heartbeatAgeMs > WORKER_NUDGE_HEARTBEAT_MS &&
      Date.now() - lastDiscoveryNudgeRef.current > WORKER_NUDGE_COOLDOWN_MS;

    if (!canNudge) return;

    lastDiscoveryNudgeRef.current = Date.now();

    void supabase.functions
      .invoke('onboarding-worker-nudge', {
        body: {
          workspace_id: workspaceId,
          workflow_key: 'competitor_discovery',
          run_id: discovery.run_id,
        },
      })
      .catch((error) => {
        logger.error('Failed to nudge competitor discovery worker', error);
      });
  }, [competitorSummary.loadedCount, isPreview, onboardingProgress, workspaceId]);

  useEffect(() => {
    if (isPreview || !workspaceId || !onboardingProgress?.tracks) return;

    const faq = onboardingProgress.tracks.faq_generation as OnboardingProgressTrack;
    const faqCount = Number(faq.counts?.faqs_added || 0);
    const pagesScraped = Number(faq.counts?.pages_scraped || 0);
    const sitesScraped = Number(faq.counts?.sites_scraped || 0);
    const generated = Number(faq.counts?.faqs_generated || 0);
    const lastHeartbeatAt = faq.last_heartbeat_at
      ? new Date(String(faq.last_heartbeat_at)).getTime()
      : 0;
    const heartbeatAgeMs = lastHeartbeatAt
      ? Date.now() - lastHeartbeatAt
      : Number.POSITIVE_INFINITY;
    const zeroProgress =
      faqCount === 0 && pagesScraped === 0 && sitesScraped === 0 && generated === 0;
    const canNudge =
      Boolean(faq.run_id) &&
      (faq.agent_status === 'queued' ||
        ((faq.agent_status === 'running' || faq.agent_status === 'pending') &&
          zeroProgress &&
          heartbeatAgeMs > WORKER_NUDGE_HEARTBEAT_MS)) &&
      Date.now() - lastFaqNudgeRef.current > WORKER_NUDGE_COOLDOWN_MS;

    if (!canNudge) return;

    lastFaqNudgeRef.current = Date.now();

    void supabase.functions
      .invoke('onboarding-worker-nudge', {
        body: {
          workspace_id: workspaceId,
          workflow_key: 'faq_generation',
          run_id: faq.run_id,
        },
      })
      .catch((error) => {
        logger.error('Failed to nudge competitor FAQ worker', error);
      });
  }, [isPreview, onboardingProgress, workspaceId]);

  useEffect(() => {
    if (isPreview || !workspaceId || !connectedEmail || !onboardingProgress?.tracks) return;

    const email = onboardingProgress.tracks.email_import as OnboardingProgressTrack;
    const isWarmup = isMailboxWarmupError(email.latest_error as string | null | undefined);
    const isRunning = email.agent_status === 'running' || email.current_step === 'importing';
    const lastHeartbeatAt = email.last_heartbeat_at
      ? new Date(String(email.last_heartbeat_at)).getTime()
      : 0;
    const heartbeatAgeMs = lastHeartbeatAt
      ? Date.now() - lastHeartbeatAt
      : Number.POSITIVE_INFINITY;
    const canNudge =
      isWarmup &&
      isRunning &&
      heartbeatAgeMs > WORKER_NUDGE_HEARTBEAT_MS &&
      Date.now() - lastEmailNudgeRef.current > WORKER_NUDGE_COOLDOWN_MS;

    if (!canNudge) return;

    lastEmailNudgeRef.current = Date.now();

    void supabase.functions
      .invoke('onboarding-worker-nudge', {
        body: {
          workspace_id: workspaceId,
          workflow_key: 'email_import',
        },
      })
      .catch((error) => {
        logger.error('Failed to nudge email import worker', error);
      });
  }, [connectedEmail, isPreview, onboardingProgress, workspaceId]);

  // Bug 4 Fix: Require ALL three tracks to be complete
  const isDiscoveryComplete = discoveryTrack.status === 'complete';
  const isScrapeComplete = scrapeTrack.status === 'complete';
  const emailTrainingEnabled = Boolean(connectedEmail);
  const isEmailImportComplete = emailImportTrack.status === 'complete';
  const isEmailComplete =
    emailTrack.status === 'complete' || emailTrack.status === 'classification_complete';
  const emailStillTraining = emailTrainingEnabled && !(isEmailImportComplete && isEmailComplete);
  const discoveryCountForReview = Math.max(
    Number(discoveryProgressTrack?.counts?.sites_discovered || 0),
    competitorSummary.loadedCount,
    competitorSummary.selectedCount,
  );
  const hasVisibleCompetitors = discoveryCountForReview > 0;
  const allComplete = isDiscoveryComplete && isScrapeComplete;
  const canReviewCompetitors = Boolean(discoveryJobId) && !reviewDismissed && hasVisibleCompetitors;
  const canStartCompetitorAnalysis =
    (competitorSummary.selectedCount > 0 || competitorSummary.temporaryCount > 0) &&
    !['scraping', 'extracting', 'scrape_processing'].includes(scrapeTrack.status);
  const competitorReviewStatusMessage =
    competitorSummary.temporaryCount > 0 && competitorSummary.persistedLoadedCount === 0
      ? 'BizzyBee has already found competitor sites. It is still turning them into saved review rows before analysis can start.'
      : scrapeTrack.status === 'validating'
        ? 'BizzyBee is validating the competitors now. You can review the list while this finishes.'
        : scrapeTrack.status === 'pending'
          ? 'Competitors are queued for analysis. You can still review the list below.'
          : scrapeTrack.status === 'scraping' ||
              scrapeTrack.status === 'extracting' ||
              scrapeTrack.status === 'scrape_processing'
            ? 'Analysis is already running. You can still inspect the competitor list below.'
            : undefined;
  const emailWarmup = isMailboxWarmupError(
    emailProgressTrack?.latest_error as string | null | undefined,
  );

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isPreview) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CardTitle className="text-xl">Setting Up Your AI Agent</CardTitle>
          <CardDescription className="mt-2">
            Preview mode — async workflows not available
          </CardDescription>
        </div>
        <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 text-center">
          <p className="text-sm text-amber-800">
            In preview mode, competitor research, email classification, and FAQ generation workflows
            are not executed. These require a real workspace to run.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3 pt-4">
          <Button onClick={onNext} size="lg" className="gap-2">
            Continue
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (progressLoading && !onboardingProgress) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CardTitle className="text-xl">Setting Up Your AI Agent</CardTitle>
          <CardDescription className="mt-2">Loading progress...</CardDescription>
        </div>
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <CardTitle className="text-xl">Setting Up Your AI Agent</CardTitle>
        <CardDescription className="mt-2">
          We're training your AI on competitor research and your email patterns.
        </CardDescription>
      </div>

      <div className="text-center text-sm text-muted-foreground">
        Elapsed: {formatTime(elapsedTime)}
      </div>

      {/* Competitor Research: 2-stage composite */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide px-1">
          Competitor Research
        </h2>
        <TrackProgress
          title="Finding Competitors"
          phases={DISCOVERY_PHASES}
          currentStatus={discoveryTrack.status}
          counts={discoveryTrack.counts}
          error={discoveryTrack.error}
        />
        {canReviewCompetitors && (
          <InlineCompetitorReview
            key={discoveryJobId ?? 'no-discovery-job'}
            workspaceId={workspaceId}
            jobId={discoveryJobId}
            runId={discoveryProgressTrack?.run_id ?? null}
            onStartAnalysis={() => setReviewDismissed(true)}
            autoStarted={false}
            scrapeComplete={scrapeTrack.status === 'complete'}
            canStartAnalysis={canStartCompetitorAnalysis}
            analysisStatusMessage={competitorReviewStatusMessage}
            onCompetitorSummaryChange={setCompetitorSummary}
          />
        )}
        <TrackProgress
          title="Analysing Competitors"
          phases={SCRAPE_PHASES}
          currentStatus={scrapeTrack.status}
          counts={scrapeTrack.counts}
          error={scrapeTrack.error}
          currentCompetitor={scrapeTrack.currentCompetitor}
          current={scrapeTrack.current}
          total={scrapeTrack.total}
        />
        {scrapeTrack.status === 'complete' && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setDownloadingPDF(true);
                try {
                  const { generateCompetitorResearchPDF } =
                    await import('@/components/settings/knowledge-base/generateCompetitorResearchPDF');
                  await generateCompetitorResearchPDF(workspaceId);
                  toast.success('Competitor Research PDF downloaded!');
                } catch (err) {
                  logger.error('PDF generation error', err);
                  toast.error('Failed to generate PDF');
                } finally {
                  setDownloadingPDF(false);
                }
              }}
              disabled={downloadingPDF}
              className="gap-2"
            >
              {downloadingPDF ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download Competitor Report
            </Button>
          </div>
        )}
      </div>

      {/* Email Import + Classification */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide px-1">
          Email Training
        </h2>
        {emailTrainingEnabled ? (
          <>
            <TrackProgress
              title="Importing Emails"
              phases={EMAIL_IMPORT_PHASES}
              currentStatus={emailImportTrack.status}
              counts={emailImportTrack.counts}
              error={emailImportTrack.error}
              note={emailImportTrack.note}
              actualPercent={emailImportTrack.actualPercent}
            />
            <TrackProgress
              title="Email Classification"
              phases={EMAIL_PHASES}
              currentStatus={emailTrack.status}
              counts={emailTrack.counts}
              error={emailTrack.error}
              note={emailTrack.note}
              actualPercent={emailTrack.actualPercent}
            />
            {emailWarmup && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-medium">Fastmail is still warming the inbox connection.</p>
                <p className="mt-1 text-amber-800">
                  Aurinko is still loading IMAP folders. BizzyBee will keep retrying automatically,
                  and you can continue onboarding while that catches up.
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            Email training is optional. You skipped inbox setup for now, so BizzyBee will finish the
            rest of onboarding without waiting on email import.
          </div>
        )}
      </div>

      {(allComplete || canReviewCompetitors) && emailStillTraining && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-foreground">
          <p className="font-medium">Core setup is ready.</p>
          <p className="mt-1 text-muted-foreground">
            BizzyBee can keep importing and learning from your inbox in the background while you
            finish onboarding and start using the workspace.
          </p>
        </div>
      )}

      {!allComplete && (
        <div className="text-center text-sm text-muted-foreground p-4 bg-muted/30 rounded-lg">
          <p>
            {scrapeTrack.status === 'scraping' || scrapeTrack.status === 'extracting'
              ? 'This may take 10-15 minutes depending on the number of competitors.'
              : emailTrainingEnabled
                ? 'This typically takes 3-5 minutes for the initial setup.'
                : 'Competitor analysis usually finishes within a few minutes.'}
          </p>
          <p className="mt-1">
            {emailTrainingEnabled
              ? 'Deep learning from your full email history will continue in the background.'
              : 'You can keep moving now and connect email later once the rest of setup is live.'}
          </p>
        </div>
      )}

      <div className="flex flex-col items-center gap-3 pt-4">
        <Button onClick={onNext} size="lg" className="gap-2">
          <>
            Continue
            <ChevronRight className="h-4 w-4" />
          </>
        </Button>
        <div className="flex gap-3">
          {/*
           * Back stays available regardless of allComplete — even once
           * discovery + scraping are "Complete", users reasonably want to
           * tweak search terms or earlier steps (spotted 2026-04-16 when
           * Fastmail warmup was stuck AND the user wanted to adjust
           * discovery, but Back had disappeared behind the allComplete
           * gate). Skip-for-now still hides when nothing's left to skip.
           */}
          <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
            ← Back
          </Button>
          {!allComplete && (
            <Button variant="outline" size="sm" onClick={onNext}>
              Skip for now →
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
