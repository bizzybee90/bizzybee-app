import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  Filter,
  Wand2,
  Users,
  RefreshCw,
  Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { CompetitorListDialog } from '@/components/onboarding/CompetitorListDialog';
import { CompetitorReviewScreen } from '@/components/onboarding/CompetitorReviewScreen';

interface CompetitorPipelineProgressProps {
  workspaceId: string;
  jobId: string;
  nicheQuery: string;
  serviceArea: string;
  targetCount: number;
  searchQueries?: string[];
  onComplete: (results: { sitesScraped: number; faqsGenerated: number }) => void;
  onBack: () => void;
  onRetry: () => void;
  onRestartNow?: () => void;
}

type PipelinePhase = 'queued' | 'discovering' | 'filtering' | 'review_ready' | 'validating' | 'scraping' | 'extracting' | 'deduplicating' | 'refining' | 'embedding' | 'completed' | 'failed' | 'error';

interface PipelineStats {
  phase: PipelinePhase;
  sitesDiscovered: number;
  sitesValidated: number;
  sitesScraped: number;
  pagesScraped: number;
  faqsExtracted: number;
  faqsAfterDedup: number;
  faqsRefined: number;
  faqsAdded: number;
  currentSite: string | null;
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
        status === 'pending' && 'border-border bg-muted/30 opacity-60'
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
              status === 'in_progress' && 'animate-spin'
            )}
          />
        </div>
      </div>

      {children && <div className="mt-4 pl-8">{children}</div>}
    </div>
  );
}

function ProgressLine({ currentStage }: { currentStage: number }) {
  const stages = ['Discover', 'Validate', 'Scrape', 'Extract', 'Refine', 'Done!'];

  return (
    <div className="flex items-center justify-center gap-0.5 py-4 overflow-x-auto">
      {stages.map((label, index) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                'w-2.5 h-2.5 rounded-full transition-all duration-300',
                index < currentStage
                  ? 'bg-success'
                  : index === currentStage
                  ? 'bg-primary ring-2 ring-primary/30'
                  : 'bg-muted'
              )}
            />
            <span
              className={cn(
                'text-[10px] mt-1 font-medium whitespace-nowrap',
                index <= currentStage ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {label}
            </span>
          </div>
          {index < stages.length - 1 && (
            <div
              className={cn(
                'w-6 h-0.5 mx-0.5 mt-[-12px] transition-all duration-300',
                index < currentStage ? 'bg-success' : 'bg-muted'
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// Maximum time to wait in discovering phase before showing timeout warning (8 minutes)
const DISCOVERY_TIMEOUT_MS = 8 * 60 * 1000;
// Time after which we consider a job stale if no heartbeat (5 minutes)
const STALE_THRESHOLD_MS = 5 * 60 * 1000;
// Time after which extraction stage is considered stalled (15 minutes)
const EXTRACTION_STALL_MS = 15 * 60 * 1000;

export function CompetitorPipelineProgress({
  workspaceId,
  jobId,
  nicheQuery,
  serviceArea,
  targetCount,
  searchQueries,
  onComplete,
  onBack,
  onRetry,
  onRestartNow,
}: CompetitorPipelineProgressProps) {
  const [stats, setStats] = useState<PipelineStats>({
    phase: 'queued',
    sitesDiscovered: 0,
    sitesValidated: 0,
    sitesScraped: 0,
    pagesScraped: 0,
    faqsExtracted: 0,
    faqsAfterDedup: 0,
    faqsRefined: 0,
    faqsAdded: 0,
    currentSite: null,
    errorMessage: null,
  });

  const [startTime] = useState<number>(Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isStale, setIsStale] = useState(false);
  const [extractionStartTime, setExtractionStartTime] = useState<number | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  
  // Fetch search queries from DB for resumed jobs
  const [storedSearchQueries, setStoredSearchQueries] = useState<string[]>([]);
  
  useEffect(() => {
    const fetchJobQueries = async () => {
      const { data } = await supabase
        .from('competitor_research_jobs')
        .select('search_queries')
        .eq('id', jobId)
        .maybeSingle();
      
      if (data?.search_queries && Array.isArray(data.search_queries)) {
        setStoredSearchQueries(data.search_queries as string[]);
      }
    };
    
    fetchJobQueries();
  }, [jobId]);
  
  // Merge: prefer passed queries, fall back to stored from DB
  const displayQueries = searchQueries?.length 
    ? searchQueries 
    : storedSearchQueries;

  // Update elapsed time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  // Poll for job progress
  useEffect(() => {
    if (!jobId) return;

    const fetchStats = async () => {
      const { data } = await supabase
        .from('competitor_research_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (data) {
        // Check if job is stale (no heartbeat in STALE_THRESHOLD_MS)
        const heartbeatTime = data.heartbeat_at ? new Date(data.heartbeat_at).getTime() : 0;
        const isJobStale = Date.now() - heartbeatTime > STALE_THRESHOLD_MS;
        setIsStale(isJobStale);

        // Check for discovery timeout
        const isDiscoveryTimeout = 
          (data.status === 'discovering' || data.status === 'queued' || data.status === 'geocoding') &&
          Date.now() - startTime > DISCOVERY_TIMEOUT_MS &&
          data.sites_discovered === 0;

        // Map faqs_generated to faqsExtracted (they're synonymous in our simplified flow)
        const faqsTotal = data.faqs_generated || data.faqs_extracted || 0;
        const faqsFinal = data.faqs_added || faqsTotal;
        
        // Track extraction start time
        if ((data.status === 'extracting' || data.status === 'deduplicating') && !extractionStartTime) {
          setExtractionStartTime(Date.now());
        } else if (data.status !== 'extracting' && data.status !== 'deduplicating') {
          setExtractionStartTime(null);
        }
        
        // Use sites_approved for validated count (this is what we actually track)
        const validatedCount = data.sites_approved || data.sites_validated || 0;
        
        setStats({
          phase: isDiscoveryTimeout ? 'error' : (data.status as PipelinePhase),
          sitesDiscovered: data.sites_discovered || 0,
          sitesValidated: validatedCount,
          sitesScraped: data.sites_scraped || 0,
          pagesScraped: data.pages_scraped || 0,
          faqsExtracted: faqsTotal,
          faqsAfterDedup: faqsFinal, // In simplified flow, this equals added
          faqsRefined: faqsFinal,
          faqsAdded: faqsFinal,
          currentSite: data.current_scraping_domain || null,
          errorMessage: isDiscoveryTimeout 
            ? 'Discovery is taking longer than expected. The external service may be busy. Try again or skip for now.'
            : (data.error_message || null),
        });
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000);

    return () => clearInterval(interval);
  }, [jobId, startTime]);

  // Derive stage statuses from phase
  const getStageStatuses = (): { 
    discover: StageStatus; 
    validate: StageStatus; 
    scrape: StageStatus; 
    extract: StageStatus;
    refine: StageStatus;
  } => {
    const { phase } = stats;

    if (phase === 'error') {
      // Determine which stage errored
      if (stats.sitesDiscovered === 0) {
        return { discover: 'error', validate: 'pending', scrape: 'pending', extract: 'pending', refine: 'pending' };
      }
      if (stats.sitesValidated === 0) {
        return { discover: 'done', validate: 'error', scrape: 'pending', extract: 'pending', refine: 'pending' };
      }
      if (stats.sitesScraped === 0) {
        return { discover: 'done', validate: 'done', scrape: 'error', extract: 'pending', refine: 'pending' };
      }
      if (stats.faqsExtracted === 0) {
        return { discover: 'done', validate: 'done', scrape: 'done', extract: 'error', refine: 'pending' };
      }
      return { discover: 'done', validate: 'done', scrape: 'done', extract: 'done', refine: 'error' };
    }

    switch (phase) {
      case 'queued':
      case 'discovering':
      case 'filtering':
        return { discover: 'in_progress', validate: 'pending', scrape: 'pending', extract: 'pending', refine: 'pending' };
      case 'review_ready':
        // Discovery done, waiting for user review before scraping
        return { discover: 'done', validate: 'done', scrape: 'pending', extract: 'pending', refine: 'pending' };
      case 'validating':
        return { discover: 'done', validate: 'in_progress', scrape: 'pending', extract: 'pending', refine: 'pending' };
      case 'scraping':
        return { discover: 'done', validate: 'done', scrape: 'in_progress', extract: 'pending', refine: 'pending' };
      case 'extracting':
      case 'deduplicating':
        return { discover: 'done', validate: 'done', scrape: 'done', extract: 'in_progress', refine: 'pending' };
      case 'refining':
      case 'embedding':
        return { discover: 'done', validate: 'done', scrape: 'done', extract: 'done', refine: 'in_progress' };
      case 'completed':
        return { discover: 'done', validate: 'done', scrape: 'done', extract: 'done', refine: 'done' };
      default:
        return { discover: 'pending', validate: 'pending', scrape: 'pending', extract: 'pending', refine: 'pending' };
    }
  };

  const stageStatuses = getStageStatuses();

  // Calculate current stage for progress line (0-5)
  const getCurrentStage = (): number => {
    if (stageStatuses.refine === 'done') return 5;
    if (stageStatuses.refine === 'in_progress') return 4;
    if (stageStatuses.extract === 'in_progress') return 3;
    if (stageStatuses.scrape === 'in_progress') return 2;
    if (stageStatuses.validate === 'in_progress') return 1;
    return 0;
  };

  // Calculate scrape progress
  const scrapePercent =
    stats.sitesValidated > 0
      ? Math.round((stats.sitesScraped / stats.sitesValidated) * 100)
      : 0;

  // Estimate time remaining
  const estimateTime = (): string => {
    if (targetCount <= 50) return '5-10 min';
    if (targetCount <= 100) return '10-20 min';
    return '30-45 min';
  };

  const isError = stats.phase === 'error' || stats.phase === 'failed';
  const isComplete = stats.phase === 'completed';
  const isReviewReady = stats.phase === 'review_ready';

  const [isCancelling, setIsCancelling] = useState(false);

  const handleCancelRun = async () => {
    setIsCancelling(true);
    try {
      const { error } = await supabase
        .from('competitor_research_jobs')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_message: 'Cancelled by user',
        })
        .eq('id', jobId);

      if (error) throw error;

      toast.success('Stopped competitor research');
      onRetry();
    } catch (err: any) {
      console.error('[CompetitorPipelineProgress] Cancel failed:', err);
      toast.error('Could not stop the run', {
        description: err?.message || 'Please try again',
      });
    } finally {
      setIsCancelling(false);
    }
  };
  
  // Check if extraction is stalled.
  // Two paths:
  // 1) "Local" timer: user has been on this screen > 15 min
  // 2) "Global" stale heartbeat: job has been stuck previously (e.g. days)
  const isExtractionStalled =
    (stats.phase === 'extracting' || stats.phase === 'deduplicating') &&
    stats.faqsExtracted === 0 &&
    ((extractionStartTime && Date.now() - extractionStartTime > EXTRACTION_STALL_MS) || isStale);

  // Handle job recovery
  const handleRecoverJob = async () => {
    setIsRecovering(true);
    try {
      const { data, error } = await supabase.functions.invoke('trigger-n8n-workflow', {
        body: { workspace_id: workspaceId, workflow_type: 'competitor_discovery', jobId }
      });
      
      if (error) {
        toast.error('Recovery failed', { description: error.message });
      } else if (data?.success) {
        toast.success('Recovery started', { description: data.message });
      } else {
        toast.error('Recovery failed', { description: data?.error || 'Unknown error' });
      }
    } catch (err) {
      toast.error('Recovery failed', { description: String(err) });
    } finally {
      setIsRecovering(false);
    }
  };

  const handleContinue = () => {
    onComplete({
      sitesScraped: stats.sitesScraped,
      faqsGenerated: stats.faqsAdded,
    });
  };

  // Handle review confirmation - continue polling after user confirms
  const handleReviewConfirm = (selectedCount: number) => {
    // The competitor-scrape-start function was called, job status will change to 'scraping'
    // The polling will automatically pick up the new status
    console.log('[CompetitorPipelineProgress] Review confirmed, waiting for scraping to start...');
  };

  // Show review screen when in review_ready state
  if (isReviewReady) {
    return (
      <CompetitorReviewScreen
        workspaceId={workspaceId}
        jobId={jobId}
        nicheQuery={nicheQuery}
        serviceArea={serviceArea}
        targetCount={targetCount}
        onConfirm={handleReviewConfirm}
        onBack={onBack}
        onSkip={() => onComplete({ sitesScraped: 0, faqsGenerated: 0 })}
        onRestart={onRestartNow}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">Competitor Research</h2>
        <p className="text-sm text-muted-foreground">
          Learning from your competitors to build a comprehensive knowledge base.
          <br />
          <span className="font-medium text-foreground">{nicheQuery}</span>
          {serviceArea && <span className="text-muted-foreground"> in {serviceArea}</span>}
        </p>
      </div>

      {/* Stage Cards */}
      <div className="space-y-3">
        {/* Stage 1: Discover */}
        <StageCard
          stage={1}
          title="Discover Competitors"
          description={
            stageStatuses.discover === 'done'
              ? 'Found businesses in your area'
              : 'Finding businesses in your area'
          }
          status={stageStatuses.discover}
          icon={Search}
        >
          {stageStatuses.discover === 'done' && stats.sitesDiscovered > 0 && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-success">{stats.sitesDiscovered} competitors found</p>
              <CompetitorListDialog jobId={jobId} workspaceId={workspaceId} serviceArea={serviceArea} nicheQuery={nicheQuery} />
            </div>
          )}
          {stageStatuses.discover === 'in_progress' && (
            <div className="space-y-3">
              {/* Always show progress bar with target count */}
              <div className="space-y-1.5">
                <Progress 
                  value={Math.min((stats.sitesDiscovered / targetCount) * 100, 100)} 
                  className="h-2" 
                />
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">
                    {stats.sitesDiscovered} / {targetCount} competitors found
                  </span>
                  <span className="font-medium">
                    {Math.min(Math.round((stats.sitesDiscovered / targetCount) * 100), 100)}%
                  </span>
                </div>
              </div>
              
              {/* Status message with elapsed time */}
              <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                  </span>
                  <span>
                    {stats.sitesDiscovered === 0 
                      ? 'Searching Google Maps...' 
                      : `Finding more businesses...`}
                  </span>
                </div>
                <span className="text-xs font-mono tabular-nums">
                  {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
                </span>
              </div>
              
              {/* Search terms being used */}
              {displayQueries.length > 0 && (
                <div className="p-3 bg-muted/30 rounded-lg border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Eye className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium text-foreground">
                      Search terms being used
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {displayQueries.map((query) => (
                      <Badge 
                        key={query} 
                        variant="secondary" 
                        className="font-mono text-xs"
                      >
                        {query}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Helpful tip after 30 seconds */}
              {elapsedSeconds > 30 && (
                <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
                  This step uses Google Maps to find real businesses. It typically takes 2-4 minutes to complete.
                  {isStale && ' The service may be busy - please wait a bit longer.'}
                </p>
              )}
            </div>
          )}
        </StageCard>

        {/* Stage 2: Validate */}
        <StageCard
          stage={2}
          title="Validate Websites"
          description={
            stageStatuses.validate === 'done'
              ? 'Checked which businesses have useful websites'
              : stageStatuses.validate === 'in_progress'
              ? 'Checking which businesses have useful websites'
              : 'Check which businesses have useful websites'
          }
          status={stageStatuses.validate}
          icon={Filter}
        >
          {stageStatuses.validate === 'pending' && (
            <p className="text-sm text-muted-foreground">
              Waiting for discovery...
            </p>
          )}
          {stageStatuses.validate === 'in_progress' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              <span>
                Validating websites... {stats.sitesValidated} valid
              </span>
            </div>
          )}
          {stageStatuses.validate === 'done' && (
            <p className="text-sm text-success">
              {stats.sitesValidated} valid websites confirmed
            </p>
          )}
        </StageCard>

        {/* Stage 3: Scrape */}
        <StageCard
          stage={3}
          title="Scrape Websites"
          description={
            stageStatuses.scrape === 'done'
              ? 'Downloaded FAQ and service pages'
              : stageStatuses.scrape === 'in_progress'
              ? 'Reading FAQ and service pages'
              : 'Read FAQ and service pages'
          }
          status={stageStatuses.scrape}
          icon={Globe}
        >
          {stageStatuses.scrape === 'pending' && (
            <p className="text-sm text-muted-foreground">
              Waiting for validation...
            </p>
          )}
          {stageStatuses.scrape === 'in_progress' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Progress value={scrapePercent} className="h-2" />
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">
                    {stats.sitesScraped} / {stats.sitesValidated} sites
                  </span>
                  <span className="font-medium">{scrapePercent}%</span>
                </div>
              </div>
              {stats.currentSite && (
                <p className="text-xs text-muted-foreground truncate">
                  Currently: {stats.currentSite}
                </p>
              )}
            </div>
          )}
          {stageStatuses.scrape === 'done' && (
            <p className="text-sm text-success">
              {stats.sitesScraped} sites, {stats.pagesScraped} pages scraped
            </p>
          )}
        </StageCard>

        {/* Stage 4: Extract & Dedupe */}
        <StageCard
          stage={4}
          title="Extract & Dedupe FAQs"
          description={
            stageStatuses.extract === 'done'
              ? 'AI extracted and removed duplicates'
              : stageStatuses.extract === 'in_progress'
              ? 'AI is extracting and removing duplicate FAQs'
              : 'AI will extract and remove duplicate FAQs'
          }
          status={stageStatuses.extract}
          icon={FileText}
        >
          {stageStatuses.extract === 'pending' && (
            <p className="text-sm text-muted-foreground">
              Waiting for scraping...
            </p>
          )}
          {stageStatuses.extract === 'in_progress' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span>
                  {stats.faqsExtracted > 0 ? `${stats.faqsExtracted} FAQs extracted` : 'Processing content...'}
                  {stats.faqsAfterDedup > 0 && `, ${stats.faqsAfterDedup} after dedup`}
                </span>
              </div>
              
              {/* Show elapsed time for extraction */}
              {extractionStartTime && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Elapsed:</span>
                  <span className="font-mono tabular-nums">
                    {Math.floor((Date.now() - extractionStartTime) / 60000)}:{((Math.floor((Date.now() - extractionStartTime) / 1000)) % 60).toString().padStart(2, '0')}
                  </span>
                </div>
              )}
              
              {/* Show recovery button if stalled */}
              {isExtractionStalled && (
                <div className="mt-3 p-3 bg-muted/50 border border-border rounded-lg space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      This stage seems stuck. The webhook may not have delivered the scraped data.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleRecoverJob}
                    disabled={isRecovering}
                    className="w-full gap-2"
                  >
                    {isRecovering ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Recovering...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" />
                        Recover Stalled Job
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
          {stageStatuses.extract === 'error' && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                {stats.errorMessage || 'Extraction failed'}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRecoverJob}
                disabled={isRecovering}
                className="gap-2"
              >
                {isRecovering ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Recovering...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3" />
                    Recover Job
                  </>
                )}
              </Button>
            </div>
          )}
          {stageStatuses.extract === 'done' && (
            <p className="text-sm text-success">
              {stats.faqsExtracted} FAQs, {stats.faqsAfterDedup} unique
            </p>
          )}
        </StageCard>

        {/* Stage 5: Refine */}
        <StageCard
          stage={5}
          title="Refine for Your Business"
          description={
            stageStatuses.refine === 'done'
              ? 'Adapted competitor FAQs for your business'
              : stageStatuses.refine === 'in_progress'
              ? 'Adapting competitor FAQs to match your services'
              : 'Adapt competitor FAQs to match your services'
          }
          status={stageStatuses.refine}
          icon={Wand2}
        >
          {stageStatuses.refine === 'pending' && (
            <p className="text-sm text-muted-foreground">
              Coming next...
            </p>
          )}
          {stageStatuses.refine === 'in_progress' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              <span>
                Personalising FAQs... {stats.faqsRefined > 0 && `${stats.faqsRefined} refined`}
              </span>
            </div>
          )}
          {stageStatuses.refine === 'done' && (
            <p className="text-sm text-success">
              {stats.faqsAdded} FAQs added to knowledge base
            </p>
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
          <Button onClick={onRetry} size="sm" variant="outline" className="mt-3 w-full gap-2">
            <RotateCcw className="h-4 w-4" />
            Retry
          </Button>
        </div>
      )}

      {/* Completion Message */}
      {isComplete && (
        <div className="p-3 bg-success/10 border border-success/30 rounded-lg text-center">
          <CheckCircle2 className="h-6 w-6 text-success mx-auto mb-2" />
          <p className="text-sm font-medium text-success">Competitor Research Complete!</p>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.faqsAdded} FAQs from {stats.sitesScraped} competitor websites added to your knowledge base.
          </p>
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
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="w-full"
                disabled={isCancelling}
              >
                {isCancelling ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Stopping…
                  </span>
                ) : (
                  'Stop this run'
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Stop competitor research?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will mark the job as cancelled so the backend stops progressing it. Any already-running external
                  work may still finish in the background, but it won’t continue the pipeline.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep running</AlertDialogCancel>
                <AlertDialogAction onClick={handleCancelRun}>Stop run</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        
        {/* Restart Research button */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              className="w-full gap-2 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" />
              Restart Competitor Research
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Restart competitor research?</AlertDialogTitle>
              <AlertDialogDescription>
                Choose whether to rerun discovery immediately (recommended if the current job is stuck) or go back to
                the setup screen.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button variant="outline" onClick={onRetry} className="gap-2">
                Back to setup
              </Button>
              <AlertDialogAction
                onClick={() => {
                  if (onRestartNow) onRestartNow();
                  else onRetry();
                }}
              >
                Restart & run discovery
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        
        {!isComplete && (
          <p className="text-xs text-center text-muted-foreground">
            You can continue while this runs in the background (~{estimateTime()})
          </p>
        )}
      </div>
    </div>
  );
}
