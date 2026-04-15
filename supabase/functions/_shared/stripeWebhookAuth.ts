export interface ParsedStripeSignature {
  timestamp: string;
  signatures: string[];
}

function timingSafeEqualHex(expected: string, actual: string): boolean {
  const expectedBytes = new TextEncoder().encode(expected);
  const actualBytes = new TextEncoder().encode(actual);
  if (expectedBytes.length !== actualBytes.length) return false;

  let result = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    result |= expectedBytes[index] ^ actualBytes[index];
  }

  return result === 0;
}

export async function createStripeHmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function parseStripeSignatureHeader(
  signatureHeader: string | null | undefined,
): ParsedStripeSignature | null {
  if (!signatureHeader) {
    return null;
  }

  const fragments = signatureHeader.split(',').map((fragment) => fragment.trim());
  const timestamp = fragments.find((fragment) => fragment.startsWith('t='))?.slice(2);
  const signatures = fragments
    .filter((fragment) => fragment.startsWith('v1='))
    .map((fragment) => fragment.slice(3))
    .filter(Boolean);

  if (!timestamp || signatures.length === 0) {
    return null;
  }

  return { timestamp, signatures };
}

export async function verifyStripeWebhookSignatureValue(params: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret: string;
}): Promise<boolean> {
  const parsed = parseStripeSignatureHeader(params.signatureHeader);
  if (!parsed) {
    return false;
  }

  const signedPayload = `${parsed.timestamp}.${params.rawBody}`;
  const expectedSignature = await createStripeHmacSha256Hex(params.secret, signedPayload);
  return parsed.signatures.some((candidate) => timingSafeEqualHex(expectedSignature, candidate));
}
