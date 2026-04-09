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
}: {
  workspaceId: string;
  onStartAnalysis: () => void;
  autoStarted?: boolean;
  scrapeComplete?: boolean;
}) {
  const [competitors, setCompetitors] = useState<CompetitorItem[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [manualUrl, setManualUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isRemovingId, setIsRemovingId] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      setIsLoading(true);
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
        setCompetitors(
          (data || []).map((c) => ({
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
      setIsLoading(false);
    };
    fetch();
  }, [workspaceId, scrapeComplete]);

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
      const { data, error } = await supabase.functions.invoke('trigger-n8n-workflow', {
        body: { workspace_id: workspaceId, workflow_type: 'faq_generation' },
      });
      if (error) throw error;
      toast.success(`Analysis started for ${data.competitors_count} competitors`);
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
            No competitors loaded yet. You can add one manually below if you want to widen the set.
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

      {/* Start/Re-run button — hidden while auto-trigger is in progress, shown when complete for re-runs */}
      {(!autoStarted || scrapeComplete) && (
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
  const [isLoading, setIsLoading] = useState(!isPreview);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [liveFaqCount, setLiveFaqCount] = useState(0);
  const liveFaqCountRef = useRef(0);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const startTimeRef = useRef<number>(Date.now());
  const autoTriggeredRef = useRef(false);

  const resetDiscoveryTrack = useCallback(() => {
    setDiscoveryTrack({
      status: 'starting',
      counts: [],
      error: null,
    });
  }, []);

  // Auto-trigger n8n workflows on mount (fire-and-forget)
  useEffect(() => {
    if (autoTriggeredRef.current || isPreview) return;
    autoTriggeredRef.current = true;

    const autoTrigger = async () => {
      try {
        const STALE_THRESHOLD_MS = 10 * 60 * 1000;

        // Check competitor_discovery status
        const { data: workflowRecords } = (await supabase
          .from('n8n_workflow_progress' as 'allowed_webhook_ips')
          .select('workflow_type, status, details, updated_at')
          .eq('workspace_id', workspaceId)) as unknown as {
          data: Array<{
            workflow_type: string;
            status: string;
            details?: Record<string, unknown> | null;
            updated_at?: string | null;
          }> | null;
        };

        const discoveryRecord = workflowRecords?.find(
          (r) => r.workflow_type === 'competitor_discovery',
        );
        const emailRecord = workflowRecords?.find((r) => r.workflow_type === 'email_import');
        const isDiscoveryStale =
          !!discoveryRecord?.updated_at &&
          !['complete', 'failed', 'classification_complete'].includes(discoveryRecord.status) &&
          Date.now() - new Date(discoveryRecord.updated_at).getTime() > STALE_THRESHOLD_MS;
        const discoveryFailedWithoutResults =
          discoveryRecord?.status === 'failed' &&
          ((discoveryRecord.details?.competitors_found as number | undefined) || 0) === 0;

        // Trigger competitor_discovery if no record, still pending, or failed/timed out with no results
        if (
          !discoveryRecord ||
          discoveryRecord.status === 'pending' ||
          discoveryFailedWithoutResults ||
          isDiscoveryStale
        ) {
          resetDiscoveryTrack();
          supabase.functions
            .invoke('trigger-n8n-workflow', {
              body: { workspace_id: workspaceId, workflow_type: 'competitor_discovery' },
            })
            .catch((err) => logger.error('competitor_discovery trigger failed', err));
        }

        // Check email import queue count — used for both guards below
        const { count: emailQueueCount } = (await supabase
          .from('email_import_queue' as 'allowed_webhook_ips')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)) as unknown as { count: number | null };

        // Guarded email_classification trigger — only if emails exist in the queue
        if (!emailRecord || emailRecord.status === 'pending') {
          if ((emailQueueCount ?? 0) > 0) {
            // Emails already imported — trigger classification
            supabase.functions
              .invoke('trigger-n8n-workflow', {
                body: { workspace_id: workspaceId, workflow_type: 'email_classification' },
              })
              .catch((err) => logger.error('email_classification trigger failed', err));
          }
        }

        // Email import recovery — fires regardless of email_import status
        // Handles cases where start-email-import never ran (queue empty but config exists)
        // Also covers 'dispatched' status where classification ran on empty queue
        if ((emailQueueCount ?? 0) === 0) {
          const { data: emailConfig } = (await supabase
            .from('email_provider_configs' as 'allowed_webhook_ips')
            .select('id, sync_status')
            .eq('workspace_id', workspaceId)
            .maybeSingle()) as unknown as { data: { id: string; sync_status: string } | null };

          if (emailConfig && emailConfig.sync_status === 'pending') {
            logger.debug('Email queue empty + config pending, triggering start-email-import');
            supabase.functions
              .invoke('start-email-import', {
                body: { config_id: emailConfig.id, workspace_id: workspaceId, mode: 'onboarding' },
              })
              .catch((err) => logger.error('start-email-import trigger failed', err));
          }
        }
      } catch (err) {
        logger.error('Auto-trigger check failed', err);
      }
    };

    autoTrigger();
  }, [workspaceId, isPreview, resetDiscoveryTrack]);

  // Realtime subscription for live FAQ count + keep ref in sync
  useEffect(() => {
    liveFaqCountRef.current = liveFaqCount;
  }, [liveFaqCount]);

  useEffect(() => {
    if (isPreview) return;

    // Initial count + periodic re-fetch to catch batch inserts
    const fetchCount = async () => {
      const { count } = await supabase
        .from('faq_database')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('is_own_content', false);
      const newCount = count || 0;
      setLiveFaqCount(newCount);
      liveFaqCountRef.current = newCount;
    };
    fetchCount();

    // Re-fetch every 15s to catch batch inserts from consolidation
    const countInterval = window.setInterval(fetchCount, 15000);

    const channel = supabase
      .channel('faq-progress')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'faq_database',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          setLiveFaqCount((prev) => prev + 1);
        },
      )
      .subscribe();

    return () => {
      window.clearInterval(countInterval);
      supabase.removeChannel(channel);
    };
  }, [workspaceId, isPreview]);

  useEffect(() => {
    if (isPreview) return;

    const pollProgress = async () => {
      try {
        // Bug 5 Fix: Poll n8n_workflow_progress for ALL tracks + email_import_progress for email counts
        const [workflowRes, emailProgressRes] = await Promise.all([
          supabase
            .from('n8n_workflow_progress' as 'allowed_webhook_ips')
            .select('*')
            .eq('workspace_id', workspaceId),
          supabase
            .from('email_import_progress' as 'allowed_webhook_ips')
            .select('*')
            .eq('workspace_id', workspaceId)
            .maybeSingle(),
        ]);

        const records = (workflowRes.data || []) as unknown as Array<{
          workflow_type: string;
          status: string;
          details: Record<string, unknown>;
          updated_at: string;
        }>;

        // Stale detection: if a non-terminal track hasn't updated in 10 min, mark as failed
        const STALE_THRESHOLD_MS = 10 * 60 * 1000;
        const now = Date.now();
        const isStale = (record: (typeof records)[0] | undefined) => {
          if (!record?.updated_at) return false;
          const terminal = ['complete', 'failed', 'classification_complete'];
          if (terminal.includes(record.status)) return false;
          return now - new Date(record.updated_at).getTime() > STALE_THRESHOLD_MS;
        };

        // Bug 4 Fix: Track all three workflow types
        const discoveryRecord = records.find((r) => r.workflow_type === 'competitor_discovery');
        const scrapeRecord = records.find((r) => r.workflow_type === 'competitor_scrape');
        const emailRecord = records.find((r) => r.workflow_type === 'email_import');

        // Discovery track (Workflow 1)
        const discoveryDetails = (discoveryRecord?.details || {}) as Record<string, unknown>;
        const discoveryStatus = isStale(discoveryRecord)
          ? 'failed'
          : discoveryRecord?.status || 'pending';

        setDiscoveryTrack({
          status: discoveryStatus,
          counts: discoveryRecord
            ? [
                {
                  label: 'competitors found',
                  value: (discoveryDetails.competitors_found as number) || 0,
                },
              ]
            : [],
          error: isStale(discoveryRecord)
            ? 'Timed out — the workflow may have failed. Please retry.'
            : (discoveryDetails.error as string | undefined),
        });

        // faq_generation is now triggered manually via the InlineCompetitorReview "Start Analysis" button
        // This ensures users can review, add, and curate competitors before scraping begins

        // Scrape track (Workflow 2) — stays 'waiting' until discovery completes
        const scrapeDetails = (scrapeRecord?.details || {}) as Record<string, unknown>;
        const scrapeStatus =
          scrapeRecord?.status || (discoveryStatus === 'complete' ? 'pending' : 'waiting');

        setScrapeTrack({
          status: scrapeStatus,
          counts: scrapeRecord
            ? [
                {
                  label: 'scraped',
                  value:
                    (scrapeDetails.current as number) ||
                    (scrapeDetails.competitors_scraped as number) ||
                    0,
                },
                { label: 'FAQs generated', value: liveFaqCountRef.current },
              ]
            : [],
          error: scrapeDetails.error as string | undefined,
          currentCompetitor: scrapeDetails.current_competitor as string | undefined,
          current: scrapeDetails.current as number | undefined,
          total: scrapeDetails.total as number | undefined,
        });

        // Email track — use email_import_progress table for accurate counts
        const emailStatus = emailRecord?.status || 'pending';
        const emailDetails = (emailRecord?.details || {}) as Record<string, unknown>;
        const emailProgress = emailProgressRes.data as unknown as Record<string, unknown> | null;

        if (emailProgress || emailRecord) {
          // Prefer emails_received (live counter) over stale dispatcher snapshot
          const totalEmails =
            (emailProgress?.emails_received as number) ||
            (emailProgress?.estimated_total_emails as number) ||
            (emailDetails.total_emails as number) ||
            0;
          const rawClassified =
            (emailDetails.emails_classified as number) ||
            (emailProgress?.emails_classified as number) ||
            0;
          // Cap classified to never exceed total (prevents >100% display bugs)
          const classifiedEmails =
            totalEmails > 0 ? Math.min(rawClassified, totalEmails) : rawClassified;

          let importStatus: string = 'pending';
          let effectiveEmailStatus = emailStatus;

          // Detect learning/voice phase as complete for the progress screen
          const currentPhase = emailProgress?.current_phase as string | undefined;
          const voiceComplete = emailProgress?.voice_profile_complete as boolean | undefined;
          const phase1Done = emailProgress?.phase1_status === 'complete';
          const estimatedTotal =
            (emailProgress?.estimated_total_emails as number | undefined) || undefined;
          const remainingEmails = Math.max(totalEmails - classifiedEmails, 0);

          if (currentPhase === 'error') {
            importStatus = totalEmails > 0 ? 'complete' : 'failed';
            effectiveEmailStatus = 'failed';
          } else if (currentPhase === 'importing') {
            importStatus = 'importing';
            effectiveEmailStatus = 'pending';
          } else if (
            currentPhase === 'classifying' ||
            currentPhase === 'learning' ||
            currentPhase === 'complete' ||
            currentPhase === 'converting'
          ) {
            importStatus = 'complete';
          } else if (totalEmails > 0) {
            importStatus = 'complete';
          }

          if (
            currentPhase === 'learning' ||
            currentPhase === 'complete' ||
            voiceComplete ||
            phase1Done
          ) {
            effectiveEmailStatus = 'complete';
          }

          // Auto-advance from pending if we can see classification is happening
          if (
            totalEmails > 0 &&
            classifiedEmails > 0 &&
            classifiedEmails < totalEmails &&
            effectiveEmailStatus === 'pending'
          ) {
            effectiveEmailStatus = 'classifying';
          }
          // 99% threshold to handle stragglers
          if (totalEmails > 0 && classifiedEmails >= totalEmails * 0.99) {
            effectiveEmailStatus = 'complete';
          }

          // If emails were received but classification never started,
          // check if the phase is stuck on 'importing' with no classification progress
          if (
            effectiveEmailStatus === 'pending' &&
            totalEmails > 0 &&
            classifiedEmails === 0 &&
            currentPhase === 'importing'
          ) {
            effectiveEmailStatus = 'pending'; // Keep pending but show the count
          }

          const percentage =
            totalEmails > 0 ? Math.round((classifiedEmails / totalEmails) * 100) : 0;

          setEmailImportTrack({
            status: importStatus,
            counts: [
              { label: 'emails imported', value: totalEmails },
              ...(estimatedTotal && estimatedTotal > totalEmails
                ? [{ label: 'estimated total', value: estimatedTotal }]
                : []),
            ],
            error:
              currentPhase === 'error'
                ? (emailProgress?.last_error as string | undefined) ||
                  (emailDetails.error as string | undefined)
                : undefined,
          });

          setEmailTrack({
            status: effectiveEmailStatus,
            counts:
              totalEmails > 0
                ? [
                    { label: 'emails classified', value: classifiedEmails },
                    { label: 'remaining', value: remainingEmails },
                  ]
                : [],
            error: emailDetails.error as string | undefined,
            actualPercent: percentage,
          });
        } else {
          setEmailImportTrack({ status: 'pending', counts: [] });
          setEmailTrack({ status: 'pending', counts: [] });
        }
      } catch (error) {
        logger.error('Error polling progress', error);
      } finally {
        setIsLoading(false);
      }
    };

    pollProgress();
    const interval = window.setInterval(pollProgress, 10000);
    return () => window.clearInterval(interval);
  }, [workspaceId, isPreview]);

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

  if (isLoading) {
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
        {/* Inline review gate — shown when discovery is done (review_ready or complete) */}
        {(scrapeTrack.status === 'review_ready' || scrapeTrack.status === 'complete') &&
          !reviewDismissed && (
            <InlineCompetitorReview
              workspaceId={workspaceId}
              onStartAnalysis={() => setReviewDismissed(true)}
              autoStarted={false}
              scrapeComplete={scrapeTrack.status === 'complete'}
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
