import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  disablePreviewMode: vi.fn(),
  enablePreviewMode: vi.fn(),
  isLocalhost: () => false,
  readOnboardingHandoff: vi.fn(() => null),
}));

describe('Auth', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockToast.mockReset();
    mockWorkspaceState.workspace = null;
    mockWorkspaceState.loading = false;
    mockWorkspaceState.needsOnboarding = true;
    mockSupabase.auth.getSession.mockReset();
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
    });
    mockSupabase.auth.onAuthStateChange.mockReset();
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mockSupabase.auth.signInWithPassword.mockReset();
    mockSupabase.auth.signUp.mockReset();
    mockSupabase.auth.signInWithOtp.mockReset();
    mockSupabase.auth.resetPasswordForEmail.mockReset();
    mockSupabase.auth.updateUser.mockReset();
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

  it('frames auth as the start of onboarding', async () => {
    render(<Auth />);

    expect(screen.getByText('Step 0 of onboarding')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome back to BizzyBee' })).toBeInTheDocument();
    expect(screen.getByText('Start with your website')).toBeInTheDocument();
  });

  it('shows a friendlier message when the signup email already exists', async () => {
    mockSupabase.auth.signUp.mockResolvedValueOnce({
      error: new Error('User already registered'),
    });

    render(<Auth />);

    fireEvent.click(screen.getByRole('button', { name: /^sign up$/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Michael' } });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'michael@maccleaning.uk' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'supersecure123' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Workspace already exists',
          description:
            'That email already has a BizzyBee account. Sign in instead, or send yourself a magic link to carry on.',
          variant: 'destructive',
        }),
      );
    });
  });

  it('shows a friendlier message when magic link emails are rate limited', async () => {
    mockSupabase.auth.signInWithOtp.mockResolvedValueOnce({
      error: new Error('email rate limit exceeded'),
    });

    render(<Auth />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'michael@maccleaning.uk' },
    });

    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Too many emails sent',
          description:
            'We already sent one recently. Give it a minute, then try again for a fresh BizzyBee link.',
          variant: 'destructive',
        }),
      );
    });
  });
});
