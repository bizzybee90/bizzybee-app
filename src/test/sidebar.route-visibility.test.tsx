import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '@/components/sidebar/Sidebar';
import type { WorkspaceEntitlements } from '@/lib/billing/entitlements';
import type { BillingPersonaKey } from './helpers/entitlementPersonas';
import { resolvePersonaEntitlements } from './helpers/entitlementPersonas';
import { renderWithProviders } from './helpers/renderWithProviders';

const testState = vi.hoisted(() => ({
  entitlements: null as WorkspaceEntitlements | null,
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
  useWorkspace: () => ({
    workspace: {
      id: 'workspace-123',
      name: 'BizzyBee QA Workspace',
    },
    loading: false,
    needsOnboarding: false,
    entitlements: testState.entitlements,
    entitlementsLoading: false,
    onboardingStep: 'complete',
    onboardingComplete: true,
    refreshWorkspace: vi.fn(),
  }),
}));

vi.mock('@/lib/previewMode', () => ({
  isPreviewModeEnabled: () => false,
}));

vi.mock('@/components/sidebar/EmailImportIndicator', () => ({
  EmailImportIndicator: () => <div data-testid="email-import-indicator" />,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: Parameters<typeof testState.supabase.from>) => testState.supabase.from(...args),
    auth: testState.supabase.auth,
  },
}));

function renderSidebarForPersona(persona: BillingPersonaKey) {
  testState.entitlements = resolvePersonaEntitlements(persona);
  renderWithProviders(<Sidebar />);
}

describe('sidebar route visibility by billing persona', () => {
  beforeEach(() => {
    testState.entitlements = null;
    testState.supabase.from.mockImplementation(() => createSupabaseQueryResult());
    testState.supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it('hides AI phone, analytics, and knowledge base routes for connect', () => {
    renderSidebarForPersona('connect');

    expect(screen.queryByText('AI phone')).not.toBeInTheDocument();
    expect(screen.queryByText('Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('Knowledge base')).not.toBeInTheDocument();
  });

  it('shows Knowledge Base on starter while keeping analytics and AI phone hidden', () => {
    renderSidebarForPersona('starter');

    expect(screen.getByText('Knowledge base')).toBeInTheDocument();
    expect(screen.queryByText('Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('AI phone')).not.toBeInTheDocument();
  });

  it('shows analytics and knowledge base for growth', () => {
    renderSidebarForPersona('growth');

    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Knowledge base')).toBeInTheDocument();
    expect(screen.queryByText('AI phone')).not.toBeInTheDocument();
  });

  it('shows analytics and knowledge base for pro', () => {
    renderSidebarForPersona('pro');

    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Knowledge base')).toBeInTheDocument();
    expect(screen.queryByText('AI phone')).not.toBeInTheDocument();
  });

  it('shows AI phone when starter includes the AI phone add-on', () => {
    renderSidebarForPersona('starter_ai_phone');

    expect(screen.getByText('AI phone')).toBeInTheDocument();
  });

  it('keeps route visibility stable for starter plus sms_ai add-on', () => {
    renderSidebarForPersona('starter_sms_ai');

    expect(screen.getByText('Knowledge base')).toBeInTheDocument();
    expect(screen.queryByText('Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('AI phone')).not.toBeInTheDocument();
  });

  it('keeps connect plus sms_routing as routing-only without premium module routes', () => {
    renderSidebarForPersona('connect_sms_routing');

    expect(screen.queryByText('AI phone')).not.toBeInTheDocument();
    expect(screen.queryByText('Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('Knowledge base')).not.toBeInTheDocument();
  });
});
