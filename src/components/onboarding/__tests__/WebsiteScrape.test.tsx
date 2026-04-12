import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WebsiteScrape } from '../WebsiteScrape';

const { mockInvoke, mockToast } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockToast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: mockInvoke,
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

describe('WebsiteScrape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({
      data: {
        success: true,
        job_id: 'job_1',
        pages_found: 8,
        pages_scraped: 0,
        status: 'pending',
      },
      error: null,
    });
  });

  it('starts the Supabase-native website analysis with a normalized URL', async () => {
    const user = userEvent.setup();

    render(<WebsiteScrape workspaceId="ws-1" onComplete={vi.fn()} />);

    await user.type(screen.getByLabelText(/website url/i), 'example.com');
    await user.click(screen.getByRole('button', { name: /analyze my website/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start-own-website-analysis', {
        body: {
          workspace_id: 'ws-1',
          website_url: 'https://example.com',
          trigger_source: 'onboarding_website_scrape_card',
        },
      });
    });

    expect(mockToast.error).not.toHaveBeenCalled();
  });
});
