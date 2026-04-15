import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnboardingDiscoveryAutoTrigger } from '../useOnboardingDiscoveryAutoTrigger';

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
});
