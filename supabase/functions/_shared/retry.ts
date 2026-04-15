/**
 * Real transient-retry helper for edge function workers.
 *
 * Replaces the previous 2-line stub at onboarding-worker.ts which did ONE retry
 * with zero backoff — which, on a 429 rate-limit, would fire the retry so fast
 * it tripped the same rate-limit and gave up.
 *
 * Deliberately kept dependency-free (pure TS, no Deno/Supabase imports) so it
 * is unit-testable under vitest/node.
 */

export interface WithTransientRetryOptions {
  /**
   * Max attempts including the first. Default 3.
   * Stays low because each attempt may tie up an edge-function invocation slot
   * and we don't want to burn through the 50s wall-clock retrying a genuinely
   * dead dependency.
   */
  attempts?: number;
  /** Base backoff ms before exponentially growing. Default 500. */
  baseMs?: number;
  /**
   * Hard cap on per-attempt backoff. Default 10 000 ms.
   * Prevents a misbehaving Retry-After from parking the worker.
   */
  maxMs?: number;
  /**
   * Optional predicate for Error-like exceptions. When absent, any Error is
   * retryable. Responses are classified via isRetryableStatus regardless.
   */
  isRetryableError?: (err: unknown) => boolean;
}

/** Classify HTTP status codes as transient or permanent. */
export function isRetryableStatus(status: number): boolean {
  if (status === 429) return true;
  if (status === 529) return true; // Anthropic "overloaded" non-standard but documented
  if (status >= 500 && status <= 599) return true;
  return false;
}

/**
 * Parse a Response's Retry-After header as milliseconds.
 * - Supports integer-seconds form only (HTTP also allows date form; we cap and ignore).
 * - Caps at 30 000 ms so a hostile server can't park the worker for minutes.
 */
export function parseRetryAfterMs(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const ms = Math.min(30_000, Math.floor(seconds * 1000));
  return ms;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffMs(attemptIndex: number, baseMs: number, maxMs: number): number {
  const exp = Math.max(0, attemptIndex);
  const candidate = baseMs * 2 ** exp;
  // +/- 20% jitter to prevent thundering herd when many workers retry in lockstep.
  const jitter = candidate * 0.2 * (Math.random() * 2 - 1);
  return Math.min(maxMs, Math.max(0, candidate + jitter));
}

/**
 * Executes `fn`, retrying on transient failures with exponential backoff +
 * jitter and Retry-After support.
 *
 * A throw of a `Response` with non-retryable status (e.g. 400, 401, 404) is
 * surfaced immediately — those represent caller bugs, not transient failures.
 *
 * Usage:
 *   const data = await withTransientRetry(() => apifyFetch(...));
 *   const data = await withTransientRetry(fn, { attempts: 5, baseMs: 250 });
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts: WithTransientRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseMs = Math.max(0, opts.baseMs ?? 500);
  const maxMs = Math.max(baseMs, opts.maxMs ?? 10_000);

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Classify the error to decide whether to retry.
      if (err instanceof Response) {
        if (!isRetryableStatus(err.status)) {
          throw err;
        }
        if (i < attempts - 1) {
          const retryAfter = parseRetryAfterMs(err.headers);
          const backoff = retryAfter ?? computeBackoffMs(i, baseMs, maxMs);
          await sleep(backoff);
          continue;
        }
      } else if (err instanceof Error) {
        if (opts.isRetryableError && !opts.isRetryableError(err)) {
          throw err;
        }
        if (i < attempts - 1) {
          await sleep(computeBackoffMs(i, baseMs, maxMs));
          continue;
        }
      } else {
        // Non-Error, non-Response throw (e.g. string). Retry by default.
        if (i < attempts - 1) {
          await sleep(computeBackoffMs(i, baseMs, maxMs));
          continue;
        }
      }
    }
  }

  throw lastError;
}
