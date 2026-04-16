import { describe, expect, it, vi } from 'vitest';

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.57.2', () => ({}));

// Mock the Claude client before importing so we can observe the exact
// systemPrompt sent, without a real network call.
const callClaudeSpy = vi.fn(async () => ({ faqs: [] }));
vi.mock('./json-tools.ts', () => ({
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

  it('contains REWRITE rules that strip brand names and use user voice', async () => {
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
