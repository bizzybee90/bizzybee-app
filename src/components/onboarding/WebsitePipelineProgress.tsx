import { useState, useEffect, useMemo } from 'react';
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

interface WebsitePipelineProgressProps {
  workspaceId: string;
  jobId: string;
  websiteUrl: string;
  onComplete: (results: { faqsExtracted: number; pagesScraped: number }) => void;
  onBack: () => void;
  onRetry: (opts?: { provider?: 'apify' | 'firecrawl' }) => void;
}

// Maps to scraping_jobs.status values
type PipelinePhase = 'pending' | 'scraping' | 'processing' | 'completed' | 'failed';

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

type StageStatus = 'pending' | 'in_progress' | 'done' | 'error';

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
            className={cn('h-4 w-4', config.iconClass, status === 'in_progress' && 'animate-spin')}
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
      const { data } = await supabase.from('scraping_jobs').select('*').eq('id', jobId).single();

      if (data) {
        setStats({
          phase: data.status as PipelinePhase,
          startedAt: (data.started_at as string) ?? null,
          apifyRunId: (data.apify_run_id as string) ?? null,
          apifyDatasetId: (data.apify_dataset_id as string) ?? null,
          pagesFound: data.total_pages_found || 0,
          pagesScraped: data.pages_processed || 0,
          faqsExtracted: data.faqs_found || 0,
          errorMessage: data.error_message || null,
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

  // Derive stage statuses from phase and data
  const getStageStatuses = (): {
    discover: StageStatus;
    scrape: StageStatus;
    extract: StageStatus;
  } => {
    const { phase, pagesFound, pagesScraped, faqsExtracted } = stats;

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
    if (phase === 'processing') {
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
    stats.pagesFound > 0 ? Math.round((stats.pagesScraped / stats.pagesFound) * 100) : 0;

  const isError = stats.phase === 'failed';
  const isComplete = stats.phase === 'completed';

  const elapsedSeconds = useMemo(() => {
    if (!stats.startedAt) return null;
    const started = new Date(stats.startedAt).getTime();
    if (Number.isNaN(started)) return null;
    return Math.max(0, Math.floor((Date.now() - started) / 1000));
  }, [stats.startedAt]);

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
      faqsExtracted: stats.faqsExtracted,
      pagesScraped: stats.pagesScraped,
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
        {stats.phase === 'scraping' && stats.pagesFound === 0 && (
          <p className="text-xs text-muted-foreground">
            Crawler running{elapsedLabel ? ` (${elapsedLabel} elapsed)` : ''} — page counts update
            when the crawl completes.
          </p>
        )}
      </div>

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
          {stageStatuses.discover === 'done' && stats.pagesFound > 0 && (
            <p className="text-sm text-success">✓ {stats.pagesFound} pages discovered</p>
          )}
          {stageStatuses.discover === 'in_progress' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              <span>Mapping website structure...</span>
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
          {stageStatuses.scrape === 'in_progress' && stats.pagesFound > 0 && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Progress value={scrapePercent} className="h-2" />
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">
                    {stats.pagesScraped} / {stats.pagesFound} pages
                  </span>
                  <span className="font-medium">{scrapePercent}%</span>
                </div>
              </div>
            </div>
          )}
          {stageStatuses.scrape === 'done' && (
            <p className="text-sm text-success">✓ {stats.pagesScraped} pages scraped</p>
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
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              <span>
                AI analysing content...
                {stats.faqsExtracted > 0 && ` ${stats.faqsExtracted} FAQs found`}
              </span>
            </div>
          )}
          {stageStatuses.extract === 'done' && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-2">
                  <span className="text-xs">└─</span> FAQs extracted
                </span>
                <span className="font-medium flex items-center gap-1">
                  {stats.faqsExtracted}
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
      {isError && stats.errorMessage && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">Something went wrong</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.errorMessage}</p>
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
            {stats.faqsExtracted} FAQs extracted from {stats.pagesScraped} pages.
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
