# Competitor Discovery — Radius Expansion + Quality Invariants Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the competitor discovery net for location-bound UK businesses by fanning search queries across nearby towns within the declared service radius, and enforce "user website = source of truth" as an invariant in the competitor-FAQ finalizer so scaling the competitor pool doesn't scale the knowledge-base contamination risk.

**Architecture:** Static `uk_towns` table seeded from ONS data + pure haversine lookup + pure query-expansion helper called from SearchTermsStep. Discovery worker is unchanged (reads expanded `search_queries` as an opaque array). Finalizer prompt gains explicit INVARIANT + REWRITE sections. CompetitorReviewScreen gains a soft-recommendation copy block and a live selection counter — no hard cap.

**Tech Stack:** Supabase Postgres + Edge Functions (Deno), Apify `google-search-scraper` (unchanged), React + shadcn/ui for onboarding steps, Vitest for tests.

**Reference:** Design doc at `docs/plans/2026-04-16-competitor-discovery-radius-expansion-design.md` — read first for context.

**Non-goals (explicit):**

- Online-only businesses (BizzyBee itself) — separate brainstorm.
- International (US/AU/EU) — UK-only `uk_towns` for now.
- Per-query free-text editing — chip toggle is the v1 escape hatch.
- Replacing Apify `google-search-scraper` with a Maps actor.

---

## Task 0: Seed dataset prep (offline, before any code)

**Why first:** Task 1 creates the `uk_towns` table, Task 2 seeds it. The seed SQL is ~1,500 `insert` statements. Generate once, keep under `supabase/migrations/seeds/uk_towns_seed.csv` as source-of-truth so the migration only references a compact INSERT-from-values block.

**Step 1: Pull the ONS "Built-up areas" dataset**

Source: https://geoportal.statistics.gov.uk/datasets/ons::built-up-areas-2022-boundaries-en-bfc (public domain, OS Open Geography).

Filter to `population >= 5000` to keep the table ~1,500 rows. Extract these columns:

- `name` (BUA22NM) — human-readable town name
- `county` — nearest county (LAD22NM or parent district)
- `latitude` / `longitude` (centroid)
- `population` (BUA22POP22)
- `canonical_slug` = `name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')`

**Step 2: Produce a seed CSV**

Path: `supabase/migrations/seeds/uk_towns_seed.csv`

Columns: `name,county,latitude,longitude,population,canonical_slug`

Verify the CSV has entries for these seven towns we'll use in later tests:

- luton, dunstable, harpenden, st-albans, hemel-hempstead, houghton-regis, hitchin

If you can't access the ONS download in your environment, request the CSV from the repo owner. Do NOT hand-type a partial list — a sparse town table will fail integration.

**Step 3: Commit the CSV**

```bash
git add supabase/migrations/seeds/uk_towns_seed.csv
git commit -m "feat(onboarding/discovery): add UK towns seed CSV (ONS built-up areas)"
```

---

## Task 1: Create `uk_towns` table migration

**Files:**

- Create: `supabase/migrations/{timestamp}_add_uk_towns.sql`

Use `date -u +%Y%m%d%H%M%S` for the timestamp. Follow the existing naming convention from `supabase/migrations/` (look at any recent file for reference).

**Step 1: Write the migration SQL**

```sql
-- uk_towns: static reference table for competitor-discovery radius expansion.
-- Seeded separately (see {next_migration_name} for the seed load).
-- Read-only to authenticated users; admin-seeded only.

create table public.uk_towns (
  id serial primary key,
  name text not null,
  county text,
  latitude double precision not null,
  longitude double precision not null,
  population integer,
  canonical_slug text unique not null,
  created_at timestamptz not null default now()
);

comment on table public.uk_towns is
  'Static UK towns/cities for competitor-discovery radius expansion. '
  'Sourced from ONS Built-up Areas (public domain). Population >= 5000.';
comment on column public.uk_towns.canonical_slug is
  'Lowercase hyphenated slug for fuzzy user-input matching (e.g. "st-albans").';

create index uk_towns_canonical_slug_idx on public.uk_towns (canonical_slug);
create index uk_towns_latlng_idx on public.uk_towns (latitude, longitude);

alter table public.uk_towns enable row level security;
create policy "uk_towns_readable"
  on public.uk_towns
  for select
  to authenticated
  using (true);
-- No insert/update/delete policies: seeded via migration only.
```

**Step 2: Apply the migration**

Run via the Supabase MCP tool (matches the pattern used for `20260416182649_add_faq_page_type`):

```
mcp__59a8ed17-71f5-4117-822d-27e7fd6b48ba__apply_migration
  project_id: atukvssploxwyqpwjmrc
  name: add_uk_towns
  query: <the SQL above>
```

**Step 3: Verify**

```sql
select table_name from information_schema.tables
where table_schema='public' and table_name='uk_towns';
```

Expected: 1 row.

```sql
select count(*) from public.uk_towns;
```

Expected: 0 (seed runs in Task 2).

**Step 4: Commit**

```bash
git add supabase/migrations/{timestamp}_add_uk_towns.sql
git commit -m "feat(onboarding/discovery): add uk_towns reference table"
```

---

## Task 2: Seed `uk_towns` from the CSV

**Files:**

- Create: `supabase/migrations/{timestamp}_seed_uk_towns.sql` (2 min after Task 1's timestamp)

**Step 1: Convert the CSV to SQL inserts**

Use `node` or `awk` to transform `uk_towns_seed.csv` into a single `insert into public.uk_towns (...) values (...), (...), ...;` statement. ~1,500 rows in one statement is fine for Postgres.

Example helper (run locally, paste output into the migration file):

```bash
# Run from repo root
cd /Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control
node -e "
const fs = require('fs');
const csv = fs.readFileSync('supabase/migrations/seeds/uk_towns_seed.csv', 'utf8').trim().split('\n').slice(1);
const rows = csv.map(line => {
  const [name, county, lat, lng, pop, slug] = line.split(',');
  const esc = (s) => s.replace(/'/g, \"''\");
  return \`('\${esc(name)}', \${county ? \`'\${esc(county)}'\` : 'null'}, \${lat}, \${lng}, \${pop || 'null'}, '\${esc(slug)}')\`;
});
console.log('insert into public.uk_towns (name, county, latitude, longitude, population, canonical_slug) values');
console.log(rows.join(',\n') + ';');
"
```

Paste the output into the migration file. Wrap in `begin; ... commit;` for atomicity.

**Step 2: Apply the migration**

```
mcp__59a8ed17-71f5-4117-822d-27e7fd6b48ba__apply_migration
  project_id: atukvssploxwyqpwjmrc
  name: seed_uk_towns
  query: <the SQL from step 1>
```

**Step 3: Verify seeded data**

```sql
-- Sanity: table populated
select count(*) from public.uk_towns;
```

Expected: ≥ 1,400, ≤ 2,500 (typical ONS cut-off produces ~1,500).

```sql
-- Sanity: the 7 towns we'll use in tests exist
select name, canonical_slug, latitude, longitude
from public.uk_towns
where canonical_slug in (
  'luton', 'dunstable', 'harpenden', 'st-albans',
  'hemel-hempstead', 'houghton-regis', 'hitchin'
)
order by canonical_slug;
```

Expected: 7 rows.

```sql
-- Spot-check: Luton→Dunstable haversine should be ~4-5 miles
with points as (
  select
    (select latitude from public.uk_towns where canonical_slug='luton') as lat1,
    (select longitude from public.uk_towns where canonical_slug='luton') as lng1,
    (select latitude from public.uk_towns where canonical_slug='dunstable') as lat2,
    (select longitude from public.uk_towns where canonical_slug='dunstable') as lng2
)
select
  3959 * 2 * asin(
    sqrt(
      power(sin(radians((lat2 - lat1) / 2)), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians((lng2 - lng1) / 2)), 2)
    )
  ) as miles
from points;
```

Expected: between 4.0 and 5.0 miles.

**Step 4: Commit**

```bash
git add supabase/migrations/{timestamp}_seed_uk_towns.sql
git commit -m "feat(onboarding/discovery): seed uk_towns from ONS built-up areas (~1.5k rows)"
```

---

## Task 3: Pure helper — slug normalization + haversine

**Files:**

- Create: `supabase/functions/_shared/uk-towns.ts`
- Create: `supabase/functions/_shared/uk-towns.test.ts`

**Why TDD here:** This is pure function territory. Write the helper's deterministic bits first (slug, haversine), test them, then add the async `findNearbyTowns` wrapper.

**Step 1: Write the failing slug + haversine tests**

Create `supabase/functions/_shared/uk-towns.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

// Stub esm.sh Supabase import so Node/vitest can load the module graph.
// Same workaround pattern used by onboarding-faq-engine.test.ts and
// onboarding-website-runner.test.ts.
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.57.2', () => ({}));

const { canonicalTownSlug, haversineMiles } = await import('./uk-towns.ts');

describe('canonicalTownSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(canonicalTownSlug('Luton')).toBe('luton');
    expect(canonicalTownSlug('St Albans')).toBe('st-albans');
    expect(canonicalTownSlug('Hemel Hempstead')).toBe('hemel-hempstead');
  });

  it('strips punctuation and trims hyphens', () => {
    expect(canonicalTownSlug('St. Albans')).toBe('st-albans');
    expect(canonicalTownSlug('  Luton  ')).toBe('luton');
    expect(canonicalTownSlug('Luton-')).toBe('luton');
    expect(canonicalTownSlug('Stoke-on-Trent')).toBe('stoke-on-trent');
  });

  it('handles empty / pathological input', () => {
    expect(canonicalTownSlug('')).toBe('');
    expect(canonicalTownSlug('   ')).toBe('');
    expect(canonicalTownSlug('!!!')).toBe('');
  });
});

describe('haversineMiles', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineMiles(51.5, -0.1, 51.5, -0.1)).toBeCloseTo(0, 2);
  });

  it('computes Luton→Dunstable as ~4-5 miles', () => {
    // Luton ≈ 51.8787, -0.4200  Dunstable ≈ 51.8860, -0.5211
    const miles = haversineMiles(51.8787, -0.42, 51.886, -0.5211);
    expect(miles).toBeGreaterThan(4);
    expect(miles).toBeLessThan(5);
  });

  it('computes Luton→central London as ~30 miles', () => {
    // London ≈ 51.5074, -0.1278
    const miles = haversineMiles(51.8787, -0.42, 51.5074, -0.1278);
    expect(miles).toBeGreaterThan(28);
    expect(miles).toBeLessThan(32);
  });
});
```

**Step 2: Run the tests, confirm they fail**

```bash
cd /Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control
npx vitest run supabase/functions/_shared/uk-towns.test.ts
```

Expected: fails with "Cannot find module './uk-towns.ts'" or similar.

**Step 3: Write `canonicalTownSlug` + `haversineMiles` in `uk-towns.ts`**

Create `supabase/functions/_shared/uk-towns.ts`:

```typescript
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

/**
 * Lowercase, strip non-alphanumerics, hyphenate spaces, trim edges.
 * Matches the `canonical_slug` column written in the uk_towns seed.
 * "St. Albans" → "st-albans", "Stoke-on-Trent" → "stoke-on-trent".
 */
export function canonicalTownSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const EARTH_RADIUS_MILES = 3959;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Great-circle distance between two lat/lng points in miles.
 * Standard haversine. Stable to ~0.5% across typical UK distances.
 */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  return EARTH_RADIUS_MILES * c;
}
```

**Step 4: Re-run tests**

```bash
npx vitest run supabase/functions/_shared/uk-towns.test.ts
```

Expected: all 6 tests pass.

**Step 5: Commit**

```bash
git add supabase/functions/_shared/uk-towns.ts supabase/functions/_shared/uk-towns.test.ts
git commit -m "feat(onboarding/discovery): pure slug + haversine helpers for uk_towns lookups"
```

---

## Task 4: Async `findNearbyTowns` helper (Supabase-backed)

**Files:**

- Modify: `supabase/functions/_shared/uk-towns.ts`
- Modify: `supabase/functions/_shared/uk-towns.test.ts`

**Step 1: Add failing tests for `findNearbyTowns`**

Append to the test file:

```typescript
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

// Minimal Supabase mock: records the query built up and returns a
// pre-programmed row set. Matches the call shape we'll use:
//   supabase.from('uk_towns').select(...).eq(canonical_slug, ?).maybeSingle()
// and
//   supabase.from('uk_towns').select(...)
// (second call iterates for the radius filter — done client-side, not via RPC).
type TownRow = {
  name: string;
  canonical_slug: string;
  latitude: number;
  longitude: number;
  population: number;
};

function mockSupabase(config: {
  primary: TownRow | null;
  allTowns: TownRow[];
  primaryError?: Error;
}): SupabaseClient {
  return {
    from: (table: string) => {
      if (table !== 'uk_towns') throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: (_col: string, _val: string) => ({
            maybeSingle: async () => {
              if (config.primaryError) throw config.primaryError;
              return { data: config.primary, error: null };
            },
          }),
          // Second "select" for the radius pass — return all towns, caller filters client-side.
          then: (resolve: (value: { data: TownRow[]; error: null }) => void) => {
            resolve({ data: config.allTowns, error: null });
          },
        }),
      };
    },
  } as unknown as SupabaseClient;
}

describe('findNearbyTowns', () => {
  const luton: TownRow = {
    name: 'Luton',
    canonical_slug: 'luton',
    latitude: 51.8787,
    longitude: -0.42,
    population: 213000,
  };
  const dunstable: TownRow = {
    name: 'Dunstable',
    canonical_slug: 'dunstable',
    latitude: 51.886,
    longitude: -0.5211,
    population: 35000,
  };
  const harpenden: TownRow = {
    name: 'Harpenden',
    canonical_slug: 'harpenden',
    latitude: 51.8173,
    longitude: -0.3479,
    population: 30000,
  };
  const stAlbans: TownRow = {
    name: 'St Albans',
    canonical_slug: 'st-albans',
    latitude: 51.7527,
    longitude: -0.3413,
    population: 87000,
  };
  const london: TownRow = {
    name: 'London',
    canonical_slug: 'london',
    latitude: 51.5074,
    longitude: -0.1278,
    population: 9000000,
  };

  it('returns empty array when primary town not found', async () => {
    const { findNearbyTowns } = await import('./uk-towns.ts');
    const supabase = mockSupabase({ primary: null, allTowns: [] });
    const result = await findNearbyTowns(supabase, 'Atlantis', 20);
    expect(result).toEqual([]);
  });

  it('returns nearby towns sorted by distance, excluding primary', async () => {
    const { findNearbyTowns } = await import('./uk-towns.ts');
    const supabase = mockSupabase({
      primary: luton,
      allTowns: [luton, dunstable, harpenden, stAlbans, london],
    });
    const result = await findNearbyTowns(supabase, 'Luton', 20);
    const names = result.map((t) => t.name);
    expect(names).not.toContain('Luton');
    expect(names).toEqual(['Dunstable', 'Harpenden', 'St Albans']);
    expect(result[0].miles).toBeLessThan(result[1].miles);
    expect(result[1].miles).toBeLessThan(result[2].miles);
  });

  it('respects maxResults cap', async () => {
    const { findNearbyTowns } = await import('./uk-towns.ts');
    const supabase = mockSupabase({
      primary: luton,
      allTowns: [luton, dunstable, harpenden, stAlbans],
    });
    const result = await findNearbyTowns(supabase, 'Luton', 20, 2);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toEqual(['Dunstable', 'Harpenden']);
  });

  it('returns empty array when radius is 0', async () => {
    const { findNearbyTowns } = await import('./uk-towns.ts');
    const supabase = mockSupabase({
      primary: luton,
      allTowns: [luton, dunstable, harpenden],
    });
    const result = await findNearbyTowns(supabase, 'Luton', 0);
    expect(result).toEqual([]);
  });

  it('is case-insensitive on primary name', async () => {
    const { findNearbyTowns } = await import('./uk-towns.ts');
    const supabase = mockSupabase({
      primary: luton,
      allTowns: [luton, dunstable],
    });
    const result = await findNearbyTowns(supabase, 'LUTON', 20);
    expect(result.map((t) => t.name)).toEqual(['Dunstable']);
  });
});
```

**Step 2: Run tests, confirm fail**

```bash
npx vitest run supabase/functions/_shared/uk-towns.test.ts
```

Expected: 5 new tests fail with "findNearbyTowns is not a function".

**Step 3: Implement `findNearbyTowns` in `uk-towns.ts`**

Append to `supabase/functions/_shared/uk-towns.ts`:

```typescript
export interface NearbyTown {
  name: string;
  miles: number;
}

type UkTownRow = {
  name: string;
  canonical_slug: string;
  latitude: number;
  longitude: number;
  population: number | null;
};

/**
 * Resolve a user-supplied primary town name → coords, then return the N
 * nearest towns within `radiusMiles`, excluding the primary itself.
 *
 * Slug resolution is exact-only in v1. Fuzzy (prefix / Levenshtein) matching
 * lives in `resolvePrimaryTown` which callers can layer on top if needed —
 * keeping this helper deterministic makes it trivially testable.
 *
 * radiusMiles = 0 is a valid "no expansion" signal → returns [].
 */
export async function findNearbyTowns(
  supabase: SupabaseClient,
  primaryTownName: string,
  radiusMiles: number,
  maxResults = 6,
): Promise<NearbyTown[]> {
  if (radiusMiles <= 0) return [];

  const slug = canonicalTownSlug(primaryTownName);
  if (!slug) return [];

  const { data: primary, error: primaryErr } = await supabase
    .from('uk_towns')
    .select('name, canonical_slug, latitude, longitude, population')
    .eq('canonical_slug', slug)
    .maybeSingle();

  if (primaryErr) {
    console.warn('[uk-towns] primary lookup failed', {
      slug,
      error: primaryErr.message,
    });
    return [];
  }
  if (!primary) return [];

  const primaryRow = primary as UkTownRow;

  // Rough lat/lng bounding-box pre-filter so we don't pull the whole table.
  // 1° latitude ≈ 69 miles; 1° longitude varies by latitude but ~43 miles at
  // UK latitudes. Add 15% slack for the haversine "corner" error vs box.
  const latDelta = (radiusMiles / 69) * 1.15;
  const lngDelta = (radiusMiles / (Math.cos(primaryRow.latitude * DEG_TO_RAD) * 69)) * 1.15;

  const { data: candidates, error: candidatesErr } = await supabase
    .from('uk_towns')
    .select('name, canonical_slug, latitude, longitude, population')
    .gte('latitude', primaryRow.latitude - latDelta)
    .lte('latitude', primaryRow.latitude + latDelta)
    .gte('longitude', primaryRow.longitude - lngDelta)
    .lte('longitude', primaryRow.longitude + lngDelta);

  if (candidatesErr) {
    console.warn('[uk-towns] candidate lookup failed', {
      slug,
      error: candidatesErr.message,
    });
    return [];
  }

  const rows = (candidates ?? []) as UkTownRow[];
  return rows
    .filter((t) => t.canonical_slug !== primaryRow.canonical_slug)
    .map((t) => ({
      name: t.name,
      miles: haversineMiles(primaryRow.latitude, primaryRow.longitude, t.latitude, t.longitude),
    }))
    .filter((t) => t.miles <= radiusMiles)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, maxResults);
}
```

Note the mock in the test uses `.eq(...).maybeSingle()` for the primary lookup and a catch-all fallback for the second select. The real implementation uses `.gte/.lte` for the bounding box — **update the mock to match** by replacing the chained method stub with a simple function that returns `{ data: allTowns.filter(bbox), error: null }`. If the mock gets too complex, switch to a single-shot `{ data, error }` stub that ignores the filters (since the filter logic is in the code, not the test assertion).

Simplest workable mock:

```typescript
function mockSupabase(config: { primary: TownRow | null; allTowns: TownRow[] }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: config.primary, error: null }),
        }),
        gte: () => ({
          lte: () => ({
            gte: () => ({
              lte: () => Promise.resolve({ data: config.allTowns, error: null }),
            }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}
```

**Step 4: Run tests**

```bash
npx vitest run supabase/functions/_shared/uk-towns.test.ts
```

Expected: all 11 tests pass.

**Step 5: Commit**

```bash
git add supabase/functions/_shared/uk-towns.ts supabase/functions/_shared/uk-towns.test.ts
git commit -m "feat(onboarding/discovery): add findNearbyTowns helper"
```

---

## Task 5: Pure query expander

**Files:**

- Create: `supabase/functions/_shared/expandSearchQueries.ts`
- Create: `supabase/functions/_shared/expandSearchQueries.test.ts`

**Step 1: Write failing tests**

Create `supabase/functions/_shared/expandSearchQueries.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.57.2', () => ({}));

const { expandSearchQueries, stripPrimaryTownSuffix } = await import('./expandSearchQueries.ts');

describe('stripPrimaryTownSuffix', () => {
  it('strips trailing primary town (case-insensitive)', () => {
    expect(stripPrimaryTownSuffix('window cleaning luton', 'Luton')).toBe('window cleaning');
    expect(stripPrimaryTownSuffix('gutter cleaning LUTON', 'Luton')).toBe('gutter cleaning');
  });

  it('strips multi-word primary town', () => {
    expect(stripPrimaryTownSuffix('plumber hemel hempstead', 'Hemel Hempstead')).toBe('plumber');
  });

  it('leaves terms without the town suffix unchanged', () => {
    expect(stripPrimaryTownSuffix('window cleaning services', 'Luton')).toBe(
      'window cleaning services',
    );
  });

  it('trims trailing punctuation after strip', () => {
    expect(stripPrimaryTownSuffix('best window cleaning, luton', 'Luton')).toBe(
      'best window cleaning',
    );
  });
});

describe('expandSearchQueries', () => {
  const terms = [
    'window cleaning',
    'window cleaner',
    'gutter cleaning',
    'best rated window cleaners',
    'commercial window cleaning',
  ];

  it('primary town gets every term; nearby towns get top N', () => {
    const result = expandSearchQueries({
      searchTerms: terms,
      primaryTown: 'Luton',
      nearbyTowns: ['Dunstable', 'Harpenden'],
      termsPerNearbyTown: 3,
    });
    // Primary: 5 × 1 = 5 queries
    // Nearby: top 3 terms × 2 towns = 6 queries
    // Total: 11
    expect(result.queries).toHaveLength(11);
    expect(result.queries).toContain('window cleaning luton');
    expect(result.queries).toContain('commercial window cleaning luton');
    expect(result.queries).toContain('window cleaning dunstable');
    expect(result.queries).toContain('gutter cleaning dunstable');
    expect(result.queries).not.toContain('commercial window cleaning dunstable');
  });

  it('strips an already-city-baked term before re-applying to each town', () => {
    const result = expandSearchQueries({
      searchTerms: ['window cleaning luton', 'gutter cleaning luton'],
      primaryTown: 'Luton',
      nearbyTowns: ['Dunstable'],
      termsPerNearbyTown: 3,
    });
    expect(result.queries).toContain('window cleaning luton');
    expect(result.queries).toContain('gutter cleaning luton');
    expect(result.queries).toContain('window cleaning dunstable');
    expect(result.queries).toContain('gutter cleaning dunstable');
    // Must not emit a double-city query like "window cleaning luton dunstable"
    expect(result.queries.every((q) => !q.includes('luton dunstable'))).toBe(true);
  });

  it('honours maxQueries cap — trims farthest town × lowest-priority term first', () => {
    // 5 terms × (1 primary + 4 nearby × top 3) = 5 + 12 = 17
    const result = expandSearchQueries({
      searchTerms: terms,
      primaryTown: 'Luton',
      nearbyTowns: ['Dunstable', 'Harpenden', 'St Albans', 'Hitchin'],
      termsPerNearbyTown: 3,
      maxQueries: 10,
    });
    expect(result.queries).toHaveLength(10);
    // Primary coverage always intact — all 5 primary queries survive.
    expect(result.queries.filter((q) => q.endsWith(' luton'))).toHaveLength(5);
    // Remaining 5 are nearby. Trimming from the lowest-priority term × farthest town:
    // Hitchin (farthest) loses its slots first.
    expect(result.queries.filter((q) => q.endsWith(' hitchin'))).toHaveLength(0);
  });

  it('returns structured metadata for UI', () => {
    const result = expandSearchQueries({
      searchTerms: terms,
      primaryTown: 'Luton',
      nearbyTowns: ['Dunstable'],
      termsPerNearbyTown: 3,
    });
    expect(result.townsUsed).toEqual(['Luton', 'Dunstable']);
    expect(result.primaryCoverage).toHaveLength(5);
    expect(result.expandedCoverage).toHaveLength(3);
  });

  it('no-op when nearbyTowns is empty (radius=0 pathway)', () => {
    const result = expandSearchQueries({
      searchTerms: terms,
      primaryTown: 'Luton',
      nearbyTowns: [],
      termsPerNearbyTown: 3,
    });
    // Primary-only: 5 queries, all city-baked.
    expect(result.queries).toEqual([
      'window cleaning luton',
      'window cleaner luton',
      'gutter cleaning luton',
      'best rated window cleaners luton',
      'commercial window cleaning luton',
    ]);
    expect(result.townsUsed).toEqual(['Luton']);
    expect(result.expandedCoverage).toEqual([]);
  });

  it('dedupes exact-match queries', () => {
    // User gave two identical terms — shouldn't produce duplicate queries.
    const result = expandSearchQueries({
      searchTerms: ['window cleaning', 'window cleaning'],
      primaryTown: 'Luton',
      nearbyTowns: ['Dunstable'],
      termsPerNearbyTown: 3,
    });
    expect(new Set(result.queries).size).toBe(result.queries.length);
  });

  it('handles empty search terms safely', () => {
    const result = expandSearchQueries({
      searchTerms: [],
      primaryTown: 'Luton',
      nearbyTowns: ['Dunstable'],
      termsPerNearbyTown: 3,
    });
    expect(result.queries).toEqual([]);
  });
});
```

**Step 2: Run tests, confirm fail**

```bash
npx vitest run supabase/functions/_shared/expandSearchQueries.test.ts
```

Expected: all tests fail (module not found).

**Step 3: Implement**

Create `supabase/functions/_shared/expandSearchQueries.ts`:

```typescript
/**
 * Strip a trailing primary-town suffix from a search term if present.
 * Case-insensitive. Preserves everything before the town.
 * "window cleaning luton" + "Luton" → "window cleaning"
 * "gutter cleaning" + "Luton" → "gutter cleaning" (unchanged)
 */
export function stripPrimaryTownSuffix(term: string, primaryTown: string): string {
  const lowerTerm = term.toLowerCase();
  const lowerTown = primaryTown.toLowerCase();
  if (!lowerTown) return term.trim();

  // Match the town at end-of-string, optionally after punctuation/whitespace.
  const escaped = lowerTown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`[\\s,.;:-]*${escaped}$`);
  const match = lowerTerm.match(pattern);
  if (!match) return term.trim();

  return term.slice(0, term.length - match[0].length).trim();
}

export interface ExpandSearchQueriesParams {
  searchTerms: string[]; // ordered by user/Claude priority, highest first
  primaryTown: string; // resolved from service_area, e.g. "Luton"
  nearbyTowns: string[]; // pre-sorted nearest-first (from findNearbyTowns)
  termsPerNearbyTown?: number; // default 3 — spec caps at 2-3
  maxQueries?: number; // default 30
}

export interface ExpandSearchQueriesResult {
  queries: string[];
  townsUsed: string[];
  primaryCoverage: string[]; // terms applied to primary town
  expandedCoverage: string[]; // DISTINCT terms applied to nearby towns
}

/**
 * Build a deterministic list of `{term} {town}` search queries for
 * radius-expanded competitor discovery.
 *
 * Allocation rules (in order of precedence):
 * 1. Strip primary-town suffix from every input term to get a clean stem.
 * 2. Primary town receives ALL stems (full coverage).
 * 3. Each nearby town receives the top N stems (termsPerNearbyTown).
 * 4. Combined list is deduped.
 * 5. If over maxQueries, trim the cheapest combinations first:
 *    priority-rank descending × distance-from-primary ascending, so the
 *    farthest town's lowest-priority term drops out first. Primary
 *    coverage is never trimmed.
 */
export function expandSearchQueries(params: ExpandSearchQueriesParams): ExpandSearchQueriesResult {
  const termsPerNearbyTown = params.termsPerNearbyTown ?? 3;
  const maxQueries = params.maxQueries ?? 30;

  if (params.searchTerms.length === 0) {
    return { queries: [], townsUsed: [], primaryCoverage: [], expandedCoverage: [] };
  }

  const stems = params.searchTerms
    .map((t) => stripPrimaryTownSuffix(t, params.primaryTown))
    .filter((t) => t.length > 0);

  const primaryQueries = stems.map((stem) => `${stem} ${params.primaryTown}`.toLowerCase());
  const expandedStems = stems.slice(0, termsPerNearbyTown);

  // Build candidate expanded queries with metadata for the trimming step.
  type Candidate = { query: string; termRank: number; townRank: number };
  const expandedCandidates: Candidate[] = [];
  for (let townRank = 0; townRank < params.nearbyTowns.length; townRank++) {
    const town = params.nearbyTowns[townRank];
    for (let termRank = 0; termRank < expandedStems.length; termRank++) {
      const stem = expandedStems[termRank];
      expandedCandidates.push({
        query: `${stem} ${town}`.toLowerCase(),
        termRank,
        townRank,
      });
    }
  }

  // Trim if over budget. Primary is never trimmed (assume <= maxQueries).
  const budget = Math.max(0, maxQueries - primaryQueries.length);
  const expandedSorted = [...expandedCandidates].sort((a, b) => {
    // Keep nearer towns + higher-priority terms.
    if (a.townRank !== b.townRank) return a.townRank - b.townRank;
    return a.termRank - b.termRank;
  });
  const expandedKept = expandedSorted.slice(0, budget);

  // Dedupe exact matches.
  const seen = new Set<string>();
  const combined: string[] = [];
  for (const q of [...primaryQueries, ...expandedKept.map((c) => c.query)]) {
    if (seen.has(q)) continue;
    seen.add(q);
    combined.push(q);
  }

  const townsUsed = [params.primaryTown];
  for (const town of params.nearbyTowns) {
    if (expandedKept.some((c) => c.query.endsWith(` ${town.toLowerCase()}`))) {
      townsUsed.push(town);
    }
  }

  return {
    queries: combined,
    townsUsed,
    primaryCoverage: stems,
    expandedCoverage: expandedStems,
  };
}
```

**Step 4: Run tests**

```bash
npx vitest run supabase/functions/_shared/expandSearchQueries.test.ts
```

Expected: all tests pass. If the maxQueries-trimming test fails, the issue is that the trim sort must keep Dunstable × top-3-terms over Hitchin × anything. Debug: log `expandedSorted` and verify `townRank` is ascending first.

**Step 5: Commit**

```bash
git add supabase/functions/_shared/expandSearchQueries.ts supabase/functions/_shared/expandSearchQueries.test.ts
git commit -m "feat(onboarding/discovery): pure query expander for radius-based fan-out"
```

---

## Task 6: Supabase RPC wrapper

**Files:**

- Create: `supabase/migrations/{timestamp}_expand_search_queries_rpc.sql`

**Rationale:** The client (SearchTermsStep.tsx) needs to call these two helpers. Options are (a) expose `uk_towns` directly and duplicate the haversine in TS client-side, or (b) wrap both helpers in an RPC and call once. (b) is cleaner and keeps the client thin. The trade-off: a Supabase SQL function reimplementing the haversine logic must stay in sync with the TS one. Since both are simple and well-tested, the cost is low.

Alternative (if the Deno edge function pattern is preferred): wrap in an edge function instead of an RPC. Either works — SQL RPC is faster (no cold start) and already matches the project's `bb_*` function pattern.

**Step 1: Write the SQL function**

```sql
-- Returns the expanded query list + UI metadata for a given workspace's
-- primary service town, radius, and ordered search terms.
--
-- Inputs are passed as parameters rather than pulled from business_context
-- so the client can preview expansions as the user edits terms without a
-- DB write. Fuzzy slug match is NOT implemented here (v1 = exact); if the
-- primary slug doesn't exist, return a "no-op" result with the input terms
-- as the primary-only query list.

create or replace function public.expand_search_queries(
  p_search_terms text[],
  p_primary_town text,
  p_radius_miles numeric,
  p_terms_per_nearby_town integer default 3,
  p_max_queries integer default 30,
  p_max_nearby_towns integer default 6
)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  v_slug text;
  v_primary record;
  v_nearby_towns text[];
  v_stems text[];
  v_expanded_stems text[];
  v_primary_queries text[] := array[]::text[];
  v_expanded_queries text[] := array[]::text[];
  v_towns_used text[] := array[p_primary_town];
  v_budget integer;
  v_stem text;
  v_town text;
  v_term_rank integer;
  v_town_rank integer;
  v_candidates jsonb := '[]'::jsonb;
begin
  -- canonical_slug mirrors the TS helper: lowercase + hyphens, trim edges.
  v_slug := regexp_replace(lower(p_primary_town), '[^a-z0-9]+', '-', 'g');
  v_slug := regexp_replace(v_slug, '(^-+|-+$)', '', 'g');

  if v_slug = '' or coalesce(array_length(p_search_terms, 1), 0) = 0 then
    return jsonb_build_object(
      'queries', '[]'::jsonb,
      'towns_used', to_jsonb(array[]::text[]),
      'primary_coverage', '[]'::jsonb,
      'expanded_coverage', '[]'::jsonb
    );
  end if;

  -- Primary town lookup.
  select name, latitude, longitude, canonical_slug
    into v_primary
    from public.uk_towns
    where canonical_slug = v_slug
    limit 1;

  -- Strip primary-town suffix from each input term.
  with stems as (
    select
      idx,
      trim(regexp_replace(
        term,
        '[[:space:],.;:\-]*' || lower(p_primary_town) || '$',
        '',
        'i'
      )) as stem
    from unnest(p_search_terms) with ordinality as t(term, idx)
  )
  select array_agg(stem order by idx)
    into v_stems
  from stems
  where stem <> '';

  v_stems := coalesce(v_stems, array[]::text[]);
  v_expanded_stems := v_stems[1:p_terms_per_nearby_town];

  -- Primary queries (full coverage).
  select array_agg(lower(stem || ' ' || p_primary_town) order by idx)
    into v_primary_queries
  from unnest(v_stems) with ordinality as t(stem, idx);

  v_primary_queries := coalesce(v_primary_queries, array[]::text[]);

  -- Nearby towns — only if we resolved the primary.
  if v_primary is not null and p_radius_miles > 0 then
    -- Bounding box pre-filter (~1.15x radius slack), then haversine.
    with bbox as (
      select p_radius_miles / 69.0 * 1.15 as lat_delta,
             p_radius_miles / (cos(radians(v_primary.latitude)) * 69.0) * 1.15 as lng_delta
    ),
    candidates as (
      select t.name, t.canonical_slug, t.latitude, t.longitude,
             3959 * 2 * asin(sqrt(
               power(sin(radians((t.latitude - v_primary.latitude) / 2)), 2) +
               cos(radians(v_primary.latitude)) * cos(radians(t.latitude)) *
               power(sin(radians((t.longitude - v_primary.longitude) / 2)), 2)
             )) as miles
        from public.uk_towns t, bbox b
       where t.latitude between v_primary.latitude - b.lat_delta and v_primary.latitude + b.lat_delta
         and t.longitude between v_primary.longitude - b.lng_delta and v_primary.longitude + b.lng_delta
         and t.canonical_slug <> v_primary.canonical_slug
    )
    select array_agg(name order by miles asc)
      into v_nearby_towns
    from (
      select name, miles from candidates
       where miles <= p_radius_miles
       order by miles asc
       limit p_max_nearby_towns
    ) s;
  end if;

  v_nearby_towns := coalesce(v_nearby_towns, array[]::text[]);
  v_budget := greatest(0, p_max_queries - array_length(v_primary_queries, 1));

  -- Build expanded candidates in town-rank × term-rank order.
  v_town_rank := 0;
  foreach v_town in array v_nearby_towns loop
    v_term_rank := 0;
    foreach v_stem in array v_expanded_stems loop
      v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
        'query', lower(v_stem || ' ' || v_town),
        'town', v_town,
        'term_rank', v_term_rank,
        'town_rank', v_town_rank
      ));
      v_term_rank := v_term_rank + 1;
    end loop;
    v_town_rank := v_town_rank + 1;
  end loop;

  -- Trim to budget (sorted by town_rank asc, term_rank asc already).
  with kept as (
    select jsonb_array_elements(v_candidates) as c
    limit v_budget
  ),
  kept_queries as (
    select (c->>'query') as query, (c->>'town') as town
    from kept
  )
  select array_agg(query) into v_expanded_queries from kept_queries;

  v_expanded_queries := coalesce(v_expanded_queries, array[]::text[]);

  -- Build towns_used from the kept set.
  with kept as (
    select jsonb_array_elements(v_candidates) as c
    limit v_budget
  )
  select array_agg(distinct (c->>'town')) into v_towns_used
  from kept;

  v_towns_used := array[p_primary_town] || coalesce(v_towns_used, array[]::text[]);

  -- Dedupe final query list while preserving order (primary first, then expanded).
  return jsonb_build_object(
    'queries', to_jsonb((
      select array_agg(distinct q order by q)
      from (
        select unnest(v_primary_queries || v_expanded_queries) as q
      ) s
    )),
    'towns_used', to_jsonb(v_towns_used),
    'primary_coverage', to_jsonb(v_stems),
    'expanded_coverage', to_jsonb(v_expanded_stems)
  );
end;
$$;

grant execute on function public.expand_search_queries(text[], text, numeric, integer, integer, integer) to authenticated;

comment on function public.expand_search_queries is
  'Radius-aware competitor-discovery query fan-out. See design doc '
  '2026-04-16-competitor-discovery-radius-expansion-design.md and the '
  'pure TS twin at supabase/functions/_shared/expandSearchQueries.ts.';
```

**Step 2: Apply the migration**

```
mcp__59a8ed17-71f5-4117-822d-27e7fd6b48ba__apply_migration
  project_id: atukvssploxwyqpwjmrc
  name: expand_search_queries_rpc
  query: <the SQL above>
```

**Step 3: Smoke-test the RPC**

```sql
select public.expand_search_queries(
  array['window cleaning luton', 'gutter cleaning luton', 'commercial window cleaning luton']::text[],
  'Luton',
  20::numeric,
  3, 30, 6
);
```

Expected: JSONB result with `queries` containing mix of luton/dunstable/harpenden/etc, `towns_used` array including `Luton`, `primary_coverage` = 3 stems, `expanded_coverage` = 3 stems.

Cross-check against the TS helper: same inputs to the vitest `expandSearchQueries` test should produce the same query set modulo ordering.

**Step 4: Commit**

```bash
git add supabase/migrations/{timestamp}_expand_search_queries_rpc.sql
git commit -m "feat(onboarding/discovery): expand_search_queries SQL RPC"
```

---

## Task 7: Wire the RPC into SearchTermsStep

**Files:**

- Modify: `src/components/onboarding/SearchTermsStep.tsx`
- Modify: `src/components/onboarding/__tests__/SearchTermsStep.test.tsx`

**Step 1: Read the current file**

```bash
cat src/components/onboarding/SearchTermsStep.tsx | head -160
```

You're looking for:

- Where `enabledTerms` (the 5 strings) is assembled.
- Where `search_queries` is passed to the downstream discovery trigger.
- Whether `service_area` is already loaded (grep shows it is — line 61).

**Step 2: Extract the primary town + radius from service_area**

Add a util (inline in the component or in a new `src/lib/onboarding/serviceArea.ts`):

```typescript
export interface ServiceAreaPrimary {
  town: string;
  radiusMiles: number;
}

export function parsePrimaryServiceArea(raw: string | null | undefined): ServiceAreaPrimary | null {
  if (!raw) return null;
  const first = (raw.includes(' | ') ? raw.split(' | ') : raw.split(','))[0]?.trim();
  if (!first) return null;
  const match = first.match(/^(.+?)\s*\((\d+)\s*miles?\)$/i);
  if (match) {
    return { town: match[1].trim(), radiusMiles: parseInt(match[2], 10) };
  }
  return { town: first, radiusMiles: 0 };
}
```

Unit test in `src/lib/onboarding/__tests__/serviceArea.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parsePrimaryServiceArea } from '../serviceArea';

describe('parsePrimaryServiceArea', () => {
  it('parses town + radius', () => {
    expect(parsePrimaryServiceArea('Luton (20 miles)')).toEqual({ town: 'Luton', radiusMiles: 20 });
  });
  it('radius=0 when no parenthetical', () => {
    expect(parsePrimaryServiceArea('Luton')).toEqual({ town: 'Luton', radiusMiles: 0 });
  });
  it('takes the first entry in a pipe-separated list', () => {
    expect(parsePrimaryServiceArea('Luton (20 miles) | Watford (10 miles)')).toEqual({
      town: 'Luton',
      radiusMiles: 20,
    });
  });
  it('handles comma-separated (legacy) format', () => {
    expect(parsePrimaryServiceArea('Luton (20 miles), Watford')).toEqual({
      town: 'Luton',
      radiusMiles: 20,
    });
  });
  it('null for empty input', () => {
    expect(parsePrimaryServiceArea('')).toBeNull();
    expect(parsePrimaryServiceArea(null)).toBeNull();
  });
});
```

Run, confirm fail, implement, confirm pass.

**Step 3: Call the RPC when terms are edited or the step mounts**

Add to `SearchTermsStep.tsx`:

```typescript
// Near the top of the component, after other useState calls:
const [expandedQueries, setExpandedQueries] = useState<string[]>([]);
const [townsUsed, setTownsUsed] = useState<string[]>([]);
const [excludedTowns, setExcludedTowns] = useState<Set<string>>(new Set());
const [isExpanding, setIsExpanding] = useState(false);

// After `enabledTerms` memo (line ~100):
const primaryArea = useMemo(
  () => parsePrimaryServiceArea(businessContext?.service_area),
  [businessContext?.service_area],
);

// Effect: recompute expansions when enabledTerms or primaryArea change.
useEffect(() => {
  let cancelled = false;
  async function run() {
    if (!primaryArea || enabledTerms.length === 0) {
      setExpandedQueries([]);
      setTownsUsed([]);
      return;
    }
    setIsExpanding(true);
    try {
      const { data, error } = await supabase.rpc('expand_search_queries', {
        p_search_terms: enabledTerms,
        p_primary_town: primaryArea.town,
        p_radius_miles: primaryArea.radiusMiles,
        p_terms_per_nearby_town: 3,
        p_max_queries: 30,
        p_max_nearby_towns: 6,
      });
      if (cancelled) return;
      if (error) {
        console.warn('[SearchTermsStep] expand_search_queries RPC failed', error);
        setExpandedQueries(enabledTerms); // fallback: original terms only
        setTownsUsed([primaryArea.town]);
        return;
      }
      const payload = data as {
        queries: string[];
        towns_used: string[];
        primary_coverage: string[];
        expanded_coverage: string[];
      };
      setExpandedQueries(payload.queries ?? enabledTerms);
      setTownsUsed(payload.towns_used ?? [primaryArea.town]);
    } finally {
      if (!cancelled) setIsExpanding(false);
    }
  }
  run();
  return () => {
    cancelled = true;
  };
}, [enabledTerms, primaryArea?.town, primaryArea?.radiusMiles]);

// Final queries passed to discovery = expandedQueries filtered by excludedTowns.
const finalQueries = useMemo(() => {
  if (excludedTowns.size === 0) return expandedQueries;
  const excluded = new Set(Array.from(excludedTowns).map((t) => t.toLowerCase()));
  return expandedQueries.filter((q) => {
    const town = townsUsed.find((t) => q.endsWith(` ${t.toLowerCase()}`));
    return !town || !excluded.has(town.toLowerCase());
  });
}, [expandedQueries, excludedTowns, townsUsed]);
```

Change the existing `search_queries: enabledTerms` at line 152 to `search_queries: finalQueries.length > 0 ? finalQueries : enabledTerms`.

**Step 4: Add the town-chip UI**

Below the existing terms list, add:

```tsx
{
  townsUsed.length > 1 && (
    <div className="mt-6">
      <p className="text-sm font-medium text-foreground">
        Searching in {townsUsed.length} towns within {primaryArea?.radiusMiles} miles
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        We'll fire {finalQueries.length} searches across these areas. Click a town to exclude it.
      </p>
      <div className="flex flex-wrap gap-2">
        {townsUsed.map((town) => {
          const isPrimary = town.toLowerCase() === primaryArea?.town.toLowerCase();
          const isExcluded = excludedTowns.has(town);
          return (
            <button
              key={town}
              type="button"
              disabled={isPrimary}
              onClick={() => {
                if (isPrimary) return;
                setExcludedTowns((prev) => {
                  const next = new Set(prev);
                  if (next.has(town)) next.delete(town);
                  else next.add(town);
                  return next;
                });
              }}
              className={cn(
                'px-3 py-1 rounded-full text-xs border transition',
                isPrimary
                  ? 'bg-primary/10 border-primary/30 text-primary cursor-default'
                  : isExcluded
                    ? 'bg-muted border-muted-foreground/20 text-muted-foreground line-through'
                    : 'bg-background border-foreground/20 hover:bg-muted',
              )}
            >
              {town}
              {isPrimary && ' (primary)'}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 5: Update tests**

In `__tests__/SearchTermsStep.test.tsx`:

```typescript
// Add to the supabase mock:
const mockExpandRpc = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: /* existing */,
    rpc: (name: string, args: unknown) => mockExpandRpc(name, args),
  },
}));

// Test: RPC is called with parsed primary town + radius.
it('calls expand_search_queries with parsed service_area', async () => {
  mockExpandRpc.mockResolvedValue({
    data: {
      queries: ['window cleaning luton', 'window cleaning dunstable'],
      towns_used: ['Luton', 'Dunstable'],
      primary_coverage: ['window cleaning'],
      expanded_coverage: ['window cleaning'],
    },
    error: null,
  });

  // ... render with service_area: 'Luton (20 miles)'

  await waitFor(() => {
    expect(mockExpandRpc).toHaveBeenCalledWith(
      'expand_search_queries',
      expect.objectContaining({ p_primary_town: 'Luton', p_radius_miles: 20 }),
    );
  });
});

// Test: chip row renders town count and query count.
it('renders town chips with query count', async () => {
  mockExpandRpc.mockResolvedValue({
    data: {
      queries: ['window cleaning luton', 'window cleaning dunstable', 'window cleaning harpenden'],
      towns_used: ['Luton', 'Dunstable', 'Harpenden'],
      primary_coverage: ['window cleaning'],
      expanded_coverage: ['window cleaning'],
    },
    error: null,
  });

  // ... render + wait for chips
  expect(screen.getByText(/Searching in 3 towns within 20 miles/)).toBeInTheDocument();
  expect(screen.getByText(/3 searches/)).toBeInTheDocument();
});

// Test: clicking a non-primary chip excludes its queries.
it('excluding a town removes its queries from finalQueries', async () => {
  // setup as above, then:
  const dunstableChip = screen.getByText('Dunstable');
  await userEvent.click(dunstableChip);
  // Trigger Continue, assert search_queries excludes dunstable:
  const continueBtn = screen.getByRole('button', { name: /continue/i });
  await userEvent.click(continueBtn);
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      search_queries: expect.not.arrayContaining(['window cleaning dunstable']),
    }),
  );
});

// Test: RPC failure falls back to enabledTerms unchanged.
it('falls back to original terms when RPC errors', async () => {
  mockExpandRpc.mockResolvedValue({ data: null, error: new Error('boom') });
  // ... render + click Continue
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ search_queries: ['window cleaning luton', /* ...original 5 */] }),
  );
});
```

Adapt to the actual test harness pattern in that file.

**Step 6: Run tests**

```bash
npx vitest run src/components/onboarding/__tests__/SearchTermsStep.test.tsx
npx vitest run src/lib/onboarding/__tests__/serviceArea.test.ts
```

Expected: all pass.

**Step 7: Commit**

```bash
git add src/components/onboarding/SearchTermsStep.tsx \
        src/components/onboarding/__tests__/SearchTermsStep.test.tsx \
        src/lib/onboarding/serviceArea.ts \
        src/lib/onboarding/__tests__/serviceArea.test.ts
git commit -m "feat(onboarding/search-terms): wire radius-expanded queries + town chip toggles"
```

---

## Task 8: Finalize prompt — enforce user-website-is-source-of-truth invariant

**Files:**

- Modify: `supabase/functions/faq-agent-runner/lib/onboarding-ai.ts` (around lines 873-905, `finalizeFaqCandidates`)
- Create: `supabase/functions/faq-agent-runner/lib/onboarding-ai.test.ts`

**Step 1: Write the failing prompt-shape test**

Create `supabase/functions/faq-agent-runner/lib/onboarding-ai.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.57.2', () => ({}));

// Capture the exact system prompt sent to Claude so the INVARIANT and
// REWRITE sections are enforced at commit time, not at live-run time.
// Mock callClaudeForJson before importing so the system prompt is
// observable without a real network call.
const callClaudeSpy = vi.fn(async () => ({ faqs: [] }));
vi.mock('./claude-client.ts', () => ({
  callClaudeForJson: callClaudeSpy,
}));

const { finalizeFaqCandidates } = await import('./onboarding-ai.ts');

describe('finalizeFaqCandidates system prompt', () => {
  it('contains the INVARIANT header enforcing user website as source of truth', async () => {
    await finalizeFaqCandidates(
      'api-key',
      'claude-sonnet-4-6',
      { workspace_name: 'MAC Cleaning', industry: null, service_area: null, business_type: null },
      [],
      [],
    );
    const systemPrompt = callClaudeSpy.mock.calls[0][1].systemPrompt as string;
    expect(systemPrompt).toMatch(/INVARIANT/i);
    expect(systemPrompt).toMatch(/source of truth/i);
    expect(systemPrompt).toMatch(/user'?s own website/i);
  });

  it('contains REWRITE rules that strip brand names and generalise claims', async () => {
    callClaudeSpy.mockClear();
    await finalizeFaqCandidates(
      'k',
      'm',
      { workspace_name: 'W', industry: null, service_area: null, business_type: null },
      [],
      [],
    );
    const systemPrompt = callClaudeSpy.mock.calls[0][1].systemPrompt as string;
    expect(systemPrompt).toMatch(/REWRITE/i);
    expect(systemPrompt).toMatch(/brand name/i);
    expect(systemPrompt).toMatch(/first person/i);
  });

  it('retains existing safety rules (no duplicates, grounded only, max 15)', async () => {
    callClaudeSpy.mockClear();
    await finalizeFaqCandidates(
      'k',
      'm',
      { workspace_name: 'W', industry: null, service_area: null, business_type: null },
      [],
      [],
    );
    const systemPrompt = callClaudeSpy.mock.calls[0][1].systemPrompt as string;
    expect(systemPrompt).toMatch(/duplicates/i);
    expect(systemPrompt).toMatch(/grounded/i);
    expect(systemPrompt).toMatch(/no more than 15/i);
  });
});
```

**Step 2: Run, confirm failure**

```bash
npx vitest run supabase/functions/faq-agent-runner/lib/onboarding-ai.test.ts
```

Expected: all 3 tests fail (existing prompt doesn't contain INVARIANT / REWRITE sections).

**Step 3: Update the finalize prompt in `onboarding-ai.ts`**

Replace the `systemPrompt` template literal in `finalizeFaqCandidates` (lines 880-895) with:

```typescript
const systemPrompt = `You are BizzyBee's FAQ finalizer for the competitor-research stream.

You are finalizing FAQ candidates that were extracted from COMPETITOR websites.
These FAQs will be added to the user's own knowledge base alongside FAQs
extracted from their own website.

Return valid JSON only.

Select the strongest final FAQ set for:
- Workspace: ${context.workspace_name}
- Industry: ${context.industry || ''}
- Service area: ${context.service_area || ''}
- Business type: ${context.business_type || ''}

INVARIANT — user's own website is the source of truth:
The user's own website is the source of truth for pricing, services,
geography, guarantees, insurance, and voice. You MUST NOT let
competitor-specific claims leak into the user's knowledge base.

For each candidate, ask:
1. Is the QUESTION one a customer might reasonably ask the USER's business? (If yes → keep; if no → drop.)
2. Does the ANSWER contain competitor-specific facts (their exact pricing, their exact product names, their exact guarantees, their exact geography)? (If yes → rewrite in generic terms OR drop the FAQ.)

REWRITE rules:
- Strip competitor brand names. "At Acme Cleaning we offer..." → "We offer...".
- Generalise competitor-specific pricing. "Acme charges £18 per visit" → either drop, or generalise to "Window cleaning for a typical 3-bed semi is usually £15–£25" only IF a reasonable industry-standard range is clearly supported across multiple competitor sources.
- Drop competitor-specific claims that contradict the user's declared services or business_type.
- Never promise a service on the user's behalf that only appears in a competitor source.
- Use the user's voice: first person ("we", "our", "us"), short sentences, no marketing fluff.

EXISTING rules (retained):
- Prefer fewer strong FAQs over many weak ones.
- Do not return duplicates of existing FAQ questions (user-site FAQs).
- Keep only clearly grounded, customer-helpful FAQs.
- Do not include unsupported or speculative claims.
- Return no more than 15 FAQs.`;
```

**Step 4: Run the prompt-shape tests**

```bash
npx vitest run supabase/functions/faq-agent-runner/lib/onboarding-ai.test.ts
```

Expected: all 3 pass.

**Step 5: Run the full suite to confirm no regressions**

```bash
npx vitest run supabase/functions/_shared supabase/functions/faq-agent-runner
npx tsc --noEmit
```

Expected: everything green; tsc clean.

**Step 6: Commit**

```bash
git add supabase/functions/faq-agent-runner/lib/onboarding-ai.ts \
        supabase/functions/faq-agent-runner/lib/onboarding-ai.test.ts
git commit -m "feat(onboarding/competitor-faq): enforce user website as source of truth in finalizer"
```

---

## Task 9: CompetitorReviewScreen — soft recommendation + counter

**Files:**

- Modify: `src/components/onboarding/CompetitorReviewScreen.tsx`
- Modify: `src/components/onboarding/__tests__/CompetitorReviewScreen.test.tsx`

**Step 1: Read current file**

```bash
cat src/components/onboarding/CompetitorReviewScreen.tsx | head -120
```

Locate the header region above the competitor list, and the selection state / counter logic (likely a `useMemo` on `competitors.filter(c => c.isSelected)`).

**Step 2: Add the recommendation copy block**

Above the competitor list:

```tsx
<div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
  <p className="text-sm font-medium text-foreground">We recommend picking 5–10 competitors.</p>
  <p className="mt-1 text-xs text-muted-foreground">
    That's usually enough for diverse coverage without diluting your own voice. More is fine if you
    prefer, but your own website will always be the primary source of truth for your AI's answers.
  </p>
</div>
```

**Step 3: Add the live counter**

Where selection count is displayed (or add it):

```tsx
<div className="flex items-center justify-between mb-2">
  <p className="text-sm text-muted-foreground">
    {selectedCount} of {totalCount} selected
  </p>
  {selectedCount > 10 && (
    <p className="text-xs text-muted-foreground italic">
      More than 10 — that's fine, just a heads-up.
    </p>
  )}
</div>
```

**Step 4: Update tests**

```typescript
it('renders the 5-10 recommendation copy', () => {
  render(<CompetitorReviewScreen competitors={[...]} onContinue={vi.fn()} />);
  expect(screen.getByText(/We recommend picking 5–10 competitors/)).toBeInTheDocument();
  expect(screen.getByText(/source of truth/)).toBeInTheDocument();
});

it('renders the selection counter and updates on toggle', async () => {
  render(<CompetitorReviewScreen competitors={mockList} onContinue={vi.fn()} />);
  expect(screen.getByText(/0 of \d+ selected/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: mockList[0].business_name }));
  expect(screen.getByText(/1 of \d+ selected/)).toBeInTheDocument();
});

it('does NOT block Continue when more than 10 competitors are selected', async () => {
  const onContinue = vi.fn();
  // Build a 12-competitor list and pre-select all 12.
  render(<CompetitorReviewScreen competitors={manyCompetitors} onContinue={onContinue} />);
  // Ensure all 12 checkboxes are checked (via default or user action).
  // ...
  const continueBtn = screen.getByRole('button', { name: /continue/i });
  expect(continueBtn).not.toBeDisabled();
  await userEvent.click(continueBtn);
  expect(onContinue).toHaveBeenCalled();
});

it('shows a soft heads-up when selection exceeds 10', () => {
  render(<CompetitorReviewScreen competitors={manyCompetitors} onContinue={vi.fn()} />);
  // select 11 competitors
  // assert the heads-up text
  expect(screen.getByText(/More than 10 — that's fine/)).toBeInTheDocument();
});
```

**Step 5: Run + commit**

```bash
npx vitest run src/components/onboarding/__tests__/CompetitorReviewScreen.test.tsx
git add src/components/onboarding/CompetitorReviewScreen.tsx \
        src/components/onboarding/__tests__/CompetitorReviewScreen.test.tsx
git commit -m "feat(onboarding/competitor-review): soft 5-10 recommendation + selection counter"
```

---

## Task 10: Deploy + live verification on MAC Cleaning

**Step 1: Deploy edge functions that import the new helpers**

The discovery worker doesn't need redeployment (reads `search_queries` as an opaque array). The onboarding-faq worker uses `finalizeFaqCandidates`, so deploy it:

```bash
cd /Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control
supabase functions deploy pipeline-worker-onboarding-faq --project-ref atukvssploxwyqpwjmrc
```

**Step 2: Verify RPC is live**

```sql
select public.expand_search_queries(
  array['window cleaning luton', 'gutter cleaning luton', 'commercial window cleaning luton']::text[],
  'Luton',
  20::numeric,
  3, 30, 6
);
```

Expected: structured JSON with queries covering Luton + ≥ 3 nearby towns.

**Step 3: Cancel any stale discovery runs + clear queue for MAC Cleaning**

```sql
update agent_runs set status='canceled', completed_at=now()
where workspace_id='acdf92d1-9da7-4c71-8216-04d476d31bb0'
  and workflow_key='competitor_discovery' and status in ('queued', 'running');
```

**Step 4: User re-triggers MAC Cleaning onboarding from the Search Terms step**

Watch in real-time:

```sql
select id, status, input_snapshot->'search_queries' as queries,
       jsonb_array_length(input_snapshot->'search_queries') as query_count,
       output_summary->'approved_count' as approved
from agent_runs
where workspace_id='acdf92d1-9da7-4c71-8216-04d476d31bb0' and workflow_key='competitor_discovery'
order by created_at desc limit 1;
```

Expected:

- `query_count` between 20–30 (up from 5).
- `approved_count` ≥ 25 after qualify (up from 14).

**Step 5: Qualitative check on the qualified list**

```sql
select business_name, url, relevance_score
from competitor_sites
where workspace_id='acdf92d1-9da7-4c71-8216-04d476d31bb0' and status='validated'
order by relevance_score desc;
```

Expected: entries with URLs referencing Dunstable, Harpenden, St Albans, Hemel Hempstead, Hitchin — not just Luton.

**Step 6: After user picks competitors + scrape completes, check for contamination**

```sql
-- Any competitor FAQs still mention a competitor brand name in the answer?
select question, answer
from faq_database
where workspace_id='acdf92d1-9da7-4c71-8216-04d476d31bb0' and is_own_content=false
  and (
    answer ~* 'scrub a dub dub|oliver.s cleaning|legendary cleaning|potters|mc bob|'
           || 'pure cleaning|deluxe window|wilsons windows|red clean|steve.s gutters|'
           || 'james wilson|taylor gutter|rc gutters|dwcpc|dwc professional'
  );
```

Expected: 0 rows. If any found, flag to design doc follow-up (post-processing filter). The invariant prompt should prevent this but isn't a hard constraint.

**Step 7: Document observed metrics**

Append a short section to the design doc under `## Post-deploy observations` with:

- Query count fired, approved count, median relevance score
- Any contamination found (count)
- Any unexpected rejection reasons

---

## Task 11: Sweep + regression guard

**Step 1: Full test suite**

```bash
cd /Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control
npx vitest run
npx tsc --noEmit
```

Expected: everything green, tsc silent.

**Step 2: Confirm no regression in own-website FAQ count**

```sql
select count(*) as own_faqs
from faq_database
where workspace_id='acdf92d1-9da7-4c71-8216-04d476d31bb0' and is_own_content=true;
```

Expected: within ±10% of the pre-deploy count (the radius work shouldn't touch own-site FAQs; any delta is noise from the latest own-site scrape).

**Step 3: Confirm migration naming consistency**

```bash
ls supabase/migrations/ | tail -5
```

Expected: new migrations named consistently with existing ones (`YYYYMMDDHHMMSS_snake_case.sql`).

**Step 4: Commit any leftover cleanup**

If the test-run surfaced any flaky mocks or dead imports, clean up and commit with a clear message.

---

## Rollback plan

1. RPC: `drop function public.expand_search_queries;` — SearchTermsStep will see the error, fall back to `enabledTerms` untouched.
2. Table: `drop table public.uk_towns;` — no other code reads this table.
3. Code: `git revert` the commits from Tasks 3-9. Tasks 0-2 are SQL-only; Task 10 is verification.

The finalize prompt change (Task 8) has no data-layer dependency — revertable by `git revert` of that commit alone.

---

## Open questions to flag during execution

- If the RPC haversine SQL drifts from the TS helper, which is canonical? Suggest the TS is canonical (vitest coverage), SQL is the shim. Add a comment in both files pointing at each other.
- If ONS dataset download isn't accessible in the implementer's env, request the CSV artefact from the repo owner rather than hand-seeding a partial set.
- If the competitor finalize prompt change produces too aggressive a drop (e.g. <5 competitor FAQs persisted because most get flagged as contaminating), tune back by loosening the REWRITE rules before lowering the invariant bar.
