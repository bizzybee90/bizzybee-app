import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREVIEW_TEXT,
  MAX_PREVIEW_LENGTH,
  hashPreviewText,
  sanitizePreviewText,
} from './voicePreview';

describe('voicePreview utils', () => {
  it('falls back to the default text when the preview is missing', () => {
    expect(sanitizePreviewText(undefined)).toBe(DEFAULT_PREVIEW_TEXT);
    expect(sanitizePreviewText('')).toBe(DEFAULT_PREVIEW_TEXT);
  });

  it('normalizes whitespace in preview text', () => {
    expect(sanitizePreviewText(' Hi   there \n BizzyBee ')).toBe('Hi there BizzyBee');
  });

  it('clamps long preview text', () => {
    const longText = 'a'.repeat(MAX_PREVIEW_LENGTH + 20);
    const sanitized = sanitizePreviewText(longText);

    expect(sanitized.length).toBeLessThanOrEqual(MAX_PREVIEW_LENGTH);
    expect(sanitized.endsWith('…')).toBe(true);
  });

  it('hashes preview text deterministically', async () => {
    await expect(hashPreviewText('Hello')).resolves.toMatch(/^[a-f0-9]{64}$/);
    await expect(hashPreviewText('Hello')).resolves.toBe(await hashPreviewText('Hello'));
  });
});
