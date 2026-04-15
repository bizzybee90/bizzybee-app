import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePersonaEntitlements } from './helpers/entitlementPersonas';
import { renderWithProviders } from './helpers/renderWithProviders';

const testState = vi.hoisted(() => ({
  workspace: {
    workspace: null as {
      id: string;
    } | null,
    loading: false,
    needsOnboarding: true,
    entitlements: null,
    entitlementsLoading: false,
    onboardingStep: null as string | null,
    onboardingComplete: false,
    refreshWorkspace: vi.fn(),
  },
  channelSetup: {
    loading: false,
    enabledChannelsByKey: {} as Record<string, boolean | undefined>,
    dashboardDefinitions: [] as Array<{ key: string }>,
    channelConnectionStates: new Map(),
    channelsNeedingSetup: [] as Array<{ key: string }>,
  },
  inboxCounts: {
    data: {
      inbox: 0,
      needsReply: 0,
      aiReview: 0,
      unread: 0,
    },
  },
  supabase: {
    channel: vi.fn(() => ({
      on: vi.fn(() => ({
        subscribe: vi.fn(() => ({
          unsubscribe: vi.fn(),
        })),
      })),
    })),
    removeChannel: vi.fn(),
    from: vi.fn(),
    auth: {
      getUser: vi.fn(),
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
    'in',
    'not',
    'or',
    'is',
    'gt',
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

vi.mock('@/hooks/useChannelSetup', () => ({
  useChannelSetup: () => testState.channelSetup,
}));

vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({
    role: 'admin',
    loading: false,
    isAdmin: true,
    isManager: true,
    isReviewer: true,
  }),
}));

vi.mock('@/hooks/useInboxEmails', () => ({
  useInboxCounts: () => testState.inboxCounts,
}));

vi.mock('@/components/sidebar/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock('@/components/layout/ThreeColumnLayout', () => ({
  ThreeColumnLayout: ({ main }: { main: ReactNode }) => <div>{main}</div>,
}));

vi.mock('@/components/layout/MobilePageLayout', () => ({
  MobilePageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/inbox/InboxSidebar', () => ({
  InboxSidebar: () => <div data-testid="inbox-sidebar" />,
}));

vi.mock('@/components/inbox/EmailList', () => ({
  EmailList: () => <div data-testid="email-list" />,
}));

vi.mock('@/components/inbox/ReadingPane', () => ({
  ReadingPane: () => <div data-testid="reading-pane" />,
}));

vi.mock('@/components/dashboard/ActivityFeed', () => ({
  ActivityFeed: () => <div data-testid="activity-feed" />,
}));

vi.mock('@/components/dashboard/DraftMessages', () => ({
  DraftMessages: () => <div data-testid="draft-messages" />,
}));

vi.mock('@/components/dashboard/HumanAIActivityLog', () => ({
  HumanAIActivityLog: () => <div data-testid="human-ai-activity-log" />,
}));

vi.mock('@/components/dashboard/LearningInsightsWidget', () => ({
  LearningInsightsWidget: () => <div data-testid="learning-insights-widget" />,
}));

vi.mock('@/components/dashboard/InsightsWidget', () => ({
  InsightsWidget: () => <div data-testid="insights-widget" />,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: testState.supabase,
}));

import Home from '@/pages/Home';
import Inbox from '@/pages/Inbox';
import ChannelsDashboard from '@/pages/ChannelsDashboard';
import Settings from '@/pages/Settings';
import KnowledgeBase from '@/pages/KnowledgeBase';
import AnalyticsDashboard from '@/pages/AnalyticsDashboard';
import AiPhone from '@/pages/AiPhone';
import Review from '@/pages/Review';

const resetState = () => {
  testState.workspace.workspace = null;
  testState.workspace.loading = false;
  testState.workspace.needsOnboarding = true;
  testState.workspace.entitlements = null;
  testState.workspace.entitlementsLoading = false;
  testState.workspace.onboardingStep = null;
  testState.workspace.onboardingComplete = false;
  testState.workspace.refreshWorkspace.mockReset();

  testState.channelSetup.loading = false;
  testState.channelSetup.enabledChannelsByKey = {};
  testState.channelSetup.dashboardDefinitions = [];
  testState.channelSetup.channelConnectionStates = new Map();
  testState.channelSetup.channelsNeedingSetup = [];

  testState.inboxCounts.data = {
    inbox: 0,
    needsReply: 0,
    aiReview: 0,
    unread: 0,
  };

  testState.supabase.channel.mockClear();
  testState.supabase.removeChannel.mockClear();
  testState.supabase.from.mockClear();
  testState.supabase.from.mockImplementation(() => createSupabaseQueryResult());
  testState.supabase.auth.getUser.mockClear();
  testState.supabase.auth.onAuthStateChange.mockClear();
};

describe('critical route smoke checks', () => {
  beforeEach(resetState);

  it('renders the home onboarding shell', async () => {
    renderWithProviders(<Home />);

    expect(await screen.findByText('Finish onboarding to unlock BizzyBee')).toBeInTheDocument();
    expect(screen.getByText('Continue onboarding')).toBeInTheDocument();
    expect(screen.getByTestId('draft-messages')).toBeInTheDocument();
    expect(screen.getByTestId('activity-feed')).toBeInTheDocument();
  });

  it('renders the inbox shell', () => {
    renderWithProviders(<Inbox />);

    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('email-list')).toBeInTheDocument();
    expect(screen.getByTestId('reading-pane')).toBeInTheDocument();
  });

  it('renders the channels onboarding notice', async () => {
    renderWithProviders(<ChannelsDashboard />);

    expect(await screen.findByText('Channels appear after workspace setup')).toBeInTheDocument();
  });

  it('renders the settings shell', () => {
    renderWithProviders(<Settings />);

    expect(screen.getAllByText('Workspace & Access').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Channels & Integrations').length).toBeGreaterThan(0);
  });

  it('renders the knowledge base lock state', () => {
    testState.workspace.workspace = { id: 'workspace-123' };
    testState.workspace.needsOnboarding = false;
    testState.workspace.onboardingComplete = true;
    testState.workspace.entitlements = resolvePersonaEntitlements('connect', {
      rolloutMode: 'hard',
    });

    renderWithProviders(<KnowledgeBase />);

    expect(screen.getByText('Knowledge Base is on paid AI plans')).toBeInTheDocument();
  });

  it('renders the analytics onboarding notice', async () => {
    renderWithProviders(<AnalyticsDashboard />);

    expect(await screen.findByText('Analytics will appear after setup')).toBeInTheDocument();
  });

  it('renders the AI Phone lock state', () => {
    testState.workspace.workspace = { id: 'workspace-123' };
    testState.workspace.needsOnboarding = false;
    testState.workspace.onboardingComplete = true;
    testState.workspace.entitlements = resolvePersonaEntitlements('starter', {
      rolloutMode: 'hard',
    });

    renderWithProviders(<AiPhone />);

    expect(screen.getByText('AI Phone is an add-on')).toBeInTheDocument();
  });

  it('renders the review onboarding notice', () => {
    renderWithProviders(<Review />);

    expect(screen.getByText('Finish setup before reviewing training')).toBeInTheDocument();
    expect(
      screen.getByText(
        'BizzyBee needs onboarding to be completed before the training queue can load. Finish setup first, then come back here to teach the AI.',
      ),
    ).toBeInTheDocument();
  });
});
