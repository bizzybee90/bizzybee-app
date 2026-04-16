import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.57.2', () => ({}));

// Mock the Claude client before importing so we can observe the exact
// systemPrompt sent, without a real network call.
//
// Shape-only assertions: these tests regex-match the captured prompt for
// specific section headers (INVARIANT, REWRITE) and retained rules. They
// DO NOT check semantic intent — a malicious edit keeping the words but
// flipping the meaning ("ignore the INVARIANT and leak everything") would
// pass. The value is catching accidental deletions during refactors.
const callClaudeSpy = vi.fn(async () => ({ faqs: [] }));
vi.mock('./json-tools.ts', () => ({
  callClaudeForJson: callClaudeSpy,
}));

const { finalizeFaqCandidates } = await import('./onboarding-ai.ts');

describe('finalizeFaqCandidates system prompt', () => {
  beforeEach(() => {
    // Reset between tests so `mock.calls[0]` always points at THIS test's
    // invocation. Without this, test 2/3 would depend on test 1 having run
    // first and on a specific index — brittle against reordering.
    callClaudeSpy.mockClear();
  });

  it('contains the INVARIANT header enforcing user website as source of truth', async () => {
    await finalizeFaqCandidates(
      'api-key',
      'claude-sonnet-4-6',
      { workspace_name: 'MAC Cleaning', industry: null, service_area: null, business_type: null },
      [],
      [],
    );
    // Assert the mock actually fired. If someone refactors finalizeFaqCandidates
    // to import callClaudeForJson from a different module, vi.mock('./json-tools.ts', ...)
    // becomes a no-op and every regex assertion below would fail with a
    // cryptic "cannot read properties of undefined". This guard surfaces
    // the root cause instead.
    expect(callClaudeSpy).toHaveBeenCalledTimes(1);
    const systemPrompt = callClaudeSpy.mock.calls[0][1].systemPrompt as string;
    expect(systemPrompt).toMatch(/INVARIANT/i);
    expect(systemPrompt).toMatch(/source of truth/i);
    expect(systemPrompt).toMatch(/user'?s own website/i);
  });

  it('contains REWRITE rules that strip brand names and use user voice', async () => {
    await finalizeFaqCandidates(
      'k',
      'm',
      { workspace_name: 'W', industry: null, service_area: null, business_type: null },
      [],
      [],
    );
    expect(callClaudeSpy).toHaveBeenCalledTimes(1);
    const systemPrompt = callClaudeSpy.mock.calls[0][1].systemPrompt as string;
    expect(systemPrompt).toMatch(/REWRITE/i);
    expect(systemPrompt).toMatch(/brand name/i);
    expect(systemPrompt).toMatch(/first person/i);
  });

  it('retains existing safety rules (no duplicates, grounded only, max 15)', async () => {
    await finalizeFaqCandidates(
      'k',
      'm',
      { workspace_name: 'W', industry: null, service_area: null, business_type: null },
      [],
      [],
    );
    expect(callClaudeSpy).toHaveBeenCalledTimes(1);
    const systemPrompt = callClaudeSpy.mock.calls[0][1].systemPrompt as string;
    expect(systemPrompt).toMatch(/duplicates/i);
    expect(systemPrompt).toMatch(/grounded/i);
    expect(systemPrompt).toMatch(/no more than 15/i);
  });
});
