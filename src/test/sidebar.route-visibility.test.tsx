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
  testState.entitlements = resolvePersonaEntitlements(persona, { rolloutMode: 'shadow' });
  renderWithProviders(<Sidebar />);
}

function expectShadowPreview(label: string) {
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getAllByText('Shadow').length).toBeGreaterThan(0);
}

describe('sidebar route visibility by billing persona', () => {
  beforeEach(() => {
    testState.entitlements = null;
    testState.supabase.from.mockImplementation(() => createSupabaseQueryResult());
    testState.supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it('shows premium modules as shadow previews for connect', () => {
    renderSidebarForPersona('connect');

    expectShadowPreview('AI phone');
    expectShadowPreview('Analytics');
    expectShadowPreview('Knowledge base');
  });

  it('shows Knowledge Base on starter while keeping analytics and AI phone in shadow preview', () => {
    renderSidebarForPersona('starter');

    expect(screen.getByText('Knowledge base')).toBeInTheDocument();
    expectShadowPreview('Analytics');
    expectShadowPreview('AI phone');
  });

  it('shows analytics and knowledge base for growth while keeping AI phone in shadow preview', () => {
    renderSidebarForPersona('growth');

    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Knowledge base')).toBeInTheDocument();
    expectShadowPreview('AI phone');
  });

  it('shows analytics and knowledge base for pro while keeping AI phone in shadow preview', () => {
    renderSidebarForPersona('pro');

    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Knowledge base')).toBeInTheDocument();
    expectShadowPreview('AI phone');
  });

  it('shows AI phone when starter includes the AI phone add-on', () => {
    renderSidebarForPersona('starter_ai_phone');

    expect(screen.getByText('AI phone')).toBeInTheDocument();
  });

  it('keeps starter plus sms_ai route visibility stable with analytics and AI phone in shadow preview', () => {
    renderSidebarForPersona('starter_sms_ai');

    expect(screen.getByText('Knowledge base')).toBeInTheDocument();
    expectShadowPreview('Analytics');
    expectShadowPreview('AI phone');
  });

  it('keeps connect plus sms_routing premium modules visible as shadow previews', () => {
    renderSidebarForPersona('connect_sms_routing');

    expectShadowPreview('AI phone');
    expectShadowPreview('Analytics');
    expectShadowPreview('Knowledge base');
  });
});
