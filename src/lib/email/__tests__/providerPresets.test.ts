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
