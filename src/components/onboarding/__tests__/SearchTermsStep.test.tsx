import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { SearchTermsStep } from '../SearchTermsStep';

// Mock Supabase client — use vi.hoisted so mocks are available at mock-hoist time
const { mockMaybeSingle, mockInvoke, mockRpc } = vi.hoisted(() => ({
  mockMaybeSingle: vi.fn(),
  mockInvoke: vi.fn(),
  mockRpc: vi.fn(),
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
    rpc: (name: string, args: unknown) => mockRpc(name, args),
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
    // Default: trigger invoke succeeds. The `get-nearby-towns` edge
    // function (added 2026-04-17 to curate Places-derived town lists)
    // is explicitly returned as empty so tests fall through to the RPC
    // path, which is what these test fixtures were originally written
    // against. Individual tests can override for Places-path coverage.
    mockInvoke.mockImplementation(async (name: string) => {
      if (name === 'get-nearby-towns') {
        return { data: { towns: [] }, error: null };
      }
      return { data: { success: true }, error: null };
    });
    // Default: expand_search_queries RPC returns the enabled terms unchanged
    // (radius=0 when the service_area has no parenthetical miles value).
    mockRpc.mockResolvedValue({
      data: {
        queries: [
          'window cleaning luton',
          'window cleaner luton',
          'gutter cleaning luton',
          'best rated window cleaners luton',
          'commercial window cleaning luton',
        ],
        towns_used: ['Luton'],
        primary_coverage: [
          'window cleaning',
          'window cleaner',
          'gutter cleaning',
          'best rated window cleaners',
          'commercial window cleaning',
        ],
        expanded_coverage: [],
      },
      error: null,
    });
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
          towns_used: expect.any(Array),
          target_count: 25,
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
          towns_used: expect.any(Array),
          target_count: 25,
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

describe('SearchTermsStep — radius expansion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });
  });

  it('calls expand_search_queries with parsed service_area (town + radius)', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        company_name: 'Test Co',
        business_type: 'window_cleaning',
        service_area: 'Luton (20 miles)',
        website_url: 'https://example.com',
      },
      error: null,
    });
    mockRpc.mockResolvedValue({
      data: {
        queries: ['window cleaning luton', 'window cleaning dunstable'],
        towns_used: ['Luton', 'Dunstable'],
        primary_coverage: ['window cleaning'],
        expanded_coverage: ['window cleaning'],
      },
      error: null,
    });

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={vi.fn()} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        'expand_search_queries',
        expect.objectContaining({
          p_primary_town: 'Luton',
          p_radius_miles: 20,
          p_terms_per_nearby_town: 3,
          p_max_queries: 120,
          p_max_nearby_towns: 20,
        }),
      );
    });
  });

  it('renders the chip row when the RPC resolves multiple towns', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        company_name: 'Test Co',
        business_type: 'window_cleaning',
        service_area: 'Luton (20 miles)',
        website_url: 'https://example.com',
      },
      error: null,
    });
    mockRpc.mockResolvedValue({
      data: {
        queries: [
          'window cleaning luton',
          'window cleaning dunstable',
          'window cleaning harpenden',
        ],
        towns_used: ['Luton', 'Dunstable', 'Harpenden'],
        primary_coverage: ['window cleaning'],
        expanded_coverage: ['window cleaning'],
      },
      error: null,
    });

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={vi.fn()} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Searching in 3 towns within 20 miles/)).toBeInTheDocument();
    });
    expect(screen.getByText(/3 queries will fire/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Luton.*primary/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Dunstable$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Harpenden$/ })).toBeInTheDocument();
  });

  it('excluding a town removes its queries from the payload', async () => {
    const user = userEvent.setup();
    mockMaybeSingle.mockResolvedValue({
      data: {
        company_name: 'Test Co',
        business_type: 'window_cleaning',
        service_area: 'Luton (20 miles)',
        website_url: 'https://example.com',
      },
      error: null,
    });
    mockRpc.mockResolvedValue({
      data: {
        queries: [
          'window cleaning luton',
          'window cleaning dunstable',
          'window cleaning harpenden',
        ],
        towns_used: ['Luton', 'Dunstable', 'Harpenden'],
        primary_coverage: ['window cleaning'],
        expanded_coverage: ['window cleaning'],
      },
      error: null,
    });

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={vi.fn()} onBack={vi.fn()} />);

    const dunstableChip = await screen.findByRole('button', { name: /^Dunstable$/ });
    await user.click(dunstableChip);

    const continueButton = await screen.findByRole('button', { name: /continue/i });
    await user.click(continueButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start-onboarding-discovery', {
        body: expect.objectContaining({
          search_queries: expect.arrayContaining([
            'window cleaning luton',
            'window cleaning harpenden',
          ]),
        }),
      });
    });

    const invokeBody = mockInvoke.mock.calls.find((c) => c[0] === 'start-onboarding-discovery')![1]
      .body as { search_queries: string[] };
    expect(invokeBody.search_queries).not.toContain('window cleaning dunstable');
  });

  it('clicking the primary chip does not change the exclusion set', async () => {
    const user = userEvent.setup();
    mockMaybeSingle.mockResolvedValue({
      data: {
        company_name: 'Test Co',
        business_type: 'window_cleaning',
        service_area: 'Luton (20 miles)',
        website_url: 'https://example.com',
      },
      error: null,
    });
    mockRpc.mockResolvedValue({
      data: {
        queries: ['window cleaning luton', 'window cleaning dunstable'],
        towns_used: ['Luton', 'Dunstable'],
        primary_coverage: ['window cleaning'],
        expanded_coverage: ['window cleaning'],
      },
      error: null,
    });

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={vi.fn()} onBack={vi.fn()} />);

    const primaryChip = await screen.findByRole('button', { name: /Luton.*primary/i });
    expect(primaryChip).toBeDisabled();
    // Simulate clicking anyway — disabled button won't fire onClick, but
    // double-check that the payload still includes the primary queries.
    await user.click(primaryChip).catch(() => {
      /* disabled button click rejects in some setups */
    });

    const continueButton = await screen.findByRole('button', { name: /continue/i });
    await user.click(continueButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });
    const invokeBody = mockInvoke.mock.calls.find((c) => c[0] === 'start-onboarding-discovery')![1]
      .body as { search_queries: string[] };
    expect(invokeBody.search_queries).toContain('window cleaning luton');
  });

  it('falls back to enabledTerms when the RPC returns an error', async () => {
    const user = userEvent.setup();
    mockMaybeSingle.mockResolvedValue({
      data: {
        company_name: 'Test Co',
        business_type: 'window_cleaning',
        service_area: 'Luton (20 miles)',
        website_url: 'https://example.com',
      },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: null, error: new Error('boom') });

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={vi.fn()} onBack={vi.fn()} />);

    // No chip row when the RPC errors (fallback state has 1 town = primary).
    await waitFor(() => {
      expect(screen.getByText(/BizzyBee suggested these/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Searching in \d+ towns/)).not.toBeInTheDocument();

    const continueButton = await screen.findByRole('button', { name: /continue/i });
    await user.click(continueButton);

    // Payload still fires with the original enabled terms (fallback).
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start-onboarding-discovery', {
        body: expect.objectContaining({
          search_queries: expect.any(Array),
        }),
      });
    });
    const invokeBody = mockInvoke.mock.calls.find((c) => c[0] === 'start-onboarding-discovery')![1]
      .body as { search_queries: string[] };
    expect(invokeBody.search_queries.length).toBeGreaterThan(0);
  });

  it('attributes queries to the LONGEST matching town when towns share a suffix prefix', async () => {
    // Regression guard for the "Hemel / Hemel Hempstead" overlap bug:
    // without length-desc sort, excluding "Hemel" would strip the
    // "Hemel Hempstead" query too (or vice-versa, depending on
    // townsUsed order). This test pins the longest-first match.
    const user = userEvent.setup();
    mockMaybeSingle.mockResolvedValue({
      data: {
        company_name: 'Test Co',
        business_type: 'plumbing',
        service_area: 'Luton (20 miles)',
        website_url: 'https://example.com',
      },
      error: null,
    });
    // Deliberately put 'Hemel' BEFORE 'Hemel Hempstead' in towns_used
    // to surface a regression if someone removes the length-desc sort.
    mockRpc.mockResolvedValue({
      data: {
        queries: ['plumber luton', 'plumber hemel', 'plumber hemel hempstead'],
        towns_used: ['Luton', 'Hemel', 'Hemel Hempstead'],
        primary_coverage: ['plumber'],
        expanded_coverage: ['plumber'],
      },
      error: null,
    });

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={vi.fn()} onBack={vi.fn()} />);

    // Exclude the SHORT town. The long-town query must survive.
    const hemelChip = await screen.findByRole('button', { name: /^Hemel$/ });
    await user.click(hemelChip);

    const continueButton = await screen.findByRole('button', { name: /continue/i });
    await user.click(continueButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });
    const invokeBody = mockInvoke.mock.calls.find((c) => c[0] === 'start-onboarding-discovery')![1]
      .body as { search_queries: string[] };
    expect(invokeBody.search_queries).toContain('plumber hemel hempstead');
    expect(invokeBody.search_queries).not.toContain('plumber hemel');
    expect(invokeBody.search_queries).toContain('plumber luton');
  });
});
