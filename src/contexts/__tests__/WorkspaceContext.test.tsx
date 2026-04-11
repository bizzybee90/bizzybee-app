import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceProvider } from '../WorkspaceContext';
import { useWorkspace } from '@/hooks/useWorkspace';
import type { Workspace } from '@/lib/types';

const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    from: vi.fn(),
  },
}));

const { mockUseEntitlements } = vi.hoisted(() => ({
  mockUseEntitlements: vi.fn(() => ({ data: null, isLoading: false })),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: mockUseEntitlements,
}));

const Probe = () => {
  const { loading, workspace, onboardingComplete, needsOnboarding, refreshWorkspace } =
    useWorkspace();

  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="workspace">{workspace ? workspace.id : 'none'}</span>
      <span data-testid="onboarding-complete">{String(onboardingComplete)}</span>
      <span data-testid="needs-onboarding">{String(needsOnboarding)}</span>
      <button onClick={() => void refreshWorkspace()} type="button">
        Refresh
      </button>
    </div>
  );
};

function buildWorkspace(id = 'ws-1'): Workspace {
  return {
    id,
    name: 'BizzyBee Workspace',
    slug: 'bizzybee-workspace',
    timezone: 'Europe/London',
    business_hours_start: '09:00',
    business_hours_end: '17:00',
    business_days: [1, 2, 3, 4, 5],
    created_at: new Date('2026-04-11T09:00:00.000Z').toISOString(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('WorkspaceProvider', () => {
  beforeEach(() => {
    mockSupabase.auth.getUser.mockReset();
    mockSupabase.auth.onAuthStateChange.mockReset();
    mockSupabase.from.mockReset();
    mockUseEntitlements.mockClear();

    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mockUseEntitlements.mockReturnValue({ data: null, isLoading: false });
  });

  it('clears loading when there is no authenticated user', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('workspace')).toHaveTextContent('none');
  });

  it('treats a completed seeded workspace as onboarded once the workspace row exists', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    workspace_id: 'ws-1',
                    onboarding_completed: true,
                    onboarding_step: 'complete',
                  },
                  error: null,
                }),
            }),
          }),
        };
      }

      if (table === 'workspaces') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: buildWorkspace('ws-1'),
                  error: null,
                }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('workspace')).toHaveTextContent('ws-1');
    expect(screen.getByTestId('onboarding-complete')).toHaveTextContent('true');
    expect(screen.getByTestId('needs-onboarding')).toHaveTextContent('false');
  });

  it('ignores stale refresh results when a newer refresh completes first', async () => {
    const firstUserQuery = deferred<{
      data: {
        workspace_id: string;
        onboarding_completed: boolean;
        onboarding_step: string;
      };
      error: null;
    }>();

    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    const userQueryResults = [
      () => firstUserQuery.promise,
      () =>
        Promise.resolve({
          data: {
            workspace_id: 'ws-1',
            onboarding_completed: true,
            onboarding_step: 'complete',
          },
          error: null,
        }),
    ];

    let userQueryIndex = 0;

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => userQueryResults[userQueryIndex++](),
            }),
          }),
        };
      }

      if (table === 'workspaces') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: buildWorkspace('ws-1'),
                  error: null,
                }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(mockSupabase.from).toHaveBeenCalledWith('users');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-complete')).toHaveTextContent('true');
    });

    await act(async () => {
      firstUserQuery.resolve({
        data: {
          workspace_id: 'ws-1',
          onboarding_completed: false,
          onboarding_step: 'welcome',
        },
        error: null,
      });
      await firstUserQuery.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-complete')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('needs-onboarding')).toHaveTextContent('false');
  });
});
