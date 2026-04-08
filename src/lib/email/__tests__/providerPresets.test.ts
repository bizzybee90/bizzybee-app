import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lookupProvider } from '../providerPresets';

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

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () => mockXml,
    } as Response);

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
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false, status: 404 } as Response);
    const result = await lookupProvider('user@nowhere.invalid');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('network'));
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
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () => pop3OnlyXml,
    } as Response);
    const result = await lookupProvider('user@x.com');
    expect(result).toBeNull();
  });

  it('prefers hardcoded preset over ISPDB (does not fetch)', async () => {
    await lookupProvider('user@fastmail.com');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('lookupProvider — MX-based detection (Tier 3)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockResponses(handlers: Record<string, () => Promise<unknown>>) {
    vi.mocked(globalThis.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      for (const [pattern, handler] of Object.entries(handlers)) {
        if (url.includes(pattern)) {
          const data = await handler();
          if (data === 'NOT_FOUND') {
            return new Response('', { status: 404 });
          }
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      return new Response('', { status: 404 });
    });
  }

  it('detects Fastmail when MX points to messagingengine.com', async () => {
    mockResponses({
      'autoconfig.thunderbird.net': async () => 'NOT_FOUND',
      'cloudflare-dns.com': async () => ({
        Status: 0,
        Answer: [
          { name: 'maccleaning.uk', type: 15, TTL: 300, data: '10 in1-smtp.messagingengine.com.' },
          { name: 'maccleaning.uk', type: 15, TTL: 300, data: '20 in2-smtp.messagingengine.com.' },
        ],
      }),
    });

    const result = await lookupProvider('michael@maccleaning.uk');

    expect(result).not.toBeNull();
    expect(result?.name).toBe('Fastmail');
    expect(result?.host).toBe('imap.fastmail.com');
    expect(result?.requiresAppPassword).toBe('always');
    expect(result?.appPasswordHelpUrl).toContain('fastmail.com');
  });

  it('detects Google Workspace when MX points to google.com', async () => {
    mockResponses({
      'autoconfig.thunderbird.net': async () => 'NOT_FOUND',
      'cloudflare-dns.com': async () => ({
        Status: 0,
        Answer: [
          { name: 'example.com', type: 15, TTL: 300, data: '1 aspmx.l.google.com.' },
          { name: 'example.com', type: 15, TTL: 300, data: '5 alt1.aspmx.l.google.com.' },
        ],
      }),
    });

    const result = await lookupProvider('user@example.com');

    expect(result).not.toBeNull();
    expect(result?.name).toBe('Google Workspace');
    expect(result?.host).toBe('imap.gmail.com');
    expect(result?.requiresAppPassword).toBe('always');
  });

  it('detects Microsoft 365 when MX points to outlook.com', async () => {
    mockResponses({
      'autoconfig.thunderbird.net': async () => 'NOT_FOUND',
      'cloudflare-dns.com': async () => ({
        Status: 0,
        Answer: [
          {
            name: 'example.com',
            type: 15,
            TTL: 300,
            data: '0 example-com.mail.protection.outlook.com.',
          },
        ],
      }),
    });

    const result = await lookupProvider('user@example.com');

    expect(result).not.toBeNull();
    expect(result?.name).toBe('Microsoft 365');
    expect(result?.host).toBe('outlook.office365.com');
    expect(result?.requiresAppPassword).toBe('always');
  });

  it('returns null when MX records do not match any known provider', async () => {
    mockResponses({
      'autoconfig.thunderbird.net': async () => 'NOT_FOUND',
      'cloudflare-dns.com': async () => ({
        Status: 0,
        Answer: [
          { name: 'example.com', type: 15, TTL: 300, data: '10 mail.someweirdhost.example.' },
        ],
      }),
    });

    const result = await lookupProvider('user@example.com');
    expect(result).toBeNull();
  });

  it('returns null when MX query fails', async () => {
    mockResponses({
      'autoconfig.thunderbird.net': async () => 'NOT_FOUND',
      'cloudflare-dns.com': async () => 'NOT_FOUND',
    });

    const result = await lookupProvider('user@example.com');
    expect(result).toBeNull();
  });

  it('returns null when MX query throws', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('autoconfig.thunderbird.net')) {
        return new Response('', { status: 404 });
      }
      throw new Error('network');
    });

    const result = await lookupProvider('user@example.com');
    expect(result).toBeNull();
  });

  it('still prefers hardcoded preset over MX lookup', async () => {
    mockResponses({
      'cloudflare-dns.com': async () => ({
        Status: 0,
        Answer: [
          { name: 'fastmail.com', type: 15, TTL: 300, data: '10 in1-smtp.messagingengine.com.' },
        ],
      }),
    });

    await lookupProvider('user@fastmail.com');

    // Cloudflare DNS should NOT be called for hardcoded domains
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    const dnsCalls = calls.filter((call) => {
      const url = typeof call[0] === 'string' ? call[0] : (call[0] as URL).toString();
      return url.includes('cloudflare-dns.com');
    });
    expect(dnsCalls).toHaveLength(0);
  });
});

describe('lookupProvider — edge cases', () => {
  it('returns null for empty string', async () => {
    expect(await lookupProvider('')).toBeNull();
  });

  it('returns null for a string with no @', async () => {
    expect(await lookupProvider('not-an-email')).toBeNull();
  });

  it('handles trailing whitespace in email', async () => {
    expect(await lookupProvider('user@icloud.com ')).toMatchObject({
      name: 'iCloud Mail',
    });
  });

  it('rejects path injection attempts in the domain', async () => {
    expect(await lookupProvider('user@evil.com/../x')).toBeNull();
    expect(await lookupProvider('user@evil.com?q=1')).toBeNull();
    expect(await lookupProvider('user@evil.com#frag')).toBeNull();
  });

  it('rejects malformed domains with leading/trailing dots', async () => {
    expect(await lookupProvider('user@.evil.com')).toBeNull();
    expect(await lookupProvider('user@evil.com.')).toBeNull();
    expect(await lookupProvider('user@..evil.com')).toBeNull();
  });
});
