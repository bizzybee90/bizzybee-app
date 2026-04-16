import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnboardingDiscoveryAutoTrigger } from '../useOnboardingDiscoveryAutoTrigger';
import { DISCOVERY_TRIGGER_GRACE_MS } from '@/lib/onboarding/discoveryTrigger';

// Regression: ProgressScreen has historically had no auto-trigger. If the
// SearchTermsStep fire-and-forget invoke failed before the server recorded
// a run, the user got stuck at 0% until the 2-minute supervisor cron
// rescued them. This hook is the safety net that fires start-onboarding-discovery
// at ProgressScreen mount when no run exists.

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: mocks.invoke,
    },
  },
}));

describe('useOnboardingDiscoveryAutoTrigger', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue({ data: { run_id: 'run-123' }, error: null });
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires start-onboarding-discovery when enabled, no run, and no competitors', async () => {
    renderHook(() =>
      useOnboardingDiscoveryAutoTrigger({
        enabled: true,
        workspaceId: 'ws-1',
        hasDiscoveryRun: false,
        hasCompetitors: false,
      }),
    );

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('start-onboarding-discovery', {
        body: expect.objectContaining({
          workspace_id: 'ws-1',
          trigger_source: 'progress_screen_autotrigger',
        }),
      });
    });
  });

  it('does not fire when a discovery run already exists', async () => {
    renderHook(() =>
      useOnboardingDiscoveryAutoTrigger({
        enabled: true,
        workspaceId: 'ws-1',
        hasDiscoveryRun: true,
        hasCompetitors: false,
      }),
    );

    // Give React a tick to run effects
    await new Promise((r) => setTimeout(r, 20));

    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('does not fire when competitors are already present', async () => {
    renderHook(() =>
      useOnboardingDiscoveryAutoTrigger({
        enabled: true,
        workspaceId: 'ws-1',
        hasDiscoveryRun: false,
        hasCompetitors: true,
      }),
    );

    await new Promise((r) => setTimeout(r, 20));

    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('does not fire when disabled', async () => {
    renderHook(() =>
      useOnboardingDiscoveryAutoTrigger({
        enabled: false,
        workspaceId: 'ws-1',
        hasDiscoveryRun: false,
        hasCompetitors: false,
      }),
    );

    await new Promise((r) => setTimeout(r, 20));

    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('does not fire when workspaceId is empty', async () => {
    renderHook(() =>
      useOnboardingDiscoveryAutoTrigger({
        enabled: true,
        workspaceId: '',
        hasDiscoveryRun: false,
        hasCompetitors: false,
      }),
    );

    await new Promise((r) => setTimeout(r, 20));

    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('only fires once even if props change causing re-render', async () => {
    const { rerender } = renderHook(
      ({ hasDiscoveryRun }: { hasDiscoveryRun: boolean }) =>
        useOnboardingDiscoveryAutoTrigger({
          enabled: true,
          workspaceId: 'ws-1',
          hasDiscoveryRun,
          hasCompetitors: false,
        }),
      { initialProps: { hasDiscoveryRun: false } },
    );

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledTimes(1);
    });

    // After trigger, server would create a run. Simulate that by flipping hasDiscoveryRun.
    rerender({ hasDiscoveryRun: true });
    await new Promise((r) => setTimeout(r, 20));

    // Flip back to false (e.g. backend race loses the run briefly).
    // The hook must NOT re-fire because we've already fired once this mount.
    rerender({ hasDiscoveryRun: false });
    await new Promise((r) => setTimeout(r, 20));

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it('swallows invoke rejection without throwing (user is mid-onboarding)', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('network down'));

    // If the hook threw, renderHook would crash.
    const { result } = renderHook(() =>
      useOnboardingDiscoveryAutoTrigger({
        enabled: true,
        workspaceId: 'ws-1',
        hasDiscoveryRun: false,
        hasCompetitors: false,
      }),
    );

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalled();
    });

    expect(result.current).toBeUndefined();
  });

  it('waits for the same-tab grace window before auto-triggering discovery', async () => {
    vi.useFakeTimers();
    window.sessionStorage.setItem('bizzybee:onboarding-discovery-trigger:ws-1', String(Date.now()));

    renderHook(() =>
      useOnboardingDiscoveryAutoTrigger({
        enabled: true,
        workspaceId: 'ws-1',
        hasDiscoveryRun: false,
        hasCompetitors: false,
      }),
    );

    expect(mocks.invoke).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DISCOVERY_TRIGGER_GRACE_MS - 1);
    });
    expect(mocks.invoke).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    await Promise.resolve();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
