# Competitor Discovery — Radius Expansion + Quality Invariants Design

**Date:** 2026-04-16
**Status:** Approved — awaiting implementation plan
**Scope:** Location-bound service businesses. Online-only businesses (BizzyBee itself) are explicitly a separate design.

---

## Problem

MAC Cleaning's onboarding returned 28 raw candidates → 14 qualified competitors. User expected more. Investigation showed:

1. Discovery fires 5 search queries, all city-suffixed (`window cleaning luton`, `gutter cleaning luton`, etc.), against Apify's `google-search-scraper`. No query hits Dunstable, Harpenden, St Albans, Hemel Hempstead, Hitchin, Houghton Regis — all valid window-cleaning competitors within MAC's declared 20-mile service radius.
2. The `business_context.service_area` field already stores the radius (`"Luton (20 miles)"`) but the discovery worker never reads it.
3. Separately: the competitor-FAQ **finalizer** prompt (`finalizeFaqCandidates` in `onboarding-ai.ts`) does not enforce any "user website is source of truth" rule. Competitor answers can persist into the user's knowledge base verbatim, contradicting their own services/pricing/voice. Raising the competitor pool size amplifies this contamination risk, so the invariant fix must ship alongside the discovery expansion.

## Goal

Expand the discovery net for location-bound businesses by fanning search queries across towns within the declared service radius. In parallel, enforce "user website = source of truth" as an invariant in the finalizer prompt. Give the user visibility into both the expanded search list and a soft recommendation on how many competitors actually add signal.

## Non-goals (this design)

- Online-only businesses (BizzyBee, SaaS, nationwide couriers). Radius doesn't model them. Separate brainstorm.
- International workspaces (US, AU, EU). `uk_towns` is UK-only for now.
- Per-query free-text editing. Chip-toggle per town is v1's escape hatch.
- Replacing Apify `google-search-scraper` with a Maps-based actor. That's a bigger API change with its own brainstorm.

---

## Approved decisions (from brainstorm)

| Decision                  | Choice                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scope                     | Radius expansion first; online-business case deferred.                                                                                                 |
| Radius mechanism          | Expand query text with nearby towns. No new external API.                                                                                              |
| Town data source          | Static `uk_towns` table in Supabase. ~1,500 towns, seeded from ONS "Built-up areas" public-domain dataset.                                             |
| Query volume              | Cap at 25–30 total. Primary town gets all 5 terms; nearby towns get top 2–3 per town. Farthest-town × lowest-priority-term combinations trimmed first. |
| UI transparency           | Show expanded queries + town chips on Search Terms step. Toggle individual towns off.                                                                  |
| User website invariant    | Enforce in the finalize prompt. Competitor FAQs rewritten to user voice/facts; never persist competitor-specific claims verbatim.                      |
| Competitor intake ceiling | **No hard cap.** Soft recommendation 5–10 surfaced in UI copy; user retains full control over how many they pick.                                      |

---

## Architecture

```
[BusinessContextStep]  service_area = "Luton (20 miles)"
        │
        ▼
[SearchTermsStep]  user confirms 5 search terms
        │
        ├─ NEW: expandSearchQueries(terms, serviceArea) → { queries, townsUsed, ... }
        │       Client-side: reads uk_towns via Supabase RPC + runs pure expander
        │
        ▼
   UI renders:
     • existing 5-term editor (unchanged)
     • NEW row: "Searching in: Luton • Dunstable ✕ • Harpenden ✕ • St Albans ✕ • Hemel Hempstead ✕ • Hitchin ✕"
     • NEW caption: "{N} queries will fire across {M} towns within 20 miles"
        │
        ▼
[start-onboarding-discovery]  stores expanded queries into input_snapshot.search_queries
        │
        ▼
[pipeline-worker-onboarding-discovery]  (unchanged logic)
   reads search_queries array, fires 1 Apify actor run per query
   → candidates → qualify → review
        │
        ▼
[CompetitorReviewScreen]
   shows qualified list
   NEW: "We recommend picking 5–10 competitors — that's usually enough
         for diverse coverage without diluting your own voice. You're
         welcome to pick more if you prefer."
   User keeps full control; no hard cap enforced.
        │
        ▼
[pipeline-worker-onboarding-faq]  competitor scrape + extract + finalize
   MODIFIED: finalize prompt enforces "user website is source of truth"
   → faq_database (is_own_content=false, category=competitor_research)
```

**Why it fits the existing system:**

- Discovery worker already reads `input_snapshot.search_queries` as an opaque array. We just make that array longer and smarter upstream.
- `business_context.service_area` already carries the radius in `"(N miles)"` form.
- Cap of 25–30 queries stays within Apify's per-account concurrency.
- The competitor-intake cap and finalizer invariant are separable fixes that could ship independently if needed, but they belong in this design because radius expansion directly grows the FAQ contamination blast radius.

---

## Components & data

### New: `uk_towns` table

```sql
create table public.uk_towns (
  id serial primary key,
  name text not null,                  -- "Luton", "Dunstable"
  county text,                         -- "Bedfordshire"
  latitude double precision not null,
  longitude double precision not null,
  population integer,                  -- tiebreak when multiple towns match a query
  canonical_slug text unique not null  -- "luton" — for fuzzy user-input matching
);

create index uk_towns_canonical_slug_idx on public.uk_towns (canonical_slug);
create index uk_towns_latlng_idx on public.uk_towns (latitude, longitude);

-- RLS: read-only to authenticated users; no write policy (admin-seeded only).
alter table public.uk_towns enable row level security;
create policy "uk_towns_readable" on public.uk_towns for select to authenticated using (true);
```

Seed: ~1,500 UK towns with population ≥ 5,000 from the ONS "Built-up areas" dataset (public domain). One-time seed SQL shipped as a migration. ~150KB inline.

### New helper: `supabase/functions/_shared/uk-towns.ts`

```ts
export async function findNearbyTowns(
  supabase: SupabaseClient,
  primaryTownName: string,
  radiusMiles: number,
  maxResults = 6,
): Promise<Array<{ name: string; miles: number }>>;
```

Resolve `primaryTownName → (lat, lng)` via `canonical_slug` (exact → prefix → fuzzy). Haversine filter `order by distance asc limit maxResults+1`, drop the primary, return.

### New helper: `supabase/functions/_shared/expandSearchQueries.ts`

```ts
export function expandSearchQueries(params: {
  searchTerms: string[]; // Claude-scored, already ordered by priority
  primaryTown: string;
  nearbyTowns: string[]; // pre-sorted nearest-first
  maxQueries?: number; // default 30
}): {
  queries: string[];
  townsUsed: string[];
  primaryCoverage: string[]; // terms applied to primary town
  expandedCoverage: string[]; // terms applied to nearby towns
};
```

Allocation:

1. Strip the primary-town suffix from each input term (`window cleaning luton` → `window cleaning`) using the workspace's primary town.
2. Primary town: every stripped term (full coverage).
3. Nearby towns: top 2–3 highest-priority stripped terms each.
4. Combine as `{term} {town}` query strings, dedupe exact matches.
5. If over `maxQueries`, trim lowest-priority term × farthest town pairs first.

Returns structured metadata for the SearchTermsStep UI to render the chip row and query count.

### New Supabase RPC: `expand_search_queries_for_workspace`

Wraps the two helpers server-side so the UI doesn't need direct `uk_towns` read access or client-side haversine math. Returns the same shape as `expandSearchQueries`.

Alternative: keep the expander client-side (pure function) and expose `uk_towns` read via the existing `authenticated` select policy. Either works. Recommend the RPC for one clean entry point and to centralise the fuzzy-match logic.

### Modified: `SearchTermsStep.tsx`

- After user confirms terms, call the RPC → render chip row + query count.
- Chip toggle removes that town's queries from the computed list.
- "Continue" button disabled when all chips off (zero queries would fire).
- On RPC failure (network, primary town unresolved): silently fall back to the original 5 terms. Log a warning. No error dialog.

### Modified: `finalizeFaqCandidates` prompt

Current rules are too permissive (see `onboarding-ai.ts:880-895`). Proposed new prompt additions, marked **(NEW)**:

```
You are BizzyBee's FAQ finalizer for the competitor-research stream.

You are finalizing FAQ candidates that were extracted from COMPETITOR websites.
These FAQs will be added to the user's own knowledge base alongside FAQs
extracted from their own website.

INVARIANT (NEW):
The user's own website is the source of truth for pricing, services,
geography, guarantees, insurance, and voice. You MUST NOT let competitor-
specific claims leak into the user's knowledge base.

For each candidate, ask:
1. Is the QUESTION one a customer might reasonably ask the USER's business? (If yes → keep; if no → drop.)
2. Does the ANSWER contain competitor-specific facts (their exact pricing, their exact product names, their exact guarantees, their exact geography)? (If yes → rewrite in generic terms OR drop the FAQ.)

REWRITE rules (NEW):
- Strip competitor brand names. "At Acme Cleaning we offer..." → "We offer...".
- Generalise competitor-specific pricing. "Acme charges £18 per visit" → either drop, or generalise to "Window cleaning for a typical 3-bed semi is usually £15–£25" IF a reasonable industry-standard range is clearly supported across multiple competitor sources.
- Drop competitor-specific claims that contradict the user's declared services. (We don't know the user's exact services here — but if a candidate says "we offer pressure washing" and the user's business_type is "Window Cleaning" with no pressure-washing signal, drop or generalise.)
- Never promise a service on the user's behalf that only appears in a competitor source.
- Use the user's voice: first-person, short sentences, no marketing fluff.

EXISTING rules (retained):
- Prefer fewer strong FAQs over many weak ones.
- Do not return duplicates of existing FAQ questions (user-site FAQs).
- Keep only clearly grounded, customer-helpful FAQs.
- Return no more than 15 FAQs.
```

Test coverage (new): a unit test for the finalize prompt asserts it contains the INVARIANT header and the REWRITE rules header, so a future edit that accidentally deletes them fails CI.

### Modified: `CompetitorReviewScreen.tsx` — messaging only

Above the competitor list:

> **We recommend picking 5–10 competitors.** That's usually enough for diverse coverage without diluting your own voice — more is fine if you prefer, but your own website will always be the primary source of truth for your AI's answers.

- Soft recommendation in copy (5–10).
- **No hard cap.** The user retains full control over how many competitors get scraped.
- `MAX_ONBOARDING_COMPETITOR_SITES` in `pipeline-worker-onboarding-faq` stays at its current value (25) as a safety ceiling against runaway user input, not as a product constraint.
- No "Continue disabled" tooltip. If a user picks 20, we process 20.
- Live counter above the list: "{N} of {M} selected" with a gentle colour change at 11+ (subtle neutral tint, not a warning) to nudge without blocking.

---

## Data flow — note on term-stripping

Today the Search Terms step produces city-baked terms like `window cleaning luton` (Claude adds the city automatically). The expander needs the city-free stem. Approach:

1. Determine primary town from `business_context.service_area` (first `"Town (N miles)"` entry).
2. For each input term, run `.toLowerCase()` endsWith match on the primary town; if present, strip it (preserving trailing whitespace trim).
3. Re-expand as `{stripped} {town}` for each selected town.

This is a zero-UX change. If the user manually typed a term without the city (`window cleaning services`), we expand it as-is: `window cleaning services dunstable`, etc. Works either way.

---

## Error handling + edge cases

**1. Primary town not in `uk_towns`**
Fuzzy slug match (Levenshtein ≤ 2) covers typos (`luton-bedfordshire` → `luton`). On failure: log `[expand-search-queries] unresolved primary town`, fall back to original 5 terms unchanged. Discovery still works, just no expansion.

**2. Radius 0 or missing**
`service_area = "Luton"` with no `(N miles)` → radius=0 → `findNearbyTowns` returns `[]` → no-op expansion. UI chip row shows only primary town with a subtle "+ Add nearby towns" hint.

**3. Radius too large**
50 miles around Luton resolves ~40 towns. `findNearbyTowns(maxResults=6)` caps before the expander sees it. Single enforcement point.

**4. Multiple service areas**
`service_area = "Luton (20 miles)|Hemel Hempstead (10 miles)"` (already supported by the parser). v1: use the first entry as primary; merge both radius's nearby towns into one deduped chip list. Explicit "primary + satellites" refinement deferred.

**5. Apify rate-limited on one query**
`searchCompetitorCandidates` at `onboarding-ai.ts:426` already catches per-query errors. One failed town doesn't break discovery.

**6. User unchecks every chip**
"Continue" disabled with "Select at least one town" helper text.

**7. Competitor finalize leaks a competitor's specific claim despite the prompt**
Not fully preventable — Claude is instructed, not constrained. Mitigation:

- Post-process: regex-strip common brand-claim patterns (`"we charge £X at {BusinessName}"`).
- Soft: own-site FAQs are always the majority and the finalizer rewrites competitor content to user voice — contamination that slips through is bounded, not structural.
- Observability: add a structured log `[finalize] candidate mentions competitor brand name` so we can audit after a few runs.
- If leaks prove material in practice, a hard post-filter on competitor brand names in persisted `faq_database.answer` is a fast follow-up.

---

## Testing + rollout

### Unit tests

`supabase/functions/_shared/uk-towns.test.ts`

- Haversine correctness for known pairs (Luton→Dunstable ≈ 4.3mi, Luton→London ≈ 30mi).
- `findNearbyTowns`: sorted by distance, excludes primary, respects `maxResults`.
- Slug resolution: exact / prefix / fuzzy / unresolved.
- Case-insensitive lookups.

`supabase/functions/_shared/expandSearchQueries.test.ts`

- Primary gets all terms; nearby towns get top N.
- `maxQueries` cap honoured (trims lowest-priority term × farthest town).
- Primary-town strip: `"window cleaning luton"` → `"window cleaning"` when primary=`"Luton"`.
- No-op paths: radius=0, primary unresolved, empty terms.
- Returns structured metadata for the UI.

`supabase/functions/faq-agent-runner/lib/onboarding-ai.test.ts` (new)

- Finalize prompt contains INVARIANT + REWRITE sections (regex assertion against the prompt string).

### UI tests (`SearchTermsStep.test.tsx`)

- Chip row renders with resolved towns.
- Toggle removes queries from computed list.
- "Continue" disabled when all chips off.
- Silent fallback: primary unresolved → no chip row, original terms flow through.

`CompetitorReviewScreen.test.tsx`

- Recommendation copy rendered ("We recommend picking 5–10...").
- Selecting 11+ competitors does NOT block Continue (regression guard: prior design had a hard cap; we explicitly don't).
- "{N} of {M} selected" counter renders and updates on toggle.

### Integration (manual, live)

- Re-run MAC Cleaning onboarding end-to-end.
  - **Target:** ≥ 40 qualified competitors after qualify (from 14).
  - **Sanity:** reject reasons still directory/social/dupe, not "too far away".
- Spot-check qualified list for Dunstable/Harpenden/St Albans/Hemel Hempstead entries.
- After processing up to 10 competitors:
  - Check `faq_database` for `is_own_content=false` rows. Target: no competitor brand names in answer text (regex audit).
  - Check own-website FAQs remain the majority.

### Rollout gate

- Ship behind `business_context.custom_flags.discovery_radius_expansion`, default **ON for new runs**, opt-out via workspace flag.
- First 5 production runs: monitor `agent_runs.output_summary.approved_count`. Target median ≥ 20 (from 14 today). If qualifier is rejecting too many expanded candidates, tune the qualifier prompt — don't roll back.
- If cost spikes beyond $1 per onboarding run, review the cap before rolling out further.

### Migrations

- `uk_towns` table + ONS seed in one migration.
- No data migration for existing runs (only affects new discoveries).
- `MAX_ONBOARDING_COMPETITOR_SITES` unchanged at 25 (safety ceiling, not a product cap).

---

## Explicit non-regression requirements

1. **Own-website FAQs remain the majority of `faq_database` rows.** (Invariant from the 2026-04-16 page-aware extraction work — competitors augment, never dominate.)
2. **Competitor FAQs never reference a competitor's brand name in the answer text.** Finalize prompt + post-processing guard.
3. **Discovery radius=0 still works.** Workspaces that intentionally set no radius must keep current behaviour.
4. **No external API added to the discovery-time hot path.** All expansion happens against Supabase (haversine SQL + static table) or in-process.

---

## Follow-ups (out of scope)

- **Online-only businesses** (BizzyBee itself): separate design. Radius is meaningless; positioning is in product/feature space, not geography.
- **International `uk_towns` → `locality_towns`**: when the first non-UK workspace onboards, generalise the table schema to include country code and seed US/AU/EU tables.
- **Per-query free-text editing**: chip toggle is v1's escape hatch. Add if users ask for it.
- **Multiple-base-of-operations workspaces**: explicit primary + satellites model. v1 uses first area as primary.

---

## File touch list (for the implementation planner)

New:

- `supabase/migrations/{timestamp}_add_uk_towns_and_seed.sql`
- `supabase/functions/_shared/uk-towns.ts`
- `supabase/functions/_shared/uk-towns.test.ts`
- `supabase/functions/_shared/expandSearchQueries.ts`
- `supabase/functions/_shared/expandSearchQueries.test.ts`
- `supabase/functions/expand-search-queries/index.ts` (RPC wrapper, optional if going SQL-RPC instead)
- `supabase/functions/faq-agent-runner/lib/onboarding-ai.test.ts` (finalize prompt regex guard)

Modified:

- `supabase/functions/faq-agent-runner/lib/onboarding-ai.ts` (`finalizeFaqCandidates` prompt with user-website-as-source-of-truth invariant)
- `src/components/onboarding/SearchTermsStep.tsx` (chip row, RPC call, fallback)
- `src/components/onboarding/SearchTermsStep.test.tsx`
- `src/components/onboarding/CompetitorReviewScreen.tsx` (soft recommendation copy, selection counter — no hard cap)
- `src/components/onboarding/CompetitorReviewScreen.test.tsx`

Untouched (by design):

- `pipeline-worker-onboarding-discovery/index.ts` — reads `search_queries` as opaque array.
- `start-onboarding-discovery/index.ts` — stores `search_queries` as given.
