import { describe, expect, it } from 'vitest';
import {
  classifyFetchedPage,
  summarizeFetchOutcomes,
  MIN_PAGE_CONTENT_LENGTH,
  type FetchOutcomeSummary,
} from './pageFetchOutcome';

// Regression: fetch_pages in pipeline-worker-onboarding-faq passed every
// successfully-fetched URL into Claude for FAQ extraction — even pages with
// <200 chars (redirect stubs, 404 text, consent banners). Claude wasted
// tokens and produced empty/garbage FAQs. Also, URL failures were only
// console.warned with no visibility into HOW MANY of N competitor sites
// actually imported useful content. summarizeFetchOutcomes rolls up a
// grep-friendly breakdown so operators can spot runs that silently
// degraded to a small fraction of their nominal competitor pool.

describe('classifyFetchedPage', () => {
  it('returns empty for null/undefined/empty content', () => {
    expect(classifyFetchedPage(null)).toEqual({ status: 'empty' });
    expect(classifyFetchedPage(undefined)).toEqual({ status: 'empty' });
    expect(classifyFetchedPage('')).toEqual({ status: 'empty' });
    expect(classifyFetchedPage('   \n  \t ')).toEqual({ status: 'empty' });
  });

  it('returns too_short for whitespace-trimmed content below MIN', () => {
    const short = 'x'.repeat(MIN_PAGE_CONTENT_LENGTH - 1);
    expect(classifyFetchedPage(short)).toEqual({
      status: 'too_short',
      contentLength: short.length,
    });
  });

  it('returns ok for content at or above MIN', () => {
    const exact = 'x'.repeat(MIN_PAGE_CONTENT_LENGTH);
    expect(classifyFetchedPage(exact)).toEqual({ status: 'ok' });
    const long = 'x'.repeat(5_000);
    expect(classifyFetchedPage(long)).toEqual({ status: 'ok' });
  });

  it('measures length after trimming leading/trailing whitespace', () => {
    const padded = '   ' + 'x'.repeat(MIN_PAGE_CONTENT_LENGTH - 1) + '   ';
    expect(classifyFetchedPage(padded)).toEqual({
      status: 'too_short',
      contentLength: MIN_PAGE_CONTENT_LENGTH - 1,
    });
  });
});

describe('summarizeFetchOutcomes', () => {
  it('counts successes and failures by reason and preserves per-URL detail', () => {
    const summary: FetchOutcomeSummary = summarizeFetchOutcomes([
      { ok: true, url: 'https://a.com' },
      { ok: true, url: 'https://b.com' },
      { ok: false, url: 'https://c.com', reason: 'fetch_failed', detail: 'Apify 500' },
      { ok: false, url: 'https://d.com', reason: 'empty' },
      { ok: false, url: 'https://e.com', reason: 'too_short', detail: 'length=40' },
    ]);

    expect(summary.total).toBe(5);
    expect(summary.ok).toBe(2);
    expect(summary.failed).toBe(3);
    expect(summary.failureRatio).toBeCloseTo(0.6);
    expect(summary.byReason).toEqual({
      fetch_failed: 1,
      empty: 1,
      too_short: 1,
    });
    expect(summary.failedUrls).toEqual(['https://c.com', 'https://d.com', 'https://e.com']);
    // failures carries the per-URL detail strings that used to live only
    // in transient console.warn logs — operators now see the actual reason
    // each URL failed without trawling deno logs.
    expect(summary.failures).toEqual([
      { url: 'https://c.com', reason: 'fetch_failed', detail: 'Apify 500' },
      { url: 'https://d.com', reason: 'empty', detail: null },
      { url: 'https://e.com', reason: 'too_short', detail: 'length=40' },
    ]);
  });

  it('handles an all-success run', () => {
    const summary = summarizeFetchOutcomes([
      { ok: true, url: 'https://a.com' },
      { ok: true, url: 'https://b.com' },
    ]);
    expect(summary.ok).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.failureRatio).toBe(0);
    expect(summary.failedUrls).toEqual([]);
  });

  it('handles an empty outcome list without dividing by zero', () => {
    const summary = summarizeFetchOutcomes([]);
    expect(summary.total).toBe(0);
    expect(summary.failureRatio).toBe(0);
  });

  it('exposes degraded=true when failureRatio exceeds the threshold', () => {
    const summary = summarizeFetchOutcomes([
      { ok: true, url: 'https://a.com' },
      { ok: false, url: 'https://b.com', reason: 'fetch_failed' },
      { ok: false, url: 'https://c.com', reason: 'fetch_failed' },
      { ok: false, url: 'https://d.com', reason: 'too_short' },
    ]);
    expect(summary.failureRatio).toBeCloseTo(0.75);
    expect(summary.degraded).toBe(true);
  });

  it('degraded=false when failureRatio is below the threshold', () => {
    const summary = summarizeFetchOutcomes([
      { ok: true, url: 'https://a.com' },
      { ok: true, url: 'https://b.com' },
      { ok: true, url: 'https://c.com' },
      { ok: false, url: 'https://d.com', reason: 'fetch_failed' },
    ]);
    expect(summary.degraded).toBe(false);
  });
});
