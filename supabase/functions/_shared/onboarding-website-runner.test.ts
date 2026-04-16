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

vi.mock('./onboarding-faq-engine.ts', () => ({
  buildFaqRows: vi.fn(() => []),
  extractFaqCandidatesFromPages: vi.fn(),
  hasRunArtifact: vi.fn(),
  loadRunArtifact: vi.fn(),
}));

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
    const [, , , pagesArg] = onboardingAi.extractWebsiteFaqs.mock.calls[0];
    expect(pagesArg).toHaveLength(1);
    expect(pagesArg[0].url).toBe('https://example.com/0');

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
}): SupabaseClient {
  const persistedFaqCount = options.persistedFaqCount ?? 0;
  const scrapingStatus = options.scrapingStatus ?? 'extracting';

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
  beforeEach(() => {
    vi.clearAllMocks();

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
});
