import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import AiPhone from '@/pages/AiPhone';
import KnowledgeBase from '@/pages/KnowledgeBase';
import { KnowledgeBasePanel } from '@/components/settings/KnowledgeBasePanel';
import { WorkspaceContext } from '@/contexts/workspace-context';
import type { Workspace } from '@/lib/types';
import type { WorkspaceEntitlements } from '@/lib/billing/entitlements';

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

const createEntitlements = (knowledgeBaseEnabled: boolean): WorkspaceEntitlements =>
  ({
    source: 'legacy_fallback',
    plan: 'starter',
    subscriptionStatus: 'active',
    addons: {
      whatsapp_routing: false,
      sms_routing: false,
      whatsapp_ai: false,
      sms_ai: false,
      ai_phone: false,
    },
    features: {
      unified_inbox: true,
      ai_inbox: true,
      instagram_dm: false,
      facebook_messenger: false,
      auto_categorisation: false,
      brand_rules: false,
      knowledge_base: knowledgeBaseEnabled,
      analytics: false,
      advanced_analytics: false,
      priority_support: false,
    },
    limits: {
      emailHistoryImportLimit: 90,
      includedSms: 0,
      includedPhoneMinutes: 0,
    },
    canUseAiInbox: true,
    canUseInstagramAi: false,
    canUseFacebookAi: false,
    canUseWhatsAppAi: false,
    canUseWhatsAppRouting: false,
    canUseSmsAi: false,
    canUseSmsRouting: false,
    canUseAiPhone: false,
  }) as WorkspaceEntitlements;

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
      entitlements: createEntitlements(false),
    });

    expect(screen.getByText('Knowledge Base is on paid AI plans')).toBeInTheDocument();
  });

  it('shows a setup lock in the settings Knowledge Base panel without a workspace', () => {
    renderWithWorkspace(<KnowledgeBasePanel />, { workspace: null, entitlements: null });

    expect(screen.getByText('Finish workspace setup first')).toBeInTheDocument();
  });
});
