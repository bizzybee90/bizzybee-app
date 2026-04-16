import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgmqHeartbeat, queueSetVt } from './pgmq-heartbeat';
import type { PgmqRpcClient } from './pgmq-heartbeat';

// Regression tests: pgmq.read defaults to a 180s visibility timeout. When
// pipeline-worker-onboarding-faq's fetch_pages loop runs 13+ competitor sites
// through Apify, total wall-clock can exceed 180s even with FETCH_CONCURRENCY=5
// on a slow network. pgmq then re-delivers the same message mid-execution →
// duplicate Apify runs and duplicate artifact writes. The heartbeat calls
// pgmq.set_vt periodically to keep the owning worker's lease fresh.

function createRpcClient(rpc: ReturnType<typeof vi.fn>): PgmqRpcClient {
  return { rpc } as unknown as PgmqRpcClient;
}

describe('queueSetVt', () => {
  it('calls bb_queue_set_vt with queue_name, msg_id, vt_seconds', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = createRpcClient(rpc);

    await queueSetVt(client, 'bb_onboarding_faq_jobs', 42, 180);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('bb_queue_set_vt', {
      queue_name: 'bb_onboarding_faq_jobs',
      msg_id: 42,
      vt_seconds: 180,
    });
  });

  it('throws with queue+msg context when the RPC returns an error', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'queue not found' },
    });
    const client = createRpcClient(rpc);

    await expect(queueSetVt(client, 'bb_onboarding_faq_jobs', 42, 180)).rejects.toThrow(
      /bb_onboarding_faq_jobs.*42.*queue not found/,
    );
  });
});

describe('createPgmqHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call set_vt on the first beat (still within minIntervalMs)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = createRpcClient(rpc);

    const heartbeat = createPgmqHeartbeat(client, 'bb_onboarding_faq_jobs', 7);
    await heartbeat();

    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls set_vt once the minIntervalMs (default 60s) has elapsed', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = createRpcClient(rpc);

    const heartbeat = createPgmqHeartbeat(client, 'bb_onboarding_faq_jobs', 7);
    await heartbeat();
    expect(rpc).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    await heartbeat();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('bb_queue_set_vt', {
      queue_name: 'bb_onboarding_faq_jobs',
      msg_id: 7,
      vt_seconds: 180,
    });
  });

  it('debounces — multiple calls within the same window only fire once', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = createRpcClient(rpc);

    const heartbeat = createPgmqHeartbeat(client, 'bb_onboarding_faq_jobs', 7);
    await heartbeat();
    vi.advanceTimersByTime(60_000);

    await heartbeat();
    await heartbeat();
    await heartbeat();

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('fires again after another full interval elapses', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = createRpcClient(rpc);

    const heartbeat = createPgmqHeartbeat(client, 'bb_onboarding_faq_jobs', 7);
    await heartbeat();
    vi.advanceTimersByTime(60_000);
    await heartbeat();
    vi.advanceTimersByTime(60_000);
    await heartbeat();

    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('force: true bypasses the min-interval rate-limit and fires immediately', async () => {
    // Regression: the own-website persist step runs a Claude dedup call
    // that can exceed the 180s pgmq VT. Time-gated beats cannot fire
    // during an await'd sync call, so the caller must be able to force a
    // pre-emptive set_vt at persist entry to reset VT before the long
    // call starts — otherwise pgmq redelivers and two workers race on
    // the same run's persist step. Observed 2026-04-16 run 4032e877.
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = createRpcClient(rpc);

    const heartbeat = createPgmqHeartbeat(client, 'bb_onboarding_website_jobs', 42);

    // Normal call right after creation: no-op (< 60s since init).
    await heartbeat();
    expect(rpc).not.toHaveBeenCalled();

    // Same timestamp, but force: true — must fire.
    await heartbeat({ force: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('bb_queue_set_vt', {
      queue_name: 'bb_onboarding_website_jobs',
      msg_id: 42,
      vt_seconds: 180,
    });
  });

  it('force: true resets the timer so subsequent normal beats respect the new interval', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = createRpcClient(rpc);

    const heartbeat = createPgmqHeartbeat(client, 'bb_onboarding_website_jobs', 42);

    await heartbeat({ force: true });
    expect(rpc).toHaveBeenCalledTimes(1);

    // 30s later: still within the min-interval from the forced beat, no-op.
    vi.advanceTimersByTime(30_000);
    await heartbeat();
    expect(rpc).toHaveBeenCalledTimes(1);

    // 60s after the forced beat: normal beat fires.
    vi.advanceTimersByTime(30_000);
    await heartbeat();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('respects custom minIntervalMs and vtSeconds overrides', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = createRpcClient(rpc);

    const heartbeat = createPgmqHeartbeat(client, 'bb_onboarding_faq_jobs', 7, {
      minIntervalMs: 30_000,
      vtSeconds: 240,
    });
    await heartbeat();
    vi.advanceTimersByTime(30_000);
    await heartbeat();

    expect(rpc).toHaveBeenCalledWith('bb_queue_set_vt', {
      queue_name: 'bb_onboarding_faq_jobs',
      msg_id: 7,
      vt_seconds: 240,
    });
  });

  it('logs and swallows RPC errors so a failed beat never crashes the worker', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'queue deleted' },
    });
    const client = createRpcClient(rpc);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const heartbeat = createPgmqHeartbeat(client, 'bb_onboarding_faq_jobs', 7);
    await heartbeat();
    vi.advanceTimersByTime(60_000);

    await expect(heartbeat()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      '[pgmq-heartbeat] set_vt failed',
      expect.objectContaining({
        queue: 'bb_onboarding_faq_jobs',
        msgId: 7,
        error: expect.stringContaining('queue deleted'),
      }),
    );

    warn.mockRestore();
  });
});
