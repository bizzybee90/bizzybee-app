import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  clearPendingOnboardingDiscoveryTrigger,
  getPendingOnboardingDiscoveryTriggerRemainingMs,
} from '@/lib/onboarding/discoveryTrigger';

export interface UseOnboardingDiscoveryAutoTriggerParams {
  /**
   * Only fire when true. Typically `true` once the user has reached the
   * ProgressScreen and the parent data load has settled.
   */
  enabled: boolean;
  /** Workspace id. Required to identify where to run discovery. */
  workspaceId: string;
  /** Whether an agent_run for competitor_discovery already exists. */
  hasDiscoveryRun: boolean;
  /**
   * Whether any competitor rows have already been surfaced for this workspace.
   * Treated as proof that discovery ran at least once (even if the agent_run
   * row is stale or missing).
   */
  hasCompetitors: boolean;
}

/**
 * Safety-net autoTrigger for competitor discovery.
 *
 * Background: SearchTermsStep fires start-onboarding-discovery fire-and-forget
 * and advances the user to ProgressScreen. If that invoke fails (network, 5xx,
 * the Supabase client hasn't attached the user JWT yet), the server has no run
 * recorded and the user watches an indefinite 0% until the 2-minute supervisor
 * cron rescues them.
 *
 * This hook fires the invoke once on mount when the server-side state shows no
 * discovery run and no competitors, then never fires again during the component's
 * lifetime (ref guard). start-onboarding-discovery is idempotent — if a run was
 * in fact already created and we raced, the server picks up from where it was.
 *
 * Errors are swallowed: this is a best-effort recovery and must not crash the
 * page. Logging goes to console.warn so it shows up in Sentry / devtools.
 */
export function useOnboardingDiscoveryAutoTrigger(
  params: UseOnboardingDiscoveryAutoTriggerParams,
): void {
  const { enabled, workspaceId, hasDiscoveryRun, hasCompetitors } = params;
  const firedRef = useRef(false);
  const [graceTick, setGraceTick] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    if (!hasDiscoveryRun && !hasCompetitors) return;

    clearPendingOnboardingDiscoveryTrigger(workspaceId);
  }, [workspaceId, hasDiscoveryRun, hasCompetitors]);

  useEffect(() => {
    if (!enabled) return;
    if (!workspaceId) return;
    if (hasDiscoveryRun) return;
    if (hasCompetitors) return;
    if (firedRef.current) return;

    const remainingMs = getPendingOnboardingDiscoveryTriggerRemainingMs(workspaceId);
    if (remainingMs > 0) {
      const timeoutId = window.setTimeout(() => {
        setGraceTick((tick) => tick + 1);
      }, remainingMs);
      return () => window.clearTimeout(timeoutId);
    }

    firedRef.current = true;
    clearPendingOnboardingDiscoveryTrigger(workspaceId);
    void supabase.functions
      .invoke('start-onboarding-discovery', {
        body: {
          workspace_id: workspaceId,
          target_count: 15,
          trigger_source: 'progress_screen_autotrigger',
        },
      })
      .catch((err) => {
        console.warn('[useOnboardingDiscoveryAutoTrigger] start-onboarding-discovery failed', err);
      });
  }, [enabled, workspaceId, hasDiscoveryRun, hasCompetitors, graceTick]);
}
