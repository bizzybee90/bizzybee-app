import { vi } from 'vitest';

/**
 * Creates a chainable mock that mimics the Supabase client query builder.
 * Usage: mockSupabaseQuery({ data: [...], error: null })
 */
function createChainableMock(resolvedValue: { data: unknown; error: unknown; count?: number }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};

  const methods = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'like',
    'ilike',
    'is',
    'in',
    'or',
    'not',
    'order',
    'limit',
    'range',
    'filter',
    'textSearch',
    'match',
    'contains',
    'containedBy',
    'overlaps',
    'csv',
  ];

  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  // Terminal methods return the resolved value
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  chain.then = vi.fn().mockImplementation((cb) => cb(resolvedValue));

  // Make the chain itself thenable (for await)
  const handler = {
    get(_target: unknown, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(resolvedValue);
      }
      return chain[prop] ?? vi.fn().mockReturnValue(chain);
    },
  };

  return new Proxy(chain, handler);
}

export function createMockSupabaseClient(overrides?: {
  fromResult?: { data: unknown; error: unknown; count?: number };
  authUser?: { id: string; email: string } | null;
  functionsResult?: { data: unknown; error: unknown };
}) {
  const fromResult = overrides?.fromResult ?? { data: [], error: null };
  const authUser = overrides?.authUser ?? { id: 'test-user-id', email: 'test@example.com' };
  const functionsResult = overrides?.functionsResult ?? { data: {}, error: null };

  return {
    from: vi.fn(() => createChainableMock(fromResult)),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: authUser },
        error: null,
      }),
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: authUser ? { access_token: 'test-token', user: authUser } : null,
        },
        error: null,
      }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    functions: {
      invoke: vi.fn().mockResolvedValue(functionsResult),
    },
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    }),
    removeChannel: vi.fn(),
  };
}
