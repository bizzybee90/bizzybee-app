import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImapConnectionModal } from '../ImapConnectionModal';

const mocks = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockLookupProvider: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: mocks.mockInvoke },
  },
}));

vi.mock('@/lib/email/providerPresets', () => ({
  lookupProvider: mocks.mockLookupProvider,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const iCloudPreset = {
  name: 'iCloud Mail',
  host: 'imap.mail.me.com',
  port: 993,
  secure: true,
  requiresAppPassword: 'always' as const,
  appPasswordHelpUrl: 'https://appleid.apple.com/account/manage/section/security',
  passwordFormatHint: 'Apple app passwords are 16 characters with dashes',
  instructions: [
    'Visit appleid.apple.com',
    'Go to Sign-In and Security → App-Specific Passwords',
    'Click + and label it BizzyBee',
    'Copy and paste the generated password',
  ],
};

describe('ImapConnectionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockLookupProvider.mockResolvedValue(null);
    mocks.mockInvoke.mockResolvedValue({
      data: { success: true, email: 'user@example.com' },
      error: null,
    });
  });

  it('renders the email and password fields when open', () => {
    render(
      <ImapConnectionModal
        open={true}
        workspaceId="ws-1"
        provider="imap"
        importMode="last_1000"
        onClose={vi.fn()}
        onConnected={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('auto-detects iCloud when email has @icloud.com', async () => {
    const user = userEvent.setup();
    mocks.mockLookupProvider.mockResolvedValue(iCloudPreset);

    render(
      <ImapConnectionModal
        open={true}
        workspaceId="ws-1"
        provider="imap"
        importMode="last_1000"
        onClose={vi.fn()}
        onConnected={vi.fn()}
      />,
    );

    const emailInput = screen.getByLabelText(/email address/i);
    await user.type(emailInput, 'sarah@icloud.com');
    await user.tab(); // blur triggers detection

    await waitFor(() => {
      expect(mocks.mockLookupProvider).toHaveBeenCalledWith('sarah@icloud.com');
    });

    await waitFor(() => {
      expect(screen.getByText(/detected: icloud mail/i)).toBeInTheDocument();
    });
  });

  it('shows app-password warning when preset requires it', async () => {
    const user = userEvent.setup();
    mocks.mockLookupProvider.mockResolvedValue(iCloudPreset);

    render(
      <ImapConnectionModal
        open={true}
        workspaceId="ws-1"
        provider="imap"
        importMode="last_1000"
        onClose={vi.fn()}
        onConnected={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/email address/i), 'sarah@icloud.com');
    await user.tab();

    await waitFor(() => {
      // The "App-specific password" label appears AND the warning text
      expect(screen.getByText(/needs an app-specific password/i)).toBeInTheDocument();
      expect(screen.getByText(/regular.*password won't work/i)).toBeInTheDocument();
    });
  });

  it('submits to edge function with correct body on connect', async () => {
    const user = userEvent.setup();
    const onConnected = vi.fn();
    mocks.mockLookupProvider.mockResolvedValue(iCloudPreset);

    render(
      <ImapConnectionModal
        open={true}
        workspaceId="ws-1"
        provider="icloud"
        importMode="last_1000"
        onClose={vi.fn()}
        onConnected={onConnected}
      />,
    );

    await user.type(screen.getByLabelText(/email address/i), 'sarah@icloud.com');
    await user.tab();
    await waitFor(() => {
      expect(screen.getByText(/detected: icloud mail/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/password/i), 'xxxx-xxxx-xxxx-xxxx');
    await user.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => {
      expect(mocks.mockInvoke).toHaveBeenCalledWith('aurinko-create-imap-account', {
        body: {
          workspaceId: 'ws-1',
          email: 'sarah@icloud.com',
          password: 'xxxx-xxxx-xxxx-xxxx',
          host: 'imap.mail.me.com',
          port: 993,
          secure: true,
          importMode: 'last_1000',
        },
      });
    });

    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledWith('sarah@icloud.com');
    });
  });

  it('shows auth-failed error with app-password guidance', async () => {
    const user = userEvent.setup();
    mocks.mockLookupProvider.mockResolvedValue(iCloudPreset);
    mocks.mockInvoke.mockResolvedValue({
      data: {
        success: false,
        error: 'AUTHENTICATION_FAILED',
        message: 'Email or password is incorrect',
        providerHint: 'icloud',
        requiresAppPassword: 'always',
      },
      error: null,
    });

    const onConnected = vi.fn();
    render(
      <ImapConnectionModal
        open={true}
        workspaceId="ws-1"
        provider="icloud"
        importMode="last_1000"
        onClose={vi.fn()}
        onConnected={onConnected}
      />,
    );

    await user.type(screen.getByLabelText(/email address/i), 'sarah@icloud.com');
    await user.tab();
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => {
      expect(screen.getByText(/iCloud.*requires an app-specific password/i)).toBeInTheDocument();
    });
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('shows manual advanced settings when detection fails', async () => {
    const user = userEvent.setup();
    mocks.mockLookupProvider.mockResolvedValue(null);

    render(
      <ImapConnectionModal
        open={true}
        workspaceId="ws-1"
        provider="imap"
        importMode="last_1000"
        onClose={vi.fn()}
        onConnected={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/email address/i), 'user@custom.invalid');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByLabelText(/imap server/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/port/i)).toBeInTheDocument();
    });
  });

  it('shows "Show me how" instructions inline', async () => {
    const user = userEvent.setup();
    mocks.mockLookupProvider.mockResolvedValue(iCloudPreset);

    render(
      <ImapConnectionModal
        open={true}
        workspaceId="ws-1"
        provider="icloud"
        importMode="last_1000"
        onClose={vi.fn()}
        onConnected={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/email address/i), 'sarah@icloud.com');
    await user.tab();
    await waitFor(() => {
      expect(screen.getByText(/detected: icloud mail/i)).toBeInTheDocument();
    });

    // Show me how expands instructions
    await user.click(screen.getByRole('button', { name: /show me how/i }));
    expect(screen.getByText(/visit appleid.apple.com/i)).toBeInTheDocument();
    expect(screen.getByText(/sign-in and security/i)).toBeInTheDocument();
  });
});
