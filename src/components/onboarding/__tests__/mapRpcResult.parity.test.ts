import { describe, expect, it, vi } from 'vitest';

// The shared module imports esm.sh URLs (Deno-style). Stub before loading
// it so vitest's Node resolver doesn't choke.
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.57.2', () => ({}));

import { mapRpcResult } from '../SearchTermsStep';
import { fromRpcResult } from '../../../../supabase/functions/_shared/expandSearchQueries';

// Parity test between the client-side `mapRpcResult` inlined in
// SearchTermsStep.tsx and the shared `fromRpcResult` in
// supabase/functions/_shared/expandSearchQueries.ts.
//
// The client inlines the mapper because tsconfig.app.json scopes to `src/`
// only — but drift between the two copies would be silent. This test
// imports BOTH and diffs them across representative fixtures, so any
// divergence (field name change, missing-array handling change, new field
// the client forgets to add) fails CI.
describe('mapRpcResult parity with shared fromRpcResult', () => {
  const fixtures = [
    {
      name: 'fully populated',
      input: {
        queries: ['window cleaning luton', 'window cleaning dunstable'],
        towns_used: ['Luton', 'Dunstable'],
        primary_coverage: ['window cleaning'],
        expanded_coverage: ['window cleaning'],
      },
    },
    {
      name: 'empty arrays',
      input: {
        queries: [],
        towns_used: [],
        primary_coverage: [],
        expanded_coverage: [],
      },
    },
    {
      name: 'partial (missing fields become empty arrays)',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input: { queries: ['a'] } as any,
    },
    {
      name: 'all undefined fields',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input: {} as any,
    },
  ];

  for (const fixture of fixtures) {
    it(`produces identical output for: ${fixture.name}`, () => {
      expect(mapRpcResult(fixture.input)).toEqual(fromRpcResult(fixture.input));
    });
  }
});
