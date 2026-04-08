# Email Connection Rework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Aurinko hosted IMAP form with a BizzyBee-branded modal (auto-detect + app-password guidance), fix the OAuth redirect allowlist so Cloudflare Pages URLs work, remove Yahoo from the provider grid, and investigate Outlook OAuth breakage.

**Architecture:** Additive refactor of `EmailConnectionStep.tsx` — `handleConnect` becomes a router that keeps Gmail/Outlook on the existing Aurinko OAuth path but sends iCloud/IMAP to a new `ImapConnectionModal` that calls a new `aurinko-create-imap-account` edge function. Origin allowlist in `aurinko-auth-callback` gets pattern matching. Provider detection uses hardcoded presets + Mozilla ISPDB fallback.

**Tech Stack:** React + TypeScript + Vitest + React Testing Library, Supabase Deno Edge Functions, Aurinko `/v1/am/accounts` endpoint, Mozilla Thunderbird autoconfig database.

**Design doc:** `docs/plans/2026-04-08-email-connection-rework-design.md`

---

## Task ordering rationale

1. **OAuth allowlist fix first** — smallest, most urgent, independent of the IMAP work. Unblocks Gmail testing on Cloudflare Pages URLs immediately.
2. **Provider presets library** — pure logic, tested in isolation, dependency for the modal.
3. **Edge function** — `aurinko-create-imap-account`, tested via deploy + curl.
4. **ImapConnectionModal component** — depends on presets library, tested with vitest + RTL.
5. **EmailConnectionStep refactor** — wires everything together.
6. **Build + deploy**.
7. **Outlook OAuth investigation** — research task, may or may not produce code changes.
8. **Manual E2E verification** — test Gmail, iCloud, Fastmail, custom domain flows.

---

## Task 1: Fix OAuth origin allowlist

**Files:**

- Modify: `supabase/functions/aurinko-auth-callback/index.ts` (lines 3-8 replace `ALLOWED_ORIGINS`, line 101 and line 139 replace the includes check)
- Modify: `src/components/onboarding/EmailConnectionStep.tsx` (line 142 remove stale `PUBLISHED_URL` constant)

### Step 1.1: Replace `ALLOWED_ORIGINS` with pattern-based validator

In `supabase/functions/aurinko-auth-callback/index.ts`, find:

```ts
const ALLOWED_ORIGINS = [
  'https://bizzybee.app',
  'https://app.bizzybee.co.uk',
  'http://localhost:5173',
  'http://localhost:8080',
];
```

Replace with:

```ts
const ALLOWED_ORIGIN_PATTERNS: Array<string | RegExp> = [
  'https://bizzybee.app',
  'https://app.bizzybee.co.uk',
  'https://bizzybee-app.pages.dev',
  /^https:\/\/[a-z0-9]+\.bizzybee-app\.pages\.dev$/, // Cloudflare preview deploys
  'http://localhost:5173',
  'http://localhost:8080',
];

function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) =>
    typeof pattern === 'string' ? pattern === origin : pattern.test(origin),
  );
}
```

### Step 1.2: Update the two call sites that use the old allowlist

Line 101 (cancellation path):

```ts
// OLD
cancelOrigin = ALLOWED_ORIGINS.includes(candidateOrigin) ? candidateOrigin : defaultOrigin;

// NEW
cancelOrigin = isAllowedOrigin(candidateOrigin) ? candidateOrigin : defaultOrigin;
```

Line 139 (success path):

```ts
// OLD
const appOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : defaultOrigin;

// NEW
const appOrigin = isAllowedOrigin(origin) ? origin : defaultOrigin;
```

### Step 1.3: Remove stale `PUBLISHED_URL` constant from frontend

In `src/components/onboarding/EmailConnectionStep.tsx`, find (around line 142):

```ts
// Published URL for redirects after OAuth
const PUBLISHED_URL = 'https://embrace-channel-pix.lovable.app';
// Note: OAuth callback is now handled by edge function (aurinko-auth-callback)
```

Delete all 3 lines. Grep the file to confirm `PUBLISHED_URL` is not referenced anywhere else before deleting:

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && grep -n "PUBLISHED_URL" src/components/onboarding/EmailConnectionStep.tsx
```

Expected: no matches (the constant is dead code).

### Step 1.4: Deploy the edge function

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && /Users/michaelcarbon/bin/supabase functions deploy aurinko-auth-callback --project-ref atukvssploxwyqpwjmrc
```

Expected: `Deployed Functions on project atukvssploxwyqpwjmrc: aurinko-auth-callback`.

### Step 1.5: Smoke test the regex in the deployed function

Verify the regex works by reading the deployed source via the Supabase MCP:

Use `mcp__59a8ed17-71f5-4117-822d-27e7fd6b48ba__get_edge_function` with `function_slug: 'aurinko-auth-callback'` and confirm the file contents include `ALLOWED_ORIGIN_PATTERNS` and `isAllowedOrigin`.

### Step 1.6: Commit

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
git add supabase/functions/aurinko-auth-callback/index.ts src/components/onboarding/EmailConnectionStep.tsx && \
git commit -m "fix: allow Cloudflare Pages URLs in OAuth callback redirect allowlist

The allowlist only accepted bizzybee.app + localhost, so users on
bizzybee-app.pages.dev (and its preview deploys) got bounced to the
wrong domain after OAuth completed. Replace exact-match array with
pattern matcher that accepts the production Cloudflare Pages URL
plus any subdomain preview deploy via regex.

Also delete the stale PUBLISHED_URL constant in EmailConnectionStep
(unused dead code from a previous Lovable preview project)."
```

---

## Task 2: Create `providerPresets.ts` library

**Files:**

- Create: `src/lib/email/providerPresets.ts`
- Create: `src/lib/email/__tests__/providerPresets.test.ts`

### Step 2.1: Write the failing test for hardcoded preset lookup

Create `src/lib/email/__tests__/providerPresets.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lookupProvider, type ProviderPreset } from '../providerPresets';

describe('lookupProvider — hardcoded presets', () => {
  it('returns iCloud preset for icloud.com', async () => {
    const result = await lookupProvider('sarah@icloud.com');
    expect(result).toMatchObject({
      name: 'iCloud Mail',
      host: 'imap.mail.me.com',
      port: 993,
      requiresAppPassword: 'always',
    });
  });

  it('returns iCloud preset for me.com and mac.com', async () => {
    const me = await lookupProvider('user@me.com');
    const mac = await lookupProvider('user@mac.com');
    expect(me?.name).toBe('iCloud Mail');
    expect(mac?.name).toBe('iCloud Mail');
  });

  it('returns Fastmail preset for fastmail.com', async () => {
    const result = await lookupProvider('user@fastmail.com');
    expect(result).toMatchObject({
      name: 'Fastmail',
      host: 'imap.fastmail.com',
      port: 993,
      requiresAppPassword: 'always',
    });
  });

  it('returns Fastmail preset for fastmail.fm', async () => {
    const result = await lookupProvider('user@fastmail.fm');
    expect(result?.name).toBe('Fastmail');
  });

  it('returns Zoho preset for zoho.com', async () => {
    const result = await lookupProvider('user@zoho.com');
    expect(result?.name).toBe('Zoho Mail');
    expect(result?.host).toBe('imap.zoho.com');
  });

  it('returns Yahoo preset for yahoo.com', async () => {
    const result = await lookupProvider('user@yahoo.com');
    expect(result?.name).toBe('Yahoo Mail');
    expect(result?.host).toBe('imap.mail.yahoo.com');
  });

  it('is case-insensitive on the domain', async () => {
    const result = await lookupProvider('Sarah@ICLOUD.COM');
    expect(result?.name).toBe('iCloud Mail');
  });

  it('includes instructions and help URL for iCloud', async () => {
    const result = await lookupProvider('user@icloud.com');
    expect(result?.appPasswordHelpUrl).toContain('appleid.apple.com');
    expect(result?.instructions).toBeInstanceOf(Array);
    expect(result?.instructions?.length).toBeGreaterThan(0);
  });
});
```

### Step 2.2: Run the test to verify it fails

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx vitest run src/lib/email/__tests__/providerPresets.test.ts
```

Expected: Test file fails to import `../providerPresets` because it doesn't exist yet.

### Step 2.3: Create `providerPresets.ts` with hardcoded presets

Create `src/lib/email/providerPresets.ts`:

```ts
/**
 * Email provider presets and auto-detection.
 *
 * Lookup tiers:
 * 1. Hardcoded fast path (this file) — instant lookup for common providers.
 * 2. Mozilla ISPDB fallback — fetch autoconfig.thunderbird.net for unknown domains.
 * 3. Manual fallback — UI shows server/port fields if both fail.
 */

export type AppPasswordRequirement = 'always' | 'with_2fa' | 'never' | 'unknown';

export interface ProviderPreset {
  name: string;
  host: string;
  port: number;
  secure: boolean;
  requiresAppPassword: AppPasswordRequirement;
  appPasswordHelpUrl?: string;
  passwordFormatHint?: string;
  instructions?: string[];
}

const HARDCODED_PRESETS: Record<string, ProviderPreset> = {
  'icloud.com': {
    name: 'iCloud Mail',
    host: 'imap.mail.me.com',
    port: 993,
    secure: true,
    requiresAppPassword: 'always',
    appPasswordHelpUrl: 'https://appleid.apple.com/account/manage/section/security',
    passwordFormatHint: 'Apple app passwords are 16 characters with dashes: xxxx-xxxx-xxxx-xxxx',
    instructions: [
      'Visit appleid.apple.com and sign in',
      'Go to Sign-In and Security → App-Specific Passwords',
      'Click + and label it "BizzyBee"',
      'Copy the generated password and paste it below',
    ],
  },
  'me.com': {
    name: 'iCloud Mail',
    host: 'imap.mail.me.com',
    port: 993,
    secure: true,
    requiresAppPassword: 'always',
    appPasswordHelpUrl: 'https://appleid.apple.com/account/manage/section/security',
    passwordFormatHint: 'Apple app passwords are 16 characters with dashes',
    instructions: [
      'Visit appleid.apple.com and sign in',
      'Go to Sign-In and Security → App-Specific Passwords',
      'Click + and label it "BizzyBee"',
      'Copy the generated password and paste it below',
    ],
  },
  'mac.com': {
    name: 'iCloud Mail',
    host: 'imap.mail.me.com',
    port: 993,
    secure: true,
    requiresAppPassword: 'always',
    appPasswordHelpUrl: 'https://appleid.apple.com/account/manage/section/security',
    passwordFormatHint: 'Apple app passwords are 16 characters with dashes',
    instructions: [
      'Visit appleid.apple.com and sign in',
      'Go to Sign-In and Security → App-Specific Passwords',
      'Click + and label it "BizzyBee"',
      'Copy the generated password and paste it below',
    ],
  },
  'fastmail.com': {
    name: 'Fastmail',
    host: 'imap.fastmail.com',
    port: 993,
    secure: true,
    requiresAppPassword: 'always',
    appPasswordHelpUrl: 'https://app.fastmail.com/settings/security/apppasswords',
    instructions: [
      'Sign in to Fastmail at app.fastmail.com',
      'Go to Settings → Privacy & Security → App Passwords',
      'Click "New App Password", select "Mail (IMAP/SMTP)", label it "BizzyBee"',
      'Copy the generated password and paste it below',
    ],
  },
  'fastmail.fm': {
    name: 'Fastmail',
    host: 'imap.fastmail.com',
    port: 993,
    secure: true,
    requiresAppPassword: 'always',
    appPasswordHelpUrl: 'https://app.fastmail.com/settings/security/apppasswords',
    instructions: [
      'Sign in to Fastmail at app.fastmail.com',
      'Go to Settings → Privacy & Security → App Passwords',
      'Click "New App Password", select "Mail (IMAP/SMTP)", label it "BizzyBee"',
      'Copy the generated password and paste it below',
    ],
  },
  'zoho.com': {
    name: 'Zoho Mail',
    host: 'imap.zoho.com',
    port: 993,
    secure: true,
    requiresAppPassword: 'with_2fa',
    appPasswordHelpUrl: 'https://accounts.zoho.com/home#security/app_passwords',
    instructions: [
      'Sign in to Zoho Accounts at accounts.zoho.com',
      'Go to Security → App Passwords',
      'Generate an app-specific password for IMAP',
      'Copy and paste it below (only required if you have 2FA enabled)',
    ],
  },
  'yahoo.com': {
    name: 'Yahoo Mail',
    host: 'imap.mail.yahoo.com',
    port: 993,
    secure: true,
    requiresAppPassword: 'always',
    appPasswordHelpUrl: 'https://login.yahoo.com/account/security',
    instructions: [
      'Sign in to Yahoo Account Security at login.yahoo.com/account/security',
      'Click "Generate app password"',
      'Select "Other app" and name it "BizzyBee"',
      'Copy and paste the generated password below',
    ],
  },
  'aol.com': {
    name: 'AOL Mail',
    host: 'imap.aol.com',
    port: 993,
    secure: true,
    requiresAppPassword: 'always',
    appPasswordHelpUrl: 'https://login.aol.com/account/security',
    instructions: [
      'Sign in to AOL Account Security',
      'Click "Generate app password"',
      'Select "Other app" and name it "BizzyBee"',
      'Copy and paste the generated password below',
    ],
  },
};

function extractDomain(email: string): string | null {
  const match = email
    .trim()
    .toLowerCase()
    .match(/@([^@\s]+)$/);
  return match ? match[1] : null;
}

/**
 * Look up a provider preset for an email address.
 *
 * Tier 1: Hardcoded presets (instant).
 * Tier 2: Mozilla ISPDB (async fetch to autoconfig.thunderbird.net).
 *
 * Returns null if the domain isn't recognised by either tier.
 */
export async function lookupProvider(email: string): Promise<ProviderPreset | null> {
  const domain = extractDomain(email);
  if (!domain) return null;

  // Tier 1: hardcoded
  if (HARDCODED_PRESETS[domain]) {
    return HARDCODED_PRESETS[domain];
  }

  // Tier 2: Mozilla ISPDB (implemented in Task 2b)
  return null;
}
```

### Step 2.4: Run test to verify it passes

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx vitest run src/lib/email/__tests__/providerPresets.test.ts
```

Expected: All 8 tests in "hardcoded presets" describe block pass.

### Step 2.5: Write failing test for Mozilla ISPDB fallback

Add to the same test file:

```ts
describe('lookupProvider — Mozilla ISPDB fallback', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches from autoconfig.thunderbird.net for unknown domains', async () => {
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="mycompany.co.uk">
    <domain>mycompany.co.uk</domain>
    <displayName>My Company Mail</displayName>
    <incomingServer type="imap">
      <hostname>imap.mycompany.co.uk</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
    </incomingServer>
  </emailProvider>
</clientConfig>`;

    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => mockXml,
    });

    const result = await lookupProvider('user@mycompany.co.uk');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://autoconfig.thunderbird.net/v1.1/mycompany.co.uk',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(result).toMatchObject({
      name: 'My Company Mail',
      host: 'imap.mycompany.co.uk',
      port: 993,
      secure: true,
      requiresAppPassword: 'unknown',
    });
  });

  it('returns null when ISPDB returns 404', async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: false, status: 404 });
    const result = await lookupProvider('user@nowhere.invalid');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('network'));
    const result = await lookupProvider('user@nowhere.invalid');
    expect(result).toBeNull();
  });

  it('returns null when XML has no IMAP server', async () => {
    const pop3OnlyXml = `<?xml version="1.0"?>
<clientConfig><emailProvider id="x">
  <domain>x.com</domain>
  <displayName>POP3 Only</displayName>
  <incomingServer type="pop3"><hostname>pop.x.com</hostname><port>995</port></incomingServer>
</emailProvider></clientConfig>`;
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => pop3OnlyXml,
    });
    const result = await lookupProvider('user@x.com');
    expect(result).toBeNull();
  });

  it('prefers hardcoded preset over ISPDB (does not fetch)', async () => {
    await lookupProvider('user@fastmail.com');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
```

### Step 2.6: Run the test to verify the new ISPDB tests fail

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx vitest run src/lib/email/__tests__/providerPresets.test.ts
```

Expected: The 4 new ISPDB tests fail (they expect `fetch` to be called, but the current implementation returns `null` before fetching). The 5th (`prefers hardcoded`) passes.

### Step 2.7: Implement ISPDB fallback in `providerPresets.ts`

Replace the Tier 2 comment with real implementation:

```ts
/**
 * Tier 2: Fetch Mozilla ISPDB XML and parse IMAP settings.
 * Uses the regex parser instead of DOMParser so this works in both
 * browser and edge function environments.
 */
async function lookupIspdb(domain: string): Promise<ProviderPreset | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`https://autoconfig.thunderbird.net/v1.1/${domain}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const xml = await response.text();

    // Find the first <incomingServer type="imap"> block
    const imapBlock = xml.match(/<incomingServer\s+type="imap"[^>]*>([\s\S]*?)<\/incomingServer>/);
    if (!imapBlock) return null;

    const hostname = imapBlock[1].match(/<hostname>([^<]+)<\/hostname>/)?.[1];
    const port = imapBlock[1].match(/<port>(\d+)<\/port>/)?.[1];
    const socketType = imapBlock[1].match(/<socketType>([^<]+)<\/socketType>/)?.[1];

    if (!hostname || !port) return null;

    const displayName = xml.match(/<displayName>([^<]+)<\/displayName>/)?.[1] ?? domain;

    return {
      name: displayName,
      host: hostname,
      port: parseInt(port, 10),
      secure: socketType === 'SSL' || socketType === 'STARTTLS',
      requiresAppPassword: 'unknown',
    };
  } catch {
    return null;
  }
}
```

And update `lookupProvider` to call it:

```ts
export async function lookupProvider(email: string): Promise<ProviderPreset | null> {
  const domain = extractDomain(email);
  if (!domain) return null;

  // Tier 1: hardcoded
  if (HARDCODED_PRESETS[domain]) {
    return HARDCODED_PRESETS[domain];
  }

  // Tier 2: Mozilla ISPDB
  return lookupIspdb(domain);
}
```

### Step 2.8: Run all presets tests

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx vitest run src/lib/email/__tests__/providerPresets.test.ts
```

Expected: All 13 tests pass (8 hardcoded + 5 ISPDB).

### Step 2.9: Commit

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
git add src/lib/email/providerPresets.ts src/lib/email/__tests__/providerPresets.test.ts && \
git commit -m "feat: add email provider presets with ISPDB auto-detect

Two-tier provider lookup for the new BizzyBee IMAP connection modal:
- Tier 1: hardcoded presets for icloud, fastmail, zoho, yahoo, aol
  with app-password requirement metadata, help URLs, and step-by-step
  instructions per provider
- Tier 2: Mozilla autoconfig.thunderbird.net ISPDB fallback for
  unknown domains (5s timeout, regex-parsed XML, IMAP only)

Returns null if both tiers fail — the modal's manual fallback UI
handles that case."
```

---

## Task 3: Create `aurinko-create-imap-account` edge function

**Files:**

- Create: `supabase/functions/aurinko-create-imap-account/index.ts`

### Step 3.1: Create the edge function

```ts
// supabase/functions/aurinko-create-imap-account/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ImportMode = 'new_only' | 'last_1000' | 'last_10000' | 'last_30000' | 'all_history';

interface CreateImapBody {
  workspaceId: string;
  email: string;
  password: string;
  host: string;
  port: number;
  secure?: boolean;
  importMode: ImportMode;
}

type ErrorCode =
  | 'INVALID_REQUEST'
  | 'AUTHENTICATION_FAILED'
  | 'IMAP_UNREACHABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

function errorResponse(
  code: ErrorCode,
  message: string,
  extras: Record<string, unknown> = {},
  status = 400,
) {
  return new Response(JSON.stringify({ success: false, error: code, message, ...extras }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function inferSmtp(imapHost: string): { host: string; port: number } {
  // iCloud special case
  if (imapHost.endsWith('mail.me.com')) {
    return { host: 'smtp.mail.me.com', port: 587 };
  }
  // Generic: imap.X → smtp.X
  return {
    host: imapHost.replace(/^imap\./, 'smtp.'),
    port: 587,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as CreateImapBody;
    const { workspaceId, email, password, host, port, secure = true, importMode } = body;

    // Basic validation
    if (!workspaceId || !email || !password || !host || !port || !importMode) {
      return errorResponse(
        'INVALID_REQUEST',
        'workspaceId, email, password, host, port, and importMode are required',
      );
    }

    // Verify the caller owns this workspace
    try {
      await validateAuth(req, workspaceId);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err);
      throw err;
    }

    const AURINKO_CLIENT_ID = Deno.env.get('AURINKO_CLIENT_ID');
    const AURINKO_CLIENT_SECRET = Deno.env.get('AURINKO_CLIENT_SECRET');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (
      !AURINKO_CLIENT_ID ||
      !AURINKO_CLIENT_SECRET ||
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      return errorResponse('INTERNAL_ERROR', 'Server configuration missing', {}, 500);
    }

    const smtp = inferSmtp(host);

    // Call Aurinko's native IMAP account create endpoint
    const aurinkoResponse = await fetch('https://api.aurinko.io/v1/am/accounts', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${AURINKO_CLIENT_ID}:${AURINKO_CLIENT_SECRET}`),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        serviceType: 'IMAP',
        username: email,
        password: password,
        imap: { host, port, useSSL: secure },
        smtp: { host: smtp.host, port: smtp.port, useTLS: true },
      }),
    });

    if (aurinkoResponse.status === 401 || aurinkoResponse.status === 403) {
      return errorResponse('AUTHENTICATION_FAILED', 'Email or password is incorrect', {
        providerHint: host,
      });
    }

    if (aurinkoResponse.status >= 500) {
      return errorResponse(
        'SERVICE_UNAVAILABLE',
        'Our email service is temporarily unavailable. Please try again.',
        { retryable: true },
        503,
      );
    }

    if (!aurinkoResponse.ok) {
      const errorText = await aurinkoResponse.text();
      console.error('[aurinko-create-imap-account] Aurinko error:', errorText);
      return errorResponse(
        'IMAP_UNREACHABLE',
        `Couldn't reach ${host}. Check your server settings.`,
      );
    }

    const accountData = await aurinkoResponse.json();
    const { accountId, accessToken, refreshToken } = accountData;

    if (!accountId || !accessToken) {
      console.error(
        '[aurinko-create-imap-account] Aurinko response missing accountId or accessToken:',
        accountData,
      );
      return errorResponse('INTERNAL_ERROR', 'Unexpected response from email service', {}, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Create webhook subscription for incoming mail
    let subscriptionId: string | null = null;
    try {
      const subResponse = await fetch('https://api.aurinko.io/v1/subscriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resource: '/email/messages',
          notificationUrl: `${SUPABASE_URL}/functions/v1/aurinko-webhook`,
        }),
      });
      if (subResponse.ok) {
        const subData = await subResponse.json();
        subscriptionId = subData.id?.toString() ?? null;
      }
    } catch (subErr) {
      console.error('[aurinko-create-imap-account] Subscription failed:', subErr);
      // Continue anyway — the account itself is created
    }

    // Upsert email_provider_configs WITHOUT plaintext tokens (same as OAuth path)
    const { data: configData, error: dbError } = await supabase
      .from('email_provider_configs')
      .upsert(
        {
          workspace_id: workspaceId,
          provider: 'imap',
          account_id: accountId.toString(),
          access_token: null,
          refresh_token: null,
          email_address: email,
          import_mode: importMode,
          connected_at: new Date().toISOString(),
          subscription_id: subscriptionId,
          sync_status: 'pending',
          sync_stage: 'queued',
        },
        { onConflict: 'workspace_id,email_address' },
      )
      .select()
      .single();

    if (dbError || !configData) {
      console.error('[aurinko-create-imap-account] DB insert failed:', dbError);
      return errorResponse('INTERNAL_ERROR', 'Failed to save email configuration', {}, 500);
    }

    // Encrypt tokens via RPC (same as OAuth callback)
    const { error: encryptError } = await supabase.rpc('store_encrypted_token', {
      p_config_id: configData.id,
      p_access_token: accessToken,
      p_refresh_token: refreshToken ?? null,
    });

    if (encryptError) {
      console.error('[aurinko-create-imap-account] Token encryption failed:', encryptError);
      // Don't fail the flow — the access token is not stored, user will reconnect if decryption fails later
    }

    // Seed import progress
    await supabase.from('email_import_progress').upsert(
      {
        workspace_id: workspaceId,
        current_phase: 'importing',
        emails_received: 0,
        emails_classified: 0,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' },
    );

    return new Response(JSON.stringify({ success: true, email }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[aurinko-create-imap-account] Error:', message);
    return errorResponse('INTERNAL_ERROR', message, {}, 500);
  }
});
```

### Step 3.2: Deploy the edge function

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
/Users/michaelcarbon/bin/supabase functions deploy aurinko-create-imap-account --project-ref atukvssploxwyqpwjmrc
```

Expected: `Deployed Functions on project atukvssploxwyqpwjmrc: aurinko-create-imap-account`.

### Step 3.3: Smoke-test validation error path

Without auth, the function should reject. Via Supabase MCP:

```ts
// pseudo — use mcp__...__get_edge_function to verify the file was deployed
```

Don't attempt a real IMAP auth here — we don't have test credentials. Verification of the happy path is deferred to Task 8 (manual E2E).

### Step 3.4: Commit

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
git add supabase/functions/aurinko-create-imap-account/index.ts && \
git commit -m "feat: add aurinko-create-imap-account edge function

Wraps Aurinko's POST /v1/am/accounts endpoint so BizzyBee can create
IMAP email accounts from a native form (no redirect to Aurinko's
hosted sign-in page). Validates workspace ownership, calls Aurinko,
creates webhook subscription, stores config with encrypted tokens,
and seeds email_import_progress — same post-connect work as the
OAuth callback so both paths produce identical DB state.

Maps Aurinko error codes to typed client-friendly errors:
AUTHENTICATION_FAILED, IMAP_UNREACHABLE, SERVICE_UNAVAILABLE."
```

---

## Task 4: Create `ImapConnectionModal` component

**Files:**

- Create: `src/components/onboarding/ImapConnectionModal.tsx`
- Create: `src/components/onboarding/__tests__/ImapConnectionModal.test.tsx`

### Step 4.1: Write failing test — modal renders with iCloud preset

Create `src/components/onboarding/__tests__/ImapConnectionModal.test.tsx`:

```tsx
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
      expect(screen.getByText(/app-specific password/i)).toBeInTheDocument();
      expect(screen.getByText(/your regular/i)).toBeInTheDocument();
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
      expect(screen.getByText(/iCloud requires an app-specific password/i)).toBeInTheDocument();
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
```

### Step 4.2: Run tests to verify all 7 fail (component doesn't exist yet)

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx vitest run src/components/onboarding/__tests__/ImapConnectionModal.test.tsx
```

Expected: All 7 tests fail because the file can't be imported.

### Step 4.3: Create the modal component

Create `src/components/onboarding/ImapConnectionModal.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, Eye, EyeOff, ExternalLink, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { lookupProvider, type ProviderPreset } from '@/lib/email/providerPresets';
import { logger } from '@/lib/logger';

type ImportMode = 'new_only' | 'last_1000' | 'last_10000' | 'last_30000' | 'all_history';

interface ImapConnectionModalProps {
  open: boolean;
  workspaceId: string;
  provider: 'icloud' | 'imap';
  importMode: ImportMode;
  onClose: () => void;
  onConnected: (email: string) => void;
}

export function ImapConnectionModal({
  open,
  workspaceId,
  provider,
  importMode,
  onClose,
  onConnected,
}: ImapConnectionModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [preset, setPreset] = useState<ProviderPreset | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [showManualSettings, setShowManualSettings] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [manualHost, setManualHost] = useState('');
  const [manualPort, setManualPort] = useState('993');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const detectTimeoutRef = useRef<number | undefined>(undefined);

  // Pre-load iCloud preset when provider is icloud
  useEffect(() => {
    if (provider === 'icloud' && !preset) {
      // We'll rely on auto-detect after the user types, but prime the state
      // so the title says "Connect iCloud Mail" immediately.
    }
  }, [provider, preset]);

  async function runDetection(emailValue: string) {
    if (!emailValue.includes('@')) return;
    setDetecting(true);
    try {
      const result = await lookupProvider(emailValue);
      setPreset(result);
      if (!result) {
        setShowManualSettings(true);
      } else {
        setManualHost(result.host);
        setManualPort(String(result.port));
      }
    } catch (err) {
      logger.error('Provider detection failed', err);
      setShowManualSettings(true);
    } finally {
      setDetecting(false);
    }
  }

  function handleEmailBlur() {
    if (detectTimeoutRef.current) window.clearTimeout(detectTimeoutRef.current);
    void runDetection(email);
  }

  async function handleSubmit() {
    setErrorMessage(null);

    // Validate
    if (!email || !password) {
      setErrorMessage('Email and password are required');
      return;
    }

    const host = preset?.host ?? manualHost;
    const port = preset?.port ?? parseInt(manualPort, 10);
    const secure = preset?.secure ?? true;

    if (!host || !port || Number.isNaN(port)) {
      setErrorMessage('IMAP server and port are required');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('aurinko-create-imap-account', {
        body: { workspaceId, email, password, host, port, secure, importMode },
      });

      if (error) {
        logger.error('Edge function error', error);
        setErrorMessage('Failed to reach email service. Please try again.');
        return;
      }

      if (!data?.success) {
        // Map error codes to friendly messages using preset metadata
        if (data?.error === 'AUTHENTICATION_FAILED') {
          if (preset?.requiresAppPassword === 'always') {
            setErrorMessage(
              `That password didn't work. ${preset.name} requires an app-specific password, not your regular account password.`,
            );
          } else if (preset?.requiresAppPassword === 'with_2fa') {
            setErrorMessage(
              `Authentication failed. If you have 2-factor authentication enabled on your ${preset.name} account, you need an app-specific password.`,
            );
          } else {
            setErrorMessage(
              'Authentication failed. Check your email and password. Some providers require an app-specific password instead of your regular one.',
            );
          }
        } else if (data?.error === 'IMAP_UNREACHABLE') {
          setErrorMessage(data.message ?? "Couldn't reach the mail server");
        } else if (data?.error === 'SERVICE_UNAVAILABLE') {
          setErrorMessage(
            data.message ?? 'Email service temporarily unavailable. Please try again.',
          );
        } else {
          setErrorMessage(data?.message ?? 'Connection failed');
        }
        return;
      }

      toast.success(`Connected to ${email}`);
      onConnected(email);
    } catch (err) {
      logger.error('IMAP submit error', err);
      setErrorMessage('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const title = preset
    ? `Connect ${preset.name}`
    : provider === 'icloud'
      ? 'Connect iCloud Mail'
      : 'Connect Email';

  const needsAppPassword = preset?.requiresAppPassword === 'always';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Email field */}
          <div className="space-y-2">
            <Label htmlFor="imap-email">Email address</Label>
            <Input
              id="imap-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={handleEmailBlur}
              autoFocus
            />
            {detecting && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Detecting provider...
              </p>
            )}
            {preset && !detecting && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Detected: {preset.name}
              </p>
            )}
          </div>

          {/* App-password warning */}
          {needsAppPassword && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-amber-900">
                    {preset?.name} needs an app-specific password
                  </p>
                  <p className="text-amber-800 text-xs mt-1">
                    Your regular account password won't work. You'll need to generate a one-time
                    password for BizzyBee.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowInstructions(!showInstructions)}
                >
                  {showInstructions ? 'Hide' : 'Show me how'} →
                </Button>
                {preset?.appPasswordHelpUrl && (
                  <Button type="button" variant="outline" size="sm" asChild>
                    <a href={preset.appPasswordHelpUrl} target="_blank" rel="noopener noreferrer">
                      Generate one now <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </Button>
                )}
              </div>
              {showInstructions && preset?.instructions && (
                <ol className="text-xs text-amber-900 list-decimal list-inside space-y-1 mt-2 border-t border-amber-200 pt-2">
                  {preset.instructions.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* Password field */}
          <div className="space-y-2">
            <Label htmlFor="imap-password">
              {needsAppPassword ? 'App-specific password' : 'Password'}
            </Label>
            <div className="relative">
              <Input
                id="imap-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={needsAppPassword ? 'font-mono' : undefined}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {preset?.passwordFormatHint && (
              <p className="text-xs text-muted-foreground">{preset.passwordFormatHint}</p>
            )}
          </div>

          {/* Advanced/manual settings */}
          {(showManualSettings || !preset) && (
            <div className="space-y-3 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">
                {preset ? 'Advanced settings' : 'Enter your IMAP settings manually'}
              </p>
              <div className="space-y-2">
                <Label htmlFor="imap-host" className="text-xs">
                  IMAP server
                </Label>
                <Input
                  id="imap-host"
                  placeholder="imap.example.com"
                  value={manualHost}
                  onChange={(e) => setManualHost(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="imap-port" className="text-xs">
                  Port
                </Label>
                <Input
                  id="imap-port"
                  type="number"
                  value={manualPort}
                  onChange={(e) => setManualPort(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Error message */}
          {errorMessage && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Connect Email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Step 4.4: Run tests to verify they pass

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx vitest run src/components/onboarding/__tests__/ImapConnectionModal.test.tsx
```

Expected: All 7 tests pass.

### Step 4.5: Run full test suite to check no regressions

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx vitest run
```

Expected: All previously passing tests still pass.

### Step 4.6: Commit

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
git add src/components/onboarding/ImapConnectionModal.tsx src/components/onboarding/__tests__/ImapConnectionModal.test.tsx && \
git commit -m "feat: add ImapConnectionModal with auto-detect and app-password guidance

BizzyBee-branded modal for connecting iCloud, Fastmail, Yahoo, Zoho,
and generic IMAP providers. Features:
- Live provider auto-detect on email blur (hardcoded presets + ISPDB)
- Preemptive amber warning for providers that require app-specific
  passwords, with inline 'Show me how' instructions and a direct
  link to the provider's app-password page
- Monospace password field with format hint
- Manual server/port fields that expand when detection fails
- Smart error mapping: AUTHENTICATION_FAILED shows provider-aware
  guidance about app-specific passwords

Replaces the Aurinko hosted sign-in page for password-based providers.
OAuth providers (Gmail, Outlook) continue to use the existing
aurinko-auth-start redirect flow."
```

---

## Task 5: Refactor `EmailConnectionStep.tsx`

**Files:**

- Modify: `src/components/onboarding/EmailConnectionStep.tsx`

### Step 5.1: Update provider list — remove Yahoo

Find the `emailProviders` array (around line 64). Replace with:

```ts
const emailProviders = [
  {
    id: 'gmail' as Provider,
    name: 'Gmail',
    icon: 'https://www.google.com/gmail/about/static-2.0/images/logo-gmail.png',
    available: true,
  },
  {
    id: 'outlook' as Provider,
    name: 'Outlook',
    icon: null,
    iconColor: 'text-blue-600',
    available: true,
  },
  {
    id: 'icloud' as Provider,
    name: 'iCloud Mail',
    icon: null,
    iconColor: 'text-sky-500',
    available: true,
  },
  {
    id: 'imap' as Provider,
    name: 'Other',
    icon: null,
    iconColor: 'text-bb-warm-gray',
    available: true,
    subtitle: 'Fastmail, Yahoo, ProtonMail, Zoho, or any IMAP provider',
  },
];
```

Also update the `Provider` type alias at line 19:

```ts
type Provider = 'gmail' | 'outlook' | 'icloud' | 'imap';
```

(Removed `'yahoo'`.)

### Step 5.2: Add modal state and import

At the top of the file, add the import:

```ts
import { ImapConnectionModal } from './ImapConnectionModal';
```

Inside the component function, near the other `useState` hooks:

```ts
const [imapModalOpen, setImapModalOpen] = useState(false);
```

### Step 5.3: Update `handleConnect` to route based on provider

Find `handleConnect` (around line 288). Replace the function with:

```ts
const handleConnect = async (provider: Provider) => {
  if (isPreview) {
    toast.info('Email connection is not available in preview mode');
    return;
  }

  // Password-based providers → open BizzyBee modal
  if (provider === 'icloud' || provider === 'imap') {
    setSelectedProvider(provider);
    setImapModalOpen(true);
    return;
  }

  // OAuth providers (Gmail, Outlook) → existing Aurinko redirect flow (unchanged)
  setIsConnecting(true);
  setSelectedProvider(provider);

  try {
    const { data, error } = await supabase.functions.invoke('aurinko-auth-start', {
      body: {
        workspaceId,
        provider,
        importMode,
        origin: window.location.origin,
      },
    });

    if (error) {
      logger.error('Error from aurinko-auth-start', error);
      toast.error('Failed to start email connection');
      setIsConnecting(false);
      return;
    }

    if (!data?.authUrl) {
      logger.error('No auth URL returned');
      toast.error('Failed to get authentication URL');
      setIsConnecting(false);
      return;
    }

    window.location.href = data.authUrl;
  } catch (error) {
    logger.error('Error starting OAuth', error);
    toast.error('Failed to start email connection');
    setIsConnecting(false);
  }
};
```

### Step 5.4: Mount the modal in the JSX

At the bottom of the component's return statement (just before the outer closing `</div>`), add:

```tsx
{
  imapModalOpen &&
    selectedProvider &&
    (selectedProvider === 'icloud' || selectedProvider === 'imap') && (
      <ImapConnectionModal
        open={imapModalOpen}
        workspaceId={workspaceId}
        provider={selectedProvider}
        importMode={importMode}
        onClose={() => {
          setImapModalOpen(false);
          setSelectedProvider(null);
        }}
        onConnected={(email) => {
          setImapModalOpen(false);
          setConnectedEmail(email);
          onEmailConnected(email);
          void checkEmailConnection();
        }}
      />
    );
}
```

### Step 5.5: Run full test suite

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx vitest run
```

Expected: All tests pass (ImapConnectionModal tests + providerPresets tests + any existing tests).

### Step 5.6: Type check

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx tsc --noEmit
```

Expected: No type errors.

### Step 5.7: Commit

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
git add src/components/onboarding/EmailConnectionStep.tsx && \
git commit -m "refactor: route EmailConnectionStep by provider type

handleConnect now branches:
- Gmail / Outlook → existing Aurinko OAuth redirect (unchanged)
- iCloud / Other (IMAP) → open new BizzyBee-branded ImapConnectionModal

Removed Yahoo from the provider grid (auto-detected under 'Other').
OAuth path is untouched, so Gmail continues to work exactly as before."
```

---

## Task 6: Build and deploy

### Step 6.1: Production build

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx vite build
```

Expected: `✓ built in Xs`.

### Step 6.2: Push to GitHub

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
git push origin main
```

Expected: All task commits pushed.

### Step 6.3: Deploy via wrangler

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx wrangler pages deploy dist/ --project-name=bizzybee-app --commit-dirty=true
```

Expected: `✨ Deployment complete!` with a preview URL.

---

## Task 7: Investigate Outlook OAuth breakage

This task is research-first, code-second. No tests unless a code change is made.

### Step 7.1: Ask user to reproduce and capture the error

Prompt the user to:

1. Hard refresh the deployed app
2. Click Outlook on the email step
3. Screenshot the exact error that appears (Microsoft error page, Aurinko error, or console error)
4. Share the screenshot and the URL shown at the time of the error

### Step 7.2: Check the auth URL being constructed

Read `supabase/functions/aurinko-auth-start/index.ts` to see what `serviceType` and scopes are sent for Outlook. Compare against Aurinko's docs at https://docs.aurinko.io/.

### Step 7.3: Diagnose based on error shape

Common failure modes and fixes:

| Error                                | Likely cause                                  | Fix                                  |
| ------------------------------------ | --------------------------------------------- | ------------------------------------ |
| "AADSTS50011: redirect URI mismatch" | Aurinko's Azure app has wrong redirect URI    | File Aurinko support ticket          |
| "AADSTS65001: needs consent"         | Consent not granted for Mail scopes           | Check scopes in `aurinko-auth-start` |
| "AADSTS90002: tenant not found"      | Single-tenant Azure app; we need multi-tenant | File Aurinko support ticket          |
| "serviceType invalid"                | Wrong `serviceType` passed                    | Change code to `'Office365'`         |
| 500 from Aurinko                     | Aurinko service issue                         | Wait, retry, or file ticket          |

### Step 7.4: If code fix — apply it with a test

If the fix is in `aurinko-auth-start/index.ts`, write a quick test or manually verify via curl, then commit with message `fix: correct Outlook OAuth parameters`.

### Step 7.5: If Aurinko-side fix needed — mark Outlook as "Coming Soon"

Update `emailProviders` in `EmailConnectionStep.tsx` to set Outlook's `available: false` and add `comingSoon: true`, then commit:

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
git add src/components/onboarding/EmailConnectionStep.tsx && \
git commit -m "chore: mark Outlook as Coming Soon pending Aurinko fix

Outlook OAuth is broken because [specific cause]. Filing a support
ticket with Aurinko. Marking Outlook as Coming Soon in the UI so
users aren't lured into a broken flow."
```

### Step 7.6: Redeploy if needed

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && \
PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx vite build && \
PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx wrangler pages deploy dist/ --project-name=bizzybee-app --commit-dirty=true
```

---

## Task 8: Manual end-to-end verification

### Step 8.1: Verify OAuth redirect fix

1. Have user hard-refresh the deployed app
2. Navigate to email step
3. Click Gmail
4. Complete Google OAuth
5. Verify they land back on `bizzybee-app.pages.dev/onboarding?step=email&aurinko=success` (NOT `bizzybee.app`)

### Step 8.2: Verify iCloud modal flow (if user has iCloud account)

1. Click iCloud Mail
2. Expect BizzyBee modal to open (NOT redirect to api.aurinko.io)
3. Type `sarah@icloud.com` in the email field
4. Expect "Detected: iCloud Mail" green badge
5. Expect amber app-password warning
6. Click "Show me how" — expect inline instructions to appear
7. Click "Generate one now" — expect new tab to appleid.apple.com
8. Paste wrong password, click Connect
9. Expect friendly error: "That password didn't work. iCloud requires an app-specific password..."
10. Paste real app password, click Connect
11. Expect modal to close, green "Email Connected" card to appear

### Step 8.3: Verify Fastmail via "Other" flow

1. Click Other
2. Type `user@fastmail.com`
3. Expect "Detected: Fastmail" badge
4. Expect app-password warning with Fastmail-specific instructions
5. Test with real credentials (if available) or skip

### Step 8.4: Verify custom domain via ISPDB fallback

1. Click Other
2. Type `user@mycompany.co.uk` (or any custom domain)
3. Expect either a detected provider (if ISPDB has it) OR the manual IMAP fields to appear

### Step 8.5: Verify Yahoo auto-detects

1. Click Other
2. Type `user@yahoo.com`
3. Expect "Detected: Yahoo Mail" badge

### Step 8.6: Verify error paths

- Wrong password → friendly error with provider-specific guidance
- Unreachable server → "Couldn't reach..." error
- Invalid email → client-side validation

---

## Done criteria

- [ ] OAuth allowlist fix deployed and verified
- [ ] `providerPresets.ts` library built and tested (13+ tests green)
- [ ] `aurinko-create-imap-account` edge function deployed
- [ ] `ImapConnectionModal` component built and tested (7+ tests green)
- [ ] `EmailConnectionStep` refactored to route by provider
- [ ] Build succeeds with no TypeScript errors
- [ ] All wider tests still pass
- [ ] Deployed to Cloudflare Pages
- [ ] Outlook investigation complete (either fixed or marked Coming Soon)
- [ ] Manual E2E: Gmail lands back on correct URL
- [ ] Manual E2E: iCloud modal opens, detects provider, shows app-password guidance
- [ ] Manual E2E: Other/IMAP flow works for at least one real provider
- [ ] Design doc updated with implementation notes
