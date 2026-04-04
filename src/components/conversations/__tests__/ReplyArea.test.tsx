import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplyArea } from '../ReplyArea';

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('@/hooks/use-tablet', () => ({
  useIsTablet: () => false,
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(),
      })),
    },
  },
}));

describe('ReplyArea', () => {
  beforeEach(() => {
    mockToast.mockReset();
    localStorage.clear();
  });

  it('blocks external sends when attachments are present', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <ReplyArea conversationId="conv_123" channel="email" onSend={onSend} senderName="Alex" />,
    );

    await user.click(screen.getByRole('button', { name: /reply to alex/i }));

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput as HTMLInputElement, {
      target: {
        files: [new File(['attachment'], 'brief.pdf', { type: 'application/pdf' })],
      },
    });

    await user.click(screen.getByRole('button', { name: /^send$/i }));

    expect(onSend).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Attachments not supported yet',
        variant: 'destructive',
      }),
    );
  });
});
