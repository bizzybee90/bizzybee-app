import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  const resolved = { data: { id: 'cust-1', name: 'Test' }, error: null };
  const mockChain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select', 'update', 'eq', 'order']) {
    mockChain[m] = vi.fn().mockReturnValue(mockChain);
  }
  mockChain.single = vi.fn().mockResolvedValue(resolved);
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
import { getCustomers, getCustomer, updateCustomer } from '../customers';

describe('customers API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getCustomers filters by workspace and orders by name', async () => {
    await getCustomers('ws-1');

    expect(supabase.from).toHaveBeenCalledWith('customers');
    const chain = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(chain.eq).toHaveBeenCalledWith('workspace_id', 'ws-1');
    expect(chain.order).toHaveBeenCalledWith('name');
  });

  it('getCustomer filters by both id and workspace', async () => {
    await getCustomer('cust-1', 'ws-1');

    const chain = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(chain.eq).toHaveBeenCalledWith('id', 'cust-1');
    expect(chain.eq).toHaveBeenCalledWith('workspace_id', 'ws-1');
    expect(chain.single).toHaveBeenCalled();
  });

  it('updateCustomer scopes to workspace', async () => {
    await updateCustomer('cust-1', 'ws-1', { name: 'Updated' });

    const chain = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(chain.update).toHaveBeenCalledWith({ name: 'Updated' });
    expect(chain.eq).toHaveBeenCalledWith('workspace_id', 'ws-1');
  });
});
