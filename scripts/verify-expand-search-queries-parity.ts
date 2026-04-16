#!/usr/bin/env -S npx tsx
/**
 * Parity check between the TS helper `expandSearchQueries` and the SQL RPC
 * `public.expand_search_queries`.
 *
 * Because the SQL RPC resolves nearby towns internally via `uk_towns` while
 * the TS helper takes them as a parameter, a direct "same inputs → same
 * outputs" comparison is impossible. Instead:
 *   1. Call the SQL RPC for a fixture.
 *   2. Take its `towns_used` (minus index 0 = the primary) and feed that back
 *      into the TS helper as `nearbyTowns`.
 *   3. Assert the final `queries` arrays match (after sort).
 *
 * This catches drift in the query-construction logic (stripping, casing,
 * trimming, dedupe, budget) — not the nearby-resolution logic, which is
 * tested separately by `supabase/functions/_shared/uk-towns.test.ts`.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/verify-expand-search-queries-parity.ts
 *
 * Not wired into vitest because the TS helper's source file uses Deno-style
 * `from 'https://esm.sh/...'` imports that require the vi.mock shim and
 * don't play well with a real Supabase client in the same process.
 */
import { createClient } from '@supabase/supabase-js';
import {
  expandSearchQueries,
  fromRpcResult,
} from '../supabase/functions/_shared/expandSearchQueries';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Fixture = {
  name: string;
  searchTerms: string[];
  primaryTown: string;
  radiusMiles: number;
  termsPerNearbyTown?: number;
  maxQueries?: number;
  maxNearbyTowns?: number;
};

const fixtures: Fixture[] = [
  {
    name: 'mac-cleaning-real-input',
    searchTerms: [
      'window cleaning luton',
      'window cleaner luton',
      'gutter cleaning luton',
      'best rated window cleaners luton',
      'commercial window cleaning luton',
    ],
    primaryTown: 'Luton',
    radiusMiles: 20,
  },
  {
    name: 'radius-zero',
    searchTerms: ['window cleaning luton'],
    primaryTown: 'Luton',
    radiusMiles: 0,
  },
  {
    name: 'small-budget-trim',
    searchTerms: ['t1', 't2', 't3', 't4', 't5'],
    primaryTown: 'Luton',
    radiusMiles: 30,
    maxQueries: 10,
  },
];

let failed = 0;
for (const f of fixtures) {
  const { data, error } = await supabase.rpc('expand_search_queries', {
    p_search_terms: f.searchTerms,
    p_primary_town: f.primaryTown,
    p_radius_miles: f.radiusMiles,
    p_terms_per_nearby_town: f.termsPerNearbyTown ?? 3,
    p_max_queries: f.maxQueries ?? 30,
    p_max_nearby_towns: f.maxNearbyTowns ?? 6,
  });
  if (error) {
    console.error(`[${f.name}] RPC error:`, error);
    failed++;
    continue;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql = fromRpcResult(data as any);
  // The first entry in towns_used is the primary; the rest are the nearby
  // towns the SQL resolved. Feed those back into the TS helper so both
  // helpers operate on the same town set.
  const ts = expandSearchQueries({
    searchTerms: f.searchTerms,
    primaryTown: f.primaryTown,
    nearbyTowns: sql.townsUsed.slice(1),
    termsPerNearbyTown: f.termsPerNearbyTown ?? 3,
    maxQueries: f.maxQueries ?? 30,
  });

  const sqlQueries = [...sql.queries].sort();
  const tsQueries = [...ts.queries].sort();
  const match = JSON.stringify(sqlQueries) === JSON.stringify(tsQueries);
  if (match) {
    console.log(`[${f.name}] PASS (${sql.queries.length} queries)`);
  } else {
    console.error(`[${f.name}] FAIL`);
    console.error(`  SQL only: ${sqlQueries.filter((q) => !tsQueries.includes(q)).join(', ')}`);
    console.error(`  TS only:  ${tsQueries.filter((q) => !sqlQueries.includes(q)).join(', ')}`);
    failed++;
  }
}

process.exit(failed > 0 ? 1 : 0);
