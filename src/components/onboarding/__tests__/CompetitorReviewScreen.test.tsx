import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompetitorReviewScreen } from '../CompetitorReviewScreen';

type CompetitorFixture = {
  id: string;
  business_name: string | null;
  domain: string;
  url: string;
  rating: number | null;
  reviews_count: number | null;
  is_selected: boolean;
  discovery_source: string | null;
  location_data: unknown;
  distance_miles: number | null;
  match_reason: string | null;
  validation_status: string | null;
  relevance_score: number | null;
};

const makeCompetitor = (
  index: number,
  overrides: Partial<CompetitorFixture> = {},
): CompetitorFixture => ({
  id: `competitor-${index}`,
  business_name: `Business ${index}`,
  domain: `business${index}.example`,
  url: `https://business${index}.example`,
  rating: 4.5,
  reviews_count: 50,
  is_selected: false,
  discovery_source: 'google_search',
  location_data: null,
  distance_miles: index,
  match_reason: 'Local business',
  validation_status: 'valid',
  relevance_score: 80,
  ...overrides,
});

const {
  mockFrom,
  mockInvoke,
  mockToast,
  mockListOnboardingCompetitors,
  mockBulkSetOnboardingCompetitorSelection,
  mockToggleOnboardingCompetitorSelection,
} = vi.hoisted(() => {
  const competitorJobsQuery = {
    eq: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: { search_queries: ['window cleaner luton', 'residential window cleaning'] },
        error: null,
      }),
    }),
  };

  return {
    mockFrom: vi.fn((table: string) => {
      if (table === 'competitor_research_jobs') {
        return {
          select: vi.fn(() => competitorJobsQuery),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    mockListOnboardingCompetitors: vi.fn(),
    mockInvoke: vi.fn(),
    mockToast: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
    mockBulkSetOnboardingCompetitorSelection: vi.fn().mockResolvedValue(undefined),
    mockToggleOnboardingCompetitorSelection: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: mockFrom,
    functions: {
      invoke: mockInvoke,
    },
  },
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@/lib/onboarding/competitors', () => ({
  listOnboardingCompetitors: mockListOnboardingCompetitors,
  toggleOnboardingCompetitorSelection: mockToggleOnboardingCompetitorSelection,
  bulkSetOnboardingCompetitorSelection: mockBulkSetOnboardingCompetitorSelection,
  deleteOnboardingCompetitor: vi.fn(),
}));

describe('CompetitorReviewScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({
      data: { success: true, sitesCount: 1 },
      error: null,
    });
    mockListOnboardingCompetitors.mockResolvedValue({
      competitors: [
        makeCompetitor(1, { business_name: 'Alpha Cleaners', is_selected: true }),
        makeCompetitor(2, { business_name: 'Beta Cleaners' }),
      ],
      selected_count: 1,
      job_id: 'job-1',
    });
  });

  it('starts the FAQ generation runner with the selected competitor ids', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <CompetitorReviewScreen
        workspaceId="ws-1"
        jobId="job-1"
        nicheQuery="window cleaning"
        serviceArea="Luton"
        targetCount={3}
        onConfirm={onConfirm}
        onBack={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm & start analysis/i })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: /confirm & start analysis/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start-faq-generation', {
        body: {
          workspace_id: 'ws-1',
          selected_competitor_ids: ['competitor-1'],
          target_count: 3,
          trigger_source: 'onboarding_competitor_review',
        },
      });
    });

    expect(onConfirm).toHaveBeenCalledWith(1);
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  describe('soft 5-10 recommendation (no hard cap)', () => {
    const renderWith = (competitors: CompetitorFixture[], targetCount = 10) => {
      mockListOnboardingCompetitors.mockResolvedValueOnce({
        competitors,
        selected_count: competitors.filter((c) => c.is_selected).length,
        job_id: 'job-1',
      });
      return render(
        <CompetitorReviewScreen
          workspaceId="ws-1"
          jobId="job-1"
          nicheQuery="window cleaning"
          serviceArea="Luton"
          targetCount={targetCount}
          onConfirm={vi.fn()}
          onBack={vi.fn()}
          onSkip={vi.fn()}
        />,
      );
    };

    it('renders the 5-10 recommendation copy and source-of-truth reminder', async () => {
      const competitors = Array.from({ length: 15 }, (_, i) => makeCompetitor(i + 1));
      renderWith(competitors);

      await waitFor(() => {
        expect(screen.getByText(/We recommend picking 5.?10 competitors/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/source of truth/i)).toBeInTheDocument();
    });

    it('selection counter shows "{N} of {M} selected" reflecting total found, not targetCount', async () => {
      const competitors = Array.from({ length: 15 }, (_, i) => makeCompetitor(i + 1));
      const user = userEvent.setup();
      renderWith(competitors, 10);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Review Competitors/i })).toBeInTheDocument();
      });

      // Initial: none pre-selected — should read "0 of 15 selected"
      const header = screen.getByRole('heading', { name: /Review Competitors/i }).parentElement!;
      expect(header).toHaveTextContent(/0\s*of\s*15\s*selected/i);

      // Click the first checkbox
      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[0]);

      await waitFor(() => {
        expect(header).toHaveTextContent(/1\s*of\s*15\s*selected/i);
      });
    });

    it('does NOT block Continue when more than the recommendation threshold are selected', async () => {
      const competitors = Array.from({ length: 15 }, (_, i) =>
        makeCompetitor(i + 1, { is_selected: true }),
      );
      renderWith(competitors, 10);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm & start analysis/i })).toBeEnabled();
      });
      // Button label reflects full selection count, not a capped value
      expect(screen.getByRole('button', { name: /confirm & start analysis.*15/i })).toBeEnabled();
    });

    it('surfaces a gentle heads-up note when 11+ selected', async () => {
      const competitors = Array.from({ length: 15 }, (_, i) =>
        makeCompetitor(i + 1, { is_selected: i < 12 }),
      );
      renderWith(competitors, 10);

      const headsUp = await screen.findByText(/more than 10/i);
      expect(headsUp).toBeInTheDocument();
      // Neutral tint — no destructive/red coloring
      const headsUpClassName = headsUp.className;
      expect(headsUpClassName).not.toMatch(/destructive|text-red|bg-red/);
    });

    it('Select All picks every non-selected filtered competitor (no targetCount gating)', async () => {
      const competitors = Array.from({ length: 20 }, (_, i) =>
        makeCompetitor(i + 1, { is_selected: i < 3 }),
      );
      const user = userEvent.setup();
      renderWith(competitors, 10);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /select all/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /select all/i }));

      // The 17 currently unselected competitors should all be bulk-toggled on
      await waitFor(() => {
        expect(mockBulkSetOnboardingCompetitorSelection).toHaveBeenCalledTimes(1);
      });
      const [, ids, value] = mockBulkSetOnboardingCompetitorSelection.mock.calls[0];
      expect(value).toBe(true);
      expect(ids).toHaveLength(17);
      // And state reflects all 20 now selected
      const header = screen.getByRole('heading', { name: /Review Competitors/i }).parentElement!;
      await waitFor(() => {
        expect(header).toHaveTextContent(/20\s*of\s*20\s*selected/i);
      });
    });
  });
});
