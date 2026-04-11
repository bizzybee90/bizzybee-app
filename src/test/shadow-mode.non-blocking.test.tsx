import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KnowledgeBase from '@/pages/KnowledgeBase';
import AnalyticsDashboard from '@/pages/AnalyticsDashboard';
import AiPhone from '@/pages/AiPhone';
import { renderWithProviders } from './helpers/renderWithProviders';

const testState = vi.hoisted(() => ({
  workspace: {
    workspace: {
      id: 'workspace-123',
      name: 'BizzyBee QA Workspace',
      slug: 'bizzybee-qa-workspace',
      timezone: 'Europe/London',
      business_hours_start: '09:00',
      business_hours_end: '17:00',
      business_days: [1, 2, 3, 4, 5],
      created_at: new Date('2026-04-11T09:00:00.000Z').toISOString(),
    },
    loading: false,
    needsOnboarding: false,
    entitlements: null,
    entitlementsLoading: true,
    onboardingStep: 'complete',
    onboardingComplete: true,
    refreshWorkspace: vi.fn(),
  },
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

function createSupabaseQueryResult(
  result: { data: unknown; error: unknown } = { data: [], error: null },
) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'gte',
    'lte',
    'order',
    'limit',
    'single',
    'maybeSingle',
  ];

  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  chain.then = vi.fn().mockImplementation((resolve) => Promise.resolve(resolve(result)));
  return chain;
}

vi.mock('@/hooks/useWorkspace', () => ({
  useWorkspace: () => testState.workspace,
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/hooks/useAiPhoneConfig', () => ({
  useAiPhoneConfig: () => ({ config: null, isLoading: false }),
}));

vi.mock('@/components/ai-phone/StatsBar', () => ({
  StatsBar: () => <div data-testid="shadow-ai-phone-stats" />,
}));

vi.mock('@/components/ai-phone/CallLogTable', () => ({
  CallLogTable: () => <div data-testid="shadow-ai-phone-call-log" />,
}));

vi.mock('@/components/ai-phone/OnboardingWizard', () => ({
  OnboardingWizard: () => <div data-testid="shadow-ai-phone-onboarding" />,
}));

vi.mock('@/components/ai-phone/PhoneSettingsForm', () => ({
  PhoneSettingsForm: () => <div data-testid="shadow-ai-phone-settings-form" />,
}));

vi.mock('@/components/ai-phone/KnowledgeBaseEditor', () => ({
  KnowledgeBaseEditor: () => <div data-testid="shadow-ai-phone-kb-editor" />,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: Parameters<typeof testState.supabase.from>) => testState.supabase.from(...args),
    auth: testState.supabase.auth,
  },
}));

describe('shadow-mode non-blocking route behaviour', () => {
  beforeEach(() => {
    testState.workspace.entitlements = null;
    testState.workspace.entitlementsLoading = true;
    testState.supabase.from.mockImplementation(() => createSupabaseQueryResult());
  });

  it('does not lock the Knowledge Base route when entitlements are unavailable', async () => {
    renderWithProviders(<KnowledgeBase />);

    expect(screen.queryByText('Knowledge Base is on paid AI plans')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Knowledge Base' })).toBeInTheDocument();
  });

  it('does not lock the Analytics route when entitlements are unavailable', async () => {
    testState.supabase.from.mockImplementation(() =>
      createSupabaseQueryResult({ data: null, error: { message: 'temporary analytics failure' } }),
    );

    renderWithProviders(<AnalyticsDashboard />);

    expect(screen.queryByText('Analytics unlocks on Growth and above')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Analytics Dashboard' })).toBeInTheDocument();
  });

  it('does not lock AI Phone when entitlements are unavailable', () => {
    renderWithProviders(<AiPhone />);

    expect(screen.queryByText('AI Phone is an add-on')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AI Phone' })).toBeInTheDocument();
  });
});
