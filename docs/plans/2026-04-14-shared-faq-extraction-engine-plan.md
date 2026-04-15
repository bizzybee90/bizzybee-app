# Shared FAQ Extraction Engine Plan

## Why this exists

BizzyBee currently has two adjacent onboarding pipelines:

- `own_website_scrape`
- `faq_generation` for approved competitors

They are not identical end to end, but they overlap heavily once we already have page content in hand. Today that overlap is implemented twice, which is why the website path and the competitor path can drift in progress behavior, retries, and completion state.

The goal of this plan is to merge the extraction engine, not to force the entire workflows into one giant worker.

## Current reality

### Keep separate

These parts are genuinely different and should remain separate entry workflows:

- own-site crawl and page discovery
- competitor search and qualification
- competitor allowlisting / domain filtering
- competitor selection and approval

### Merge into one shared engine

These parts should be shared:

- page-batch artifact contract
- FAQ extraction progress updates
- grounded candidate generation
- dedupe against existing FAQs
- optional quality/final shortlist pass
- persistence into `faq_database`
- progress heartbeat / queued / stalled handling
- worker nudge / retry behavior

## Target architecture

### Workflow A: Own website

1. Discover own pages
2. Fetch own page content
3. Pass page batch into shared FAQ extraction engine

### Workflow B: Competitors

1. Discover competitors
2. Qualify competitors
3. Fetch competitor pages
4. Pass page batch into shared FAQ extraction engine

### Shared FAQ extraction engine

Input:

- `workspace_id`
- `run_id`
- `source_kind` (`own_site` or `competitor`)
- `pages_artifact_key`
- `persist_category`
- `is_own_content`
- `dedupe_against_existing`
- `require_final_selection`
- `source_business_map` when available

Stages:

1. `faq:extract_candidates`
2. `faq:dedupe`
3. `faq:finalize` (optional for own-site, required for competitors only if it adds value)
4. `faq:persist`

Output:

- standard progress counts
- standard heartbeat
- standard run summary
- standard FAQ persistence result

## Standard contracts to introduce

### Shared page artifact

Both website and competitor paths should write the same page artifact shape:

```ts
type SharedFaqSourcePage = {
  url: string;
  title?: string | null;
  text: string;
  source_business?: string | null;
  source_kind: 'own_site' | 'competitor';
};
```

### Shared FAQ candidate artifact

Both paths should write the same candidate artifact shape:

```ts
type SharedFaqCandidate = {
  question: string;
  answer: string;
  source_url: string;
  source_business?: string | null;
  evidence_quote?: string | null;
  quality_score?: number | null;
};
```

### Shared progress shape

All FAQ extraction runs should expose:

- `agent_status`
- `current_step`
- `last_heartbeat_at`
- `counts.pages_found`
- `counts.pages_processed`
- `counts.faqs_found`
- `counts.faqs_persisted`
- optional `output_summary.extract_progress`

This lets the UI render one live progress component for both own-site and competitor FAQ runs.

## What should change first

### Phase 1: Extract shared engine

Move the overlapping logic out of:

- `pipeline-worker-onboarding-website`
- `pipeline-worker-onboarding-faq`

into a shared runner module that can:

- load source pages
- run FAQ extraction
- report batch progress
- dedupe
- finalize when configured
- persist rows

This should become the single source of truth for FAQ extraction behavior.

### Phase 2: Standardize progress keys

Make both website and competitor FAQ runs expose the same progress vocabulary.

Today the website path already feels closer to the right model:

- fetch
- extract
- persist

The competitor path should either align to that naming or map cleanly onto the same UI layer.

### Phase 3: Unify customer-facing progress UI

Once both paths emit the same counters and heartbeat model, the UI should show:

- worker state
- last heartbeat
- pages found
- pages scraped
- FAQ candidates found
- FAQs persisted

for both own-site and competitor FAQ generation.

### Phase 4: Unify retry and nudge behavior

The same self-healing pattern now used on website onboarding should apply to competitor FAQ generation:

- queue detection
- delayed worker pickup recovery
- user-facing "rechecking worker" copy
- stale-run warnings

## Practical policy differences

These should stay configurable, not branch the whole pipeline:

- `source_kind = own_site | competitor`
- `persist_category = knowledge_base | competitor_research`
- `is_own_content = true | false`
- `dedupe_against_existing = true | false`
- `require_final_selection = true | false`
- `minimum_faq_count`

## Why this will help

If we do this, BizzyBee gets:

- one bulletproof FAQ extraction engine instead of two similar ones
- one progress model the customer can trust
- one retry/nudge model
- fewer "works for website but not competitors" regressions
- less duplicated backend logic
- easier debugging and better product confidence during onboarding

## Recommendation

This refactor should happen soon, but after the live website onboarding path is fully stabilized.

Priority order:

1. keep own-site scrape and customer-facing progress trustworthy
2. extract the shared FAQ engine
3. migrate competitor FAQ generation onto it
4. collapse both UI progress flows into one unified extraction experience
