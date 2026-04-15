import { describe, expect, it, vi } from 'vitest';
import { withTransientRetry, isRetryableStatus, parseRetryAfterMs } from './retry';

// Regression tests: withTransientRetry was a 2-line stub that did ONE retry
// with zero backoff. On a 429 from Apify or 529 from Anthropic, the second
// attempt would trip the same rate-limit instantly. Real retry logic with
// exponential backoff + Retry-After parsing + retryable-status classification
// is the fix.

describe('isRetryableStatus', () => {
  it('marks 429 as retryable', () => {
    expect(isRetryableStatus(429)).toBe(true);
  });

  it('marks 500 as retryable', () => {
    expect(isRetryableStatus(500)).toBe(true);
  });

  it('marks 502/503/504/529 as retryable', () => {
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(504)).toBe(true);
    expect(isRetryableStatus(529)).toBe(true);
  });

  it('marks 400 as NOT retryable (caller bug, not transient)', () => {
    expect(isRetryableStatus(400)).toBe(false);
  });

  it('marks 401/403/404 as NOT retryable', () => {
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

describe('parseRetryAfterMs', () => {
  it('parses integer seconds', () => {
    const headers = new Headers({ 'retry-after': '3' });
    expect(parseRetryAfterMs(headers)).toBe(3_000);
  });

  it('returns null for missing header', () => {
    const headers = new Headers();
    expect(parseRetryAfterMs(headers)).toBeNull();
  });

  it('returns null for non-numeric header', () => {
    const headers = new Headers({ 'retry-after': 'tomorrow' });
    expect(parseRetryAfterMs(headers)).toBeNull();
  });

  it('caps extreme values to 30 seconds to avoid a stuck worker', () => {
    const headers = new Headers({ 'retry-after': '600' });
    expect(parseRetryAfterMs(headers)).toBe(30_000);
  });
});

describe('withTransientRetry', () => {
  it('returns value on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withTransientRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once after a transient Error and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('network reset'))
      .mockResolvedValueOnce('ok-after-retry');
    const result = await withTransientRetry(fn, { attempts: 3, baseMs: 1, maxMs: 5 });
    expect(result).toBe('ok-after-retry');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after opts.attempts failures and throws the final error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent'));
    await expect(withTransientRetry(fn, { attempts: 3, baseMs: 1, maxMs: 5 })).rejects.toThrow(
      'persistent',
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a non-retryable Response (e.g. 400)', async () => {
    const badResponse = new Response('bad request', { status: 400 });
    const fn = vi.fn().mockRejectedValue(badResponse);
    await expect(withTransientRetry(fn, { attempts: 3, baseMs: 1, maxMs: 5 })).rejects.toBe(
      badResponse,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 Response and respects Retry-After', async () => {
    const rateLimited = new Response('slow down', {
      status: 429,
      headers: { 'retry-after': '0' }, // 0s = effectively immediate for test
    });
    const fn = vi.fn().mockRejectedValueOnce(rateLimited).mockResolvedValueOnce('recovered');
    const result = await withTransientRetry(fn, { attempts: 3, baseMs: 1, maxMs: 5 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries a 5xx Response then succeeds', async () => {
    const serverError = new Response('', { status: 503 });
    const fn = vi.fn().mockRejectedValueOnce(serverError).mockResolvedValueOnce('ok');
    const result = await withTransientRetry(fn, { attempts: 3, baseMs: 1, maxMs: 5 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('defaults to attempts=3 when no opts passed', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(withTransientRetry(fn)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
