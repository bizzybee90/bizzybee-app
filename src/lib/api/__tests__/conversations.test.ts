import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase before importing the module under test
vi.mock('@/integrations/supabase/client', () => {
  const resolved = { data: { id: 'test-conv' }, error: null };
  const mockChain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'select',
    'insert',
    'update',
    'eq',
    'neq',
    'gte',
    'not',
    'is',
    'or',
    'order',
    'limit',
  ];
  for (const m of methods) {
    mockChain[m] = vi.fn().mockReturnValue(mockChain);
  }
  mockChain.single = vi.fn().mockResolvedValue(resolved);
  mockChain.then = vi
    .fn()
    .mockImplementation((cb: (v: typeof resolved) => void) => Promise.resolve(cb(resolved)));
  return {
    supabase: {
      from: vi.fn(() => mockChain),
      functions: { invoke: vi.fn() },
    },
  };
});

import { supabase } from '@/integrations/supabase/client';
import { getConversation, updateConversation } from '../conversations';

describe('conversations API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getConversation filters by workspace_id', async () => {
    await getConversation('conv-1', 'ws-1');

    expect(supabase.from).toHaveBeenCalledWith('conversations');
    const chain = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(chain.eq).toHaveBeenCalledWith('id', 'conv-1');
    expect(chain.eq).toHaveBeenCalledWith('workspace_id', 'ws-1');
    expect(chain.single).toHaveBeenCalled();
  });

  it('updateConversation includes workspace_id filter', async () => {
    await updateConversation('conv-1', 'ws-1', { status: 'resolved' });

    expect(supabase.from).toHaveBeenCalledWith('conversations');
    const chain = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(chain.update).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith('id', 'conv-1');
    expect(chain.eq).toHaveBeenCalledWith('workspace_id', 'ws-1');
  });
});
