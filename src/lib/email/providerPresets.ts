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

// Shared base for iCloud domains — keeps icloud.com, me.com, mac.com in sync
const ICLOUD_BASE: ProviderPreset = Object.freeze({
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
}) as ProviderPreset;

// Shared base for Fastmail domains
const FASTMAIL_BASE: ProviderPreset = Object.freeze({
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
}) as ProviderPreset;

/**
 * Maps MX hostname patterns to detected providers.
 * Used as Tier 3 detection for custom domains whose MX records reveal
 * a known mail host (Fastmail, Google Workspace, Microsoft 365).
 */
const MX_PROVIDER_MAP: Array<{ pattern: RegExp; preset: ProviderPreset }> = [
  // Fastmail (including custom domains hosted on Fastmail's messagingengine.com)
  {
    pattern: /messagingengine\.com\.?$/i,
    preset: FASTMAIL_BASE,
  },
  // Google Workspace (custom domains using Gmail)
  {
    pattern: /\.google\.com\.?$|\.googlemail\.com\.?$/i,
    preset: Object.freeze({
      name: 'Google Workspace',
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      requiresAppPassword: 'always',
      appPasswordHelpUrl: 'https://myaccount.google.com/apppasswords',
      passwordFormatHint: 'Google app passwords are 16 characters',
      instructions: [
        'Visit myaccount.google.com/apppasswords (sign in if needed)',
        'You may need to enable 2-Step Verification first',
        'Click "Select app", choose "Mail", then "Other (Custom name)" and label it BizzyBee',
        'Copy the 16-character password and paste it below',
      ],
    }) as ProviderPreset,
  },
  // Microsoft 365 (custom domains routed through Office 365)
  {
    pattern: /\.protection\.outlook\.com\.?$|\.outlook\.com\.?$/i,
    preset: Object.freeze({
      name: 'Microsoft 365',
      host: 'outlook.office365.com',
      port: 993,
      secure: true,
      requiresAppPassword: 'always',
      appPasswordHelpUrl: 'https://account.microsoft.com/security',
      passwordFormatHint: 'Microsoft app passwords are 16 lowercase characters',
      instructions: [
        'Sign in to account.microsoft.com/security',
        'Make sure 2-Step Verification is enabled',
        'Go to Advanced security options → App passwords',
        'Click "Create a new app password" and label it BizzyBee',
        'Copy the password and paste it below',
      ],
    }) as ProviderPreset,
  },
];

const HARDCODED_PRESETS: Record<string, ProviderPreset> = {
  'icloud.com': ICLOUD_BASE,
  'me.com': ICLOUD_BASE,
  'mac.com': ICLOUD_BASE,
  'fastmail.com': FASTMAIL_BASE,
  'fastmail.fm': FASTMAIL_BASE,
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
  if (!match) return null;
  const domain = match[1];
  // RFC-1035-ish: labels of [a-z0-9-] separated by dots, no leading/trailing dot or hyphen
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    return null;
  }
  return domain;
}

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
    const rawXml = await response.text();
    // Strip XML comments so commented-out elements don't leak into matches
    const xml = rawXml.replace(/<!--[\s\S]*?-->/g, '');

    // Match <incomingServer ...type=["']imap["']...> regardless of attribute order or quote style
    const imapBlock = xml.match(
      /<incomingServer\b[^>]*\btype=["']imap["'][^>]*>([\s\S]*?)<\/incomingServer>/i,
    );
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

interface DnsAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

interface DnsResponse {
  Status: number;
  Answer?: DnsAnswer[];
}

/**
 * Tier 3: Look up the domain's MX records via DNS-over-HTTPS and match
 * the hostnames against known mail providers. This catches custom domains
 * hosted by Fastmail, Google Workspace, Microsoft 365, etc.
 */
async function lookupViaMx(domain: string): Promise<ProviderPreset | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      {
        headers: { Accept: 'application/dns-json' },
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);

    if (!response.ok) return null;
    const dns = (await response.json()) as DnsResponse;
    if (dns.Status !== 0 || !dns.Answer || dns.Answer.length === 0) return null;

    // Each MX answer's `data` looks like "10 mail.example.com.". Strip the priority.
    for (const answer of dns.Answer) {
      const parts = answer.data.trim().split(/\s+/);
      const host = parts[parts.length - 1] ?? '';
      for (const { pattern, preset } of MX_PROVIDER_MAP) {
        if (pattern.test(host)) {
          return preset;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Look up a provider preset for an email address.
 *
 * Tier 1: Hardcoded presets (instant).
 * Tier 2: Mozilla ISPDB (async fetch to autoconfig.thunderbird.net).
 * Tier 3: MX records via DNS-over-HTTPS (Cloudflare).
 *
 * Returns null if the domain isn't recognised by any tier.
 */
export async function lookupProvider(email: string): Promise<ProviderPreset | null> {
  const domain = extractDomain(email);
  if (!domain) return null;

  // Tier 1: hardcoded
  if (HARDCODED_PRESETS[domain]) {
    return HARDCODED_PRESETS[domain];
  }

  // Tier 2: Mozilla ISPDB
  const ispdbResult = await lookupIspdb(domain);
  if (ispdbResult) return ispdbResult;

  // Tier 3: MX records via DNS-over-HTTPS
  return lookupViaMx(domain);
}
