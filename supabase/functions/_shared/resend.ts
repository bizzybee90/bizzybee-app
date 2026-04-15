export type TransactionalEmailKind =
  | 'signup_welcome'
  | 'workspace_ready'
  | 'onboarding_ready'
  | 'billing_subscription_started'
  | 'billing_subscription_updated'
  | 'billing_cancellation_scheduled'
  | 'billing_subscription_cancelled'
  | 'billing_payment_failed'
  | 'account_deleted_confirmation';

export interface TransactionalEmailContext {
  kind: TransactionalEmailKind;
  recipientEmail: string;
  recipientName?: string | null;
  workspaceName?: string | null;
  details?: string[];
  appUrl: string;
  supportEmail: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
}

export interface ResendTag {
  name: string;
  value: string;
}

export interface ResendAttachment {
  filename: string;
  content?: string;
  path?: string;
  type?: string;
}

export interface ResendEmailPayload {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
  attachments?: ResendAttachment[];
  tags?: ResendTag[];
}

export interface ResendSendResult {
  messageId: string | null;
}

const EMAIL_KIND_COPY: Record<
  TransactionalEmailKind,
  {
    subject: string;
    headline: string;
    intro: string;
    ctaLabel: string;
    tag: string;
  }
> = {
  signup_welcome: {
    subject: 'Welcome to BizzyBee',
    headline: 'Your BizzyBee account is ready',
    intro:
      'Thanks for signing up. Your workspace has been created and you can jump back in whenever you are ready.',
    ctaLabel: 'Open BizzyBee',
    tag: 'signup_welcome',
  },
  workspace_ready: {
    subject: 'Your BizzyBee workspace is ready',
    headline: 'Your workspace is ready',
    intro:
      'We have finished preparing your workspace. You can now pick up where you left off and continue setup.',
    ctaLabel: 'Open your workspace',
    tag: 'workspace_ready',
  },
  onboarding_ready: {
    subject: 'Your BizzyBee onboarding is complete',
    headline: 'Onboarding is complete',
    intro: 'Your setup is finished and your BizzyBee workspace is ready for day-to-day use.',
    ctaLabel: 'Review your setup',
    tag: 'onboarding_ready',
  },
  billing_subscription_started: {
    subject: 'Your BizzyBee subscription is active',
    headline: 'Your subscription is active',
    intro:
      'Your BizzyBee billing setup is now active. You can review your plan and add-ons any time from billing settings.',
    ctaLabel: 'Open billing settings',
    tag: 'billing_subscription_started',
  },
  billing_subscription_updated: {
    subject: 'Your BizzyBee billing details changed',
    headline: 'Your billing details changed',
    intro:
      'We updated your BizzyBee subscription settings. Review the latest plan and add-ons below to confirm everything looks right.',
    ctaLabel: 'Review billing',
    tag: 'billing_subscription_updated',
  },
  billing_cancellation_scheduled: {
    subject: 'Your BizzyBee cancellation is scheduled',
    headline: 'Cancellation scheduled',
    intro:
      'We received your cancellation request. Your workspace keeps its current access until the end of the active billing period.',
    ctaLabel: 'Review billing',
    tag: 'billing_cancellation_scheduled',
  },
  billing_subscription_cancelled: {
    subject: 'Your BizzyBee subscription has ended',
    headline: 'Your subscription has ended',
    intro:
      'Your BizzyBee subscription is now cancelled. You can restart billing any time from your settings if you want to come back.',
    ctaLabel: 'Open billing settings',
    tag: 'billing_subscription_cancelled',
  },
  billing_payment_failed: {
    subject: 'Your BizzyBee payment needs attention',
    headline: 'Payment needs attention',
    intro:
      'We could not process your latest BizzyBee payment. Update your billing details to keep your workspace and channel add-ons active.',
    ctaLabel: 'Update billing details',
    tag: 'billing_payment_failed',
  },
  account_deleted_confirmation: {
    subject: 'Your BizzyBee account has been deleted',
    headline: 'Account deleted',
    intro:
      'This email confirms that your BizzyBee account and associated workspace data were deleted.',
    ctaLabel: 'Contact support',
    tag: 'account_deleted_confirmation',
  },
};

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function normalizeDisplayName(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : '';
}

function buildGreeting(recipientName?: string | null): string {
  const name = normalizeDisplayName(recipientName);
  return name ? `Hi ${name},` : 'Hi there,';
}

function buildTextBody(lines: string[]): string {
  return lines.map((line) => line.trimEnd()).join('\n');
}

function buildDetailLines(details: string[] | undefined): string[] {
  return (details ?? []).map((detail) => normalizeDisplayName(detail)).filter(Boolean);
}

function buildHtmlBody(params: {
  greeting: string;
  headline: string;
  intro: string;
  ctaLabel: string;
  ctaUrl: string;
  workspaceName?: string | null;
  supportEmail: string;
  details?: string[];
}): string {
  const workspaceSuffix = params.workspaceName?.trim()
    ? ` for ${escapeHtml(params.workspaceName.trim())}`
    : '';
  const detailLines = buildDetailLines(params.details);
  const detailsHtml = detailLines.length
    ? `
        <div style="margin:24px 0 0;padding:16px 18px;border-radius:18px;background:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 10px;font-size:13px;line-height:20px;font-weight:600;letter-spacing:0.02em;color:#0f172a;text-transform:uppercase;">Billing summary</p>
          <ul style="margin:0;padding-left:18px;color:#334155;font-size:14px;line-height:22px;">
            ${detailLines.map((detail) => `<li>${escapeHtml(detail)}</li>`).join('')}
          </ul>
        </div>
      `
    : '';

  return `
    <div style="background:#f5f7fb;margin:0;padding:32px 16px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;padding:40px;">
        <p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#334155;">${escapeHtml(params.greeting)}</p>
        <h1 style="margin:0 0 16px;font-size:28px;line-height:36px;letter-spacing:-0.02em;color:#0f172a;">${escapeHtml(params.headline)}${workspaceSuffix}</h1>
        <p style="margin:0 0 24px;font-size:16px;line-height:26px;color:#334155;">${escapeHtml(params.intro)}</p>
        ${detailsHtml}
        <a href="${escapeHtml(params.ctaUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:600;font-size:14px;line-height:20px;">
          ${escapeHtml(params.ctaLabel)}
        </a>
        <p style="margin:24px 0 0;font-size:14px;line-height:22px;color:#64748b;">
          Need help? Reply to this email or write to ${escapeHtml(params.supportEmail)}.
        </p>
      </div>
    </div>
  `;
}

function normalizeTagValue(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_-]/g, '_');
  return normalized.slice(0, 256) || 'bizzybee';
}

export function isTransactionalEmailKind(value: unknown): value is TransactionalEmailKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EMAIL_KIND_COPY, value);
}

export const transactionalEmailCatalog = [
  {
    key: 'signup_welcome',
    title: 'Signup welcome',
    owner: 'resend',
    purpose: 'Sent after BizzyBee creates the first workspace for a new account.',
  },
  {
    key: 'workspace_ready',
    title: 'Workspace ready',
    owner: 'resend',
    purpose: 'Sent when a workspace setup task completes and the customer can continue.',
  },
  {
    key: 'onboarding_ready',
    title: 'Onboarding complete',
    owner: 'resend',
    purpose: 'Sent when onboarding finishes and the workspace is ready for day-to-day use.',
  },
  {
    key: 'billing_subscription_started',
    title: 'Subscription started',
    owner: 'resend',
    purpose: 'Sent when a Stripe subscription becomes active.',
  },
  {
    key: 'billing_subscription_updated',
    title: 'Subscription updated',
    owner: 'resend',
    purpose: 'Sent when the BizzyBee plan or add-on mix changes.',
  },
  {
    key: 'billing_cancellation_scheduled',
    title: 'Cancellation scheduled',
    owner: 'resend',
    purpose: 'Sent when cancel_at_period_end is switched on.',
  },
  {
    key: 'billing_subscription_cancelled',
    title: 'Subscription cancelled',
    owner: 'resend',
    purpose: 'Sent when Stripe reports the subscription as cancelled.',
  },
  {
    key: 'billing_payment_failed',
    title: 'Payment failed',
    owner: 'resend',
    purpose: 'Reserved for failed invoice/payment retries once invoice events are subscribed.',
  },
  {
    key: 'account_deleted_confirmation',
    title: 'Account deleted',
    owner: 'resend',
    purpose: 'Reserved for destructive account deletion confirmation flows.',
  },
] as const;

export function buildTransactionalEmailPayload(
  context: TransactionalEmailContext,
): ResendEmailPayload {
  const copy = EMAIL_KIND_COPY[context.kind];
  const greeting = buildGreeting(context.recipientName);
  const baseUrl = normalizeUrl(context.appUrl);
  const ctaUrl = baseUrl || 'https://bizzybee.app';
  const fromName = normalizeDisplayName(context.fromName) || 'BizzyBee';
  const fromEmail = normalizeDisplayName(context.fromEmail) || 'noreply@bizzyb.ee';
  const replyTo = normalizeDisplayName(context.replyTo) || context.supportEmail;
  const workspaceName = normalizeDisplayName(context.workspaceName);
  const supportEmail = normalizeDisplayName(context.supportEmail) || 'support@bizzyb.ee';
  const detailLines = buildDetailLines(context.details);

  const textBody = buildTextBody([
    greeting,
    '',
    `${copy.headline}${workspaceName ? ` for ${workspaceName}` : ''}`,
    copy.intro,
    ...(detailLines.length
      ? ['', 'Billing summary:', ...detailLines.map((detail) => `- ${detail}`)]
      : []),
    '',
    `${copy.ctaLabel}: ${ctaUrl}`,
    '',
    `Need help? Reply to this email or write to ${supportEmail}.`,
  ]);

  const htmlBody = buildHtmlBody({
    greeting,
    headline: copy.headline,
    intro: copy.intro,
    ctaLabel: copy.ctaLabel,
    ctaUrl,
    workspaceName,
    supportEmail,
    details: detailLines,
  });

  return {
    from: `${fromName} <${fromEmail}>`,
    to: context.recipientEmail.trim(),
    subject: copy.subject,
    html: htmlBody,
    text: textBody,
    reply_to: replyTo,
    tags: [
      { name: 'category', value: 'bizzybee_lifecycle' },
      { name: 'kind', value: normalizeTagValue(copy.tag) },
    ],
  };
}

export async function sendResendEmail(
  apiKey: string,
  payload: ResendEmailPayload,
  options?: { idempotencyKey?: string },
): Promise<ResendSendResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey.trim()}`,
    'Content-Type': 'application/json',
  };
  const idempotencyKey = options?.idempotencyKey?.trim();
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send transactional email: ${response.status} ${errorText}`);
  }

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    messageId: typeof json.id === 'string' ? json.id : null,
  };
}
