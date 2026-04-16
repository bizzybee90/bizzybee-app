# Own-Site Extract: Per-Batch Chunking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the 8-minute `website:extract` step into 12 independent per-batch pgmq messages so each worker invocation runs exactly one Claude call (~40s), never exceeding the Edge Function wall-clock limit that was silently killing workers and causing concurrent-delivery races.

**Architecture:** The own-site extract flow currently reads 12 pages and calls Claude 12 times serially inside a single worker invocation. Supabase Edge Functions kill long-running invocations around 150s, leaving pgmq msgs undeleted → VT expires → another worker pops the same msg → concurrent workers race on `agent_runs.output_summary` (user-visible "pass 10 → pass 1 reset"). The fix: make each batch its own pgmq msg, write a `website_faq_candidates_batch_{N}` artifact per batch, and only enqueue 'persist' after all batch artifacts exist. Persist aggregates batch artifacts.

**Tech Stack:** Supabase Edge Functions (Deno), pgmq, Claude API, Vitest

**Non-goals:**

- Competitor extract (`pipeline-worker-onboarding-faq`) — different pattern, separate commit if needed
- Changing the Claude prompt or batch size (still 1 page per batch)
- Touching the fetch or persist-output semantics beyond the aggregation change

---

## Task 0: Cancel the broken in-flight run and clear its queue msgs

**Why first:** The current run `cd6687a9-ace4-4e42-b8c3-adfa11a1d82d` has 3 concurrent workers racing. Leaving it alive while we deploy wastes Claude tokens and muddies the verification signal.

**Step 1: Cancel the run**

```sql
update agent_runs
  set status = 'canceled',
      completed_at = now(),
      error_summary = jsonb_build_object('reason', 'superseded by per-batch chunking refactor')
where id = 'cd6687a9-ace4-4e42-b8c3-adfa11a1d82d';

update agent_run_steps
  set status = 'canceled', completed_at = now()
where run_id = 'cd6687a9-ace4-4e42-b8c3-adfa11a1d82d' and status = 'running';
```

**Step 2: Clear the queue msgs for this run**

```sql
select pgmq.archive('bb_onboarding_website_jobs', msg_id)
from pgmq.q_bb_onboarding_website_jobs
where (message->>'run_id')::uuid = 'cd6687a9-ace4-4e42-b8c3-adfa11a1d82d';
```

**Step 3: Verify queue is empty of this run's msgs**

```sql
select msg_id, message->>'step' from pgmq.q_bb_onboarding_website_jobs;
```

Expected: empty or unrelated msgs only.

**Step 4: Mark the scraping_jobs row failed so the UI doesn't show phantom "running"**

```sql
update scraping_jobs
  set status = 'failed',
      error_message = 'Superseded by batch-chunking refactor',
      completed_at = now()
where id = (
  select source_job_id from agent_runs where id = 'cd6687a9-ace4-4e42-b8c3-adfa11a1d82d'
);
```

---

## Task 1: Add `batch_index` to the OnboardingWebsiteJob payload type

**Files:**

- Modify: `supabase/functions/_shared/onboarding.ts` (the `OnboardingWebsiteJob` type definition)

**Step 1: Locate the type**

Run: `grep -n "OnboardingWebsiteJob" supabase/functions/_shared/onboarding.ts`

**Step 2: Add `batch_index?: number` field to the type**

Current (approx):

```typescript
export type OnboardingWebsiteJob = {
  run_id: string;
  workspace_id: string;
  step: 'fetch' | 'extract' | 'persist';
  attempt: number;
};
```

New:

```typescript
export type OnboardingWebsiteJob = {
  run_id: string;
  workspace_id: string;
  step: 'fetch' | 'extract' | 'persist';
  attempt: number;
  /**
   * Only meaningful when step === 'extract'. When present, the worker
   * processes exactly one page batch (index 0..N-1). Omitted on first
   * enqueue from the fetch step — runner treats undefined as "resolve
   * the next missing batch from artifacts".
   */
  batch_index?: number;
};
```

**Step 3: Commit**

```bash
git add supabase/functions/_shared/onboarding.ts
git commit -m "types(onboarding): add batch_index to website job payload"
```

---

## Task 2: Add a `loadWebsitePages` + `getNextMissingWebsiteBatch` helper

**Files:**

- Modify: `supabase/functions/_shared/onboarding-website-runner.ts` (add helpers near top)
- Create: `supabase/functions/_shared/onboarding-website-runner.test.ts` (if not exists)

**Step 1: Add helper `getNextMissingWebsiteBatch`**

```typescript
/**
 * Return the lowest batch_index whose `website_faq_candidates_batch_{N}`
 * artifact does not yet exist, or null if all batches are written.
 * Callers: runner (when batch_index is omitted from the payload) and
 * onboarding-worker-nudge (to enqueue the right batch on nudge).
 */
export async function getNextMissingWebsiteBatch(
  supabase: SupabaseClient,
  runId: string,
  workspaceId: string,
  batchCount: number,
): Promise<number | null> {
  if (batchCount <= 0) return null;

  const { data, error } = await supabase
    .from('agent_run_artifacts')
    .select('artifact_key')
    .eq('run_id', runId)
    .eq('workspace_id', workspaceId)
    .like('artifact_key', 'website_faq_candidates_batch_%');

  if (error) {
    throw new Error(`Failed to list website batch artifacts: ${error.message}`);
  }

  const present = new Set(
    (data ?? [])
      .map((row) => row.artifact_key)
      .map((key) => {
        const match = /^website_faq_candidates_batch_(\d+)$/.exec(key);
        return match ? Number(match[1]) : null;
      })
      .filter((value): value is number => value !== null),
  );

  for (let i = 0; i < batchCount; i += 1) {
    if (!present.has(i)) return i;
  }
  return null;
}
```

**Step 2: Write a unit test**

```typescript
describe('getNextMissingWebsiteBatch', () => {
  it('returns 0 when no artifacts exist', async () => {
    const supabase = mockClient([]);
    expect(await getNextMissingWebsiteBatch(supabase, 'r', 'w', 3)).toBe(0);
  });

  it('returns the first gap', async () => {
    const supabase = mockClient([
      'website_faq_candidates_batch_0',
      'website_faq_candidates_batch_2',
    ]);
    expect(await getNextMissingWebsiteBatch(supabase, 'r', 'w', 3)).toBe(1);
  });

  it('returns null when all present', async () => {
    const supabase = mockClient([
      'website_faq_candidates_batch_0',
      'website_faq_candidates_batch_1',
      'website_faq_candidates_batch_2',
    ]);
    expect(await getNextMissingWebsiteBatch(supabase, 'r', 'w', 3)).toBeNull();
  });
});
```

`mockClient` returns `{ data: keys.map(k => ({artifact_key: k})), error: null }` from `.like()`.

**Step 3: Run tests**

Run: `pnpm --filter bizzybee-hardening-control test -- onboarding-website-runner`
Expected: 3/3 pass.

**Step 4: Commit**

```bash
git add supabase/functions/_shared/onboarding-website-runner.ts supabase/functions/_shared/onboarding-website-runner.test.ts
git commit -m "feat(onboarding/website): add getNextMissingWebsiteBatch helper for chunked extract"
```

---

## Task 3: Refactor `executeWebsiteRunStep` extract branch to process one batch at a time

**Files:**

- Modify: `supabase/functions/_shared/onboarding-website-runner.ts:190-312` (extract branch)

**Design:** When the worker calls `executeWebsiteRunStep(run, 'extract', attempt, { heartbeat, batchIndex })`:

1. Load `website_pages` artifact, compute `batchCount = pages.length`.
2. Determine `effectiveBatch = batchIndex ?? await getNextMissingWebsiteBatch(...)`.
3. If `effectiveBatch === null` → all batches done, return `{ executedStep: 'extract', allBatchesDone: true, batchCount }`.
4. If the batch artifact ALREADY exists (idempotency), short-circuit and return without re-calling Claude.
5. Otherwise: slice pages to `[effectiveBatch, effectiveBatch+1]`, call `extractWebsiteFaqs` (per-batch function exported from onboarding-ai.ts) wrapped in `withTransientRetry`, write `website_faq_candidates_batch_{N}` artifact, update `agent_runs.output_summary.website_extract_progress`.
6. Return `{ executedStep: 'extract', batchIndex: effectiveBatch, batchCount, allBatchesDone: <are we done now?> }`.

**Signature change:**

```typescript
export interface WebsiteRunStepOptions {
  heartbeat?: () => Promise<void>;
  /** Only meaningful when step === 'extract' */
  batchIndex?: number;
}

export interface WebsiteRunStepResult {
  executedStep: WebsiteWorkflowStep | null;
  /** Populated on extract step only */
  batchIndex?: number;
  batchCount?: number;
  allBatchesDone?: boolean;
}

export async function executeWebsiteRunStep(
  supabase: SupabaseClient,
  run: WebsiteRunRecord,
  requestedStep: WebsiteWorkflowStep,
  attempt: number,
  options: WebsiteRunStepOptions = {},
): Promise<WebsiteRunStepResult>;
```

**Step 1: Extract helper — `executeExtractOneBatch`**

Move the Claude-calling logic from the current extract branch into a new internal function:

```typescript
async function executeExtractOneBatch(params: {
  supabase: SupabaseClient;
  run: WebsiteRunRecord;
  attempt: number;
  batchIndex: number;
  pages: FetchedPage[];
  heartbeat?: () => Promise<void>;
}): Promise<{ candidateCount: number; totalCandidateCount: number; batchCount: number }> {
  const { supabase, run, attempt, batchIndex, pages, heartbeat } = params;
  const batchCount = pages.length;
  const pagesInBatch = pages.slice(batchIndex, batchIndex + 1);
  const model = resolveStepModel(run.input_snapshot, 'extract');

  const stepRecord = await beginStep({
    supabase,
    runId: run.id,
    workspaceId: run.workspace_id,
    stepKey: `website:extract_batch_${batchIndex}`,
    attempt,
    provider: 'claude',
    model,
  });

  try {
    const [{ data: workspace }, { data: businessContext }] = await Promise.all([
      supabase.from('workspaces').select('name').eq('id', run.workspace_id).maybeSingle(),
      supabase
        .from('business_context')
        .select('industry, service_area, business_type')
        .eq('workspace_id', run.workspace_id)
        .maybeSingle(),
    ]);

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim();
    if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY not configured');

    if (heartbeat) await heartbeat();

    // Import from faq-agent-runner/lib/onboarding-ai.ts — the per-batch
    // Claude call (no outer chunk loop here; we ARE the batch).
    const extracted = await withTransientRetry(() =>
      extractWebsiteFaqsForOneBatch({
        apiKey: anthropicApiKey,
        model,
        context: {
          workspace_name: workspace?.name || 'BizzyBee workspace',
          industry: businessContext?.industry ?? null,
          service_area: businessContext?.service_area ?? null,
          business_type: businessContext?.business_type ?? null,
        },
        pages: pagesInBatch,
      }),
    );

    await recordRunArtifact(supabase, {
      runId: run.id,
      workspaceId: run.workspace_id,
      artifactType: 'faq_candidate_batch',
      artifactKey: `website_faq_candidates_batch_${batchIndex}`,
      content: {
        faqs: extracted.faqs,
        batch_index: batchIndex,
        batch_count: batchCount,
      } as Record<string, unknown>,
      stepId: stepRecord.id,
    });

    // Compute total-so-far by summing existing batch artifacts.
    const totalSoFar = await sumWebsiteBatchCandidateCounts(supabase, run.id, run.workspace_id);

    await touchAgentRun(supabase, {
      runId: run.id,
      status: 'running',
      currentStepKey: 'website:extract',
      outputSummaryPatch: {
        website_extract_progress: {
          batch_index: batchIndex + 1, // UI shows 1-indexed "AI pass N of M"
          batch_count: batchCount,
          pages_in_batch: pagesInBatch.length,
          pages_total: pages.length,
          candidate_count: extracted.faqs.length,
          total_candidate_count: totalSoFar,
        },
      },
    });

    await succeedStep(supabase, stepRecord.id, {
      faq_count: extracted.faqs.length,
      batch_index: batchIndex,
    });

    return {
      candidateCount: extracted.faqs.length,
      totalCandidateCount: totalSoFar,
      batchCount,
    };
  } catch (error) {
    await failStep(supabase, stepRecord.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
```

**Step 2: Add `sumWebsiteBatchCandidateCounts` helper** (reads all batch artifacts, sums their `faqs.length`).

**Step 3: Rewrite the `if (step === 'extract')` branch** to:

1. Load pages + compute batchCount.
2. `effectiveBatch = options.batchIndex ?? await getNextMissingWebsiteBatch(...)`.
3. If `effectiveBatch === null`: return `{ executedStep: 'extract', batchCount, allBatchesDone: true }`.
4. If artifact for `effectiveBatch` exists: skip Claude, compute `allBatchesDone` by checking if there are more missing batches.
5. Else: call `executeExtractOneBatch`.
6. Return with `allBatchesDone` flag.

**Step 4: Add `extractWebsiteFaqsForOneBatch` export in `faq-agent-runner/lib/onboarding-ai.ts`** (thin wrapper around existing `extractWebsiteFaqs` with the current payload shape).

**Step 5: Unit tests**

- `executeExtractOneBatch` writes exactly one artifact and returns sensible counts.
- Branch is idempotent: running batch 3 twice → second run short-circuits, no duplicate artifact.

**Step 6: Run tests + typecheck**

Run: `pnpm --filter bizzybee-hardening-control typecheck && pnpm --filter bizzybee-hardening-control test`
Expected: all green.

**Step 7: Commit**

```bash
git add supabase/functions/_shared/onboarding-website-runner.ts \
        supabase/functions/_shared/onboarding-website-runner.test.ts \
        supabase/functions/faq-agent-runner/lib/onboarding-ai.ts
git commit -m "feat(onboarding/website): process extract one batch per invocation"
```

---

## Task 4: Update `pipeline-worker-onboarding-website` to chain batches

**Files:**

- Modify: `supabase/functions/pipeline-worker-onboarding-website/index.ts:51-89`

**Step 1: Pass `batchIndex` into the runner**

```typescript
const { executedStep, batchIndex, batchCount, allBatchesDone } = await executeWebsiteRunStep(
  supabase,
  run,
  job.step,
  effectiveAttempt,
  {
    heartbeat,
    batchIndex: job.batch_index,
  },
);
```

**Step 2: Rewrite the chain-enqueue logic**

```typescript
if (executedStep === 'fetch') {
  await queueSend(
    supabase,
    QUEUE_NAME,
    {
      run_id: run.id,
      workspace_id: run.workspace_id,
      step: 'extract',
      attempt: 1,
      batch_index: 0, // start chunked extract
    },
    0,
  );
  await tryWakeWorker(supabase);
} else if (executedStep === 'extract') {
  if (allBatchesDone) {
    // All batches have their artifacts — move to persist.
    await queueSend(
      supabase,
      QUEUE_NAME,
      { run_id: run.id, workspace_id: run.workspace_id, step: 'persist', attempt: 1 },
      0,
    );
  } else if (typeof batchIndex === 'number' && typeof batchCount === 'number') {
    // Enqueue the NEXT batch. Runner wrote artifact N, so next is N+1.
    await queueSend(
      supabase,
      QUEUE_NAME,
      {
        run_id: run.id,
        workspace_id: run.workspace_id,
        step: 'extract',
        attempt: 1,
        batch_index: batchIndex + 1,
      },
      0,
    );
  }
  await tryWakeWorker(supabase);
}

await queueDelete(supabase, QUEUE_NAME, record.msg_id);
```

Where `tryWakeWorker` is a local helper that wraps the existing wakeWorker + try/catch.

**Step 3: Verify no fall-through** — if `executedStep === 'extract'` and `allBatchesDone === false` and no batchIndex/batchCount, this would enqueue nothing. Assert that the runner always returns one of the two shapes. Add a defensive `else` that logs and throws (so requeueStepJob kicks in).

**Step 4: Integration-level test**

Skip unit tests for the index.ts (depends on Deno). Instead, verify via staged edge-fn deploy + manual trigger after Task 5.

**Step 5: Commit**

```bash
git add supabase/functions/pipeline-worker-onboarding-website/index.ts
git commit -m "fix(onboarding/website): chain per-batch extract msgs; only enqueue persist when all batches done"
```

---

## Task 5: Update `persist` step to aggregate batch artifacts

**Files:**

- Modify: `supabase/functions/_shared/onboarding-website-runner.ts` (persist branch, currently ~line 314-379)

**Step 1: Replace `loadRunArtifact(... 'website_faq_candidates')` with aggregation over batches**

```typescript
// Load all batch artifacts and concatenate their faqs.
const { data: batchRows, error: batchErr } = await supabase
  .from('agent_run_artifacts')
  .select('artifact_key, content')
  .eq('run_id', run.id)
  .eq('workspace_id', run.workspace_id)
  .like('artifact_key', 'website_faq_candidates_batch_%')
  .order('artifact_key');

if (batchErr) throw new Error(`Failed to load batch artifacts: ${batchErr.message}`);

const faqs: FaqCandidate[] = [];
for (const row of batchRows ?? []) {
  const content = row.content as { faqs?: FaqCandidate[] } | null;
  if (Array.isArray(content?.faqs)) faqs.push(...content.faqs);
}

// Write the consolidated `website_faq_candidates` artifact for downstream
// tooling / compat / observability.
await recordRunArtifact(supabase, {
  runId: run.id,
  workspaceId: run.workspace_id,
  artifactType: 'faq_candidate_batch',
  artifactKey: 'website_faq_candidates',
  content: { faqs, batch_count: (batchRows ?? []).length } as Record<string, unknown>,
  stepId: stepRecord.id,
});

if (!faqs || faqs.length < 3) {
  throw new Error('Not enough grounded website FAQs were extracted');
}
```

**Step 2: Keep the existing `faq_database` insert and run success logic unchanged.**

**Step 3: Unit test**

- `persist` aggregates N batch artifacts and inserts `sum(faqs)` rows.
- `persist` throws when aggregate < 3.

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -m "fix(onboarding/website): persist step aggregates batch artifacts before writing faq_database"
```

---

## Task 6: Update nudge to enqueue the correct next batch

**Files:**

- Modify: `supabase/functions/onboarding-worker-nudge/index.ts` (the `resolvePendingWebsiteStep` + `nextWebsiteStepOrInFlight` for 'extract')

**Step 1: When nudge sees `hasCandidates = false` and picks 'extract'**, it must attach `batch_index = getNextMissingWebsiteBatch(...)` to the enqueued payload. Currently it always uses `attempt: 1` with no batch_index, which would restart from batch 0 every nudge.

```typescript
// In the main handler where it handles own_website_scrape
const nextStep = await resolvePendingWebsiteStep(supabase, run);
if (nextStep === 'extract') {
  const pages = await loadWebsitePagesCount(supabase, run.id, run.workspace_id);
  const nextBatch = await getNextMissingWebsiteBatch(supabase, run.id, run.workspace_id, pages);
  if (nextBatch === null) {
    // All batches present — caller meant 'persist' not 'extract'
    await queueSend(
      supabase,
      ONBOARDING_WEBSITE_QUEUE,
      { run_id: run.id, workspace_id: run.workspace_id, step: 'persist', attempt: 1 },
      0,
    );
  } else {
    await queueSend(
      supabase,
      ONBOARDING_WEBSITE_QUEUE,
      {
        run_id: run.id,
        workspace_id: run.workspace_id,
        step: 'extract',
        attempt: 1,
        batch_index: nextBatch,
      },
      0,
    );
  }
} else if (nextStep) {
  // fetch / persist — existing payload shape
  await queueSend(...);
}
```

**Step 2: The in-flight check** — currently checks `agent_run_steps.step_key='website:extract'`. After Task 3 it'll be `website:extract_batch_{N}`. Update the dedupe to match `website:extract_batch_%` with LIKE or by name prefix.

**Step 3: Unit test** (if nudge has tests — check, otherwise deferred to manual E2E).

**Step 4: Commit**

```bash
git commit -m "fix(onboarding/website-nudge): enqueue correct next batch_index for chunked extract"
```

---

## Task 7: Deploy + end-to-end verification

**Step 1: Deploy updated edge functions**

```bash
npx supabase functions deploy pipeline-worker-onboarding-website --project-ref atukvssploxwyqpwjmrc
npx supabase functions deploy onboarding-worker-nudge --project-ref atukvssploxwyqpwjmrc
```

**Step 2: Michael re-triggers the own-site scrape from the UI.**

**Step 3: Watch the run in real-time**

```sql
-- Should see ONE step record per batch, status 'succeeded'. Never >1 concurrent 'running'.
select step_key, attempt, status, started_at, completed_at
from agent_run_steps
where run_id = '<new-run-id>'
order by started_at;

-- Should see website_faq_candidates_batch_0..N-1 artifacts accumulating one at a time.
select artifact_key, created_at
from agent_run_artifacts
where run_id = '<new-run-id>'
order by created_at;

-- output_summary progress.batch_index should only ever INCREASE
select updated_at, output_summary->'website_extract_progress' as progress
from agent_runs
where id = '<new-run-id>'
order by updated_at desc
limit 20;
```

**Expected behaviour:**

- Each edge-function invocation logs `execution_time_ms < 60_000` (no 150s kill).
- `batch_index` progresses monotonically 1 → 2 → ... → 12, **never resets**.
- Total wall-clock run time ~8 minutes (same as before) but split across 12 healthy invocations.
- `faq_database` rows land after batch 12 via persist.

**Step 4: Commit the verification note into handoff**

Update the handoff doc to record the verified fix.

---

## Rollback plan

If the refactor regresses harder than the current state:

1. `git revert` the commits from Tasks 2-6 (in reverse order).
2. Redeploy edge functions.
3. Task 0's cancellation (broken run) is non-reversible but harmless — user just re-triggers.

## Open questions to flag during execution

- Does `extractWebsiteFaqs` (the per-batch function referenced by `extractWebsiteFaqsForOneBatch`) already exist in `faq-agent-runner/lib/onboarding-ai.ts`? Confirm before Task 3 Step 4 — if not, we may just inline the per-batch prompt-and-parse.
- Is `WEBSITE_EXTRACTION_BATCH_SIZE` used outside the chunks function? Safe to leave at 1, but double-check no other code assumes chunking.
