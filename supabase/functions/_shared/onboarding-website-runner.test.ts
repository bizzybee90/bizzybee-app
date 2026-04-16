import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

// Regression tests: the 12-batch website extract used to run inside a single
// pgmq message. Task 2 of the 2026-04-16 extract-batch-chunking plan splits it
// into 12 separate messages. getNextMissingWebsiteBatch tells callers which
// batch to enqueue next — 0 when nothing is written, the first missing index
// when some are written (resume case), or null when all are done.

// Stub the Deno-style URL imports that onboarding-website-runner pulls in
// transitively. These are only needed at runtime by unrelated code paths
// (step recorders, fetch tooling); the helper under test is a pure supabase
// query so we can mock the whole module to an empty shape.
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.57.2', () => ({}));

const { getNextMissingWebsiteBatch } = await import('./onboarding-website-runner');

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
