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
    window.sessionStorage.clear();
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
      expect(screen.getByText(/BizzyBee suggested these/i)).toBeInTheDocument();
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

    expect(
      window.sessionStorage.getItem('bizzybee:onboarding-discovery-trigger:test-workspace-id'),
    ).toMatch(/^\d+$/);

    // onNext should still be called (user advances even before trigger resolves)
    expect(onNext).toHaveBeenCalled();
  });

  // Fire-and-forget semantics: user always advances immediately after clicking
  // Continue. If the trigger fails, ProgressScreen.autoTrigger is the safety net
  // (see useOnboardingDiscoveryAutoTrigger). This prevents the UI from hanging
  // on a 20-50s awaited invoke when the network is slow.

  it('advances even if the discovery trigger rejects (fire-and-forget)', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onBack = vi.fn();

    // Make the trigger fail
    mockInvoke.mockRejectedValue(new Error('Network error'));

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={onNext} onBack={onBack} />);

    await waitFor(() => {
      expect(screen.getByText(/BizzyBee suggested these/i)).toBeInTheDocument();
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
    });

    // User advances regardless. ProgressScreen.autoTrigger will retry.
    await waitFor(() => {
      expect(onNext).toHaveBeenCalled();
    });

    // Non-blocking error: no toast.error on the step itself.
    // Failures are logged to console; ProgressScreen surfaces real state.
    expect(toast.error).not.toHaveBeenCalledWith('Failed to save search terms');
  });

  it('advances even if the edge function returns an error (fire-and-forget)', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onBack = vi.fn();

    mockInvoke.mockResolvedValue({ data: null, error: new Error('Edge function failed') });

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={onNext} onBack={onBack} />);

    await waitFor(() => {
      expect(screen.getByText(/BizzyBee suggested these/i)).toBeInTheDocument();
    });

    const continueButton = await screen.findByRole('button', { name: /continue/i });
    await user.click(continueButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });

    // User advances regardless of edge-function error response.
    await waitFor(() => {
      expect(onNext).toHaveBeenCalled();
    });

    expect(toast.error).not.toHaveBeenCalledWith('Failed to save search terms');
  });

  it('does not block the UI for a slow invoke (fire-and-forget)', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onBack = vi.fn();

    // Simulate a slow invoke that never resolves during the test
    let resolveInvoke: ((value: unknown) => void) | undefined;
    mockInvoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        }),
    );

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={onNext} onBack={onBack} />);

    await waitFor(() => {
      expect(screen.getByText(/BizzyBee suggested these/i)).toBeInTheDocument();
    });

    const continueButton = await screen.findByRole('button', { name: /continue/i });
    await user.click(continueButton);

    // onNext should be called even though the invoke promise is still pending.
    await waitFor(() => {
      expect(onNext).toHaveBeenCalled();
    });

    // Clean up the pending promise to avoid an unhandled-rejection warning
    if (resolveInvoke) resolveInvoke({ data: { success: true }, error: null });
  });
});
