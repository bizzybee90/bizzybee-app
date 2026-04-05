import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import {
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  Globe,
  FileText,
  Download,
  Loader2,
  Search,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { BizzyBeeLogo } from '@/components/branding/BizzyBeeLogo';

interface KnowledgeBaseStepProps {
  workspaceId: string;
  businessContext: {
    companyName: string;
    businessType: string;
    websiteUrl?: string;
  };
  onComplete: (results: { industryFaqs: number; websiteFaqs: number }) => void;
  onBack: () => void;
}

type Status = 'checking' | 'idle' | 'already_done' | 'starting' | 'polling' | 'complete' | 'error';

interface ExistingKnowledge {
  faqCount: number;
  pagesScraped: number;
  scrapedAt: string | null;
}

export function KnowledgeBaseStep({
  workspaceId,
  businessContext,
  onComplete,
  onBack,
}: KnowledgeBaseStepProps) {
  const [status, setStatus] = useState<Status>('checking');
  const [jobDbId, setJobDbId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [existingKnowledge, setExistingKnowledge] = useState<ExistingKnowledge | null>(null);

  // Polling state
  const [pollingFaqCount, setPollingFaqCount] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pollingStartRef = useRef<number | null>(null);
  const lastCountRef = useRef<number>(-1);
  const stableCountRef = useRef<number>(0);

  // Check if we already have website knowledge
  useEffect(() => {
    const checkExisting = async () => {
      if (!businessContext.websiteUrl) {
        setStatus('idle');
        return;
      }

      try {
        // Check for existing completed scraping job
        const { data: job } = await supabase
          .from('scraping_jobs')
          .select('id, status, faqs_found, pages_processed, completed_at')
          .eq('workspace_id', workspaceId)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (job && job.faqs_found > 0) {
          setExistingKnowledge({
            faqCount: job.faqs_found,
            pagesScraped: job.pages_processed || 0,
            scrapedAt: job.completed_at,
          });
          setStatus('already_done');
          return;
        }

        // Check for FAQs from website source
        // @ts-expect-error - Supabase types cause deep instantiation errors
        const faqResult = await supabase
          .from('faq_database')
          .select('id, generation_source')
          .eq('workspace_id', workspaceId)
          .eq('is_own_content', true)
          .limit(500);
        const faqs = faqResult?.data as Array<{ id: string; generation_source?: string }> | null;
        const faqCount = faqs?.length || 0;

        if (faqCount > 0) {
          // n8n stores the source page URL in generation_source
          const uniquePages = new Set(faqs?.map((f) => f.generation_source).filter(Boolean) ?? []);
          setExistingKnowledge({
            faqCount,
            pagesScraped: uniquePages.size,
            scrapedAt: null,
          });
          setStatus('already_done');
          return;
        }

        setStatus('idle');
      } catch (err) {
        logger.error('Error checking existing knowledge', err);
        setStatus('idle');
      }
    };

    checkExisting();
  }, [workspaceId, businessContext.websiteUrl]);

  // Polling logic: watch faq_database directly while status === 'polling'
  useEffect(() => {
    if (status !== 'polling') return;

    pollingStartRef.current = Date.now();
    lastCountRef.current = -1;
    stableCountRef.current = 0;

    const MAX_POLL_MS = 5 * 60 * 1000; // 5 minutes
    const POLL_INTERVAL_MS = 8000;
    const MIN_STABLE_COUNT = 5;
    const STABLE_TICKS_REQUIRED = 2;

    // Elapsed timer
    const timerInterval = setInterval(() => {
      if (pollingStartRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - pollingStartRef.current) / 1000));
      }
    }, 1000);

    const markComplete = async (count: number) => {
      // Derive pages scraped from distinct generation_source values (n8n stores page URL there)
      let pagesScraped = 0;
      try {
        // @ts-expect-error - Supabase types cause deep instantiation errors
        const { data: pageRows } = await supabase
          .from('faq_database')
          .select('generation_source')
          .eq('workspace_id', workspaceId)
          .eq('is_own_content', true)
          .not('generation_source', 'is', null);
        const uniquePages = new Set(
          (pageRows as Array<{ generation_source: string }> | null)?.map(
            (r) => r.generation_source,
          ) ?? [],
        );
        pagesScraped = uniquePages.size;
      } catch (err) {
        logger.warn('Could not count pages', { error: String(err) });
      }

      // Update scraping_jobs row in DB so re-entry detection works
      // Fix D: fall back to querying the most recent job if jobDbId isn't set (e.g. after remount)
      let resolvedJobId = jobDbId;
      if (!resolvedJobId) {
        try {
          const { data: latestJob } = await supabase
            .from('scraping_jobs')
            .select('id')
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          resolvedJobId = latestJob?.id || null;
        } catch (err) {
          logger.warn('Could not find latest scraping_jobs row', { error: String(err) });
        }
      }
      if (resolvedJobId) {
        try {
          await supabase
            .from('scraping_jobs')
            .update({
              status: 'completed',
              faqs_found: count,
              pages_processed: pagesScraped,
              completed_at: new Date().toISOString(),
            })
            .eq('id', resolvedJobId);
        } catch (err) {
          logger.warn('Could not update scraping_jobs', { error: String(err) });
        }
      }

      setExistingKnowledge({
        faqCount: count,
        pagesScraped,
        scrapedAt: new Date().toISOString(),
      });
      setStatus('already_done');
    };

    const poll = async () => {
      const elapsed = pollingStartRef.current ? Date.now() - pollingStartRef.current : 0;

      try {
        // @ts-expect-error - Supabase types cause deep instantiation errors
        const { count } = await supabase
          .from('faq_database')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('is_own_content', true);

        const currentCount = count || 0;
        setPollingFaqCount(currentCount);

        // Check stability
        if (currentCount >= MIN_STABLE_COUNT && currentCount === lastCountRef.current) {
          stableCountRef.current += 1;
          if (stableCountRef.current >= STABLE_TICKS_REQUIRED) {
            clearInterval(pollInterval);
            clearInterval(timerInterval);
            await markComplete(currentCount);
            return;
          }
        } else {
          stableCountRef.current = 0;
        }
        lastCountRef.current = currentCount;

        // 5-minute timeout
        if (elapsed >= MAX_POLL_MS) {
          clearInterval(pollInterval);
          clearInterval(timerInterval);
          if (currentCount > 0) {
            await markComplete(currentCount);
          } else {
            setError('The scrape timed out. You can add FAQs manually later or try again.');
            setStatus('error');
          }
        }
      } catch (err) {
        logger.error('Polling error', err);
      }
    };

    // First poll immediately, then every 8s
    poll();
    const pollInterval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      clearInterval(pollInterval);
      clearInterval(timerInterval);
    };
  }, [status, workspaceId, jobDbId]);

  const startScraping = async () => {
    if (!businessContext.websiteUrl) return;

    setStatus('starting');
    setError(null);
    setPollingFaqCount(0);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('trigger-n8n-workflow', {
        body: {
          workspace_id: workspaceId,
          workflow_type: 'own_website_scrape',
          websiteUrl: businessContext.websiteUrl,
        },
      });

      if (invokeError) throw new Error(invokeError.message || 'Failed to start scraping');
      if (!data?.success) throw new Error(data?.error || 'Failed to start scraping');

      setJobDbId(data.jobId || null);
      setStatus('polling');
    } catch (err: any) {
      logger.error('Start scraping error', err);
      setError(err.message || 'Something went wrong');
      setStatus('error');
    }
  };

  const handleSkip = () => {
    onComplete({ industryFaqs: 0, websiteFaqs: 0 });
  };

  const handleContinueWithExisting = () => {
    onComplete({ industryFaqs: 0, websiteFaqs: existingKnowledge?.faqCount || 0 });
  };

  const elapsedLabel = (() => {
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  })();

  // ── Checking state ──────────────────────────────────────────────
  if (status === 'checking') {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">Checking existing knowledge...</h2>
          <p className="text-sm text-muted-foreground">Just a moment</p>
        </div>
      </div>
    );
  }

  // ── Already done state ──────────────────────────────────────────
  if (status === 'already_done' && existingKnowledge) {
    const pagesCount = existingKnowledge.pagesScraped || 0;
    const faqCount = existingKnowledge.faqCount || 0;
    const websiteDomain =
      businessContext.websiteUrl?.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || '';
    const faviconUrl = businessContext.websiteUrl
      ? `https://www.google.com/s2/favicons?domain=${websiteDomain}&sz=64`
      : null;

    return (
      <div className="space-y-5">
        {/* Header with dual logos */}
        <div className="flex items-center justify-center gap-4 pt-2">
          <div className="flex items-center gap-2">
            <BizzyBeeLogo variant="full" size="sm" imgClassName="max-w-[118px]" />
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <div className="flex items-center gap-2">
            {faviconUrl && (
              <img src={faviconUrl} alt={businessContext.companyName} className="h-8 w-8 rounded" />
            )}
            <span className="font-bold text-base">
              {businessContext.companyName || websiteDomain}
            </span>
          </div>
        </div>

        <div className="text-center space-y-1">
          <h2 className="text-xl font-semibold">Knowledge Base Ready</h2>
          <p className="text-sm text-muted-foreground">{businessContext.websiteUrl}</p>
        </div>

        {/* Results summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card border rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-primary">{pagesCount || '—'}</p>
            <p className="text-xs text-muted-foreground">Pages Scraped</p>
          </div>
          <div className="bg-card border rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-primary">{faqCount}</p>
            <p className="text-xs text-muted-foreground">FAQs Extracted</p>
          </div>
          <div className="bg-card border rounded-xl p-3 text-center">
            <CheckCircle2 className="h-6 w-6 text-primary mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Complete</p>
          </div>
        </div>

        {/* Stage progress */}
        <div className="border rounded-xl overflow-hidden">
          {[
            {
              icon: Search,
              label: 'Discover Pages',
              detail: pagesCount ? `${pagesCount} pages found` : 'Complete',
            },
            {
              icon: Globe,
              label: 'Scrape Content',
              detail: pagesCount ? `${pagesCount} pages scraped` : 'Complete',
            },
            { icon: Sparkles, label: 'Extract Knowledge', detail: `${faqCount} FAQs extracted` },
          ].map(({ icon: Icon, label, detail }, i) => (
            <div
              key={i}
              className={`flex items-center justify-between px-4 py-2.5 ${i < 2 ? 'border-b' : ''}`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{detail}</span>
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              </div>
            </div>
          ))}
        </div>

        {/* PDF Download */}
        <Button
          variant="outline"
          onClick={async () => {
            setDownloadingPDF(true);
            try {
              const { generateKnowledgeBasePDF } =
                await import('@/components/settings/knowledge-base/generateKnowledgeBasePDF');
              await generateKnowledgeBasePDF(workspaceId, businessContext.companyName);
              toast.success('Knowledge Base PDF downloaded!');
            } catch (err) {
              logger.error('PDF generation error', err);
              toast.error('Failed to generate PDF');
            } finally {
              setDownloadingPDF(false);
            }
          }}
          disabled={downloadingPDF}
          className="w-full gap-2"
        >
          {downloadingPDF ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download Knowledge Base PDF
        </Button>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            Back
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              // Fix A: clear stale faq_database + scraping_jobs rows so re-entry doesn't detect old data
              try {
                await Promise.all([
                  supabase
                    .from('faq_database')
                    .delete()
                    .eq('workspace_id', workspaceId)
                    .eq('is_own_content', true),
                  supabase.from('scraping_jobs').delete().eq('workspace_id', workspaceId),
                ]);
              } catch (err) {
                logger.warn('Could not clear stale rows before re-scrape', { error: String(err) });
              }
              setExistingKnowledge(null);
              setJobDbId(null);
              setStatus('idle');
            }}
            className="gap-1 text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Re-scrape
          </Button>
          <Button onClick={handleContinueWithExisting} className="flex-1">
            Continue
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Polling state (n8n running, watching faq_database) ──────────
  if (status === 'polling') {
    const faqsDetected = pollingFaqCount >= 5;

    const stages = [
      { icon: Search, label: 'Discover Pages' },
      { icon: Globe, label: 'Scrape Content' },
      { icon: Sparkles, label: 'Extract Knowledge' },
    ];

    return (
      <div className="space-y-5">
        <div className="text-center space-y-1">
          <h2 className="text-xl font-semibold">Extracting your website knowledge...</h2>
          <p className="text-sm text-muted-foreground">{businessContext.websiteUrl}</p>
        </div>

        {/* Stage rows */}
        <div className="border rounded-xl overflow-hidden">
          {stages.map(({ icon: Icon, label }, i) => (
            <div
              key={i}
              className={`flex items-center justify-between px-4 py-2.5 ${i < stages.length - 1 ? 'border-b' : ''}`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{label}</span>
              </div>
              {faqsDetected ? (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              )}
            </div>
          ))}
        </div>

        {/* Live FAQ counter */}
        <div className="bg-muted/40 border rounded-xl p-4 text-center space-y-1">
          <p className="text-3xl font-bold text-primary">{pollingFaqCount}</p>
          <p className="text-sm text-muted-foreground">FAQs found so far</p>
          {elapsedSeconds > 0 && (
            <p className="text-xs text-muted-foreground">{elapsedLabel} elapsed</p>
          )}
        </div>

        <p className="text-xs text-center text-muted-foreground">
          This usually takes 1–3 minutes. Feel free to wait or skip for now.
        </p>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button variant="ghost" onClick={handleSkip} className="flex-1 text-muted-foreground">
            Skip for now
          </Button>
        </div>
      </div>
    );
  }

  // ── Starting state ──────────────────────────────────────────────
  if (status === 'starting') {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <h2 className="text-xl font-semibold">Connecting to your website...</h2>
          <p className="text-sm text-muted-foreground">This will just take a moment</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button variant="ghost" onClick={handleSkip} className="flex-1 text-muted-foreground">
            Skip this step
          </Button>
        </div>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">
              {error || "We couldn't scrape your website. You can add FAQs manually later."}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button variant="outline" onClick={handleSkip} className="flex-1">
            Skip for now
          </Button>
          <Button
            onClick={() => {
              setError(null);
              setStatus('idle');
            }}
            className="flex-1"
          >
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // ── Idle state ──────────────────────────────────────────────────
  if (!businessContext.websiteUrl) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">Ready to continue</h2>
          <p className="text-sm text-muted-foreground">
            You can add FAQs manually in Settings → Knowledge Base later
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button
            onClick={() => onComplete({ industryFaqs: 0, websiteFaqs: 0 })}
            className="flex-1"
          >
            Continue
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <Globe className="h-12 w-12 text-primary mx-auto" />
        <h2 className="text-xl font-semibold">Extract Website Knowledge</h2>
        <p className="text-sm text-muted-foreground">
          We'll scrape your website to extract FAQs, pricing, and services
        </p>
      </div>

      <div className="bg-muted/30 border rounded-lg p-4">
        <div className="flex items-center gap-3">
          <Globe className="h-5 w-5 text-muted-foreground" />
          <p className="font-medium">{businessContext.websiteUrl}</p>
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button variant="ghost" onClick={handleSkip} className="flex-1 text-muted-foreground">
          Skip this step
        </Button>
        <Button onClick={() => startScraping()} className="flex-1">
          Start Scraping
        </Button>
      </div>
    </div>
  );
}
