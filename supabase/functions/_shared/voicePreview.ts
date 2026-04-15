export const ALLOWED_VOICE_IDS = new Set([
  'cgSgspJ2msm6clMCkdW9',
  'iP95p4xoKVk53GoZ742B',
  'XB0fDUnXU5powFXDhCwa',
  'bIHbv24MWmeRgasZH58o',
  'EXAVITQu4vr4xnSDxMaL',
  'onwK4e9ZLuTAKqWW03F9',
]);

export const DEFAULT_PREVIEW_TEXT =
  'Hi, thanks for calling. BizzyBee can help with your enquiry and guide you to the right next step.';
export const MAX_PREVIEW_LENGTH = 180;
export const PREVIEW_COOLDOWN_SECONDS = 8;
export const PREVIEW_HOURLY_LIMIT = 30;

export function sanitizePreviewText(input: unknown): string {
  if (typeof input !== 'string') {
    return DEFAULT_PREVIEW_TEXT;
  }

  const normalized = input.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return DEFAULT_PREVIEW_TEXT;
  }

  if (normalized.length <= MAX_PREVIEW_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 1).trimEnd()}…`;
}

export async function hashPreviewText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}
