# 2026-04-17 Competitor Quality Pass — Handoff to Codex

**Status:** 3 commits on `codex/supabase-hardening-control`, pushed.
**Prior baseline:** the 2026-04-16 radius-expansion + onboarding-disaster
remediation work had just landed. Competitor discovery was returning 11/15
approved (Places-curated was starting to help), but FAQ extraction
was producing only ~4 FAQs total across all competitors vs own-site's ~67
FAQs from 11 pages of one domain. User-perceived quality was poor.

## TL;DR for reviewer

Three commits land a cohesive set of changes to pull competitor discovery

- competitor FAQ harvest up to the quality bar the own-site pipeline
  already hits. The shape of the fix was informed by two user-provided spec
  docs (linked below). At a glance:

1. **Discovery quality:** SERP was fundamentally noisy (directory/social
   dominance) — switch to Google Places Text Search with per-town
   fan-out as the primary path. SERP remains as fallback.
2. **Town curation:** `uk_towns` contained many wards/suburbs that don't
   independently rank for services (Sopwell, Fleetville, Marshalswick,
   Bennetts End…). Add a Places-based settlement-type filter that keeps
   only true localities.
3. **Scrape parity:** Competitor crawl was hard-capped at 1 page per
   competitor while own-site crawled 8. That's the single biggest reason
   own-site FAQ yield was 10× competitor's. Unify to `crawlWebsitePages
(url, 8)` + per-page Claude extraction.
4. **Reliability:** pgmq was redelivering long-running messages because
   the later FAQ steps had no heartbeat. Workers raced, counters flickered,
   generate_candidates ran four times in parallel. Add heartbeats,
   per-competitor timeouts, monotonic counters, bumped VT.
5. **One latent bug** unblocked on the way: six `.select('industry, …')`
   call sites against `business_context` — the `industry` column has
   never existed. The query silently errored → `businessContext` was
   null → heuristic competitor qualification defaulted to "reject all".

Acceptance criteria from Spec 2 (embedded below): not all met yet. Gaps
listed under "Open / not done" at the bottom.

## Reference specs

Two markdown files the user handed us mid-session; both materially shaped
the direction. They're worth reading before reviewing the commits:

1. `~/Downloads/competitor_scraper_architecture.md` — architectural
   diagnosis. Key argument: "good scraper, weak discovery layer." Split
   into two deterministic pipelines (Domain Discovery, Site Extraction).
   Uses weighted scoring, strict root-domain dedupe, evidence-quota
   extraction, shared contract across all competitors.

2. `~/Downloads/bizzybee-competitor-discovery-and-extraction.md` —
   tactical implementation brief for BizzyBee specifically. Has concrete
   blocklist, query fan-out shape (80 queries for 20 towns × 4 variants),
   `competitor_domains` + `competitor_search_results` schemas,
   sequential-processing mandate, per-competitor 3-min timeout,
   `industry_standard` flag for cross-competitor dedupe, acceptance
   criteria.

Both are consistent. Spec 2 is more directly actionable; I used it as the
primary reference while treating Spec 1 as the architectural backdrop.

## Branch state

```
codex/supabase-hardening-control @ 2026-04-17

d6e53cb feat(onboarding/competitor-faq): unify scrape/extract with own-site 8-page pipeline + reliability pass
752ba31 feat(onboarding/discovery): Places-first with curated nearby towns + industry-field fix
926db6c fix(supabase/uk_towns): grant SELECT to authenticated behind the RLS policy
1ddeb9c feat(onboarding/competitor-review): disclose pipeline cap + regression guard  ← yesterday
fbc24a3 feat(onboarding/competitor-review): soft 5-10 recommendation + remove hard cap  ← yesterday
```

Tests: **323/323 passing.** `npx tsc --noEmit`: clean.

## Commit-by-commit detail

### 926db6c — `fix(supabase/uk_towns): grant SELECT to authenticated`

**1 file.** Adds the migration
`20260416224200_grant_uk_towns_select_to_authenticated.sql`.

The 2026-04-16 `uk_towns` migration enabled RLS + created a SELECT policy
for `authenticated`, but never ran
`GRANT SELECT ON TABLE public.uk_towns TO authenticated`. RLS only
filters rows you're already entitled to read — without the grant the
query errors at the privilege check before RLS runs. Manifested as
`expand_search_queries` RPC (SECURITY INVOKER) dying from the browser
with `permission denied for table uk_towns`, the chip row silently
collapsing to primary-town-only.

**Review focus:** Should this have been part of the 20260416211432 seed
migration? Yes — leaving it here only because the seed migration has
already been applied to the live project and we don't amend landed
migrations.

### 752ba31 — `feat(onboarding/discovery): Places-first with curated nearby towns + industry-field fix`

**8 files, ~700 lines.** Largest commit of the pass.

**New:** `supabase/functions/get-nearby-towns/index.ts` (edge function).
Takes `{primary_town, radius_miles, max_towns}`, returns
`{primary, towns}` where each town is guaranteed to be a Google-classified
locality (not a sublocality/ward).

Two-step approach:

1. Primary town → lat/lng via Places Text Search. (Geocoding API returned
   `REQUEST_DENIED` on our key — only Places is enabled. This is a
   known workaround, not a clever design; document it so nobody tries
   to "simplify" by switching to the Geocoding API.)
2. Query `uk_towns` by bounding box + haversine for ~2× maxTowns
   candidate names; for each, call Places Find Place From Text to get
   the `types` array; keep only those with `locality` and no
   `sublocality*`.

Live Luton +20mi test the reviewer can reproduce: 50 candidates →
25 sublocality rejections → 25 real localities. Rejected names include
Sopwell, Fleetville, Marshalswick, Bernards Heath, Townsend, Cotonmills,
Bennetts End, Cunningham Hill — all of which the user called out as
noise that wouldn't independently rank for window-cleaning services.

**New (same commit):** `searchCompetitorsViaPlaces` in
`faq-agent-runner/lib/onboarding-ai.ts`. Per-town Places Text Search with
3 query variants each, dedupe by `place_id` across variants, rank by
`rating × log(reviews + 1)`, fetch Place Details for top 2× target for
website, filter UNSCRAPABLE + workspace's own domain, return up to
`targetCount`.

**Wiring:** `pipeline-worker-onboarding-discovery` calls Places first;
if ≥5 candidates returned, uses them and skips SERP. Below 5 or on
error, falls back to the existing `searchCompetitorCandidates` SERP path
(still intact).

**Client:** `SearchTermsStep` now calls `get-nearby-towns` first. If ≥2
towns returned, builds queries client-side (same shape as the RPC:
primary × all stems + nearby × first 3 stems) and uses those for the
chip row. RPC remains as fallback. `target_count` raised from 15 → 25
to use the server-side hard cap. `towns_used` sent in POST body so the
backend's Places fan-out respects user chip-row exclusions.

**Edge function:** `start-onboarding-discovery` accepts and persists
`towns_used` into `input_snapshot`.

**Bundled bug fix:** 4 `.select('industry, service_area, business_type,
…')` call sites across `pipeline-worker-onboarding-discovery`,
`faq-agent-runner/tools/get-run-context`, and
`_shared/onboarding-website-runner`. `industry` column does not exist
on `business_context` (verified via
`information_schema.columns` — only `industry_faqs_copied` exists, a
different thing). supabase-js errored silently, `businessContext` was
null, downstream defaults cascaded. Fix: remove `industry, ` from the
select lists. The `industry` field on `PromptContext` is still
populated from `businessContext?.industry ?? null` and always resolves
to null — harmless.

**Review focus:**

- Is the `.select()` change safe? Yes — `businessContext?.industry` was
  already being `?? null`-coalesced and no prompt template breaks on
  empty industry. Prompt templates reference `business_type` which is
  the real signal.
- Why 10 SERP exclusions and not the full 30-host UNSCRAPABLE list?
  Google silently ignores `-site:` operators past about 10, and
  distorting the SERP composition (freeing up UK directory slots)
  was causing US results to bubble into UK queries. 10 covers the
  top offenders; the full UNSCRAPABLE list runs post-fetch as
  `filterUnscrapableFromQualification`. Comment in-code explains.
- Why keep both the RPC and Places paths? Defensive — if Places quota
  hits a wall or the key rotates, discovery still works against
  SERP. Also the RPC powers a parity test between TS + SQL
  implementations that I didn't want to invalidate.

### d6e53cb — `feat(onboarding/competitor-faq): unify scrape/extract with own-site 8-page pipeline + reliability pass`

**4 files, ~230 lines.**

**Scrape parity:** `handleFetchSourcePage` in
`faq-agent-runner/tools/fetch-source-page.ts`:

- Return type: `FetchResult` → `FetchResult[]`.
- `maxCrawlPages: 1` → `8` (default), accepts override.
- Adds `includeUrlGlobs: [${origin}/**]` so Playwright follows internal
  links.
- Timeout 90s → 180s.
- Caller in `pipeline-worker-onboarding-faq` rewritten to accumulate
  per-competitor buckets into a flat `pages` array for the `faq_pages`
  artifact.

Observed yield: cmbwindowcleaning 11 pages, legendarycleaning 10,
fantasticservices 4. Small sites stay at 1 page (no internal links to
follow), but the ones that matter now contribute their `/services`,
`/pricing`, `/faq` sub-pages.

**Extract parity:** `extractFaqCandidatesFromPages` (in
`_shared/onboarding-faq-engine.ts`) now routes BOTH `sourceKind:
'own_site'` AND `'competitor'` through `extractWebsiteFaqsInChunks`
(`WEBSITE_EXTRACTION_BATCH_SIZE = 1`). Previously competitor used
`extractCompetitorFaqCandidates` which packed all pages into a single
Claude call — worked at ~5 total pages, breaks at 25+.

Added a `finalLimit` option to `extractWebsiteFaqsInChunks`: own-site
stays at 15, competitor uses 60 because many sites aggregate upstream
of the finalizer.

**Reliability:**

- `VT_SECONDS: 180 → 600`. 8-page scrape + per-page extract easily
  crosses the old VT.
- `FETCH_CONCURRENCY: 5 → 2`. 5 × 8 = 40 concurrent Playwright was
  failing ~79% of calls at Apify. 2 × 8 = 16 is the steady state
  that worked.
- `createPgmqHeartbeat` added to `generate_candidates` (chained through
  `onWebsiteProgress` so it fires after every per-page Claude call)
  and `finalize` (called after loading candidates). Previously only
  `fetch_pages` heartbeated. This was directly causing today's "4
  concurrent generate_candidates attempts racing" symptom.
- Per-competitor 3-min timeout (`Promise.race` against the
  `handleFetchSourcePage` call). Bounds wall-clock per site and stops
  one slow site from stalling the worker past VT.
- Monotonic counter writes on `competitor_research_jobs`:
  `sites_scraped` / `pages_scraped` now read-modify-write with
  `Math.max(existing, new)`. Stops the "19 → 1" UX flicker.

**Safety net:** `UNSCRAPABLE_HOSTNAME_PATTERNS` gained `.co.uk` variants
for nextdoor, yelp, yell, trustpilot plus `angi.com`,
`threebestrated.co.uk`. These leaked through yesterday because the list
was `.com`-only.

**Bundled dedup fix:** `approvedRows` in `pipeline-worker-onboarding-
discovery`'s persist step now dedupes on `domain` with highest
`relevance_score` winning. Claude (or heuristic) can approve the same
domain via multiple discovery_queries — e.g. `fantasticservices.com`
for both "best rated window cleaners luton" AND "gutter cleaning luton".
Each duplicate burned a scrape slot.

**Same `industry` fix** in `pipeline-worker-onboarding-faq` that landed
across-the-board in the previous commit. Bundled here because the
scrape/extract path couldn't work without it.

**Review focus:**

- Per-competitor timeout — 3 min chosen to match Spec 2's guidance.
  Under `FETCH_CONCURRENCY=2`, worst-case scrape wall-clock for 25
  competitors is ~25/2 × 3min = 37.5min which is higher than Spec 2's
  "20min total pipeline" acceptance criterion. In practice most
  sites complete in 20-30s so this is theoretical ceiling; real
  observed runs were <5min. If this becomes a real constraint, drop
  per-site timeout to 90s.
- The `extractCompetitorFaqCandidates` function is still exported but
  no longer called internally. Kept to avoid breaking anything that
  imports it from outside. Safe to remove in a follow-up.
- The old single-shot competitor prompt (`faq-extraction.md`) is now
  unused. `website-faq-extraction.md` handles both cases via
  `extractWebsiteFaqs`. Might want to delete the unused prompt.

## Open / not done (from Spec 2's acceptance criteria)

Explicitly deferred, not "missed":

1. **`industry_standard` / `competitor_count` fields on FAQs.** Spec 2
   wants the finalizer to flag "3+ competitors said the same thing"
   and count how many. Not implemented — the existing Jaccard-similarity
   dedupe does most of what this would do, and adding the flag
   requires a schema migration + finalizer prompt rewrite. Cheaper
   to add as a follow-up after we see what the new FAQ volume looks
   like in practice.

2. **New schema tables `competitor_domains`, `competitor_search_results`.**
   Spec 2 wants these for discovery tuning/debugging and a
   `workspaces.search_locations` jsonb. We already persist
   `input_snapshot.towns_used` and `input_snapshot.search_queries` on
   `agent_runs`, and `competitor_sites` already carries most of what
   `competitor_domains` would. Adding dedicated tables is useful for
   query-position analytics but wasn't blocking quality.

3. **Evidence-quota on competitor extraction** ("don't accept a domain
   profile unless homepage + 1 service page + 1 contact/about page
   scraped"). Not implemented. Current filter is just
   `classifyFetchedPage` per page (empty / too_short / ok). Could add
   a per-competitor minimum-pages check at the end of fetch_pages.

4. **`CompetitorProfile` strict schema** (Spec 1's §4). We still emit
   FAQ candidates, not a structured competitor profile. The FAQ-first
   design is what the product actually surfaces, so I treated this
   as out of scope.

5. **Per-competitor retry with alternate page selection.** Spec 2 wants
   "if extraction is weak, retry page discovery once, retry with
   alternate service page". Not implemented — `withTransientRetry`
   handles transient Apify/Claude errors but doesn't pick different
   pages on semantic weakness.

## Known judgment calls the reviewer should sanity-check

1. **Keeping the SERP path as fallback** instead of deleting it.
   Rationale above. If codex thinks the maintenance overhead isn't
   worth the defence-in-depth, it's safe to remove
   `searchCompetitorCandidates` and the SERP wiring in
   `pipeline-worker-onboarding-discovery`.

2. **`target_count: 25`** as the client default. The server caps at 25
   regardless, so the client sending anything lower was just
   under-using budget. No downside — Places comfortably produces 25
   after multi-town fan-out.

3. **Places cost envelope.** ~$0.80 per onboarding for Places
   (20 towns × 3 variants × ~$0.04 textsearch + ~30 Details for top
   candidates × $0.017) + ~$0.50 for Places-curated-towns pass
   (20 findplace × $0.017 × 2 for overshoot). Total ~$1.30
   discovery cost per onboarding. User explicitly accepted this
   tradeoff — phrased "100 million %" — but codex may want to confirm
   it fits the commercial model.

4. **Per-page Claude extract loops competitor through same prompt as
   own-site.** The `website-faq-extraction.md` prompt is tuned for
   "extracting FAQs from THIS business's own site." When passed a
   competitor's page it still produces usable FAQs, and the downstream
   `finalizeSharedFaqCandidates` step strips competitor brand names.
   Works in practice. Alternative — a dedicated
   `competitor-faq-extraction.md` prompt — would give better
   per-page output but is an extra prompt to maintain. Judgment call.

## Reproducer: verify the quality claims live

Workspace: MAC Cleaning, `acdf92d1-9da7-4c71-8216-04d476d31bb0`.
Service area: "Luton (20 miles)".

1. `get-nearby-towns` directly:

   ```bash
   curl -X POST "https://atukvssploxwyqpwjmrc.supabase.co/functions/v1/get-nearby-towns" \
     -H "Authorization: Bearer <user-jwt>" \
     -H "Content-Type: application/json" \
     -d '{"primary_town":"Luton","radius_miles":20,"max_towns":25}'
   ```

   Expect: `candidates_considered: 50`,
   `candidates_rejected_as_sublocality: ~25`, `towns.length: 25`.

2. End-to-end onboarding re-trigger from the Search Terms step. Expect:
   - Chip row shows ~21 real localities (no Sopwell/Fleetville/etc).
   - `agent_runs.competitor_discovery`: `approved_count` between 18-25,
     `discovery_source: 'places'` in step output.
   - `agent_runs.faq_generation`: `faq_count` between 40-80,
     `output_summary.faq_progress.pages_scraped` between 50-120.

## Files touched this session

### Commit 926db6c

- `supabase/migrations/20260416224200_grant_uk_towns_select_to_authenticated.sql` (new)

### Commit 752ba31

- `supabase/functions/get-nearby-towns/index.ts` (new)
- `supabase/functions/start-onboarding-discovery/index.ts`
- `supabase/functions/pipeline-worker-onboarding-discovery/index.ts`
- `supabase/functions/faq-agent-runner/lib/onboarding-ai.ts`
- `supabase/functions/faq-agent-runner/tools/get-run-context.ts`
- `supabase/functions/_shared/onboarding-website-runner.ts`
- `src/components/onboarding/SearchTermsStep.tsx`
- `src/components/onboarding/__tests__/SearchTermsStep.test.tsx`

### Commit d6e53cb

- `supabase/functions/_shared/onboarding-faq-engine.ts`
- `supabase/functions/_shared/unscrapableUrl.ts`
- `supabase/functions/faq-agent-runner/tools/fetch-source-page.ts`
- `supabase/functions/pipeline-worker-onboarding-faq/index.ts`

## Deployed edge functions

All deployed to project `atukvssploxwyqpwjmrc`:

- `get-nearby-towns` (new)
- `start-onboarding-discovery`
- `pipeline-worker-onboarding-discovery`
- `pipeline-worker-onboarding-faq`
- `pipeline-worker-onboarding-website`
- `onboarding-worker-nudge`
- `faq-agent-runner`

Migration `20260416224200_grant_uk_towns_select_to_authenticated` applied
to the live DB.

## For codex

Suggested review order:

1. Read the two spec docs in `~/Downloads/` first — they're the
   architectural north star.
2. Review the commits in order (926db6c → 752ba31 → d6e53cb).
3. Check the "Known judgment calls" section — those are the
   opinionated decisions that may want a second opinion.
4. Check "Open / not done" against Spec 2's acceptance criteria to
   decide whether to land the deferred pieces in the same pass or
   scope them separately.
5. If running live, start with the reproducer above against the
   MAC Cleaning workspace to confirm quality numbers before touching
   anything.
