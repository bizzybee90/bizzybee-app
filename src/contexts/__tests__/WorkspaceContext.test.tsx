import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceProvider } from '../WorkspaceContext';
import { useWorkspace } from '@/hooks/useWorkspace';
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

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const Probe = () => {
  const { loading, workspace } = useWorkspace();

  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="workspace">{workspace ? workspace.id : 'none'}</span>
    </div>
  );
};

describe('WorkspaceProvider', () => {
  it('clears loading when there is no authenticated user', async () => {
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
});
