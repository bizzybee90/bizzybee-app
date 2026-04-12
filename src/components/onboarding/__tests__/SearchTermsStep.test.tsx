import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { SearchTermsStep } from '../SearchTermsStep';

// Mock Supabase client — use vi.hoisted so mocks are available at mock-hoist time
const { mockMaybeSingle, mockInvoke } = vi.hoisted(() => ({
  mockMaybeSingle: vi.fn(),
  mockInvoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
    functions: {
      invoke: mockInvoke,
    },
  },
}));

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SearchTermsStep — early competitor discovery trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: business context loaded successfully
    mockMaybeSingle.mockResolvedValue({
      data: {
        company_name: 'Test Co',
        business_type: 'window_cleaning',
        service_area: 'Luton',
        website_url: 'https://example.com',
      },
      error: null,
    });
    // Default: trigger invoke succeeds
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });
  });

  it('fires competitor_discovery trigger after successful save', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onBack = vi.fn();

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={onNext} onBack={onBack} />);

    // Wait for business context to load and search terms to populate
    await waitFor(() => {
      expect(screen.getByText(/Configure/i)).toBeInTheDocument();
    });

    // Click Continue button
    const continueButton = await screen.findByRole('button', { name: /continue/i });
    await user.click(continueButton);

    // Verify the onboarding discovery function was invoked with the right body
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start-onboarding-discovery', {
        body: {
          workspace_id: 'test-workspace-id',
          search_queries: expect.any(Array),
          target_count: 15,
          trigger_source: 'onboarding_search_terms',
        },
      });
    });

    // onNext should still be called (user advances even before trigger resolves)
    expect(onNext).toHaveBeenCalled();
  });

  it('does not advance if the discovery trigger rejects', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onBack = vi.fn();

    // Make the trigger fail
    mockInvoke.mockRejectedValue(new Error('Network error'));

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={onNext} onBack={onBack} />);

    await waitFor(() => {
      expect(screen.getByText(/Configure/i)).toBeInTheDocument();
    });

    const continueButton = await screen.findByRole('button', { name: /continue/i });
    await user.click(continueButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start-onboarding-discovery', {
        body: {
          workspace_id: 'test-workspace-id',
          search_queries: expect.any(Array),
          target_count: 15,
          trigger_source: 'onboarding_search_terms',
        },
      });
      expect(toast.error).toHaveBeenCalledWith('Failed to save search terms');
    });

    expect(onNext).not.toHaveBeenCalled();
  });

  it('does NOT advance if the discovery trigger fails', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onBack = vi.fn();

    mockInvoke.mockResolvedValue({ data: null, error: new Error('Edge function failed') });

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={onNext} onBack={onBack} />);

    await waitFor(() => {
      expect(screen.getByText(/Configure/i)).toBeInTheDocument();
    });

    const continueButton = await screen.findByRole('button', { name: /continue/i });
    await user.click(continueButton);

    // Wait for the error path to actually execute
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to save search terms');
    });

    expect(mockInvoke).toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });
});
