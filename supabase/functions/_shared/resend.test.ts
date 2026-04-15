import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildTransactionalEmailPayload,
  isTransactionalEmailKind,
  sendResendEmail,
} from './resend';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isTransactionalEmailKind', () => {
  it('accepts supported lifecycle email kinds', () => {
    expect(isTransactionalEmailKind('signup_welcome')).toBe(true);
    expect(isTransactionalEmailKind('workspace_ready')).toBe(true);
    expect(isTransactionalEmailKind('onboarding_ready')).toBe(true);
    expect(isTransactionalEmailKind('billing_subscription_started')).toBe(true);
    expect(isTransactionalEmailKind('billing_subscription_updated')).toBe(true);
    expect(isTransactionalEmailKind('billing_cancellation_scheduled')).toBe(true);
    expect(isTransactionalEmailKind('billing_subscription_cancelled')).toBe(true);
    expect(isTransactionalEmailKind('billing_payment_failed')).toBe(true);
    expect(isTransactionalEmailKind('account_deleted_confirmation')).toBe(true);
  });

  it('rejects unknown lifecycle email kinds', () => {
    expect(isTransactionalEmailKind('billing_receipt')).toBe(false);
    expect(isTransactionalEmailKind('whatever')).toBe(false);
  });
});

describe('buildTransactionalEmailPayload', () => {
  it('renders a signup welcome email with safe HTML and text', () => {
    const payload = buildTransactionalEmailPayload({
      kind: 'signup_welcome',
      recipientEmail: 'sam@example.com',
      recipientName: 'Sam',
      workspaceName: 'BizzyBee <HQ>',
      appUrl: 'https://bizzybee.app/',
      supportEmail: 'support@bizzyb.ee',
    });

    expect(payload.from).toBe('BizzyBee <noreply@bizzyb.ee>');
    expect(payload.to).toBe('sam@example.com');
    expect(payload.subject).toBe('Welcome to BizzyBee');
    expect(payload.reply_to).toBe('support@bizzyb.ee');
    expect(payload.text).toContain('Hi Sam,');
    expect(payload.text).toContain('Open BizzyBee: https://bizzybee.app');
    expect(payload.html).toContain('BizzyBee &lt;HQ&gt;');
    expect(payload.html).toContain('Open BizzyBee');
    expect(payload.tags).toEqual([
      { name: 'category', value: 'bizzybee_lifecycle' },
      { name: 'kind', value: 'signup_welcome' },
    ]);
  });

  it('renders billing detail lines for billing emails', () => {
    const payload = buildTransactionalEmailPayload({
      kind: 'billing_subscription_updated',
      recipientEmail: 'sam@example.com',
      recipientName: 'Sam',
      workspaceName: 'BizzyBee HQ',
      appUrl: 'https://bizzybee.app/settings?category=billing',
      supportEmail: 'support@bizzyb.ee',
      details: ['Plan: Growth', 'Add-ons: AI Phone, SMS AI'],
    });

    expect(payload.subject).toBe('Your BizzyBee billing details changed');
    expect(payload.text).toContain('Billing summary:');
    expect(payload.text).toContain('- Plan: Growth');
    expect(payload.text).toContain('- Add-ons: AI Phone, SMS AI');
    expect(payload.html).toContain('Billing summary');
    expect(payload.html).toContain('Plan: Growth');
  });

  it('renders the account deleted confirmation copy', () => {
    const payload = buildTransactionalEmailPayload({
      kind: 'account_deleted_confirmation',
      recipientEmail: 'sam@example.com',
      recipientName: 'Sam',
      appUrl: 'https://bizzybee.app/settings',
      supportEmail: 'support@bizzyb.ee',
    });

    expect(payload.subject).toBe('Your BizzyBee account has been deleted');
    expect(payload.text).toContain(
      'This email confirms that your BizzyBee account and associated workspace data were deleted.',
    );
    expect(payload.html).toContain('Account deleted');
  });
});

describe('sendResendEmail', () => {
  it('posts the payload to Resend and returns provider metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'email_123',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await sendResendEmail(
      're_test_token',
      {
        from: 'BizzyBee <noreply@bizzyb.ee>',
        to: 'sam@example.com',
        subject: 'Welcome to BizzyBee',
        html: '<p>Hello</p>',
        text: 'Hello',
        reply_to: 'support@bizzyb.ee',
        tags: [{ name: 'category', value: 'bizzybee_lifecycle' }],
      },
      { idempotencyKey: 'signup:sam@example.com' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.resend.com/emails');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer re_test_token',
        'Idempotency-Key': 'signup:sam@example.com',
      }),
    });
    expect(result).toEqual({
      messageId: 'email_123',
    });
  });
});
