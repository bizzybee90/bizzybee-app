import { describe, expect, it } from 'vitest';

import {
  createStripeHmacSha256Hex,
  parseStripeSignatureHeader,
  verifyStripeWebhookSignatureValue,
} from './stripeWebhookAuth';

describe('parseStripeSignatureHeader', () => {
  it('parses timestamped Stripe signatures', () => {
    expect(parseStripeSignatureHeader('t=1713000000,v1=abc123,v1=def456')).toEqual({
      timestamp: '1713000000',
      signatures: ['abc123', 'def456'],
    });
  });

  it('rejects malformed signature headers', () => {
    expect(parseStripeSignatureHeader('totally-invalid')).toBeNull();
    expect(parseStripeSignatureHeader('t=1713000000')).toBeNull();
  });
});

describe('verifyStripeWebhookSignatureValue', () => {
  it('accepts a valid Stripe-style v1 signature', async () => {
    const secret = 'whsec_test';
    const rawBody = JSON.stringify({
      id: 'evt_123',
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription' } },
    });
    const timestamp = '1713000000';
    const signature = await createStripeHmacSha256Hex(secret, `${timestamp}.${rawBody}`);

    await expect(
      verifyStripeWebhookSignatureValue({
        rawBody,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        secret,
      }),
    ).resolves.toBe(true);
  });

  it('rejects malformed or mismatched signatures', async () => {
    const secret = 'whsec_test';
    const rawBody = JSON.stringify({
      id: 'evt_456',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_123' } },
    });
    const timestamp = '1713000000';
    const signature = await createStripeHmacSha256Hex(secret, `${timestamp}.${rawBody}`);

    await expect(
      verifyStripeWebhookSignatureValue({
        rawBody,
        signatureHeader: `t=${timestamp},v1=${signature.slice(0, -2)}aa`,
        secret,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyStripeWebhookSignatureValue({
        rawBody,
        signatureHeader: 'totally-invalid',
        secret,
      }),
    ).resolves.toBe(false);
  });
});
