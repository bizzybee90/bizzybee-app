const DEFAULT_TOLERANCE_SECONDS = 30 * 60;
const DEFAULT_FUTURE_SKEW_SECONDS = 5 * 60;

export type ParsedElevenLabsSignature =
  | {
      format: 'timestamped';
      timestamp: string;
      signature: string;
    }
  | {
      format: 'legacy';
      timestamp: null;
      signature: string;
    };

type VerifyElevenLabsSignatureParams = {
  header: string;
  rawBody: string;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
  futureSkewSeconds?: number;
};

function normalizeHex(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^sha256=/, '');
}

function isHexSignature(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function buildElevenLabsSignedPayload(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

export function parseElevenLabsSignatureHeader(header: string): ParsedElevenLabsSignature | null {
  const trimmed = header.trim();
  if (!trimmed) {
    return null;
  }

  if (!trimmed.includes(',')) {
    const signature = normalizeHex(trimmed);
    if (!isHexSignature(signature)) {
      return null;
    }

    return {
      format: 'legacy',
      timestamp: null,
      signature,
    };
  }

  const segments = trimmed
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  const values = new Map<string, string>();
  for (const segment of segments) {
    const [rawKey, ...rest] = segment.split('=');
    if (!rawKey || rest.length === 0) {
      continue;
    }

    values.set(rawKey.trim().toLowerCase(), rest.join('=').trim());
  }

  const timestamp = values.get('t');
  const signature = normalizeHex(values.get('v0') ?? '');
  if (!timestamp || !/^\d+$/.test(timestamp) || !isHexSignature(signature)) {
    return null;
  }

  return {
    format: 'timestamped',
    timestamp,
    signature,
  };
}

export function isElevenLabsTimestampFresh(
  timestampSeconds: number,
  nowMs = Date.now(),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  futureSkewSeconds = DEFAULT_FUTURE_SKEW_SECONDS,
): boolean {
  const nowSeconds = Math.floor(nowMs / 1000);
  return (
    timestampSeconds >= nowSeconds - toleranceSeconds &&
    timestampSeconds <= nowSeconds + futureSkewSeconds
  );
}

export async function createSha256HmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyElevenLabsSignatureValue({
  header,
  rawBody,
  secret,
  nowMs,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  futureSkewSeconds = DEFAULT_FUTURE_SKEW_SECONDS,
}: VerifyElevenLabsSignatureParams): Promise<ParsedElevenLabsSignature> {
  const parsed = parseElevenLabsSignatureHeader(header);
  if (!parsed) {
    throw new Error('Malformed ElevenLabs signature header');
  }

  const payload =
    parsed.format === 'timestamped'
      ? buildElevenLabsSignedPayload(parsed.timestamp, rawBody)
      : rawBody;

  if (
    parsed.format === 'timestamped' &&
    !isElevenLabsTimestampFresh(
      Number(parsed.timestamp),
      nowMs,
      toleranceSeconds,
      futureSkewSeconds,
    )
  ) {
    throw new Error('Expired ElevenLabs signature timestamp');
  }

  const expected = await createSha256HmacHex(secret, payload);
  if (!timingSafeEqual(parsed.signature, expected)) {
    throw new Error('Invalid ElevenLabs signature');
  }

  return parsed;
}
