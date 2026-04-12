import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

type OnboardingTrackPayload = {
  run_id: string | null;
  agent_status: string;
  current_step: string | null;
  job_id?: string | null;
  counts: Record<string, number>;
  latest_error?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

export interface OnboardingProgressPayload {
  workspace_id: string;
  tracks: {
    discovery: OnboardingTrackPayload;
    website: OnboardingTrackPayload;
    faq_generation: OnboardingTrackPayload;
    email_import: OnboardingTrackPayload;
    faq_counts?: Record<string, number>;
  };
}

type OnboardingProgressRpcClient = {
  rpc: (
    fn: 'bb_get_onboarding_progress',
    args: { p_workspace_id: string },
  ) => Promise<{
    data: OnboardingProgressPayload | null;
    error: { message: string } | null;
  }>;
};

export function useOnboardingProgress(workspaceId: string | null, enabled = true) {
  const [data, setData] = useState<OnboardingProgressPayload | null>(null);
  const [loading, setLoading] = useState(Boolean(enabled && workspaceId));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId || !enabled) {
      setLoading(false);
      return;
    }

    try {
      const client = supabase as unknown as OnboardingProgressRpcClient;
      const { data: payload, error: rpcError } = await client.rpc('bb_get_onboarding_progress', {
        p_workspace_id: workspaceId,
      });

      if (rpcError) {
        throw rpcError;
      }

      setData(payload as OnboardingProgressPayload);
      setError(null);
    } catch (err) {
      logger.error('Failed to load onboarding progress', err);
      setError(err instanceof Error ? err.message : 'Failed to load onboarding progress');
    } finally {
      setLoading(false);
    }
  }, [enabled, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!workspaceId || !enabled) return;

    const interval = window.setInterval(() => {
      void load();
    }, 10000);

    return () => window.clearInterval(interval);
  }, [enabled, load, workspaceId]);

  return {
    data,
    loading,
    error,
    refresh: load,
  };
}
