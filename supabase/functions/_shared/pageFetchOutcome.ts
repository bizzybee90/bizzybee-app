/**
 * Classifies the content of a fetched competitor page for FAQ extraction, and
 * rolls up a batch of outcomes into an operator-friendly summary.
 *
 * Problem 1: fetch_pages passed every non-null page to Claude, including
 * redirect stubs, 404 text, and consent-banner-only pages that gave Claude
 * nothing to work with. Wasted tokens, produced empty FAQs.
 *
 * Problem 2: URL fetch failures were only console.warn'd, with no structured
 * count or artifact. Operators couldn't tell whether a run's low FAQ count
 * came from "all 12 sites scraped fine, just thin content" or "9/12 failed
 * silently". summarizeFetchOutcomes makes that distinction explicit.
 */

export const MIN_PAGE_CONTENT_LENGTH = 200;
export const FETCH_DEGRADATION_THRESHOLD = 0.5;

export type FetchOutcomeReason = 'fetch_failed' | 'empty' | 'too_short';

export type FetchOutcome =
  | { ok: true; url: string }
  | { ok: false; url: string; reason: FetchOutcomeReason; detail?: string };

export type PageClassification =
  | { status: 'ok' }
  | { status: 'too_short'; contentLength: number }
  | { status: 'empty' };

export function classifyFetchedPage(content: string | null | undefined): PageClassification {
  if (typeof content !== 'string') {
    return { status: 'empty' };
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { status: 'empty' };
  }
  if (trimmed.length < MIN_PAGE_CONTENT_LENGTH) {
    return { status: 'too_short', contentLength: trimmed.length };
  }
  return { status: 'ok' };
}

export interface FetchOutcomeFailure {
  url: string;
  reason: FetchOutcomeReason;
  /**
   * Truncated (<400 chars) error message preserved per-URL so operators
   * can see exactly why each URL failed — "Apify cheerio crawl failed
   * (504): timeout" vs "Both crawlers failed for X: cheerio=500 /
   * playwright=timeout". Previously this detail only lived in transient
   * console.warn logs; now it rides along in the run artifact.
   */
  detail: string | null;
}

export interface FetchOutcomeSummary {
  total: number;
  ok: number;
  failed: number;
  failureRatio: number;
  byReason: Record<FetchOutcomeReason, number>;
  failedUrls: string[];
  failures: FetchOutcomeFailure[];
  /**
   * True iff failureRatio > FETCH_DEGRADATION_THRESHOLD. Callers should
   * surface this in step output_summary so the UI can show "Fetched N of M
   * sites — results may be incomplete" instead of silently degraded output.
   */
  degraded: boolean;
}

export function summarizeFetchOutcomes(outcomes: FetchOutcome[]): FetchOutcomeSummary {
  const byReason: Record<FetchOutcomeReason, number> = {
    fetch_failed: 0,
    empty: 0,
    too_short: 0,
  };
  const failedUrls: string[] = [];
  const failures: FetchOutcomeFailure[] = [];
  let ok = 0;
  let failed = 0;

  for (const outcome of outcomes) {
    if (outcome.ok) {
      ok += 1;
      continue;
    }
    failed += 1;
    byReason[outcome.reason] += 1;
    failedUrls.push(outcome.url);
    failures.push({
      url: outcome.url,
      reason: outcome.reason,
      detail: outcome.detail ?? null,
    });
  }

  const total = outcomes.length;
  const failureRatio = total === 0 ? 0 : failed / total;

  return {
    total,
    ok,
    failed,
    failureRatio,
    byReason,
    failedUrls,
    failures,
    degraded: failureRatio > FETCH_DEGRADATION_THRESHOLD,
  };
}
