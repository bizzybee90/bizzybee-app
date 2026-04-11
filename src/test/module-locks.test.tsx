import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import AiPhone from '@/pages/AiPhone';
import KnowledgeBase from '@/pages/KnowledgeBase';
import AnalyticsDashboard from '@/pages/AnalyticsDashboard';
import { KnowledgeBasePanel } from '@/components/settings/KnowledgeBasePanel';
import { WorkspaceContext } from '@/contexts/workspace-context';
import type { Workspace } from '@/lib/types';
import type { WorkspaceEntitlements } from '@/lib/billing/entitlements';
import { resolvePersonaEntitlements } from './helpers/entitlementPersonas';

const supabaseState = vi.hoisted(() => ({
  from: vi.fn(),
}));

function createQueryBuilder(result: { data: unknown; error: unknown } = { data: [], error: null }) {
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

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: Parameters<typeof supabaseState.from>) => supabaseState.from(...args),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
    channel: vi.fn(() => ({
      on: vi.fn(() => ({
        subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
      })),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock('@/hooks/useAiPhoneConfig', () => ({
  useAiPhoneConfig: () => ({ config: null, isLoading: false }),
}));

vi.mock('@/components/ai-phone/StatsBar', () => ({
  StatsBar: () => <div data-testid="ai-phone-stats-bar" />,
}));

vi.mock('@/components/ai-phone/CallLogTable', () => ({
  CallLogTable: () => <div data-testid="ai-phone-call-log-table" />,
}));

vi.mock('@/components/ai-phone/OnboardingWizard', () => ({
  OnboardingWizard: () => <div data-testid="ai-phone-onboarding-wizard" />,
}));

vi.mock('@/components/ai-phone/PhoneSettingsForm', () => ({
  PhoneSettingsForm: () => <div data-testid="ai-phone-settings-form" />,
}));

vi.mock('@/components/ai-phone/KnowledgeBaseEditor', () => ({
  KnowledgeBaseEditor: () => <div data-testid="ai-phone-knowledge-editor" />,
}));

const createWorkspace = (): Workspace => ({
  id: 'workspace-123',
  name: 'Test Workspace',
  slug: 'test-workspace',
  timezone: 'Europe/London',
  business_hours_start: '09:00',
  business_hours_end: '17:00',
  business_days: [1, 2, 3, 4, 5],
  created_at: new Date('2026-04-11T09:00:00.000Z').toISOString(),
});

function renderWithWorkspace(
  ui: ReactElement,
  {
    workspace,
    entitlements,
  }: {
    workspace: Workspace | null;
    entitlements: WorkspaceEntitlements | null;
  },
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkspaceContext.Provider
          value={{
            workspace,
            loading: false,
            onboardingStep: null,
            onboardingComplete: Boolean(workspace),
            needsOnboarding: !workspace,
            entitlements,
            entitlementsLoading: false,
            refreshWorkspace: async () => undefined,
          }}
        >
          {ui}
        </WorkspaceContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('module route lock states', () => {
  beforeEach(() => {
    supabaseState.from.mockImplementation(() => createQueryBuilder());
  });

  it('shows a setup lock on the AI Phone route without a workspace', () => {
    renderWithWorkspace(<AiPhone />, { workspace: null, entitlements: null });

    expect(screen.getByText('Finish workspace setup first')).toBeInTheDocument();
  });

  it('shows a setup lock on the Knowledge Base route without a workspace', () => {
    renderWithWorkspace(<KnowledgeBase />, { workspace: null, entitlements: null });

    expect(screen.getByText('Finish workspace setup first')).toBeInTheDocument();
  });

  it('shows the paid-plan lock on the Knowledge Base route when the feature is unavailable', () => {
    renderWithWorkspace(<KnowledgeBase />, {
      workspace: createWorkspace(),
      entitlements: resolvePersonaEntitlements('connect', { rolloutMode: 'hard' }),
    });

    expect(screen.getByText('Knowledge Base is on paid AI plans')).toBeInTheDocument();
  });

  it('shows the paid-plan lock on the Analytics route when the plan does not include analytics', () => {
    renderWithWorkspace(<AnalyticsDashboard />, {
      workspace: createWorkspace(),
      entitlements: resolvePersonaEntitlements('starter', { rolloutMode: 'hard' }),
    });

    expect(screen.getByText('Analytics unlocks on Growth and above')).toBeInTheDocument();
  });

  it('shows the add-on lock on the AI Phone route when the add-on is unavailable', () => {
    renderWithWorkspace(<AiPhone />, {
      workspace: createWorkspace(),
      entitlements: resolvePersonaEntitlements('starter', { rolloutMode: 'hard' }),
    });

    expect(screen.getByText('AI Phone is an add-on')).toBeInTheDocument();
  });

  it('unlocks AI Phone when the starter persona has the AI Phone add-on', () => {
    renderWithWorkspace(<AiPhone />, {
      workspace: createWorkspace(),
      entitlements: resolvePersonaEntitlements('starter_ai_phone'),
    });

    expect(screen.queryByText('AI Phone is an add-on')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AI Phone' })).toBeInTheDocument();
  });

  it('keeps Knowledge Base non-blocking when entitlements are temporarily unavailable', () => {
    renderWithWorkspace(<KnowledgeBase />, {
      workspace: createWorkspace(),
      entitlements: null,
    });

    expect(screen.queryByText('Knowledge Base is on paid AI plans')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Knowledge Base' })).toBeInTheDocument();
  });

  it('shows a setup lock in the settings Knowledge Base panel without a workspace', () => {
    renderWithWorkspace(<KnowledgeBasePanel />, { workspace: null, entitlements: null });

    expect(screen.getByText('Finish workspace setup first')).toBeInTheDocument();
  });
});
