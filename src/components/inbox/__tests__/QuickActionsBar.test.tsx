import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickActionsBar } from '../QuickActionsBar';

const { mockSupabase, mockToast, conversationUpdate, queueUpdate, invalidateQueries } =
  vi.hoisted(() => {
    const conversationUpdate = vi.fn();
    const queueUpdate = vi.fn();
    const invalidateQueries = vi.fn();

    return {
      conversationUpdate,
      queueUpdate,
      invalidateQueries,
      mockSupabase: {
        from: vi.fn((table: string) => {
          if (table === 'conversations') {
            return {
              update: conversationUpdate,
            };
          }

          if (table === 'email_import_queue') {
            return {
              update: queueUpdate,
            };
          }

          throw new Error(`Unexpected table ${table}`);
        }),
      },
      mockToast: {
        success: vi.fn(),
        error: vi.fn(),
      },
    };
  });

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries,
    }),
  };
});

describe('QuickActionsBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    conversationUpdate.mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [{ id: 'conv_1' }], error: null }),
    });

    queueUpdate.mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
  });

  it('updates conversations before falling back to the legacy queue', async () => {
    const user = userEvent.setup();

    render(<QuickActionsBar emailId="conv_1" workspaceId="ws_1" />);

    await user.click(screen.getByRole('button', { name: /handled/i }));

    await waitFor(() => {
      expect(mockSupabase.from).toHaveBeenCalledWith('conversations');
      expect(conversationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'resolved',
          decision_bucket: 'auto_handled',
          requires_reply: false,
        }),
      );
      expect(mockToast.success).toHaveBeenCalledWith('Marked as handled');
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox-emails'] });
    });

    expect(mockSupabase.from).not.toHaveBeenCalledWith('email_import_queue');
  });
});
