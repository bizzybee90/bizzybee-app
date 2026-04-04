import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendReply } from '../sendReply';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: mockInvoke,
    },
  },
}));

describe('sendReply', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('calls send-reply with the canonical payload', async () => {
    mockInvoke.mockResolvedValue({
      data: { success: true, message_id: 'msg_123' },
      error: null,
    });

    await sendReply({
      conversationId: 'conv_123',
      workspaceId: 'ws_123',
      content: 'Hello there',
      statusAfterSend: 'waiting_customer',
    });

    expect(mockInvoke).toHaveBeenCalledWith('send-reply', {
      body: {
        conversation_id: 'conv_123',
        workspace_id: 'ws_123',
        content: 'Hello there',
        status_after_send: 'waiting_customer',
      },
    });
  });

  it('throws when the edge function returns an application-level failure', async () => {
    mockInvoke.mockResolvedValue({
      data: { success: false, error: 'Delivery failed' },
      error: null,
    });

    await expect(
      sendReply({
        conversationId: 'conv_123',
        workspaceId: 'ws_123',
        content: 'Hello there',
      }),
    ).rejects.toThrow('Delivery failed');
  });
});
