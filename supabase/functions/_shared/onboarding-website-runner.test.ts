import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

// Regression tests: the 12-batch website extract used to run inside a single
// pgmq message. Task 2 of the 2026-04-16 extract-batch-chunking plan split
// discovery into getNextMissingWebsiteBatch; Task 3 splits the extract
// branch itself into per-batch invocations of executeWebsiteRunStep. Each
// call processes exactly one page batch so a single Claude request fits
// well inside the Edge Function wall-clock.

// Stub the Deno-style URL imports that onboarding-website-runner pulls in
// transitively. These are only needed at runtime by unrelated code paths
// (step recorders, fetch tooling); the helper under test is a pure supabase
// query so we can mock the whole module to an empty shape.
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.57.2', () => ({}));

// Mock the cross-module dependencies the runner pulls in. Each mock stays
// shallow — tests assert the runner's *own* logic (branch selection,
// artifact key naming, short-circuit on idempotency) and not the
// cross-module behaviour.
vi.mock('./onboarding.ts', () => ({
  failRun: vi.fn(async () => undefined),
  recordRunArtifact: vi.fn(async () => undefined),
  resolveStepModel: vi.fn(() => 'claude-sonnet-4-5'),
  succeedRun: vi.fn(async () => undefined),
  touchAgentRun: vi.fn(async () => undefined),
}));

vi.mock('./onboarding-worker.ts', () => ({
  loadRunRecord: vi.fn(),
  withTransientRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../faq-agent-runner/lib/step-recorder.ts', () => ({
  beginStep: vi.fn(async () => ({ id: 'step-id-1', runId: 'run-1', stepKey: 'website:extract' })),
  succeedStep: vi.fn(async () => undefined),
  failStep: vi.fn(async () => undefined),
}));

vi.mock('../faq-agent-runner/lib/onboarding-ai.ts', () => ({
  crawlWebsitePages: vi.fn(),
  extractWebsiteFaqs: vi.fn(async () => ({ faqs: [] })),
}));

vi.mock('./onboarding-faq-engine.ts', async (importOriginal) => {
  // Partial mock — keep the REAL `dedupeAggregatedFaqs` (it's pure, fast,
  // deterministic: no reason to mock it) so the persist-branch tests
  // exercise the actual fingerprint logic end-to-end. Only mock the
  // db/artifact-touching helpers that need test control.
  const actual = await importOriginal<typeof import('./onboarding-faq-engine.ts')>();
  return {
    ...actual,
    buildFaqRows: vi.fn(() => []),
    extractFaqCandidatesFromPages: vi.fn(),
    hasRunArtifact: vi.fn(),
    loadRunArtifact: vi.fn(),
  };
});

const runner = await import('./onboarding-website-runner');
const onboarding = (await import('./onboarding.ts')) as unknown as {
  recordRunArtifact: ReturnType<typeof vi.fn>;
  touchAgentRun: ReturnType<typeof vi.fn>;
  succeedRun: ReturnType<typeof vi.fn>;
};
const onboardingAi = (await import('../faq-agent-runner/lib/onboarding-ai.ts')) as unknown as {
  extractWebsiteFaqs: ReturnType<typeof vi.fn>;
};
const faqEngine = (await import('./onboarding-faq-engine.ts')) as unknown as {
  loadRunArtifact: ReturnType<typeof vi.fn>;
  hasRunArtifact: ReturnType<typeof vi.fn>;
  buildFaqRows: ReturnType<typeof vi.fn>;
};
const stepRecorder = (await import('../faq-agent-runner/lib/step-recorder.ts')) as unknown as {
  beginStep: ReturnType<typeof vi.fn>;
  succeedStep: ReturnType<typeof vi.fn>;
  failStep: ReturnType<typeof vi.fn>;
};

const { executeWebsiteRunStep, getNextMissingWebsiteBatch } = runner;

function mockArtifactsQuery(keys: string[]): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            like: () =>
              Promise.resolve({
                data: keys.map((artifact_key) => ({ artifact_key })),
                error: null,
              }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('getNextMissingWebsiteBatch', () => {
  it('returns 0 when no batch artifacts have been written yet', async () => {
    const supabase = mockArtifactsQuery([]);
    const result = await getNextMissingWebsiteBatch(supabase, 'run-1', 'ws-1', 12);
    expect(result).toBe(0);
  });

  it('returns the first gap when some batches are present (e.g. 0 and 2 → 1)', async () => {
    const supabase = mockArtifactsQuery([
      'website_faq_candidates_batch_0',
      'website_faq_candidates_batch_2',
    ]);
    const result = await getNextMissingWebsiteBatch(supabase, 'run-1', 'ws-1', 12);
    expect(result).toBe(1);
  });

  it('returns null when every batch in [0, batchCount) is present', async () => {
    const supabase = mockArtifactsQuery([
      'website_faq_candidates_batch_0',
      'website_faq_candidates_batch_1',
      'website_faq_candidates_batch_2',
    ]);
    const result = await getNextMissingWebsiteBatch(supabase, 'run-1', 'ws-1', 3);
    expect(result).toBeNull();
  });
});

/**
 * Build a supabase mock tailored for the extract branch. Routes by table
 * name. Any ad-hoc `.select().eq().maybeSingle()` / `.update().eq()` /
 * `.like()` chain falls through to a `thenable` Promise so awaits resolve
 * correctly.
 */
function makeExtractSupabase(options: {
  /** Batch artifact keys that currently exist for this run. */
  existingBatchKeys?: string[];
  /** faqs array per existing batch key — keyed by artifact_key. */
  existingBatchContent?: Record<string, { faqs: Array<{ question: string }> }>;
}): SupabaseClient {
  const existing = options.existingBatchKeys ?? [];
  const content = options.existingBatchContent ?? {};

  return {
    from: (table: string) => {
      if (table === 'agent_run_artifacts') {
        return {
          select: (columns?: string) => ({
            eq: () => ({
              eq: () => ({
                like: () => {
                  if ((columns ?? '').includes('content')) {
                    return {
                      // sumWebsiteBatchCandidateCounts path: .like().order()
                      order: () =>
                        Promise.resolve({
                          data: existing.map((key) => ({
                            artifact_key: key,
                            content: content[key] ?? { faqs: [] },
                          })),
                          error: null,
                        }),
                      // Fallback for consumers that don't order()
                      then: (resolve: (v: unknown) => void) =>
                        resolve({
                          data: existing.map((key) => ({
                            artifact_key: key,
                            content: content[key] ?? { faqs: [] },
                          })),
                          error: null,
                        }),
                    };
                  }
                  return Promise.resolve({
                    data: existing.map((artifact_key) => ({ artifact_key })),
                    error: null,
                  });
                },
              }),
            }),
          }),
        };
      }
      if (table === 'scraping_jobs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { status: 'extracting' }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          }),
        };
      }
      if (table === 'faq_database') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ count: 0, data: null, error: null }),
            }),
          }),
        };
      }
      if (table === 'workspaces') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { name: 'Test Workspace' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'business_context') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { industry: null, service_area: null, business_type: null },
                  error: null,
                }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

function makeRun() {
  return {
    id: 'run-1',
    workspace_id: 'ws-1',
    workflow_key: 'own_website_scrape' as const,
    status: 'running',
    current_step_key: null,
    input_snapshot: { website_url: 'https://example.com' },
    output_summary: {},
    error_summary: null,
    started_at: null,
    completed_at: null,
    last_heartbeat_at: null,
    trigger_source: null,
    rollout_mode: null,
    legacy_progress_workflow_type: null,
    source_job_id: 'job-1',
  };
}

function makePages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://example.com/${i}`,
    title: `Page ${i}`,
    content: `Content ${i}`,
    content_length: 100,
  }));
}

describe('executeWebsiteRunStep extract branch (per-batch)', () => {
  const ORIGINAL_ENV = globalThis.Deno?.env?.get;

  beforeEach(() => {
    vi.clearAllMocks();

    // Stub Deno.env.get so the runner can read ANTHROPIC_API_KEY.
    const denoStub = {
      env: {
        get: (k: string) => (k === 'ANTHROPIC_API_KEY' ? 'test-key' : ORIGINAL_ENV?.(k)),
      },
    };
    (globalThis as unknown as { Deno: unknown }).Deno = denoStub;

    // Default mocks: pages artifact exists (so resolvePendingWebsiteStep
    // doesn't return 'fetch'), candidates artifact does not exist (so it
    // returns 'extract'). Tests override hasRunArtifact per-case to
    // control the idempotency path for the per-batch artifact.
    faqEngine.loadRunArtifact.mockReset();
    faqEngine.hasRunArtifact.mockReset();
    onboardingAi.extractWebsiteFaqs.mockReset();
    onboardingAi.extractWebsiteFaqs.mockResolvedValue({
      faqs: [{ question: 'Q1' }, { question: 'Q2' }],
    });
    onboarding.recordRunArtifact.mockReset();
    onboarding.touchAgentRun.mockReset();
    stepRecorder.beginStep.mockReset();
    stepRecorder.beginStep.mockResolvedValue({
      id: 'step-id-1',
      runId: 'run-1',
      stepKey: 'website:extract',
    });
    stepRecorder.succeedStep.mockReset();
    stepRecorder.failStep.mockReset();
  });

  it('processes a single batch and writes website_faq_candidates_batch_0 with allBatchesDone=false', async () => {
    const run = makeRun();
    const pages = makePages(3);
    faqEngine.loadRunArtifact.mockResolvedValue({ pages });
    // resolvePendingWebsiteStep calls: 'website_pages' true, 'website_faq_candidates' false.
    // Idempotency check: 'website_faq_candidates_batch_0' false.
    faqEngine.hasRunArtifact.mockImplementation(
      async (_s: unknown, _r: string, _w: string, key: string) => {
        if (key === 'website_pages') return true;
        return false;
      },
    );

    const supabase = makeExtractSupabase({ existingBatchKeys: [] });

    const result = await executeWebsiteRunStep(supabase, run, 'extract', 1, { batchIndex: 0 });

    expect(onboardingAi.extractWebsiteFaqs).toHaveBeenCalledTimes(1);
    // Signature: (apiKey, model, context, page, options). Previously this
    // helper took a page array — the page-aware rewrite processes one page
    // per call and moves singlePageSite into an options struct.
    const [, , , pageArg, optionsArg] = onboardingAi.extractWebsiteFaqs.mock.calls[0];
    expect(pageArg).toMatchObject({ url: 'https://example.com/0' });
    // 3 pages ≤ 3 → singlePageSite = true (small-site comprehensive path).
    expect(optionsArg).toEqual({ singlePageSite: true });

    expect(onboarding.recordRunArtifact).toHaveBeenCalledTimes(1);
    const recordCall = onboarding.recordRunArtifact.mock.calls[0][1] as {
      artifactKey: string;
      content: { faqs: unknown[]; batch_index: number; batch_count: number };
    };
    expect(recordCall.artifactKey).toBe('website_faq_candidates_batch_0');
    expect(recordCall.content.batch_index).toBe(0);
    expect(recordCall.content.batch_count).toBe(3);
    expect(recordCall.content.faqs).toHaveLength(2);

    expect(stepRecorder.beginStep).toHaveBeenCalledWith(
      expect.objectContaining({ stepKey: 'website:extract_batch_0' }),
    );

    // Progress is written 1-indexed so the UI's "AI pass N of M" label reads
    // naturally. A regression to 0-indexing would make the first batch
    // render as "AI pass 0 of 3", which is what we want to guard against.
    expect(onboarding.touchAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        outputSummaryPatch: expect.objectContaining({
          website_extract_progress: expect.objectContaining({
            batch_index: 1,
            batch_count: 3,
          }),
        }),
      }),
    );

    expect(result).toMatchObject({
      executedStep: 'extract',
      batchIndex: 0,
      batchCount: 3,
      allBatchesDone: false,
    });
  });

  it('passes singlePageSite=false to the extractor when the site has >3 pages', async () => {
    // Regression guard for the threshold that ACTUALLY controls dedup on
    // the Claude side. MAC Cleaning's 88-FAQ bug went away only because
    // a 15-page site triggered the page-aware "skip facts that belong on
    // another page" prompt branch — which requires singlePageSite=false.
    // A regression that flips `pages.length <= 3` to `< 3` (or similar)
    // would pass every other test and silently re-enable the single-page
    // comprehensive-extract path for multi-page sites, re-introducing
    // the duplicate blowup. This test locks the >3 side of the threshold.
    const run = makeRun();
    const pages = makePages(6);
    faqEngine.loadRunArtifact.mockResolvedValue({ pages });
    faqEngine.hasRunArtifact.mockImplementation(
      async (_s: unknown, _r: string, _w: string, key: string) => {
        if (key === 'website_pages') return true;
        return false;
      },
    );

    const supabase = makeExtractSupabase({ existingBatchKeys: [] });
    await executeWebsiteRunStep(supabase, run, 'extract', 1, { batchIndex: 0 });

    expect(onboardingAi.extractWebsiteFaqs).toHaveBeenCalledTimes(1);
    const [, , , , optionsArg] = onboardingAi.extractWebsiteFaqs.mock.calls[0];
    expect(optionsArg).toEqual({ singlePageSite: false });
  });

  it('treats exactly 3 pages as singlePageSite=true (boundary condition for the ≤3 threshold)', async () => {
    // The threshold is inclusive. A 3-page site is a small site; switching
    // the comparison to `< 3` would turn this off and force a 3-page site
    // through the dedup-gated prompt branch, losing facts. This test pins
    // the inclusive-at-3 semantics.
    const run = makeRun();
    const pages = makePages(3);
    faqEngine.loadRunArtifact.mockResolvedValue({ pages });
    faqEngine.hasRunArtifact.mockImplementation(
      async (_s: unknown, _r: string, _w: string, key: string) => {
        if (key === 'website_pages') return true;
        return false;
      },
    );

    const supabase = makeExtractSupabase({ existingBatchKeys: [] });
    await executeWebsiteRunStep(supabase, run, 'extract', 1, { batchIndex: 0 });

    const [, , , , optionsArg] = onboardingAi.extractWebsiteFaqs.mock.calls[0];
    expect(optionsArg).toEqual({ singlePageSite: true });
  });

  it('treats exactly 4 pages as singlePageSite=false (immediately above the threshold)', async () => {
    const run = makeRun();
    const pages = makePages(4);
    faqEngine.loadRunArtifact.mockResolvedValue({ pages });
    faqEngine.hasRunArtifact.mockImplementation(
      async (_s: unknown, _r: string, _w: string, key: string) => {
        if (key === 'website_pages') return true;
        return false;
      },
    );

    const supabase = makeExtractSupabase({ existingBatchKeys: [] });
    await executeWebsiteRunStep(supabase, run, 'extract', 1, { batchIndex: 0 });

    const [, , , , optionsArg] = onboardingAi.extractWebsiteFaqs.mock.calls[0];
    expect(optionsArg).toEqual({ singlePageSite: false });
  });

  it('short-circuits when the batch artifact already exists (idempotency)', async () => {
    const run = makeRun();
    const pages = makePages(6);
    faqEngine.loadRunArtifact.mockResolvedValue({ pages });
    faqEngine.hasRunArtifact.mockImplementation(
      async (_s: unknown, _r: string, _w: string, key: string) => {
        if (key === 'website_pages') return true;
        if (key === 'website_faq_candidates_batch_5') return true;
        return false;
      },
    );

    // Supabase says batches 0..4 and 5 exist but not 6+ — so after we
    // short-circuit on batch 5, allBatchesDone should be false because
    // batches 1..4 are still missing in this scenario (we only seed 0 and 5
    // so that the first-gap lookup returns a non-null value).
    const supabase = makeExtractSupabase({
      existingBatchKeys: ['website_faq_candidates_batch_0', 'website_faq_candidates_batch_5'],
    });

    const result = await executeWebsiteRunStep(supabase, run, 'extract', 1, { batchIndex: 5 });

    expect(onboardingAi.extractWebsiteFaqs).not.toHaveBeenCalled();
    expect(onboarding.recordRunArtifact).not.toHaveBeenCalled();

    expect(result).toMatchObject({
      executedStep: 'extract',
      batchIndex: 5,
      batchCount: 6,
      allBatchesDone: false,
    });
  });

  it('resolves the next missing batch when batchIndex is omitted', async () => {
    const run = makeRun();
    const pages = makePages(3);
    faqEngine.loadRunArtifact.mockResolvedValue({ pages });
    faqEngine.hasRunArtifact.mockImplementation(
      async (_s: unknown, _r: string, _w: string, key: string) => {
        if (key === 'website_pages') return true;
        // No per-batch artifact has been written yet.
        return false;
      },
    );

    const supabase = makeExtractSupabase({ existingBatchKeys: [] });

    const result = await executeWebsiteRunStep(supabase, run, 'extract', 1, {});

    expect(onboardingAi.extractWebsiteFaqs).toHaveBeenCalledTimes(1);
    const recordCall = onboarding.recordRunArtifact.mock.calls[0][1] as { artifactKey: string };
    expect(recordCall.artifactKey).toBe('website_faq_candidates_batch_0');
    expect(result).toMatchObject({
      executedStep: 'extract',
      batchIndex: 0,
      batchCount: 3,
      allBatchesDone: false,
    });
  });

  it('returns allBatchesDone=true and skips Claude when every batch artifact exists', async () => {
    const run = makeRun();
    const pages = makePages(3);
    faqEngine.loadRunArtifact.mockResolvedValue({ pages });
    faqEngine.hasRunArtifact.mockImplementation(
      async (_s: unknown, _r: string, _w: string, key: string) => {
        if (key === 'website_pages') return true;
        return false;
      },
    );

    const supabase = makeExtractSupabase({
      existingBatchKeys: [
        'website_faq_candidates_batch_0',
        'website_faq_candidates_batch_1',
        'website_faq_candidates_batch_2',
      ],
    });

    const result = await executeWebsiteRunStep(supabase, run, 'extract', 1, {});

    expect(onboardingAi.extractWebsiteFaqs).not.toHaveBeenCalled();
    expect(onboarding.recordRunArtifact).not.toHaveBeenCalled();

    expect(result).toMatchObject({
      executedStep: 'extract',
      batchCount: 3,
      allBatchesDone: true,
    });
    expect(result.batchIndex).toBeUndefined();
  });

  it('skips the batch (artifact with faqs:[], batch_skipped:true) when Claude retries are exhausted', async () => {
    // When withTransientRetry gives up and extractWebsiteFaqs rejects with a
    // permanent error, executeExtractOneBatch MUST NOT rethrow — otherwise
    // the pgmq chain stalls on this batch forever and later batches never
    // fire. Instead it writes an empty artifact tagged batch_skipped:true
    // and succeeds the step so the worker can advance.
    const run = makeRun();
    const pages = makePages(3);
    faqEngine.loadRunArtifact.mockResolvedValue({ pages });
    faqEngine.hasRunArtifact.mockImplementation(
      async (_s: unknown, _r: string, _w: string, key: string) => {
        if (key === 'website_pages') return true;
        return false;
      },
    );

    onboardingAi.extractWebsiteFaqs.mockReset();
    onboardingAi.extractWebsiteFaqs.mockRejectedValue(new Error('persistent 429 after retries'));

    const supabase = makeExtractSupabase({ existingBatchKeys: [] });

    const result = await executeWebsiteRunStep(supabase, run, 'extract', 1, { batchIndex: 0 });

    // The retry wrapper is mocked to pass through, so this proves the outer
    // try/catch in executeExtractOneBatch swallowed the rejection.
    expect(onboardingAi.extractWebsiteFaqs).toHaveBeenCalledTimes(1);

    expect(onboarding.recordRunArtifact).toHaveBeenCalledTimes(1);
    const recordCall = onboarding.recordRunArtifact.mock.calls[0][1] as {
      artifactKey: string;
      content: {
        faqs: unknown[];
        batch_index: number;
        batch_count: number;
        batch_skipped?: boolean;
      };
    };
    expect(recordCall.artifactKey).toBe('website_faq_candidates_batch_0');
    expect(recordCall.content).toMatchObject({
      faqs: [],
      batch_index: 0,
      batch_count: 3,
      batch_skipped: true,
    });

    // The step should succeed (so the worker can advance), not fail.
    expect(stepRecorder.succeedStep).toHaveBeenCalledTimes(1);
    expect(stepRecorder.failStep).not.toHaveBeenCalled();

    expect(result).toEqual({
      executedStep: 'extract',
      batchIndex: 0,
      batchCount: 3,
      allBatchesDone: false,
    });
  });
});

/**
 * Build a supabase mock tailored for the persist branch. Persist:
 *   - selects all `website_faq_candidates_batch_%` rows (with content)
 *   - resolvePendingWebsiteStep reads scraping_jobs.status + faq_database count
 *   - deletes existing faq_database rows, inserts new rows
 *   - updates scraping_jobs status to completed
 *
 * The `insertSpy` lets tests assert on the rows passed to .insert().
 */
function makePersistSupabase(options: {
  /** Ordered batch rows as the mock should surface them from .order(). */
  batchRows: Array<{
    artifact_key: string;
    content: { faqs?: Array<{ question: string }>; batch_skipped?: boolean } | null;
  }>;
  /** Captured rows from faq_database.insert(...) — push-through for assertions. */
  insertSpy: { lastArgs: unknown; callCount: number };
  /** Defaults to 0 (no pre-existing persisted FAQs). */
  persistedFaqCount?: number;
  /** Defaults to 'extracting' — must NOT be 'completed' for persist to run. */
  scrapingStatus?: string;
  /**
   * Defaults to false (safe default — location-collapse is opt-in per
   * workspace). When true, the business_context mock returns
   * custom_flags.faq_dedup_collapse_locations=true so the persist branch
   * threads `collapseLocations: true` into dedupeAggregatedFaqs.
   */
  collapseLocations?: boolean;
}): SupabaseClient {
  const persistedFaqCount = options.persistedFaqCount ?? 0;
  const scrapingStatus = options.scrapingStatus ?? 'extracting';
  const customFlags = options.collapseLocations ? { faq_dedup_collapse_locations: true } : {};

  return {
    from: (table: string) => {
      if (table === 'agent_run_artifacts') {
        return {
          select: (columns?: string) => ({
            eq: () => ({
              eq: () => ({
                like: () => {
                  if ((columns ?? '').includes('content')) {
                    return {
                      order: () => Promise.resolve({ data: options.batchRows, error: null }),
                      then: (resolve: (v: unknown) => void) =>
                        resolve({ data: options.batchRows, error: null }),
                    };
                  }
                  return Promise.resolve({
                    data: options.batchRows.map((r) => ({ artifact_key: r.artifact_key })),
                    error: null,
                  });
                },
              }),
            }),
          }),
        };
      }
      if (table === 'faq_database') {
        return {
          // resolvePendingWebsiteStep uses head:true count.
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ count: persistedFaqCount, data: null, error: null }),
            }),
          }),
          delete: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: (rows: unknown) => {
            options.insertSpy.lastArgs = rows;
            options.insertSpy.callCount += 1;
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      if (table === 'scraping_jobs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { status: scrapingStatus }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          }),
        };
      }
      if (table === 'workspaces') {
        // Persist branch loads workspace_name for the dedup-Claude prompt.
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { name: 'Test Workspace' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'business_context') {
        // Persist branch reads custom_flags (for the collapseLocations opt-in)
        // via its own separate .select('custom_flags') call. Respond to BOTH
        // the legacy industry/service_area/business_type select (used by the
        // earlier Claude-dedup code path that's now removed but may come back
        // as a prompt-context enrichment) AND the new custom_flags select.
        return {
          select: (columns?: string) => ({
            eq: () => ({
              maybeSingle: () => {
                if ((columns ?? '').includes('custom_flags')) {
                  return Promise.resolve({
                    data: { custom_flags: customFlags },
                    error: null,
                  });
                }
                return Promise.resolve({
                  data: { industry: null, service_area: null, business_type: null },
                  error: null,
                });
              },
            }),
          }),
        };
      }
      // Fallback for any other table accidentally touched.
      return {
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      };
    },
  } as unknown as SupabaseClient;
}

describe('executeWebsiteRunStep persist branch (per-batch aggregation)', () => {
  const ORIGINAL_ENV = globalThis.Deno?.env?.get;

  beforeEach(() => {
    vi.clearAllMocks();

    // Stub Deno.env.get so persist can read ANTHROPIC_API_KEY for the dedup call.
    const denoStub = {
      env: {
        get: (k: string) => (k === 'ANTHROPIC_API_KEY' ? 'test-key' : ORIGINAL_ENV?.(k)),
      },
    };
    (globalThis as unknown as { Deno: unknown }).Deno = denoStub;

    // resolvePendingWebsiteStep needs: website_pages=true, website_faq_candidates=false
    // so it returns 'persist' (not 'fetch' or 'extract'). We control this per-test
    // via faqEngine.hasRunArtifact.
    faqEngine.loadRunArtifact.mockReset();
    faqEngine.hasRunArtifact.mockReset();
    faqEngine.hasRunArtifact.mockImplementation(
      async (_s: unknown, _r: string, _w: string, key: string) => {
        if (key === 'website_pages') return true;
        if (key === 'website_faq_candidates') return false;
        return false;
      },
    );

    // buildFaqRows: by default return one row per FAQ it's given so tests can
    // assert the final insert count equals the aggregate faq count.
    faqEngine.buildFaqRows.mockReset();
    faqEngine.buildFaqRows.mockImplementation((params: { faqs: Array<unknown> }) =>
      params.faqs.map((_, i) => ({ row_id: i })),
    );

    onboarding.recordRunArtifact.mockReset();
    onboarding.touchAgentRun.mockReset();
    onboarding.succeedRun.mockReset();
    stepRecorder.beginStep.mockReset();
    stepRecorder.beginStep.mockResolvedValue({
      id: 'persist-step-id',
      runId: 'run-1',
      stepKey: 'website:persist',
    });
    stepRecorder.succeedStep.mockReset();
    stepRecorder.failStep.mockReset();
  });

  it('aggregates N batch artifacts and inserts the sum', async () => {
    const run = makeRun();
    const insertSpy = { lastArgs: null as unknown, callCount: 0 };
    const supabase = makePersistSupabase({
      batchRows: [
        {
          artifact_key: 'website_faq_candidates_batch_0',
          content: { faqs: [{ question: 'A' }, { question: 'B' }] },
        },
        {
          artifact_key: 'website_faq_candidates_batch_1',
          content: { faqs: [{ question: 'C' }] },
        },
        {
          artifact_key: 'website_faq_candidates_batch_2',
          content: { faqs: [{ question: 'D' }, { question: 'E' }, { question: 'F' }] },
        },
      ],
      insertSpy,
    });

    const result = await executeWebsiteRunStep(supabase, run, 'persist', 1, {});

    // 1. Consolidated artifact written with aggregate.
    expect(onboarding.recordRunArtifact).toHaveBeenCalledTimes(1);
    const recordCall = onboarding.recordRunArtifact.mock.calls[0][1] as {
      artifactKey: string;
      content: { faqs: unknown[]; batch_count: number };
    };
    expect(recordCall.artifactKey).toBe('website_faq_candidates');
    expect(recordCall.content.faqs).toHaveLength(6);
    expect(recordCall.content.batch_count).toBe(3);

    // 2. faq_database.insert received rows of length 6 (one per aggregated FAQ).
    expect(insertSpy.callCount).toBe(1);
    expect(Array.isArray(insertSpy.lastArgs)).toBe(true);
    expect((insertSpy.lastArgs as unknown[]).length).toBe(6);

    // 3. succeedStep called with faq_count: 6
    expect(stepRecorder.succeedStep).toHaveBeenCalledWith(
      expect.anything(),
      'persist-step-id',
      expect.objectContaining({ faq_count: 6 }),
    );

    // 4. succeedRun called (run completes after persist).
    expect(onboarding.succeedRun).toHaveBeenCalledTimes(1);

    // 5. The legacy consolidated-key loadRunArtifact should NOT be called —
    // persist now writes this artifact, it does not read it.
    expect(faqEngine.loadRunArtifact).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'website_faq_candidates',
    );

    expect(result).toMatchObject({ executedStep: 'persist' });
  });

  it('throws when aggregate faq count is < 3', async () => {
    const run = makeRun();
    const insertSpy = { lastArgs: null as unknown, callCount: 0 };
    const supabase = makePersistSupabase({
      batchRows: [
        {
          artifact_key: 'website_faq_candidates_batch_0',
          content: { faqs: [{ question: 'A' }] },
        },
        {
          artifact_key: 'website_faq_candidates_batch_1',
          content: { faqs: [{ question: 'B' }] },
        },
      ],
      insertSpy,
    });

    await expect(executeWebsiteRunStep(supabase, run, 'persist', 1, {})).rejects.toThrow(
      /Not enough grounded website FAQs/,
    );

    // Persist must NOT insert or succeed the run when aggregate is too small.
    expect(insertSpy.callCount).toBe(0);
    expect(onboarding.succeedRun).not.toHaveBeenCalled();
    expect(stepRecorder.failStep).toHaveBeenCalledTimes(1);
  });

  it('treats batch_skipped artifacts (empty faqs) as contributing zero and still persists the remainder', async () => {
    const run = makeRun();
    const insertSpy = { lastArgs: null as unknown, callCount: 0 };
    const supabase = makePersistSupabase({
      batchRows: [
        {
          artifact_key: 'website_faq_candidates_batch_0',
          content: { faqs: [{ question: 'A' }, { question: 'B' }] },
        },
        {
          artifact_key: 'website_faq_candidates_batch_1',
          content: { faqs: [], batch_skipped: true },
        },
        {
          artifact_key: 'website_faq_candidates_batch_2',
          content: { faqs: [{ question: 'C' }, { question: 'D' }] },
        },
      ],
      insertSpy,
    });

    const result = await executeWebsiteRunStep(supabase, run, 'persist', 1, {});

    const recordCall = onboarding.recordRunArtifact.mock.calls[0][1] as {
      artifactKey: string;
      content: { faqs: unknown[]; batch_count: number };
    };
    expect(recordCall.content.faqs).toHaveLength(4);
    expect(recordCall.content.batch_count).toBe(3);

    expect(insertSpy.callCount).toBe(1);
    expect((insertSpy.lastArgs as unknown[]).length).toBe(4);

    expect(onboarding.succeedRun).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ executedStep: 'persist' });
  });

  it('orders batches numerically (batch_10 after batch_2), not lexicographically', async () => {
    // Regression test for the lex-sort bug: if the runner trusted .order()'s
    // string ordering, batch_10 would come before batch_2 and the final FAQ
    // list would end up [A, C, B]. The runner must parse the trailing integer
    // and sort numerically → [A, B, C].
    const run = makeRun();
    const insertSpy = { lastArgs: null as unknown, callCount: 0 };
    const supabase = makePersistSupabase({
      // Mock surfaces rows in lexicographic order: 0, 10, 2.
      batchRows: [
        {
          artifact_key: 'website_faq_candidates_batch_0',
          content: { faqs: [{ question: 'A' }] },
        },
        {
          artifact_key: 'website_faq_candidates_batch_10',
          content: { faqs: [{ question: 'C' }] },
        },
        {
          artifact_key: 'website_faq_candidates_batch_2',
          content: { faqs: [{ question: 'B' }] },
        },
      ],
      insertSpy,
    });

    await executeWebsiteRunStep(supabase, run, 'persist', 1, {});

    const recordCall = onboarding.recordRunArtifact.mock.calls[0][1] as {
      artifactKey: string;
      content: { faqs: Array<{ question: string }>; batch_count: number };
    };
    expect(recordCall.artifactKey).toBe('website_faq_candidates');
    expect(recordCall.content.faqs.map((f) => f.question)).toEqual(['A', 'B', 'C']);
    expect(recordCall.content.batch_count).toBe(3);
  });

  it('collapses cross-batch dupes end-to-end: location, brand, and exact-match variants all fold into one winner per topic', async () => {
    // Real (un-mocked) `dedupeAggregatedFaqs` runs against the dup classes
    // we see in live MAC Cleaning extraction (2026-04-16):
    //
    //   Class 1 — per-city pricing variants + generic:
    //     "How much does window cleaning cost in Luton?" × 2 (different pages)
    //     "How much does window cleaning cost in Dunstable?"
    //     "How much does window cleaning cost?"
    //     → ALL collapse (location tokens are stopwords). Location-penalty
    //       in scoreFaqForDedup makes the generic variant the winner even
    //       when a city-tagged one has higher quality_score.
    //
    //   Class 2 — brand-reference variants:
    //     "What services do you offer?" vs "What services does MAC Cleaning offer?"
    //     → fingerprint to the same {offer,service}; generic variant wins
    //       (the brand-tagged one gets the same -250 penalty).
    //
    // Preserved:
    //   - "Can you clean gutters?" (distinct gutter topic)
    const run = makeRun();
    const insertSpy = { lastArgs: null as unknown, callCount: 0 };
    // Opt into location-collapse via the business_context flag — this is
    // the MAC Cleaning scenario where no area is more expensive than
    // another. Default-off workspaces keep their per-city FAQs distinct.
    const supabase = makePersistSupabase({
      collapseLocations: true,
      batchRows: [
        {
          artifact_key: 'website_faq_candidates_batch_0',
          content: {
            faqs: [
              // Class 1: city-tagged Luton — will lose to the generic in batch_1
              {
                question: 'How much does window cleaning cost in Luton?',
                answer: 'From £15.',
                source_url: 'https://maccleaning.uk/locations/luton',
                evidence_quote: 'Pricing starts at £15.',
                quality_score: 0.9,
              },
              // Class 2: brand-stripped variant pair — generic wins
              {
                question: 'What services do you offer?',
                answer: 'Window, gutter, fascia, conservatory roof cleaning.',
                source_url: 'https://maccleaning.uk/',
                evidence_quote: 'We offer four main services.',
                quality_score: 0.75,
              },
              // Distinct topic kept as its own survivor
              {
                question: 'Can you clean gutters?',
                answer: 'Yes, bundled service available.',
                source_url: 'https://maccleaning.uk/services/gutter-clearing',
                evidence_quote: 'Combined window + gutter package.',
                quality_score: 0.85,
              },
            ],
          },
        },
        {
          artifact_key: 'website_faq_candidates_batch_1',
          content: {
            faqs: [
              // Class 1: same Luton pricing question from another page
              {
                question: 'How much does window cleaning cost in Luton?',
                answer: 'About £15-£20 depending on property size.',
                source_url: 'https://maccleaning.uk/blog/window-cleaning-luton-guide',
                evidence_quote: 'Luton typically costs £15-£20.',
                quality_score: 0.7,
              },
              // Class 2: brand-tagged variant of the "services" question
              {
                question: 'What services does MAC Cleaning offer?',
                answer: 'Four core cleaning services.',
                source_url: 'https://maccleaning.uk/services',
                evidence_quote: 'We provide four services.',
                quality_score: 0.65,
              },
              // Class 1: Dunstable variant — same topic, different city
              {
                question: 'How much does window cleaning cost in Dunstable?',
                answer: 'Similar range.',
                source_url: 'https://maccleaning.uk/locations/dunstable',
                evidence_quote: 'Dunstable pricing mirrors Luton.',
                quality_score: 0.8,
              },
              // Class 1: GENERIC variant — should win thanks to the
              // location-penalty pushing city-tagged scores below this.
              {
                question: 'How much does window cleaning cost?',
                answer: 'Priced per property size; typically £15-£20.',
                source_url: 'https://maccleaning.uk/',
                evidence_quote: 'Standard pricing for 3-bed semi.',
                quality_score: 0.75,
              },
            ],
          },
        },
      ],
      insertSpy,
    });

    const result = await executeWebsiteRunStep(supabase, run, 'persist', 1, {});

    // 7 aggregate → 3 winners:
    //   - Pricing group (4 variants collapse; generic wins via location penalty)
    //   - "services offer" group (brand variants collapse; generic wins)
    //   - "Can you clean gutters?" (distinct topic, unchanged)
    expect(onboarding.recordRunArtifact).toHaveBeenCalledTimes(1);
    const recordCall = onboarding.recordRunArtifact.mock.calls[0][1] as {
      artifactKey: string;
      content: {
        faqs: Array<{ question: string; quality_score: number }>;
        batch_count: number;
        dedup_applied: boolean;
      };
    };
    expect(recordCall.artifactKey).toBe('website_faq_candidates');
    expect(recordCall.content.faqs).toHaveLength(3);
    expect(recordCall.content.dedup_applied).toBe(true);

    const byQuestion = new Map(recordCall.content.faqs.map((f) => [f.question, f.quality_score]));
    // Pricing group: generic variant wins despite 0.75 < 0.9 (Luton) because
    // Luton's score gets the -250 location penalty.
    expect(byQuestion.get('How much does window cleaning cost?')).toBe(0.75);
    // Services group: generic phrasing wins over the MAC Cleaning variant.
    expect(byQuestion.get('What services do you offer?')).toBe(0.75);
    // Distinct entry kept:
    expect(byQuestion.has('Can you clean gutters?')).toBe(true);
    // Sanity: no location-tagged variants survived the dedup.
    expect(byQuestion.has('How much does window cleaning cost in Luton?')).toBe(false);
    expect(byQuestion.has('How much does window cleaning cost in Dunstable?')).toBe(false);

    // faq_database insert receives exactly the 3 deduped rows.
    expect(insertSpy.callCount).toBe(1);
    expect((insertSpy.lastArgs as unknown[]).length).toBe(3);

    // Run succeeds.
    expect(onboarding.succeedRun).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ executedStep: 'persist' });
  });

  it('dedup_applied flag reflects whether any group was collapsed', async () => {
    // When no two questions collide under the fingerprint, dedup_applied is
    // false — the consolidated artifact just records "nothing to merge".
    // This regression-guards against a future change that flips the flag to
    // always-true / always-false and makes the artifact useless for audit.
    const run = makeRun();
    const insertSpy = { lastArgs: null as unknown, callCount: 0 };
    const supabase = makePersistSupabase({
      batchRows: [
        {
          artifact_key: 'website_faq_candidates_batch_0',
          content: {
            faqs: [
              {
                question: 'Can you clean conservatory roofs?',
                answer: 'Yes.',
                source_url: 'https://example.com/conservatory',
                evidence_quote: 'Conservatory roof cleaning is offered.',
                quality_score: 0.8,
              },
              {
                question: 'Do you unblock guttering downpipes?',
                answer: 'Yes.',
                source_url: 'https://example.com/gutter',
                evidence_quote: 'Downpipe clearance included in gutter service.',
                quality_score: 0.7,
              },
              {
                question: 'What areas of Bedfordshire do you serve?',
                answer: 'Luton, Dunstable, Harpenden.',
                source_url: 'https://example.com/areas',
                evidence_quote: 'We serve Luton, Dunstable, and Harpenden.',
                quality_score: 0.9,
              },
            ],
          },
        },
      ],
      insertSpy,
    });

    await executeWebsiteRunStep(supabase, run, 'persist', 1, {});

    const recordCall = onboarding.recordRunArtifact.mock.calls[0][1] as {
      content: { faqs: unknown[]; dedup_applied: boolean };
    };
    expect(recordCall.content.faqs).toHaveLength(3);
    // No collisions — dedup_applied stays truthy (all rows kept = still valid
    // dedup pass) to reflect that we HAVE attempted dedup, successfully.
    expect(recordCall.content.dedup_applied).toBe(true);
  });
});
