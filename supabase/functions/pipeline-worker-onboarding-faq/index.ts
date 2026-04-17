import {
  DEFAULT_TIME_BUDGET_MS,
  HttpError,
  assertWorkerToken,
  createServiceClient,
  jsonResponse,
  queueDelete,
  queueSend,
  readQueue,
  wakeWorker,
  withinBudget,
} from '../_shared/pipeline.ts';
import {
  ONBOARDING_FAQ_QUEUE,
  recordRunArtifact,
  resolveStepModel,
  succeedRun,
  touchAgentRun,
  type OnboardingFaqJob,
} from '../_shared/onboarding.ts';
import {
  deadletterStepJob,
  loadRunRecord,
  resolveQueueAttempt,
  requeueStepJob,
  withTransientRetry,
} from '../_shared/onboarding-worker.ts';
import { createPgmqHeartbeat } from '../_shared/pgmq-heartbeat.ts';
import {
  classifyFetchedPage,
  summarizeFetchOutcomes,
  type FetchOutcome,
} from '../_shared/pageFetchOutcome.ts';
import { beginStep, failStep, succeedStep } from '../faq-agent-runner/lib/step-recorder.ts';
import { type FaqCandidate } from '../faq-agent-runner/lib/onboarding-ai.ts';
import {
  handleFetchSourcePage,
  type FetchResult,
} from '../faq-agent-runner/tools/fetch-source-page.ts';
import { handleGetRunContext, type RunContext } from '../faq-agent-runner/tools/get-run-context.ts';
import { handleMirrorProgress } from '../faq-agent-runner/tools/mirror-progress.ts';
import {
  buildFaqRows,
  dedupeFaqCandidatesAgainstQuestions,
  extractFaqCandidatesFromPages,
  finalizeSharedFaqCandidates,
  loadExistingFaqQuestions,
  loadRunArtifact,
  normalizeFaqQuestion,
  type SharedFaqSourcePage,
} from '../_shared/onboarding-faq-engine.ts';

const QUEUE_NAME = ONBOARDING_FAQ_QUEUE;
// VT was 180s when each competitor only fetched 1 page. With the 8-page
// unified crawl (see handleFetchSourcePage max_pages=8) a batch of 25
// competitor URLs easily runs 4-6 minutes wall-clock despite parallelism.
// If VT expires mid-scrape pgmq redelivers the message and a second worker
// races against the first — duplicate artifacts, flickering progress
// counters, and Apify charged twice for the same work. 600s covers the
// worst observed case (2m 19s) with 4× headroom.
const VT_SECONDS = 600;
const MAX_ATTEMPTS = 5;
const MAX_ONBOARDING_COMPETITOR_SITES = 25;

function resolveCompetitorResearchJobId(run: {
  source_job_id?: string | null;
  input_snapshot?: Record<string, unknown> | null;
}): string | null {
  if (typeof run.source_job_id === 'string' && run.source_job_id.trim().length > 0) {
    return run.source_job_id;
  }

  const fromSnapshot = run.input_snapshot?.competitor_research_job_id;
  return typeof fromSnapshot === 'string' && fromSnapshot.trim().length > 0 ? fromSnapshot : null;
}

async function processJob(
  record: { msg_id: number; read_ct: number; message: OnboardingFaqJob },
  startMs: number,
) {
  const supabase = createServiceClient();
  const job = record.message;
  const run = await loadRunRecord(supabase, job.run_id);

  if (run.workflow_key !== 'faq_generation') {
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    return;
  }

  const sourceJobId = resolveCompetitorResearchJobId(run);
  const model = resolveStepModel(run.input_snapshot, job.step);
  const effectiveAttempt = resolveQueueAttempt(record);
  const targetCount = Math.max(
    3,
    Math.min(MAX_ONBOARDING_COMPETITOR_SITES, Number(run.input_snapshot.target_count || 10)),
  );

  await touchAgentRun(supabase, {
    runId: run.id,
    status: 'running',
    currentStepKey: job.step,
  });

  if (job.step === 'load_context') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'faq:load_context',
      attempt: effectiveAttempt,
      provider: 'runner',
      model,
    });

    try {
      const context = await handleGetRunContext(supabase, { run_id: run.id });
      if (!context.allowed_urls.length) {
        throw new Error('No allowlisted competitor URLs were available');
      }

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'context_snapshot',
        artifactKey: 'faq_context',
        content: context as unknown as Record<string, unknown>,
        stepId: step.id,
      });

      await handleMirrorProgress(
        supabase,
        {
          run_id: run.id,
          stage: 'context_loaded',
          summary: 'Loaded competitor FAQ context',
          metadata: { allowed_url_count: context.allowed_urls.length },
        },
        run.workspace_id,
      );

      await succeedStep(supabase, step.id, { allowed_url_count: context.allowed_urls.length });
      await queueSend(
        supabase,
        QUEUE_NAME,
        {
          run_id: run.id,
          workspace_id: run.workspace_id,
          step: 'fetch_pages',
          attempt: 1,
        },
        0,
      );
      try {
        await wakeWorker(supabase, 'pipeline-worker-onboarding-faq');
      } catch (workerKickError) {
        console.warn('Failed to chain onboarding FAQ fetch step', workerKickError);
      }
      await queueDelete(supabase, QUEUE_NAME, record.msg_id);
      return;
    } catch (error) {
      await failStep(supabase, step.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  if (job.step === 'fetch_pages') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'faq:fetch_pages',
      attempt: effectiveAttempt,
      provider: 'apify',
      model,
    });

    try {
      const context = await loadRunArtifact<RunContext>(
        supabase,
        run.id,
        run.workspace_id,
        'faq_context',
      );
      const selectedCompetitorIds = Array.isArray(run.input_snapshot.selected_competitor_ids)
        ? run.input_snapshot.selected_competitor_ids.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];

      let competitorQuery = supabase
        .from('competitor_sites')
        .select('id, business_name, url')
        .eq('workspace_id', run.workspace_id)
        .eq('is_selected', true)
        .neq('status', 'rejected');

      if (selectedCompetitorIds.length > 0) {
        competitorQuery = competitorQuery.in('id', selectedCompetitorIds);
      }

      const { data: competitors, error: competitorsError } = await competitorQuery;
      if (competitorsError) {
        throw new Error(`Failed to load competitor rows: ${competitorsError.message}`);
      }

      const businessNameByUrl = new Map<string, string>();
      for (const competitor of competitors || []) {
        if (competitor.url) {
          businessNameByUrl.set(competitor.url, competitor.business_name || competitor.url);
        }
      }

      // Parallelised fetch: up to FETCH_CONCURRENCY pages scraped concurrently.
      // Was previously a serial for-loop with up to 60s Apify timeout per URL,
      // which on a 13-site batch produced a 13-minute floor and routinely
      // exceeded both the 50s edge-function wall-clock AND the 180s pgmq
      // visibility timeout (causing duplicate deliveries). Bounded concurrency
      // of 5 cuts wall-clock to ~max-site-time while staying polite to Apify's
      // per-account concurrency and Anthropic downstream.
      // Concurrency was 5 when each competitor scraped 1 page. With 8-page
      // crawls that's 40 Playwright page-fetches in flight, which hammered
      // Apify hard enough to fail 79% of calls (observed 2026-04-17).
      // Concurrency 2 × 8 pages = 16 concurrent — still parallel enough
      // to avoid a 10-minute serial floor, but low enough that Apify's
      // per-account concurrency and each site's rate-limits don't push
      // us into degraded territory.
      const FETCH_CONCURRENCY = 2;
      // Pages-per-competitor cap. Mirrors own-site's crawlWebsitePages
      // default (onboarding-ai.ts#crawlWebsitePages). The real FAQ content
      // typically lives on /services, /pricing, /faq sub-pages — crawling
      // the first 8 internal pages of each competitor gives Claude the
      // same surface area to extract from as own-site gets.
      const PAGES_PER_COMPETITOR = 8;
      const targetUrls = context.allowed_urls.slice(0, targetCount);
      // Per-competitor page buckets. Each bucket holds up to PAGES_PER_COMPETITOR
      // pages from that competitor's crawl. Flattened to a single array at the
      // end for the `faq_pages` artifact — downstream extract/dedupe/finalize
      // already treat `pages` as a flat list keyed by url + source_business.
      const pagesByCompetitor: Array<SharedFaqSourcePage[]> = Array.from(
        { length: targetUrls.length },
        () => [],
      );
      let competitorsCompleted = 0;

      if (sourceJobId) {
        await supabase
          .from('competitor_research_jobs')
          .update({
            status: 'scraping',
            current_scraping_domain: targetUrls[0] || null,
            sites_scraped: 0,
            pages_scraped: 0,
            heartbeat_at: new Date().toISOString(),
          })
          .eq('id', sourceJobId);
      }

      // Pgmq heartbeat: extends this message's visibility timeout in-place
      // while the scrape loop is still running. No-ops for the first 60s
      // (we just popped the message), then issues one pgmq.set_vt every 60s
      // of wall-clock regardless of how fast/slow each iteration is. Prevents
      // pgmq from redelivering this job mid-scrape if wall-clock exceeds the
      // 180s VT — the root cause of duplicate Apify runs + duplicate artifact
      // writes flagged in the 2026-04-15 onboarding-disaster audit. Shared
      // across all FETCH_CONCURRENCY workers; the internal time-gate debounces
      // concurrent calls to at most one set_vt per interval.
      const heartbeat = createPgmqHeartbeat(supabase, QUEUE_NAME, record.msg_id);

      // Per-URL outcome tracking. Previously we just console.warn'd failures
      // and left pagesByIndex[idx] null, so the run succeeded with "12 pages"
      // even when 4 of 12 actually failed. Now we record fetch_failed /
      // empty / too_short structurally and surface a degraded flag on the
      // step if the failure ratio crosses FETCH_DEGRADATION_THRESHOLD.
      const fetchOutcomes: FetchOutcome[] = [];

      const queue = targetUrls.map((url, idx) => ({ url, idx }));
      const workers = Array.from(
        { length: Math.min(FETCH_CONCURRENCY, queue.length) },
        async () => {
          while (true) {
            const next = queue.shift();
            if (!next) return;
            const { url, idx } = next;
            try {
              // Per-competitor 3-min ceiling. Previously one slow site
              // (Cloudflare challenge, huge blog index, etc.) could stall
              // a whole worker past VT and trigger pgmq redelivery. Now
              // we bound each competitor's wall-clock to 180s and fail
              // over cleanly; the pipeline carries on with the remaining
              // sites rather than getting dragged back.
              const PER_COMPETITOR_TIMEOUT_MS = 180_000;
              const fetched = await withTransientRetry(() =>
                Promise.race<FetchResult[]>([
                  handleFetchSourcePage(
                    supabase,
                    { url, run_id: run.id, max_pages: PAGES_PER_COMPETITOR },
                    run.workspace_id,
                    context.allowed_urls,
                  ),
                  new Promise<FetchResult[]>((_, reject) =>
                    setTimeout(
                      () =>
                        reject(
                          new Error(`per-competitor timeout ${PER_COMPETITOR_TIMEOUT_MS / 1000}s`),
                        ),
                      PER_COMPETITOR_TIMEOUT_MS,
                    ),
                  ),
                ]),
              );
              // handleFetchSourcePage now returns an array of up to
              // PAGES_PER_COMPETITOR pages per competitor (was single-page).
              // Classify each individually so one junk page doesn't poison
              // the per-competitor outcome.
              const bucket: SharedFaqSourcePage[] = [];
              for (const page of fetched) {
                const classification = classifyFetchedPage(page?.content ?? null);
                if (classification.status === 'ok') {
                  bucket.push({
                    ...page,
                    source_business: businessNameByUrl.get(url) || url,
                  });
                } else if (classification.status === 'too_short') {
                  console.warn(
                    '[fetch_pages] skipping page with too-short content',
                    page?.url,
                    'length=',
                    classification.contentLength,
                  );
                }
              }
              if (bucket.length > 0) {
                pagesByCompetitor[idx] = bucket;
                fetchOutcomes.push({ ok: true, url });
              } else {
                console.warn('[fetch_pages] all pages empty/too-short for', url);
                fetchOutcomes.push({ ok: false, url, reason: 'empty' });
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.warn('[fetch_pages] handleFetchSourcePage failed for url', url, message);
              fetchOutcomes.push({ ok: false, url, reason: 'fetch_failed', detail: message });
              // Leave bucket empty; we'll skip it in the final compaction below.
            } finally {
              await heartbeat();
              competitorsCompleted += 1;
              const totalPagesScraped = pagesByCompetitor.reduce(
                (sum, bucket) => sum + bucket.length,
                0,
              );
              // Monotonic progress write. If a duplicate pgmq-delivered
              // worker is racing us, we read first + take max so the
              // counter can't go backwards — that was causing the UX of
              // "up to 19, then down to 1" that looked like the pipeline
              // was malfunctioning. Worst case under concurrency is that
              // both workers write the same max value.
              const latestUrl = url;
              if (sourceJobId) {
                try {
                  const { data: existing } = await supabase
                    .from('competitor_research_jobs')
                    .select('sites_scraped, pages_scraped')
                    .eq('id', sourceJobId)
                    .maybeSingle();
                  const nextSites = Math.max(existing?.sites_scraped ?? 0, competitorsCompleted);
                  const nextPages = Math.max(existing?.pages_scraped ?? 0, totalPagesScraped);
                  await supabase
                    .from('competitor_research_jobs')
                    .update({
                      status: 'scraping',
                      current_scraping_domain: latestUrl,
                      sites_scraped: nextSites,
                      pages_scraped: nextPages,
                      heartbeat_at: new Date().toISOString(),
                    })
                    .eq('id', sourceJobId);
                } catch (e) {
                  console.warn('[fetch_pages] competitor_research_jobs progress update failed', e);
                }
              }
              // Skip the per-competitor output_summary.faq_progress update
              // — it's the main flicker source when a duplicate worker is
              // running, and the UI already falls through to
              // competitor_research_jobs (which we just updated monotonically).
              // We only touch agent_runs for heartbeat.
              await touchAgentRun(supabase, {
                runId: run.id,
                status: 'running',
                currentStepKey: 'fetch_pages',
              });
            }
          }
        },
      );
      await Promise.all(workers);

      const pages: SharedFaqSourcePage[] = pagesByCompetitor.flat();
      const fetchSummary = summarizeFetchOutcomes(fetchOutcomes);

      if (fetchSummary.degraded) {
        console.warn('[fetch_pages-degraded]', {
          workspace_id: run.workspace_id,
          run_id: run.id,
          total: fetchSummary.total,
          ok: fetchSummary.ok,
          failed: fetchSummary.failed,
          failure_ratio: fetchSummary.failureRatio,
          by_reason: fetchSummary.byReason,
          failed_urls: fetchSummary.failedUrls,
        });
      }

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'source_page_batch',
        artifactKey: 'faq_pages',
        content: { pages, fetch_summary: fetchSummary },
        stepId: step.id,
      });

      if (sourceJobId) {
        // Step-completion counter write. Previously set sites_scraped
        // and pages_scraped to `pages.length` — which was correct when
        // each competitor yielded 1 page but under 8-page crawls they
        // conflate. Report sites = competitors whose bucket is non-empty,
        // pages = total pages. Also apply the monotonic guard so a
        // racing duplicate worker with fewer pages can't lower the
        // visible totals.
        const sitesWithPages = pagesByCompetitor.filter((b) => b.length > 0).length;
        const { data: existing } = await supabase
          .from('competitor_research_jobs')
          .select('sites_scraped, pages_scraped')
          .eq('id', sourceJobId)
          .maybeSingle();
        await supabase
          .from('competitor_research_jobs')
          .update({
            status: 'scraping',
            sites_scraped: Math.max(existing?.sites_scraped ?? 0, sitesWithPages),
            pages_scraped: Math.max(existing?.pages_scraped ?? 0, pages.length),
            heartbeat_at: new Date().toISOString(),
          })
          .eq('id', sourceJobId);
      }

      await handleMirrorProgress(
        supabase,
        {
          run_id: run.id,
          stage: 'fetch_complete',
          summary: 'Fetched selected competitor pages',
          metadata: { page_count: pages.length },
        },
        run.workspace_id,
      );

      await succeedStep(supabase, step.id, {
        page_count: pages.length,
        fetch_total: fetchSummary.total,
        fetch_ok: fetchSummary.ok,
        fetch_failed: fetchSummary.failed,
        fetch_failure_ratio: fetchSummary.failureRatio,
        fetch_failures_by_reason: fetchSummary.byReason,
        fetch_degraded: fetchSummary.degraded,
      });
      await queueSend(
        supabase,
        QUEUE_NAME,
        {
          run_id: run.id,
          workspace_id: run.workspace_id,
          step: 'generate_candidates',
          attempt: 1,
        },
        0,
      );
      try {
        await wakeWorker(supabase, 'pipeline-worker-onboarding-faq');
      } catch (workerKickError) {
        console.warn('Failed to chain onboarding FAQ candidate generation step', workerKickError);
      }
      await queueDelete(supabase, QUEUE_NAME, record.msg_id);
      return;
    } catch (error) {
      await failStep(supabase, step.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  if (job.step === 'generate_candidates') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'faq:generate_candidates',
      attempt: effectiveAttempt,
      provider: 'claude',
      model,
    });

    try {
      // Pgmq heartbeat. Per-page Claude extraction (one call per page of
      // up to 28 pages × ~5s) easily crosses the VT boundary, and without
      // the heartbeat pgmq redelivers to a second worker mid-loop — the
      // 2026-04-17 "4 concurrent generate_candidates attempts" symptom.
      // Mirrors the fetch_pages heartbeat pattern; shared helper
      // debounces set_vt calls internally.
      const heartbeat = createPgmqHeartbeat(supabase, QUEUE_NAME, record.msg_id);

      const { pages } = await loadRunArtifact<{
        pages: SharedFaqSourcePage[];
      }>(supabase, run.id, run.workspace_id, 'faq_pages');
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('name')
        .eq('id', run.workspace_id)
        .maybeSingle();
      const { data: businessContext } = await supabase
        .from('business_context')
        .select('service_area, business_type')
        .eq('workspace_id', run.workspace_id)
        .maybeSingle();

      const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim();
      if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY not configured');

      const extracted = await withTransientRetry(() =>
        extractFaqCandidatesFromPages({
          sourceKind: 'competitor',
          apiKey: anthropicApiKey,
          model,
          context: {
            workspace_name: workspace?.name || 'BizzyBee workspace',
            industry: businessContext?.industry ?? null,
            service_area: businessContext?.service_area ?? null,
            business_type: businessContext?.business_type ?? null,
          },
          pages,
          // Fire the pgmq heartbeat after each per-page Claude extraction
          // completes. extractWebsiteFaqsInChunks already invokes
          // onWebsiteProgress after every batch — we piggy-back on that
          // to keep pgmq's VT pushed out while the loop runs.
          onWebsiteProgress: async () => {
            await heartbeat();
          },
        }),
      );

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'faq_candidate_batch',
        artifactKey: 'faq_candidates_raw',
        content: extracted as Record<string, unknown>,
        stepId: step.id,
      });

      if (sourceJobId) {
        await supabase
          .from('competitor_research_jobs')
          .update({
            status: 'extracting',
            faqs_extracted: extracted.faqs.length,
            current_scraping_domain: null,
            heartbeat_at: new Date().toISOString(),
          })
          .eq('id', sourceJobId);
      }

      await touchAgentRun(supabase, {
        runId: run.id,
        status: 'running',
        currentStepKey: 'generate_candidates',
        outputSummaryPatch: {
          faq_progress: {
            current_domain: null,
            pages_scraped: pages.length,
            page_count: pages.length,
            candidate_count: extracted.faqs.length,
          },
        },
      });

      await handleMirrorProgress(
        supabase,
        {
          run_id: run.id,
          stage: 'candidates_generated',
          summary: 'Generated competitor FAQ candidates',
          metadata: { candidate_count: extracted.faqs.length },
        },
        run.workspace_id,
      );

      await succeedStep(supabase, step.id, { candidate_count: extracted.faqs.length });
      await queueSend(
        supabase,
        QUEUE_NAME,
        {
          run_id: run.id,
          workspace_id: run.workspace_id,
          step: 'dedupe',
          attempt: 1,
        },
        0,
      );
      try {
        await wakeWorker(supabase, 'pipeline-worker-onboarding-faq');
      } catch (workerKickError) {
        console.warn('Failed to chain onboarding FAQ dedupe step', workerKickError);
      }
      await queueDelete(supabase, QUEUE_NAME, record.msg_id);
      return;
    } catch (error) {
      await failStep(supabase, step.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  if (job.step === 'dedupe') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'faq:dedupe',
      attempt: effectiveAttempt,
      provider: 'runner',
      model,
    });

    try {
      // generate_candidates writes { faqs, batchCount } via extractFaqCandidatesFromPages
      // (onboarding-faq-engine.ts:108). Previously this step destructured { candidates }
      // which silently gave undefined and threw "Cannot read properties of undefined
      // (reading 'filter')" inside dedupeFaqCandidatesAgainstQuestions. Read `faqs`.
      const artifact = await loadRunArtifact<{
        faqs?: FaqCandidate[];
        candidates?: FaqCandidate[];
      }>(supabase, run.id, run.workspace_id, 'faq_candidates_raw');
      const candidates = artifact.faqs ?? artifact.candidates ?? [];
      const existingQuestions = await loadExistingFaqQuestions(supabase, run.workspace_id);
      const deduped = dedupeFaqCandidatesAgainstQuestions(candidates, existingQuestions);

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'faq_candidate_batch',
        artifactKey: 'faq_candidates_deduped',
        content: { faqs: deduped, candidates: deduped },
        stepId: step.id,
      });

      if (sourceJobId) {
        await supabase
          .from('competitor_research_jobs')
          .update({
            faqs_after_dedup: deduped.length,
            current_scraping_domain: null,
            heartbeat_at: new Date().toISOString(),
          })
          .eq('id', sourceJobId);
      }

      await touchAgentRun(supabase, {
        runId: run.id,
        status: 'running',
        currentStepKey: 'dedupe',
        outputSummaryPatch: {
          faq_progress: {
            current_domain: null,
            candidate_count: candidates.length,
            faqs_after_dedup: deduped.length,
          },
        },
      });

      await succeedStep(supabase, step.id, { candidate_count: deduped.length });
      await queueSend(
        supabase,
        QUEUE_NAME,
        {
          run_id: run.id,
          workspace_id: run.workspace_id,
          step: 'finalize',
          attempt: 1,
        },
        0,
      );
      try {
        await wakeWorker(supabase, 'pipeline-worker-onboarding-faq');
      } catch (workerKickError) {
        console.warn('Failed to chain onboarding FAQ finalize step', workerKickError);
      }
      await queueDelete(supabase, QUEUE_NAME, record.msg_id);
      return;
    } catch (error) {
      await failStep(supabase, step.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  if (job.step === 'finalize') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'faq:finalize',
      attempt: effectiveAttempt,
      provider: 'claude',
      model,
    });

    try {
      // Same heartbeat protection as generate_candidates — the finalize
      // Claude call takes ~3s typical but can be 30s+ on big candidate
      // sets, and without heartbeat a delayed response still triggers
      // pgmq redelivery at VT.
      const heartbeat = createPgmqHeartbeat(supabase, QUEUE_NAME, record.msg_id);

      const { candidates } = await loadRunArtifact<{ candidates: FaqCandidate[] }>(
        supabase,
        run.id,
        run.workspace_id,
        'faq_candidates_deduped',
      );
      await heartbeat();
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('name')
        .eq('id', run.workspace_id)
        .maybeSingle();
      const { data: businessContext } = await supabase
        .from('business_context')
        .select('service_area, business_type')
        .eq('workspace_id', run.workspace_id)
        .maybeSingle();

      const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim();
      if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY not configured');

      const existingQuestionSet = await loadExistingFaqQuestions(supabase, run.workspace_id);
      const finalized = await withTransientRetry(() =>
        finalizeSharedFaqCandidates({
          apiKey: anthropicApiKey,
          model,
          context: {
            workspace_name: workspace?.name || 'BizzyBee workspace',
            industry: businessContext?.industry ?? null,
            service_area: businessContext?.service_area ?? null,
            business_type: businessContext?.business_type ?? null,
          },
          candidates,
          existingQuestions: Array.from(existingQuestionSet),
        }),
      );

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'faq_candidate_batch',
        artifactKey: 'faq_candidates_final',
        content: finalized as Record<string, unknown>,
        stepId: step.id,
      });

      await handleMirrorProgress(
        supabase,
        {
          run_id: run.id,
          stage: 'quality_review_complete',
          summary: 'Selected the strongest final competitor FAQs',
          metadata: { final_count: finalized.faqs.length },
        },
        run.workspace_id,
      );

      await succeedStep(supabase, step.id, { faq_count: finalized.faqs.length });
      await touchAgentRun(supabase, {
        runId: run.id,
        status: 'running',
        currentStepKey: 'finalize',
        outputSummaryPatch: {
          faq_progress: {
            current_domain: null,
            final_count: finalized.faqs.length,
            faqs_after_dedup: candidates.length,
          },
        },
      });
      await queueSend(
        supabase,
        QUEUE_NAME,
        {
          run_id: run.id,
          workspace_id: run.workspace_id,
          step: 'persist',
          attempt: 1,
        },
        0,
      );
      try {
        await wakeWorker(supabase, 'pipeline-worker-onboarding-faq');
      } catch (workerKickError) {
        console.warn('Failed to chain onboarding FAQ persist step', workerKickError);
      }
      await queueDelete(supabase, QUEUE_NAME, record.msg_id);
      return;
    } catch (error) {
      await failStep(supabase, step.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  if (job.step === 'persist') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'faq:persist',
      attempt: effectiveAttempt,
      provider: 'supabase',
      model,
    });

    try {
      const { faqs } = await loadRunArtifact<{ faqs: FaqCandidate[] }>(
        supabase,
        run.id,
        run.workspace_id,
        'faq_candidates_final',
      );
      let selectedFaqs = Array.isArray(faqs) ? faqs : [];
      let usedFallbackShortlist = false;
      if (selectedFaqs.length < 3) {
        const { candidates: dedupedCandidates } = await loadRunArtifact<{
          candidates: FaqCandidate[];
        }>(supabase, run.id, run.workspace_id, 'faq_candidates_deduped');
        selectedFaqs = Array.isArray(dedupedCandidates) ? dedupedCandidates.slice(0, 8) : [];
        usedFallbackShortlist = true;
      }

      const existingQuestions = await loadExistingFaqQuestions(supabase, run.workspace_id);
      const freshFaqs = selectedFaqs.filter(
        (faq) => !existingQuestions.has(normalizeFaqQuestion(faq.question)),
      );

      const faqRows = buildFaqRows({
        workspaceId: run.workspace_id,
        faqs: freshFaqs,
        category: 'competitor_research',
        isOwnContent: false,
      });

      if (faqRows.length > 0) {
        const { error: insertError } = await supabase.from('faq_database').insert(faqRows);
        if (insertError) {
          throw new Error(`Failed to persist competitor FAQs: ${insertError.message}`);
        }
      }

      const faqCountsBySource = new Map<string, number>();
      for (const faq of freshFaqs) {
        faqCountsBySource.set(faq.source_url, (faqCountsBySource.get(faq.source_url) || 0) + 1);
      }

      for (const [sourceUrl, count] of faqCountsBySource.entries()) {
        await supabase
          .from('competitor_sites')
          .update({
            scrape_status: 'completed',
            scraped_at: new Date().toISOString(),
            faqs_generated: count,
            pages_scraped: 1,
          })
          .eq('workspace_id', run.workspace_id)
          .eq('url', sourceUrl);
      }

      if (sourceJobId) {
        await supabase
          .from('competitor_research_jobs')
          .update({
            status: 'complete',
            sites_scraped: faqCountsBySource.size,
            pages_scraped: faqCountsBySource.size,
            faqs_generated: selectedFaqs.length,
            faqs_added: freshFaqs.length,
            completed_at: new Date().toISOString(),
            heartbeat_at: new Date().toISOString(),
          })
          .eq('id', sourceJobId);
      }

      await handleMirrorProgress(
        supabase,
        {
          run_id: run.id,
          stage: 'finalized',
          summary:
            freshFaqs.length > 0
              ? 'Persisted final competitor FAQs'
              : 'Completed competitor FAQ analysis with no new FAQs to add',
          metadata: {
            faq_count: freshFaqs.length,
            fallback_shortlist_used: usedFallbackShortlist,
            shortlisted_faq_count: selectedFaqs.length,
          },
        },
        run.workspace_id,
      );

      await succeedStep(supabase, step.id, {
        faq_count: freshFaqs.length,
        shortlisted_faq_count: selectedFaqs.length,
        fallback_shortlist_used: usedFallbackShortlist,
      });
      await succeedRun(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        workflowKey: 'faq_generation',
        outputSummaryPatch: {
          faq_count: freshFaqs.length,
          shortlisted_faq_count: selectedFaqs.length,
          fallback_shortlist_used: usedFallbackShortlist,
          selected_competitor_ids: run.input_snapshot.selected_competitor_ids || [],
          faq_progress: {
            current_domain: null,
            final_count: selectedFaqs.length,
            faq_count: freshFaqs.length,
          },
        },
      });
      await queueDelete(supabase, QUEUE_NAME, record.msg_id);
      return;
    } catch (error) {
      await failStep(supabase, step.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  await queueDelete(supabase, QUEUE_NAME, record.msg_id);
}

Deno.serve(async (req) => {
  const startMs = Date.now();
  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }

    assertWorkerToken(req);
    const supabase = createServiceClient();
    const jobs = await readQueue<OnboardingFaqJob>(supabase, QUEUE_NAME, VT_SECONDS, 2);

    let processed = 0;
    const failures: Array<{
      run_id: string;
      step: string;
      attempt: number;
      error: string;
    }> = [];
    for (const record of jobs) {
      if (!withinBudget(startMs, DEFAULT_TIME_BUDGET_MS)) break;

      try {
        await processJob(record, startMs);
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({
          run_id: typeof record.message?.run_id === 'string' ? record.message.run_id : 'unknown',
          step: typeof record.message?.step === 'string' ? record.message.step : 'unknown',
          attempt: Number(record.message?.attempt || 0),
          error: message,
        });
        // Use resolveQueueAttempt which reads the payload `attempt` counter.
        // record.read_ct is the PGMQ delivery count and resets to 1 whenever
        // requeueStepJob archives the old msg and enqueues a fresh one — so
        // using read_ct here creates an infinite requeue loop for dead runs
        // (observed 2026-04-15: 57 messages with attempt=14-21 but read_ct=0
        // because the deadletter branch was never reached).
        if (resolveQueueAttempt(record) >= MAX_ATTEMPTS) {
          await deadletterStepJob(supabase, {
            queueName: QUEUE_NAME,
            workflowKey: 'faq_generation',
            scope: 'pipeline-worker-onboarding-faq',
            record: record as unknown as {
              msg_id: number;
              read_ct: number;
              message: Record<string, unknown>;
            },
            errorMessage: message,
          });
        } else {
          await requeueStepJob(
            supabase,
            QUEUE_NAME,
            record as unknown as {
              msg_id: number;
              read_ct: number;
              message: Record<string, unknown>;
            },
            message,
          );
        }
      }
    }

    return jsonResponse({
      ok: true,
      queue: QUEUE_NAME,
      fetched_jobs: jobs.length,
      processed,
      failures,
      elapsed_ms: Date.now() - startMs,
    });
  } catch (error) {
    console.error('pipeline-worker-onboarding-faq fatal', error);
    if (error instanceof HttpError) {
      return jsonResponse({ ok: false, error: error.message }, error.status);
    }

    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected error',
        elapsed_ms: Date.now() - startMs,
      },
      500,
    );
  }
});
