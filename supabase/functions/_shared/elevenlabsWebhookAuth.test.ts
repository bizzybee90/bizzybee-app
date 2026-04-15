import { describe, expect, it } from 'vitest';

import {
  buildElevenLabsSignedPayload,
  createSha256HmacHex,
  isElevenLabsTimestampFresh,
  parseElevenLabsSignatureHeader,
  verifyElevenLabsSignatureValue,
} from './elevenlabsWebhookAuth';

describe('parseElevenLabsSignatureHeader', () => {
  it('parses timestamped headers', () => {
    const signature = 'abcd'.padEnd(64, '0');
    expect(parseElevenLabsSignatureHeader(`t=1712966400, v0=${signature}`)).toEqual({
      format: 'timestamped',
      timestamp: '1712966400',
      signature,
    });
  });

  it('parses legacy sha256 headers', () => {
    expect(parseElevenLabsSignatureHeader(`sha256=${'a'.repeat(64)}`)).toEqual({
      format: 'legacy',
      timestamp: null,
      signature: 'a'.repeat(64),
    });
  });

  it('rejects malformed headers', () => {
    expect(parseElevenLabsSignatureHeader('totally-invalid')).toBeNull();
    expect(parseElevenLabsSignatureHeader('t=abc,v0=1234')).toBeNull();
  });
});

describe('isElevenLabsTimestampFresh', () => {
  it('accepts recent timestamps', () => {
    expect(isElevenLabsTimestampFresh(1_712_966_400, 1_712_966_450_000)).toBe(true);
  });

  it('rejects stale timestamps', () => {
    expect(isElevenLabsTimestampFresh(1_712_966_400, 1_712_968_500_000)).toBe(false);
  });

  it('rejects timestamps too far in the future', () => {
    expect(isElevenLabsTimestampFresh(1_712_966_900, 1_712_966_400_000)).toBe(false);
  });
});

describe('verifyElevenLabsSignatureValue', () => {
  const secret = 'super-secret';
  const rawBody = JSON.stringify({ type: 'post_call_transcription', data: { id: 'call_123' } });

  it('verifies timestamped signatures end to end', async () => {
    const timestamp = '1712966400';
    const payload = buildElevenLabsSignedPayload(timestamp, rawBody);
    const signature = await createSha256HmacHex(secret, payload);

    await expect(
      verifyElevenLabsSignatureValue({
        header: `t=${timestamp},v0=${signature}`,
        rawBody,
        secret,
        nowMs: 1_712_966_450_000,
      }),
    ).resolves.toEqual({
      format: 'timestamped',
      timestamp,
      signature,
    });
  });

  it('verifies legacy signatures for backward compatibility', async () => {
    const signature = await createSha256HmacHex(secret, rawBody);

    await expect(
      verifyElevenLabsSignatureValue({
        header: `sha256=${signature}`,
        rawBody,
        secret,
      }),
    ).resolves.toEqual({
      format: 'legacy',
      timestamp: null,
      signature,
    });
  });

  it('rejects expired timestamped signatures', async () => {
    const timestamp = '1712966400';
    const payload = buildElevenLabsSignedPayload(timestamp, rawBody);
    const signature = await createSha256HmacHex(secret, payload);

    await expect(
      verifyElevenLabsSignatureValue({
        header: `t=${timestamp},v0=${signature}`,
        rawBody,
        secret,
        nowMs: 1_712_968_500_000,
      }),
    ).rejects.toThrow('Expired ElevenLabs signature timestamp');
  });
});
