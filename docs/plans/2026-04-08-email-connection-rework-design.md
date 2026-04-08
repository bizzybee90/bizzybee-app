# Email Connection Rework — Design

**Date:** 2026-04-08
**Status:** Approved
**Author:** Michael + Claude

## Problem

The onboarding email connection step has several interconnected issues:

1. **iCloud and "Other (IMAP)" redirect to Aurinko's generic hosted form.** Customers see a third-party domain (`api.aurinko.io`), an unbranded page, and a confusing provider dropdown that often defaults to the wrong provider. This breaks BizzyBee branding at a critical moment in the onboarding flow.

2. **Outlook OAuth is broken.** Clicking Outlook currently shows a Microsoft error page. Users report it's been broken for a while. Cause is unknown — likely a misconfigured Azure AD app registration in Aurinko's side or a scope/redirect URI mismatch.

3. **Gmail works but the post-OAuth redirect often lands on the wrong domain.** The callback's origin allowlist only includes `bizzybee.app` and `app.bizzybee.co.uk` — not `bizzybee-app.pages.dev` or its preview deploys. Users on Cloudflare Pages URLs get bounced to a different domain after OAuth completes.

4. **There is no clear guidance that app-specific passwords are required.** Users attempting to connect iCloud, Fastmail, Yahoo, or Zoho via IMAP instinctively paste their main account password, get a generic "authentication failed" error, and give up.

5. **Yahoo is shown as "Coming Soon" but it just works via IMAP.** Unnecessary clutter.

## Goal

Replace the Aurinko hosted IMAP form with a BizzyBee-branded modal that handles iCloud, Fastmail, Yahoo, Zoho, and generic IMAP through a single auto-detecting interface. Keep Gmail and Outlook OAuth flows intact but fix the broken origin handling. Investigate and fix Outlook's OAuth breakage inline. Simplify the provider grid by removing Yahoo (it's automatically detected).

## Non-goals

- Changing the Gmail OAuth flow (it works, don't touch it)
- Supporting ProtonMail IMAP directly (requires Proton Bridge running locally, out of scope for v1)
- Restructuring the import-mode radio group above the providers
- Adding more providers beyond what already exists

## Decisions

| Provider         | Flow                                     | Notes                                                            |
| ---------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| **Gmail**        | Aurinko OAuth (unchanged)                | Works today, keep as-is                                          |
| **Outlook**      | Aurinko OAuth (investigate + fix)        | Fall back to "Coming Soon" if Aurinko-side fix required          |
| **iCloud**       | New BizzyBee modal (IMAP + app-password) | Apple has no OAuth for mail, this is the only option             |
| **Other (IMAP)** | New BizzyBee modal (auto-detect)         | Covers Fastmail, Yahoo, Zoho, custom domains, etc.               |
| **Yahoo**        | Removed from grid                        | Users type `@yahoo.com` into the Other modal, gets auto-detected |

## Architecture

**Files to create:**

- `src/components/onboarding/ImapConnectionModal.tsx` — BizzyBee-branded modal with auto-detect form, app-password guidance, and smart error mapping
- `src/lib/email/providerPresets.ts` — hardcoded lookup table + Mozilla ISPDB fetcher
- `supabase/functions/aurinko-create-imap-account/index.ts` — edge function wrapping Aurinko's `POST /v1/am/accounts` endpoint

**Files to modify:**

- `src/components/onboarding/EmailConnectionStep.tsx` — route handler by provider, remove Yahoo, mount modal, delete stale `PUBLISHED_URL` constant
- `supabase/functions/aurinko-auth-callback/index.ts` — tighten origin allowlist with pattern matching

**Files unchanged:**

- `supabase/functions/aurinko-auth-start/index.ts` — still handles Gmail and Outlook OAuth URL construction
- `supabase/functions/aurinko-webhook/index.ts` — webhook handler stays the same

## Flow split at `handleConnect(provider)`

```
User clicks provider button
       ↓
       ├── Gmail → existing Aurinko OAuth redirect (unchanged)
       ├── Outlook → existing Aurinko OAuth redirect (investigate + fix)
       ├── iCloud → open ImapConnectionModal with iCloud preset
       └── Other (IMAP) → open ImapConnectionModal (auto-detect mode)
```

## ImapConnectionModal component

**Props:**

```ts
interface ImapConnectionModalProps {
  open: boolean;
  workspaceId: string;
  provider: 'icloud' | 'imap';
  importMode: ImportMode;
  onClose: () => void;
  onConnected: (email: string) => void;
}
```

**Form fields:**

- Email address (with live auto-detect badge)
- App-specific password (monospace, show/hide, paste-aware)
- Advanced settings accordion (host, port, security — pre-filled, editable)

**Auto-detect tiers (runs on email blur, debounced 500ms):**

1. **Hardcoded fast path.** `providerPresets.ts` has entries for icloud.com, me.com, mac.com, fastmail.com, fastmail.fm, zoho.com, yahoo.com, aol.com — instant.
2. **Mozilla ISPDB.** For everything else, fetch `https://autoconfig.thunderbird.net/v1.1/{domain}` (5-second timeout). Parse the `<emailProvider>` XML block for IMAP hostname and port.
3. **Manual fallback.** If both fail, show an amber warning and auto-expand the advanced section with placeholder hints.

**Provider preset metadata:**

```ts
{
  'icloud.com': {
    name: 'iCloud Mail',
    host: 'imap.mail.me.com',
    port: 993,
    requiresAppPassword: 'always',
    appPasswordHelpUrl: 'https://appleid.apple.com/account/manage/section/security',
    passwordFormatHint: 'Apple app passwords are 16 characters with dashes: xxxx-xxxx-xxxx-xxxx',
    instructions: [
      'Visit appleid.apple.com and sign in',
      'Go to Sign-In and Security → App-Specific Passwords',
      'Click + and label it "BizzyBee"',
      'Copy the generated password',
    ],
  },
  // ... same shape for fastmail.com, yahoo.com, zoho.com, aol.com
}
```

## App-specific password UX

**Preemptive warning (amber callout above the password field):**

```
⚠  iCloud needs an app-specific password

Your regular Apple ID password won't work. You'll need to
generate a one-time password for BizzyBee.

[Show me how →]    [Generate one now ↗]
```

- **"Show me how →"** expands an inline accordion with the 4-step instructions from the provider preset. No tab switch needed.
- **"Generate one now ↗"** opens the provider's app-password page in a new tab.
- **Password field label** changes from "Password" to "App-specific password" when required.
- **Format hint** appears below the field: "Format: 16 characters with dashes".

**Smart error mapping (when Aurinko returns `AUTHENTICATION_FAILED`):**

```
If requiresAppPassword === 'always':
  "That password didn't work. iCloud requires an app-specific password,
   not your Apple ID password. [Show me how to create one]"

If requiresAppPassword === 'with_2fa':
  "Authentication failed. If you have 2-factor authentication enabled,
   Zoho requires an app-specific password. [Show me how]"

If requiresAppPassword === 'unknown':
  "Authentication failed. Check your email and password. Some providers
   require an app-specific password instead of your regular one."
```

**Password field UX details:**

- Monospace font so dashes align visually
- Show/hide toggle button
- Paste-aware: strip whitespace, detect expected format, show ✓ on match
- On blur, if the format clearly doesn't match the expected pattern, show a subtle warning

## Edge function: `aurinko-create-imap-account`

**Endpoint:** `POST /functions/v1/aurinko-create-imap-account`

**Request body:**

```ts
{
  workspaceId: string;
  email: string;
  password: string;
  host: string;
  port: number;
  secure?: boolean;
  importMode: ImportMode;
}
```

**Flow:**

1. `validateAuth(req, workspaceId)` — confirm caller owns the workspace
2. POST to `https://api.aurinko.io/v1/am/accounts` with Basic auth using `AURINKO_CLIENT_ID:AURINKO_CLIENT_SECRET` and body containing the IMAP credentials
3. Handle error responses — map to typed error codes
4. On success, replicate the OAuth callback's post-connect work:
   - Encrypt access token via `store_encrypted_token` RPC
   - Insert into `email_provider_configs` with `provider='imap'`
   - Create Aurinko webhook subscription for `/email/messages`
   - Upsert `email_import_progress` with `current_phase='idle'`
5. Return `{ success: true, email }` to the client

**SMTP inference:** Take the IMAP host, replace leading `imap.` with `smtp.`, use port 587 (STARTTLS). iCloud hardcoded to `smtp.mail.me.com:587`.

**Error shapes:**

```ts
// Success
{ success: true, email: 'sarah@icloud.com' }

// Auth failure
{
  success: false,
  error: 'AUTHENTICATION_FAILED',
  message: 'Email or password is incorrect',
  providerHint: 'icloud',
  requiresAppPassword: 'always',
}

// IMAP unreachable
{
  success: false,
  error: 'IMAP_UNREACHABLE',
  message: "Couldn't reach imap.mail.me.com. Check your server settings.",
}

// Aurinko down
{
  success: false,
  error: 'SERVICE_UNAVAILABLE',
  message: 'Our email service is temporarily unavailable. Please try again.',
  retryable: true,
}
```

**Security:**

- Password never logged (explicit redaction in any logger calls)
- Aurinko access token encrypted via existing `store_encrypted_token` RPC
- Raw IMAP password passed through to Aurinko and discarded — never stored
- CORS headers from existing `_shared/auth.ts` pattern

## EmailConnectionStep refactor

**Provider list (Yahoo removed):**

```ts
const emailProviders = [
  { id: 'gmail', name: 'Gmail', available: true },
  { id: 'outlook', name: 'Outlook', available: true },
  { id: 'icloud', name: 'iCloud Mail', available: true },
  {
    id: 'imap',
    name: 'Other',
    available: true,
    subtitle: 'Fastmail, Yahoo, ProtonMail, Zoho, or any IMAP provider',
  },
];
```

**`handleConnect` becomes a router:**

```ts
const handleConnect = async (provider: Provider) => {
  if (isPreview) {
    toast.info('Email connection is not available in preview mode');
    return;
  }

  if (provider === 'icloud' || provider === 'imap') {
    setSelectedProvider(provider);
    setImapModalOpen(true);
    return;
  }

  // OAuth providers (Gmail, Outlook) — existing flow, unchanged
  setIsConnecting(true);
  setSelectedProvider(provider);
  try {
    const { data, error } = await supabase.functions.invoke('aurinko-auth-start', {
      body: { workspaceId, provider, importMode, origin: window.location.origin },
    });
    // existing error handling + redirect
  } catch (error) {
    // existing catch
  }
};
```

**New state and modal mount:**

```ts
const [imapModalOpen, setImapModalOpen] = useState(false);

{imapModalOpen && (
  <ImapConnectionModal
    open={imapModalOpen}
    workspaceId={workspaceId}
    provider={selectedProvider as 'icloud' | 'imap'}
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
)}
```

When the modal reports success, the parent reuses `checkEmailConnection` — existing connected-email UI, import progress polling, and Continue button all light up identically to the OAuth path.

## OAuth redirect fix

**Bug location:** `supabase/functions/aurinko-auth-callback/index.ts` lines 3-8 and line 139.

```ts
const ALLOWED_ORIGINS = [
  'https://bizzybee.app',
  'https://app.bizzybee.co.uk',
  'http://localhost:5173',
  'http://localhost:8080',
];

// line 139
const appOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : defaultOrigin;
```

The allowlist doesn't include `bizzybee-app.pages.dev` or its preview URLs, so users on Cloudflare Pages deploys get bounced to the wrong domain after OAuth.

**Fix: pattern-based origin validation:**

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

const appOrigin = isAllowedOrigin(origin) ? origin : defaultOrigin;
```

Applied in both places the allowlist is consulted: the cancellation path (around line 101) and the success path (line 139).

**Regex safety:**

- `^https:\/\/` — anchors to start, requires HTTPS
- `[a-z0-9]+` — lowercase alphanumeric subdomain (no dots, no dashes, no path characters)
- `\.bizzybee-app\.pages\.dev$` — literal dots, anchored to end
- Rejects: `evil.bizzybee-app.pages.dev.attacker.com` (end anchor blocks), `bizzybee-app.pages.dev.attacker.com` (no subdomain, fails the pattern), `http://...` (protocol mismatch)

**Additional cleanups:**

- Remove the stale `PUBLISHED_URL = 'https://embrace-channel-pix.lovable.app'` constant at line 142 of `EmailConnectionStep.tsx`
- Verify `APP_URL` environment variable in Supabase is set to the correct production URL; if missing, set it via the Supabase MCP

## Outlook investigation

Before falling back to "Coming Soon", investigate the actual error:

1. Ask the user to reproduce the Outlook flow and capture the exact error message / screenshot
2. Check Aurinko's docs for Office365 OAuth requirements
3. Inspect the auth URL being constructed in `aurinko-auth-start` — is `serviceType=Office365` correct? Are the scopes right?
4. Check whether the Aurinko dashboard has Microsoft OAuth enabled for this client
5. If the issue is on Aurinko's side (app registration, consent config), file a support ticket and mark Outlook as "Coming Soon" in the UI
6. If the issue is fixable in our code (wrong scope, wrong serviceType), fix it and verify

## Error handling summary

| Failure                                  | Behaviour                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Gmail OAuth works                        | Unchanged                                                              |
| Outlook OAuth broken                     | Investigate; if Aurinko-side, show "Coming Soon" temporarily           |
| iCloud IMAP — wrong password             | Inline error with "You need an app-specific password" guidance         |
| iCloud IMAP — Aurinko down               | Retryable error, "Try again" button                                    |
| Other IMAP — detection fails             | Auto-expand manual settings, show warning                              |
| Other IMAP — Aurinko rejects credentials | Smart error map based on detected provider                             |
| Origin not in allowlist                  | Fall back to `APP_URL` (existing behaviour, but allowlist now broader) |

## Testing

**Unit tests:**

- `providerPresets.ts` — lookup by domain, Mozilla ISPDB fallback mock
- `isAllowedOrigin` — positive and negative cases (see regex safety above)

**Component tests (vitest + RTL):**

- `ImapConnectionModal`:
  - Auto-detect fires on email blur, updates detection badge
  - Hardcoded preset takes precedence over ISPDB
  - ISPDB failure shows manual fallback
  - App-password warning appears for iCloud/Fastmail/Yahoo
  - "Show me how" accordion expands inline
  - Format hint shows correct pattern per provider
  - Submit calls edge function with correct body
  - Auth failure shows provider-aware error message
  - Success closes modal and calls `onConnected`

**Edge function tests:**

- Happy path — valid credentials return success
- Auth failure — Aurinko 401 maps to `AUTHENTICATION_FAILED`
- IMAP unreachable — Aurinko 503 or connection refused maps to `IMAP_UNREACHABLE`
- Missing required fields — validation error
- Ownership check — different workspace returns 403

**Manual E2E:**

- Gmail OAuth from `bizzybee-app.pages.dev` — lands back on the same URL
- iCloud via modal — connect with a real Apple ID + app-specific password
- Fastmail via Other — type `@fastmail.com`, see auto-detect, connect
- Custom domain via Other — type `@mycompany.com`, see ISPDB fallback or manual form
- Failure path — enter wrong password for iCloud, confirm guidance appears

## Trade-offs considered

- **Approach A (chosen):** Additive refactor — route `handleConnect` per provider, OAuth path untouched, IMAP path new. Smallest risk to the working Gmail flow.
- **Approach B:** Full rewrite of `EmailConnectionStep` with extracted sub-components. Cleaner but high risk of breaking Gmail.
- **Approach C:** Generic provider abstraction with config-driven flow. Over-engineered for 4 providers; YAGNI.

Approach A wins because it isolates the new IMAP work from the OAuth path completely. If anything in the IMAP flow breaks, Gmail keeps working.
