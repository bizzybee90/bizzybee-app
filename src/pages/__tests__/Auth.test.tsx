import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Auth from '../Auth';

const { mockNavigate, mockWorkspaceState, mockSupabase, mockToast } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockToast: vi.fn(),
  mockWorkspaceState: {
    workspace: null,
    loading: false,
    needsOnboarding: true,
    onboardingStep: null,
    onboardingComplete: false,
    entitlements: null,
    entitlementsLoading: false,
    refreshWorkspace: vi.fn(),
  },
  mockSupabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInWithOtp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
    },
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');

  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/useWorkspace', () => ({
  useWorkspace: () => mockWorkspaceState,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/integrations/lovable/index', () => ({
  lovable: {
    auth: {
      signInWithOAuth: vi.fn(),
    },
  },
}));

vi.mock('@/components/branding/BizzyBeeLogo', () => ({
  BizzyBeeLogo: () => <div>BizzyBee</div>,
}));

vi.mock('@/lib/previewMode', () => ({
  enablePreviewMode: vi.fn(),
  isLocalhost: () => false,
}));

describe('Auth', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockToast.mockReset();
    mockWorkspaceState.workspace = null;
    mockWorkspaceState.loading = false;
    mockWorkspaceState.needsOnboarding = true;
    mockSupabase.auth.getSession.mockReset();
    mockSupabase.auth.onAuthStateChange.mockReset();
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    window.history.replaceState({}, '', '/auth');
  });

  it('sends signed-in users without a ready workspace straight to onboarding', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    render(<Auth />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding', { replace: true });
    });
  });

  it('sends signed-in users with a ready workspace home', async () => {
    mockWorkspaceState.workspace = { id: 'ws-1' };
    mockWorkspaceState.needsOnboarding = false;
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    render(<Auth />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });
});
