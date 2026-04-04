import { describe, it, expect } from 'vitest';
import { createMockSupabaseClient } from './mocks/supabase';

describe('Test infrastructure', () => {
  it('vitest runs correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('supabase mock is chainable', async () => {
    const client = createMockSupabaseClient({
      fromResult: { data: [{ id: '1', name: 'Test' }], error: null },
    });

    const result = await client.from('users').select('*').eq('id', '1').single();
    expect(result.data).toEqual([{ id: '1', name: 'Test' }]);
    expect(result.error).toBeNull();
    expect(client.from).toHaveBeenCalledWith('users');
  });

  it('auth mock returns user', async () => {
    const client = createMockSupabaseClient({
      authUser: { id: 'user-123', email: 'michael@test.com' },
    });

    const { data } = await client.auth.getUser();
    expect(data.user?.id).toBe('user-123');
  });
});
