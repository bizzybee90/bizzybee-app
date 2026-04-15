import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompetitorReviewScreen } from '../CompetitorReviewScreen';

const { mockFrom, mockInvoke, mockToast, mockListOnboardingCompetitors } = vi.hoisted(() => {
  const competitors = [
    {
      id: 'competitor-1',
      business_name: 'Alpha Cleaners',
      domain: 'alphacleaners.example',
      url: 'https://alphacleaners.example',
      rating: 4.9,
      reviews_count: 120,
      is_selected: true,
      discovery_source: 'google_search',
      location_data: null,
      distance_miles: 1.2,
      match_reason: 'closest match',
      validation_status: 'valid',
      relevance_score: 95,
    },
    {
      id: 'competitor-2',
      business_name: 'Beta Cleaners',
      domain: 'betacleaners.example',
      url: 'https://betacleaners.example',
      rating: 4.7,
      reviews_count: 88,
      is_selected: false,
      discovery_source: 'google_search',
      location_data: null,
      distance_miles: 2.4,
      match_reason: 'adjacent match',
      validation_status: 'valid',
      relevance_score: 90,
    },
  ];

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
    mockListOnboardingCompetitors: vi.fn().mockResolvedValue({
      competitors,
      selected_count: 1,
      job_id: 'job-1',
    }),
    mockInvoke: vi.fn(),
    mockToast: {
      success: vi.fn(),
      error: vi.fn(),
    },
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
  toggleOnboardingCompetitorSelection: vi.fn(),
  bulkSetOnboardingCompetitorSelection: vi.fn(),
  deleteOnboardingCompetitor: vi.fn(),
}));

describe('CompetitorReviewScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({
      data: { success: true, sitesCount: 1 },
      error: null,
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
});
