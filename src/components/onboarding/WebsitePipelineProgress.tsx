import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  Loader2,
  Circle,
  AlertCircle,
  ArrowRight,
  RotateCcw,
  Globe,
  FileText,
  Sparkles,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { useOnboardingProgress } from '@/hooks/useOnboardingProgress';

interface WebsitePipelineProgressProps {
  workspaceId: string;
  jobId?: string | null;
  websiteUrl: string;
  onComplete: (results: { faqsExtracted: number; pagesScraped: number }) => void;
  onBack: () => void;
  onRetry: (opts?: { provider?: 'apify' | 'firecrawl' }) => void;
}

// Maps to scraping_jobs.status values
type PipelinePhase = 'pending' | 'scraping' | 'processing' | 'extracting' | 'completed' | 'failed';

interface PipelineStats {
  phase: PipelinePhase;
  startedAt?: string | null;
  apifyRunId?: string | null;
  apifyDatasetId?: string | null;
  pagesFound: number;
  pagesScraped: number;
  faqsExtracted: number;
  errorMessage: string | null;
}

type WebsiteProgressTrack = {
  agent_status?: string;
  current_step?: string | null;
  job_id?: string | null;
  job_status?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
  last_heartbeat_at?: string | null;
  latest_error?: string | null;
  output_summary?: {
    website_extract_progress?: {
      batch_index?: number;
      batch_count?: number;
      pages_in_batch?: number;
      pages_total?: number;
      candidate_count?: number;
      total_candidate_count?: number;
    };
  };
  counts?: {
    pages_found?: number;
    pages_processed?: number;
    faqs_found?: number;
  };
};

type StageStatus = 'pending' | 'queued' | 'in_progress' | 'done' | 'error';

function StageCard({
  stage,
  title,
  description,
  status,
  icon: Icon,
  children,
}: {
  stage: number;
  title: string;
  description: string;
  status: StageStatus;
  icon: React.ElementType;
  children?: React.ReactNode;
}) {
  const statusConfig = {
    pending: {
      badge: 'Pending',
      badgeClass: 'bg-muted text-muted-foreground',
      iconClass: 'text-muted-foreground',
      StatusIcon: Circle,
    },
    queued: {
      badge: 'Queued',
      badgeClass: 'bg-amber-100 text-amber-700',
      iconClass: 'text-amber-600',
      StatusIcon: Loader2,
    },
    in_progress: {
      badge: 'In Progress',
      badgeClass: 'bg-primary/10 text-primary',
      iconClass: 'text-primary',
      StatusIcon: Loader2,
    },
    done: {
      badge: 'Done',
      badgeClass: 'bg-success/10 text-success',
      iconClass: 'text-success',
      StatusIcon: CheckCircle2,
    },
    error: {
      badge: 'Error',
      badgeClass: 'bg-destructive/10 text-destructive',
      iconClass: 'text-destructive',
      StatusIcon: AlertCircle,
    },
  };

  const config = statusConfig[status];

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-all duration-300',
        status === 'queued' && 'border-amber-200 bg-amber-50/60 shadow-sm',
        status === 'in_progress' && 'border-primary/50 bg-primary/5 shadow-sm',
        status === 'done' && 'border-success/30 bg-success/5',
        status === 'error' && 'border-destructive/30 bg-destructive/5',
        status === 'pending' && 'border-border bg-muted/30 opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={cn('mt-0.5 shrink-0', config.iconClass)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-muted-foreground">STAGE {stage}</span>
              <h3 className="font-semibold text-foreground">{title}</h3>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', config.badgeClass)}>
            {config.badge}
          </span>
          <config.StatusIcon
            className={cn(
              'h-4 w-4',
              config.iconClass,
              (status === 'in_progress' || status === 'queued') && 'animate-spin',
            )}
          />
        </div>
      </div>

      {children && <div className="mt-4 pl-8">{children}</div>}
    </div>
  );
}

function ProgressLine({ currentStage }: { currentStage: number }) {
  const stages = ['Discover', 'Scrape', 'Extract', 'Done!'];

  return (
    <div className="flex items-center justify-center gap-1 py-4">
      {stages.map((label, index) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                'w-3 h-3 rounded-full transition-all duration-300',
                index < currentStage
                  ? 'bg-success'
                  : index === currentStage
                    ? 'bg-primary ring-2 ring-primary/30'
                    : 'bg-muted',
              )}
            />
            <span
              className={cn(
                'text-xs mt-1 font-medium',
                index <= currentStage ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
          </div>
          {index < stages.length - 1 && (
            <div
              className={cn(
                'w-12 h-0.5 mx-1 mt-[-12px] transition-all duration-300',
                index < currentStage ? 'bg-success' : 'bg-muted',
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function WebsitePipelineProgress({
  workspaceId,
  jobId,
  websiteUrl,
  onComplete,
  onBack,
  onRetry,
}: WebsitePipelineProgressProps) {
  const [stats, setStats] = useState<PipelineStats>({
    phase: 'pending',
    startedAt: null,
    apifyRunId: null,
    apifyDatasetId: null,
    pagesFound: 0,
    pagesScraped: 0,
    faqsExtracted: 0,
    errorMessage: null,
  });

  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [nudgeState, setNudgeState] = useState<{
    running: boolean;
    lastRunAt: number | null;
    error: string | null;
  }>({
    running: false,
    lastRunAt: null,
    error: null,
  });
  const lastNudgeRef = useRef(0);
  const { data: onboardingProgress, refresh: refreshOnboardingProgress } = useOnboardingProgress(
    workspaceId,
    Boolean(workspaceId),
  );
  const websiteTrack = onboardingProgress?.tracks.website as WebsiteProgressTrack | undefined;
  const extractProgress = websiteTrack?.output_summary?.website_extract_progress;

  const handleDownloadPDF = async () => {
    setDownloadingPdf(true);
    try {
      const { generateKnowledgeBasePDF } =
        await import('@/components/settings/knowledge-base/generateKnowledgeBasePDF');
      await generateKnowledgeBasePDF(workspaceId);
      toast.success('PDF downloaded!');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate PDF';
      toast.error(message);
    } finally {
      setDownloadingPdf(false);
    }
  };

  // Subscribe to job updates via realtime - now using scraping_jobs table
  useEffect(() => {
    if (!jobId) return;

    const fetchStats = async () => {
      const { data } = await supabase.from('scraping_jobs').select('*').eq('id', jobId).limit(1);

      const row = data?.[0];

      if (row) {
        setStats({
          phase: row.status as PipelinePhase,
          startedAt: (row.started_at as string) ?? null,
          apifyRunId: (row.apify_run_id as string) ?? null,
          apifyDatasetId: (row.apify_dataset_id as string) ?? null,
          pagesFound: row.total_pages_found || 0,
          pagesScraped: row.pages_processed || 0,
          faqsExtracted: row.faqs_found || 0,
          errorMessage: row.error_message || null,
        });
      }
    };

    fetchStats();

    const channel = supabase
      .channel(`scraping-job-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'scraping_jobs',
          filter: `id=eq.${jobId}`,
        },
        () => {
          fetchStats();
        },
      )
      .subscribe();

    // Also poll every 10 seconds as backup
    const interval = setInterval(fetchStats, 10000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const effectiveStats = useMemo<PipelineStats>(() => {
    const counts = websiteTrack?.counts;

    let phase: PipelinePhase = stats.phase;
    if (websiteTrack?.latest_error) {
      phase = 'failed';
    } else if (
      websiteTrack?.job_status === 'completed' ||
      websiteTrack?.agent_status === 'completed'
    ) {
      phase = 'completed';
    } else if (websiteTrack?.current_step === 'website:fetch') {
      phase = 'scraping';
    } else if (websiteTrack?.current_step === 'website:extract') {
      phase = 'extracting';
    } else if (websiteTrack?.current_step === 'website:persist') {
      phase = 'processing';
    }

    return {
      phase,
      startedAt: websiteTrack?.started_at ?? stats.startedAt,
      apifyRunId: stats.apifyRunId,
      apifyDatasetId: stats.apifyDatasetId,
      pagesFound: typeof counts?.pages_found === 'number' ? counts.pages_found : stats.pagesFound,
      pagesScraped:
        typeof counts?.pages_processed === 'number' ? counts.pages_processed : stats.pagesScraped,
      faqsExtracted:
        typeof counts?.faqs_found === 'number' ? counts.faqs_found : stats.faqsExtracted,
      errorMessage: websiteTrack?.latest_error ?? stats.errorMessage,
    };
  }, [stats, websiteTrack]);

  const heartbeatAgeMs = useMemo(() => {
    const raw = websiteTrack?.last_heartbeat_at ?? websiteTrack?.updated_at ?? null;
    if (!raw) return null;
    const parsed = new Date(raw).getTime();
    if (Number.isNaN(parsed)) return null;
    return Math.max(0, nowTick - parsed);
  }, [nowTick, websiteTrack?.last_heartbeat_at, websiteTrack?.updated_at]);

  const formatAge = (ageMs: number | null) => {
    if (ageMs == null) return null;
    const totalSeconds = Math.floor(ageMs / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const currentStepLabel = useMemo(() => {
    switch (websiteTrack?.current_step) {
      case 'website:fetch':
        return 'Crawler is fetching and mapping your site';
      case 'website:extract':
        return 'AI is extracting grounded FAQs and business facts';
      case 'website:persist':
        return 'Saving the new website knowledge into BizzyBee';
      default:
        if (
          websiteTrack?.job_status === 'completed' ||
          websiteTrack?.agent_status === 'completed' ||
          websiteTrack?.agent_status === 'succeeded'
        ) {
          return 'Website knowledge complete';
        }
        if (websiteTrack?.agent_status === 'queued') {
          return heartbeatAgeMs !== null && heartbeatAgeMs >= 30_000
            ? 'Still queued — rechecking the website worker automatically'
            : 'Queued for worker pickup';
        }
        if (websiteTrack?.agent_status === 'running') return 'Website worker is active';
        return 'Waiting for the website worker to pick up the next step';
    }
  }, [
    heartbeatAgeMs,
    websiteTrack?.agent_status,
    websiteTrack?.current_step,
    websiteTrack?.job_status,
  ]);

  const heartbeatLabel = formatAge(heartbeatAgeMs);
  const lastNudgeLabel = formatAge(
    nudgeState.lastRunAt ? Math.max(0, nowTick - nudgeState.lastRunAt) : null,
  );
  const isLikelyStalled = (() => {
    if (websiteTrack?.agent_status !== 'running' || heartbeatAgeMs === null) return false;
    if (websiteTrack?.current_step === 'website:extract') {
      return heartbeatAgeMs > 90 * 1000;
    }
    return (
      heartbeatAgeMs > 5 * 60 * 1000 &&
      effectiveStats.pagesFound === 0 &&
      effectiveStats.pagesScraped === 0 &&
      effectiveStats.faqsExtracted === 0
    );
  })();

  const isSlowStart =
    websiteTrack?.agent_status === 'running' &&
    heartbeatAgeMs !== null &&
    websiteTrack?.current_step !== 'website:extract' &&
    heartbeatAgeMs > 2 * 60 * 1000 &&
    effectiveStats.pagesFound === 0 &&
    effectiveStats.pagesScraped === 0 &&
    effectiveStats.faqsExtracted === 0;

  useEffect(() => {
    if (!workspaceId || !jobId || !websiteTrack?.run_id) return;
    if (websiteTrack.agent_status !== 'queued') return;
    if (heartbeatAgeMs == null || heartbeatAgeMs < 12_000) return;

    const now = Date.now();
    if (nudgeState.running || now - lastNudgeRef.current < 20_000) return;

    let cancelled = false;
    lastNudgeRef.current = now;
    setNudgeState((current) => ({ ...current, running: true, error: null }));

    void supabase.functions
      .invoke('onboarding-worker-nudge', {
        body: {
          workspace_id: workspaceId,
          run_id: websiteTrack.run_id,
          workflow_key: 'own_website_scrape',
        },
      })
      .then(async ({ error }) => {
        if (cancelled) return;
        if (error) {
          setNudgeState({
            running: false,
            lastRunAt: Date.now(),
            error: error.message || 'Failed to recheck the website worker',
          });
          return;
        }

        setNudgeState({
          running: false,
          lastRunAt: Date.now(),
          error: null,
        });
        await refreshOnboardingProgress();
      })
      .catch((error) => {
        if (cancelled) return;
        setNudgeState({
          running: false,
          lastRunAt: Date.now(),
          error: error instanceof Error ? error.message : 'Failed to recheck the website worker',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    heartbeatAgeMs,
    jobId,
    nudgeState.running,
    refreshOnboardingProgress,
    websiteTrack?.agent_status,
    websiteTrack?.run_id,
    workspaceId,
  ]);

  // Derive stage statuses from phase and data
  const getStageStatuses = (): {
    discover: StageStatus;
    scrape: StageStatus;
    extract: StageStatus;
  } => {
    const { phase, pagesFound, pagesScraped } = effectiveStats;

    if (websiteTrack?.agent_status === 'queued') {
      return { discover: 'queued', scrape: 'pending', extract: 'pending' };
    }

    if (phase === 'failed') {
      if (pagesFound === 0) {
        return { discover: 'error', scrape: 'pending', extract: 'pending' };
      }
      if (pagesScraped < pagesFound) {
        return { discover: 'done', scrape: 'error', extract: 'pending' };
      }
      return { discover: 'done', scrape: 'done', extract: 'error' };
    }

    if (phase === 'completed') {
      return { discover: 'done', scrape: 'done', extract: 'done' };
    }

    // 'scraping' status means Apify is running (discover + scrape happening together)
    if (phase === 'scraping') {
      // If pages found, discovery is done, scraping in progress
      if (pagesFound > 0) {
        return { discover: 'done', scrape: 'in_progress', extract: 'pending' };
      }
      // Still discovering
      return { discover: 'in_progress', scrape: 'pending', extract: 'pending' };
    }

    // 'processing' status means extraction is happening
    if (phase === 'processing' || phase === 'extracting') {
      return { discover: 'done', scrape: 'done', extract: 'in_progress' };
    }

    // Default: pending
    return { discover: 'pending', scrape: 'pending', extract: 'pending' };
  };

  const stageStatuses = getStageStatuses();

  // Calculate current stage for progress line (0-3)
  const getCurrentStage = (): number => {
    if (stageStatuses.extract === 'done') return 3;
    if (stageStatuses.extract === 'in_progress') return 2;
    if (stageStatuses.scrape === 'in_progress') return 1;
    return 0;
  };

  // Calculate scrape progress
  const scrapePercent =
    effectiveStats.pagesFound > 0
      ? Math.round((effectiveStats.pagesScraped / effectiveStats.pagesFound) * 100)
      : 0;

  const isError = effectiveStats.phase === 'failed' || isLikelyStalled;
  const isComplete = effectiveStats.phase === 'completed';

  const elapsedSeconds = useMemo(() => {
    if (!effectiveStats.startedAt) return null;
    const started = new Date(effectiveStats.startedAt).getTime();
    if (Number.isNaN(started)) return null;
    return Math.max(0, Math.floor((Date.now() - started) / 1000));
  }, [effectiveStats.startedAt]);

  const elapsedLabel = useMemo(() => {
    if (elapsedSeconds == null) return null;
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      const remMins = mins % 60;
      return `${hours}h ${remMins}m`;
    }
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }, [elapsedSeconds]);

  const handleContinue = () => {
    onComplete({
      faqsExtracted: effectiveStats.faqsExtracted,
      pagesScraped: effectiveStats.pagesScraped,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">Your Website Knowledge</h2>
        <p className="text-sm text-muted-foreground">
          We're extracting FAQs, pricing, and services from your website.
          <br />
          <span className="font-medium text-foreground">{websiteUrl}</span>
        </p>
        {(websiteTrack?.agent_status || websiteTrack?.current_step) && (
          <div
            className={cn(
              'mx-auto max-w-xl rounded-lg border px-4 py-3 text-left',
              isLikelyStalled
                ? 'border-amber-300 bg-amber-50'
                : isSlowStart
                  ? 'border-primary/20 bg-primary/5'
                  : 'border-border bg-muted/30',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">{currentStepLabel}</p>
                <p className="text-xs text-muted-foreground">
                  Agent status: {websiteTrack?.agent_status ?? 'pending'}
                  {heartbeatLabel ? ` • last heartbeat ${heartbeatLabel} ago` : ''}
                </p>
              </div>
              {websiteTrack?.agent_status === 'running' && !isLikelyStalled ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              ) : null}
              {isLikelyStalled ? <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" /> : null}
            </div>
            {isLikelyStalled ? (
              <p className="mt-2 text-xs text-amber-700">
                This run looks stalled. Retry below to kick off a fresh crawl.
              </p>
            ) : isSlowStart ? (
              <p className="mt-2 text-xs text-muted-foreground">
                The worker is active, but the first page counts can take a bit to appear while the
                crawler boots and fetches your site.
              </p>
            ) : nudgeState.running ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Rechecking the website worker now so live counts can start moving.
              </p>
            ) : nudgeState.error ? (
              <p className="mt-2 text-xs text-amber-700">
                We tried to wake the website worker again, but it still needs attention.
              </p>
            ) : lastNudgeLabel && websiteTrack?.agent_status === 'queued' ? (
              <p className="mt-2 text-xs text-muted-foreground">
                We rechecked the worker {lastNudgeLabel} ago and will keep doing that while this run
                is queued.
              </p>
            ) : null}
          </div>
        )}
        {effectiveStats.phase === 'scraping' && effectiveStats.pagesFound === 0 && (
          <p className="text-xs text-muted-foreground">
            Crawler running{elapsedLabel ? ` (${elapsedLabel} elapsed)` : ''} — page counts update
            when the crawl completes.
          </p>
        )}
      </div>

      {!jobId && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-primary">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm font-medium">Preparing live website analysis…</span>
          </div>
          <p className="text-xs text-muted-foreground">
            We&apos;re waiting for the new scrape job to register before showing page and FAQ
            progress.
          </p>
        </div>
      )}

      {(websiteTrack?.agent_status ||
        effectiveStats.pagesFound > 0 ||
        effectiveStats.faqsExtracted > 0) && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border bg-background px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Worker state
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground capitalize">
              {websiteTrack?.agent_status ?? 'pending'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {heartbeatLabel
                ? `Last heartbeat ${heartbeatLabel} ago`
                : 'Waiting for first worker ping'}
            </p>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Pages discovered
            </p>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {effectiveStats.pagesFound}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Site map and internal pages found so far
            </p>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Pages scraped
            </p>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {effectiveStats.pagesScraped}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Downloaded and ready for FAQ extraction
            </p>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              FAQ candidates
            </p>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {effectiveStats.faqsExtracted}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Grounded questions and answers found so far
            </p>
          </div>
        </div>
      )}

      {/* Stage Cards */}
      <div className="space-y-3">
        {/* Stage 1: Discover */}
        <StageCard
          stage={1}
          title="Discover Pages"
          description={
            stageStatuses.discover === 'done'
              ? 'Found pages on your website'
              : 'Finding pages on your website'
          }
          status={stageStatuses.discover}
          icon={Search}
        >
          {stageStatuses.discover === 'done' && effectiveStats.pagesFound > 0 && (
            <p className="text-sm text-success">✓ {effectiveStats.pagesFound} pages discovered</p>
          )}
          {stageStatuses.discover === 'queued' && (
            <div className="space-y-2 text-sm text-amber-700">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Queued for the website worker to pick up.</span>
              </div>
              <p className="text-xs text-muted-foreground">
                We recheck the worker automatically, so you do not need to restart the whole scrape
                just because the queue is slow.
              </p>
            </div>
          )}
          {stageStatuses.discover === 'in_progress' && (
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span>Mapping website structure...</span>
              </div>
              {effectiveStats.pagesFound > 0 ? (
                <p className="text-xs text-foreground">
                  {effectiveStats.pagesFound} page{effectiveStats.pagesFound === 1 ? '' : 's'} found
                  so far
                </p>
              ) : null}
            </div>
          )}
        </StageCard>

        {/* Stage 2: Scrape */}
        <StageCard
          stage={2}
          title="Scrape Content"
          description={
            stageStatuses.scrape === 'done'
              ? 'Downloaded page content'
              : stageStatuses.scrape === 'in_progress'
                ? 'Reading and downloading page content'
                : 'Read and download page content'
          }
          status={stageStatuses.scrape}
          icon={Globe}
        >
          {stageStatuses.scrape === 'pending' && (
            <p className="text-sm text-muted-foreground">Waiting for discovery to complete...</p>
          )}
          {stageStatuses.scrape === 'in_progress' && effectiveStats.pagesFound > 0 && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Progress value={scrapePercent} className="h-2" />
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">
                    {effectiveStats.pagesScraped} / {effectiveStats.pagesFound} pages
                  </span>
                  <span className="font-medium">{scrapePercent}%</span>
                </div>
              </div>
            </div>
          )}
          {stageStatuses.scrape === 'done' && (
            <p className="text-sm text-success">✓ {effectiveStats.pagesScraped} pages scraped</p>
          )}
        </StageCard>

        {/* Stage 3: Extract */}
        <StageCard
          stage={3}
          title="Extract Knowledge"
          description={
            stageStatuses.extract === 'done'
              ? 'AI extracted FAQs and business facts'
              : stageStatuses.extract === 'in_progress'
                ? 'AI is extracting FAQs, pricing, and business facts'
                : 'AI will extract FAQs, pricing, and business facts'
          }
          status={stageStatuses.extract}
          icon={Sparkles}
        >
          {stageStatuses.extract === 'pending' && (
            <p className="text-sm text-muted-foreground">Coming next... (~30 seconds)</p>
          )}
          {stageStatuses.extract === 'in_progress' && (
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span>
                  AI analysing {effectiveStats.pagesScraped || effectiveStats.pagesFound || 0} pages
                  for FAQs, pricing, and service details
                </span>
              </div>
              {(extractProgress?.batch_count || stageStatuses.extract === 'in_progress') && (
                <div className="rounded-md border border-primary/15 bg-primary/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span>
                      {extractProgress?.batch_count
                        ? `AI pass ${extractProgress.batch_index ?? 1} of ${extractProgress.batch_count}`
                        : 'Extracting grounded website FAQs'}
                    </span>
                    <span className="font-medium text-foreground">
                      {effectiveStats.faqsExtracted} FAQ
                      {effectiveStats.faqsExtracted === 1 ? '' : 's'} identified so far
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
          {stageStatuses.extract === 'done' && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-2">
                  <span className="text-xs">└─</span> FAQs extracted
                </span>
                <span className="font-medium flex items-center gap-1">
                  {effectiveStats.faqsExtracted}
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                </span>
              </div>
            </div>
          )}
        </StageCard>
      </div>

      {/* Progress Line */}
      <ProgressLine currentStage={getCurrentStage()} />

      {/* Error State */}
      {isError && (effectiveStats.errorMessage || isLikelyStalled) && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">
                {isLikelyStalled ? 'This run may be stalled' : 'Something went wrong'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {effectiveStats.errorMessage ||
                  'The website worker stopped reporting progress. Retry to start a fresh crawl.'}
              </p>
            </div>
          </div>
          <Button
            onClick={() => onRetry()}
            size="sm"
            variant="outline"
            className="mt-3 w-full gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Retry
          </Button>
        </div>
      )}

      {/* Completion Message */}
      {isComplete && (
        <div className="p-4 bg-success/10 border border-success/30 rounded-lg text-center space-y-3">
          <CheckCircle2 className="h-6 w-6 text-success mx-auto" />
          <p className="text-sm font-medium text-success">Website Analysed!</p>
          <p className="text-xs text-muted-foreground">
            {effectiveStats.faqsExtracted} FAQs extracted from {effectiveStats.pagesScraped} pages.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadPDF}
            disabled={downloadingPdf}
            className="gap-2"
          >
            {downloadingPdf ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download Knowledge Base PDF
          </Button>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-3">
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            Back
          </Button>
          <Button onClick={handleContinue} className="flex-1 gap-2">
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        {!isComplete && (
          <p className="text-xs text-center text-muted-foreground">
            You can continue while this runs in the background
          </p>
        )}
      </div>
    </div>
  );
}
