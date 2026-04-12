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
} from 'lucide-react';
import { toast } from 'sonner';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useOnboardingProgress } from '@/hooks/useOnboardingProgress';

interface ProgressScreenProps {
  workspaceId: string;
  onNext: () => void;
  onBack: () => void;
}

interface TrackState {
  status: string;
  counts: { label: string; value: number }[];
  error?: string | null;
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

function mapDiscoveryStatus(track: OnboardingProgressTrack | undefined): string {
  if (!track) return 'pending';
  if (track.agent_status === 'failed' || track.latest_error) return 'failed';
  if (track.agent_status === 'succeeded') return 'complete';
  if (track.agent_status === 'queued') return 'pending';

  switch (track.current_step) {
    case 'acquire':
      return 'discovering';
    case 'qualify':
      return 'search_complete';
    case 'persist':
      return 'health_check_complete';
    default:
      return 'starting';
  }
}

function mapFaqStatus(
  discoveryTrack: OnboardingProgressTrack | undefined,
  faqTrack: OnboardingProgressTrack | undefined,
): string {
  if (faqTrack?.agent_status === 'failed' || faqTrack?.latest_error) return 'failed';
  if (faqTrack?.agent_status === 'succeeded') return 'complete';
  if (faqTrack?.agent_status === 'queued') return 'pending';

  switch (faqTrack?.current_step) {
    case 'load_context':
      return 'validating';
    case 'fetch_pages':
      return 'scraping';
    case 'generate_candidates':
      return 'extracting';
    case 'dedupe':
    case 'finalize':
    case 'persist':
      return 'scrape_processing';
    default:
      break;
  }

  if (mapDiscoveryStatus(discoveryTrack) === 'complete') {
    return 'review_ready';
  }

  return 'waiting';
}

function mapEmailImportStatus(track: OnboardingProgressTrack | undefined): string {
  if (!track) return 'pending';
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
}

function InlineCompetitorReview({
  workspaceId,
  onStartAnalysis,
  autoStarted = false,
  scrapeComplete = false,
  canStartAnalysis = true,
  analysisStatusMessage,
}: {
  workspaceId: string;
  onStartAnalysis: () => void;
  autoStarted?: boolean;
  scrapeComplete?: boolean;
  canStartAnalysis?: boolean;
  analysisStatusMessage?: string;
}) {
  const [competitors, setCompetitors] = useState<CompetitorItem[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [manualUrl, setManualUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isRemovingId, setIsRemovingId] = useState<string | null>(null);

  const loadCompetitors = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) {
        setIsLoading(true);
      }

      const { data: latestJob, error: jobError } = await supabase
        .from('competitor_research_jobs')
        .select('id')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (jobError) {
        logger.error('Failed to load latest competitor job', jobError);
        setCompetitors([]);
        setJobId(null);
        setIsLoading(false);
        return;
      }

      setJobId(latestJob?.id ?? null);

      if (!latestJob?.id) {
        setCompetitors([]);
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('competitor_sites')
        .select('id, business_name, domain, url, is_selected, discovery_source, validation_status')
        .eq('job_id', latestJob.id)
        .not('status', 'eq', 'rejected')
        .order('distance_miles', { ascending: true, nullsFirst: false })
        .order('relevance_score', { ascending: false, nullsFirst: false });

      if (error) {
        logger.error('Failed to load discovered competitors', error);
        setCompetitors([]);
      } else {
        const mapped = (data || []).map((c) => ({
          id: c.id,
          business_name: c.business_name,
          domain: c.domain,
          url: c.url,
          is_selected: c.is_selected ?? true,
          discovery_source: c.discovery_source,
          validation_status: c.validation_status,
        }));

        if (mapped.length > 0) {
          setCompetitors(mapped);
        } else {
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('competitor_sites')
            .select(
              'id, business_name, domain, url, is_selected, discovery_source, validation_status',
            )
            .eq('workspace_id', workspaceId)
            .not('status', 'eq', 'rejected')
            .order('created_at', { ascending: false })
            .limit(50);

          if (fallbackError) {
            logger.error('Failed to load fallback competitors', fallbackError);
            setCompetitors([]);
          } else {
            setCompetitors(
              (fallbackData || []).map((c) => ({
                id: c.id,
                business_name: c.business_name,
                domain: c.domain,
                url: c.url,
                is_selected: c.is_selected ?? true,
                discovery_source: c.discovery_source,
                validation_status: c.validation_status,
              })),
            );
          }
        }
      }
      setIsLoading(false);
    },
    [workspaceId],
  );

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

  const toggleSelection = async (id: string, value: boolean) => {
    setCompetitors((prev) => prev.map((c) => (c.id === id ? { ...c, is_selected: value } : c)));
    await supabase.from('competitor_sites').update({ is_selected: value }).eq('id', id);
  };

  const addManualUrl = async () => {
    if (!manualUrl.trim()) return;
    if (!jobId) {
      toast.error('Competitor discovery is still starting');
      return;
    }

    let cleanUrl = manualUrl.trim();
    if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;
    let hostname: string;
    try {
      hostname = new URL(cleanUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      toast.error('Invalid URL');
      return;
    }

    if (competitors.some((c) => c.domain === hostname)) {
      toast.error('Already in the list');
      return;
    }

    setIsAdding(true);

    const { data: existingRows } = await supabase
      .from('competitor_sites')
      .select('id, business_name, domain, url, is_selected, discovery_source, validation_status')
      .eq('workspace_id', workspaceId)
      .or(`domain.eq.${hostname},url.eq.${cleanUrl}`)
      .limit(1);

    if (existingRows && existingRows.length > 0) {
      const existing = existingRows[0];
      setCompetitors((prev) =>
        prev.some((c) => c.id === existing.id)
          ? prev
          : [
              {
                id: existing.id,
                business_name: existing.business_name,
                domain: existing.domain,
                url: existing.url,
                is_selected: existing.is_selected ?? true,
                discovery_source: existing.discovery_source,
                validation_status: existing.validation_status,
              },
              ...prev,
            ],
      );
      setManualUrl('');
      setIsAdding(false);
      toast.success('Competitor already existed and has been loaded');
      return;
    }

    const { data, error } = await supabase
      .from('competitor_sites')
      .insert({
        job_id: jobId,
        workspace_id: workspaceId,
        business_name: hostname,
        url: cleanUrl,
        domain: hostname,
        discovery_source: 'manual',
        status: 'approved',
        scrape_status: 'pending',
        is_selected: true,
        validation_status: 'pending',
        relevance_score: 100,
      })
      .select('id, business_name, domain, url, is_selected, discovery_source, validation_status')
      .single();

    if (error) {
      logger.error('Failed to add manual competitor', error);
      toast.error('Failed to add');
    } else if (data) {
      setCompetitors((prev) => [data as CompetitorItem, ...prev]);
      setManualUrl('');
      toast.success('Competitor added');
    }
    setIsAdding(false);
  };

  const removeCompetitor = async (id: string) => {
    const existing = competitors.find((c) => c.id === id);
    if (!existing) return;

    setIsRemovingId(id);
    setCompetitors((prev) => prev.filter((c) => c.id !== id));

    const { error } = await supabase.from('competitor_sites').delete().eq('id', id);

    if (error) {
      logger.error('Failed to remove competitor', error);
      setCompetitors((prev) => [existing, ...prev]);
      toast.error('Failed to remove');
    } else {
      toast.success('Competitor removed');
    }
    setIsRemovingId(null);
  };

  const handleStart = async () => {
    if (selectedCount === 0) {
      toast.error('Select at least one competitor');
      return;
    }
    setIsStarting(true);
    try {
      const selectedCompetitorIds = competitors
        .filter((competitor) => competitor.is_selected)
        .map((competitor) => competitor.id);

      const { data, error } = await supabase.functions.invoke('start-faq-generation', {
        body: {
          workspace_id: workspaceId,
          selected_competitor_ids: selectedCompetitorIds,
          target_count: selectedCount,
          trigger_source: 'onboarding_progress_inline_review',
        },
      });
      if (error) throw error;
      toast.success(`Analysis started for ${data?.sitesCount || selectedCount} competitors`);
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
          <span className="text-muted-foreground font-normal ml-1">({selectedCount} selected)</span>
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
            {competitors.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 p-1.5 rounded hover:bg-accent/50 text-sm"
              >
                <Checkbox
                  checked={c.is_selected}
                  onCheckedChange={(v) => toggleSelection(c.id, !!v)}
                />
                <Globe className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.business_name || c.domain}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.domain}</div>
                </div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {c.discovery_source === 'manual' ? 'Manual' : 'Found'}
                </div>
                <Button
                  size="icon"
                  type="button"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  disabled={isRemovingId === c.id}
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
          disabled={isStarting || selectedCount === 0}
          className="w-full gap-2"
          size="sm"
        >
          {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {scrapeComplete
            ? `Re-run Analysis (${selectedCount} competitors)`
            : `Start Analysis (${selectedCount} competitors)`}
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

export function ProgressScreen({ workspaceId, onNext, onBack }: ProgressScreenProps) {
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
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (isPreview || !onboardingProgress?.tracks) return;

    const discovery = onboardingProgress.tracks.discovery as OnboardingProgressTrack;
    const faq = onboardingProgress.tracks.faq_generation as OnboardingProgressTrack;
    const email = onboardingProgress.tracks.email_import as OnboardingProgressTrack;

    const mappedDiscoveryStatus = mapDiscoveryStatus(discovery);
    const mappedFaqStatus = mapFaqStatus(discovery, faq);
    const mappedEmailImportStatus = mapEmailImportStatus(email);
    const mappedEmailStatus = mapEmailClassificationStatus(email);

    setLiveFaqCount(
      Number(onboardingProgress.tracks.faq_counts?.competitor_faqs || faq.counts?.faqs_added || 0),
    );

    setDiscoveryTrack({
      status: mappedDiscoveryStatus,
      counts: [
        {
          label: 'competitors found',
          value: Number(discovery.counts?.sites_discovered || 0),
        },
      ],
      error: discovery.latest_error || null,
    });

    setScrapeTrack({
      status: mappedFaqStatus,
      counts: [
        { label: 'scraped', value: Number(faq.counts?.sites_scraped || 0) },
        {
          label: 'FAQs generated',
          value: Number(
            onboardingProgress.tracks.faq_counts?.competitor_faqs || faq.counts?.faqs_added || 0,
          ),
        },
      ],
      error: faq.latest_error || null,
      current: Number(faq.counts?.sites_scraped || 0) || undefined,
      total: Number(discovery.counts?.sites_approved || 0) || undefined,
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
  }, [isPreview, onboardingProgress]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Bug 4 Fix: Require ALL three tracks to be complete
  const isDiscoveryComplete = discoveryTrack.status === 'complete';
  const isScrapeComplete = scrapeTrack.status === 'complete';
  const isEmailImportComplete = emailImportTrack.status === 'complete';
  const isEmailComplete =
    emailTrack.status === 'complete' || emailTrack.status === 'classification_complete';
  const allComplete =
    isDiscoveryComplete && isScrapeComplete && isEmailImportComplete && isEmailComplete;
  const canReviewCompetitors = isDiscoveryComplete && !reviewDismissed;
  const canStartCompetitorAnalysis =
    scrapeTrack.status === 'review_ready' || scrapeTrack.status === 'complete';
  const competitorReviewStatusMessage =
    scrapeTrack.status === 'validating'
      ? 'BizzyBee is validating the competitors now. You can review the list while this finishes.'
      : scrapeTrack.status === 'pending'
        ? 'Competitors are queued for analysis. You can still review the list below.'
        : scrapeTrack.status === 'scraping' ||
            scrapeTrack.status === 'extracting' ||
            scrapeTrack.status === 'scrape_processing'
          ? 'Analysis is already running. You can still inspect the competitor list below.'
          : undefined;

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
            workspaceId={workspaceId}
            onStartAnalysis={() => setReviewDismissed(true)}
            autoStarted={false}
            scrapeComplete={scrapeTrack.status === 'complete'}
            canStartAnalysis={canStartCompetitorAnalysis}
            analysisStatusMessage={competitorReviewStatusMessage}
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
        <TrackProgress
          title="Importing Emails"
          phases={EMAIL_IMPORT_PHASES}
          currentStatus={emailImportTrack.status}
          counts={emailImportTrack.counts}
          error={emailImportTrack.error}
        />
        <TrackProgress
          title="Email Classification"
          phases={EMAIL_PHASES}
          currentStatus={emailTrack.status}
          counts={emailTrack.counts}
          error={emailTrack.error}
          actualPercent={emailTrack.actualPercent}
        />
      </div>

      {!allComplete && (
        <div className="text-center text-sm text-muted-foreground p-4 bg-muted/30 rounded-lg">
          <p>
            {scrapeTrack.status === 'scraping' || scrapeTrack.status === 'extracting'
              ? 'This may take 10-15 minutes depending on the number of competitors.'
              : 'This typically takes 3-5 minutes for the initial setup.'}
          </p>
          <p className="mt-1">
            Deep learning from your full email history will continue in the background.
          </p>
        </div>
      )}

      <div className="flex flex-col items-center gap-3 pt-4">
        <Button onClick={onNext} disabled={!allComplete} size="lg" className="gap-2">
          {allComplete ? (
            <>
              Continue
              <ChevronRight className="h-4 w-4" />
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing...
            </>
          )}
        </Button>
        {!allComplete && (
          <div className="flex gap-3">
            <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
              ← Back
            </Button>
            <Button variant="outline" size="sm" onClick={onNext}>
              Skip for now →
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
