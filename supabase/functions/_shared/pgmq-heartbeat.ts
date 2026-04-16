/**
 * Keep an in-flight pgmq message's visibility timeout fresh while a long-running
 * worker step is still executing.
 *
 * Problem: pgmq.read pops a message with a visibility timeout (VT) — 180s by
 * default in this project. If the worker takes longer than VT to finish, pgmq
 * re-delivers the same message to another worker, which then does the work
 * again. For pipeline-worker-onboarding-faq's fetch_pages loop (13+ sites x
 * Apify) this means duplicate Apify runs, duplicate artifact writes, and
 * wasted spend.
 *
 * Solution: call pgmq.set_vt(queue, msg_id, vt) periodically from inside the
 * worker while it still owns the message. The heartbeat is elapsed-time-gated
 * so that both many-fast-iterations and a-single-slow-iteration get refreshed
 * correctly.
 */

/**
 * Minimal structural type for the supabase-js client's rpc method. We avoid a
 * runtime `import` from the esm.sh URL so this module stays loadable under
 * Vitest's default ESM resolver (tests colocated under
 * supabase/functions/_shared/ run in Node via vitest).
 */
export interface PgmqRpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

export const DEFAULT_PGMQ_VT_SECONDS = 180;
export const DEFAULT_PGMQ_HEARTBEAT_INTERVAL_MS = 60_000;

export async function queueSetVt(
  client: PgmqRpcClient,
  queueName: string,
  msgId: number,
  vtSeconds: number,
): Promise<void> {
  const { error } = await client.rpc('bb_queue_set_vt', {
    queue_name: queueName,
    msg_id: msgId,
    vt_seconds: vtSeconds,
  });

  if (error) {
    throw new Error(`Failed to set VT for queue ${queueName} msg ${msgId}: ${error.message}`);
  }
}

export interface PgmqHeartbeatOptions {
  /**
   * How much wall-clock time must pass before another set_vt call is issued.
   * Defaults to DEFAULT_PGMQ_HEARTBEAT_INTERVAL_MS (60s) — ~1/3 of the default
   * 180s VT, leaving a 2x safety margin if a beat gets delayed.
   */
  minIntervalMs?: number;

  /**
   * New VT (seconds) to set on each fired beat. Defaults to
   * DEFAULT_PGMQ_VT_SECONDS (180s) — matches the project's pgmq.read default.
   */
  vtSeconds?: number;
}

/**
 * Factory that returns a heartbeat function `() => Promise<void>`. Each call:
 *
 * - no-op if < minIntervalMs has elapsed since the last fired beat (or since
 *   the heartbeat was created)
 * - otherwise calls pgmq.set_vt and resets the timer
 *
 * set_vt failures are logged to console.warn and swallowed — the heartbeat is
 * best-effort and should never crash the owning worker's main work.
 */
export interface PgmqBeatOptions {
  /**
   * Bypass the min-interval rate-limit and fire set_vt unconditionally.
   * Use this at the start of long-running sub-steps (e.g. a Claude call
   * whose duration could exceed the VT itself) so we don't rely on the
   * next time-gated beat landing in time — which, per the 2026-04-16
   * onboarding-website persist regression, it won't when a single
   * Claude call takes 180s+ with retries and the worker was just popped.
   */
  force?: boolean;
}

export function createPgmqHeartbeat(
  client: PgmqRpcClient,
  queueName: string,
  msgId: number,
  options: PgmqHeartbeatOptions = {},
): (beatOptions?: PgmqBeatOptions) => Promise<void> {
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_PGMQ_HEARTBEAT_INTERVAL_MS;
  const vtSeconds = options.vtSeconds ?? DEFAULT_PGMQ_VT_SECONDS;

  let lastBeatMs = Date.now();

  return async (beatOptions: PgmqBeatOptions = {}) => {
    const now = Date.now();
    if (!beatOptions.force && now - lastBeatMs < minIntervalMs) {
      return;
    }
    lastBeatMs = now;

    try {
      await queueSetVt(client, queueName, msgId, vtSeconds);
    } catch (err) {
      console.warn('[pgmq-heartbeat] set_vt failed', {
        queue: queueName,
        msgId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
