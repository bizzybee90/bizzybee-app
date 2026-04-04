import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  const resolved = { data: { id: 'faq-1' }, error: null };
  const mockChain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'order'];
  for (const m of methods) {
    mockChain[m] = vi.fn().mockReturnValue(mockChain);
  }
  mockChain.single = vi.fn().mockResolvedValue(resolved);
  mockChain.maybeSingle = vi.fn().mockResolvedValue(resolved);
  // Make chain awaitable (for queries without terminal .single())
  mockChain.then = vi
    .fn()
    .mockImplementation((cb: (v: typeof resolved) => void) => Promise.resolve(cb(resolved)));
  return {
    supabase: {
      from: vi.fn(() => mockChain),
    },
  };
});

import { supabase } from '@/integrations/supabase/client';
import { getFaqs, createFaq, deleteFaq, getBusinessContext } from '../knowledge-base';

describe('knowledge-base API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getFaqs filters by workspace and excludes archived', async () => {
    await getFaqs('ws-1');

    expect(supabase.from).toHaveBeenCalledWith('faq_database');
    const chain = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(chain.eq).toHaveBeenCalledWith('workspace_id', 'ws-1');
    expect(chain.eq).toHaveBeenCalledWith('archived', false);
    expect(chain.order).toHaveBeenCalledWith('priority', { ascending: false });
  });

  it('createFaq inserts with correct fields', async () => {
    const faq = {
      workspace_id: 'ws-1',
      category: 'Pricing',
      question: 'How much?',
      answer: '£35',
    };
    await createFaq(faq);

    expect(supabase.from).toHaveBeenCalledWith('faq_database');
    const chain = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(chain.insert).toHaveBeenCalledWith(faq);
  });

  it('deleteFaq soft-deletes by setting archived', async () => {
    await deleteFaq('faq-1', 'ws-1');

    const chain = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(chain.update).toHaveBeenCalledWith({ archived: true });
    expect(chain.eq).toHaveBeenCalledWith('id', 'faq-1');
    expect(chain.eq).toHaveBeenCalledWith('workspace_id', 'ws-1');
  });

  it('getBusinessContext uses maybeSingle', async () => {
    await getBusinessContext('ws-1');

    expect(supabase.from).toHaveBeenCalledWith('business_context');
    const chain = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(chain.maybeSingle).toHaveBeenCalled();
  });
});
