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

  // Tier 2: Mozilla ISPDB
  return lookupIspdb(domain);
}
