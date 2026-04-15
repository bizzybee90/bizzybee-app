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

async function fetchOnboardingProgressWithBearer(
  workspaceId: string,
): Promise<OnboardingProgressPayload | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const accessToken = session?.access_token;

  if (!accessToken) {
    throw new Error('Authentication required');
  }

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/bb_get_onboarding_progress`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ p_workspace_id: workspaceId }),
    },
  );

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `Failed to load onboarding progress (${response.status})`;
    throw new Error(message);
  }

  return payload as OnboardingProgressPayload | null;
}

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
      let payload: OnboardingProgressPayload | null = null;

      try {
        const rpcResult = await client.rpc('bb_get_onboarding_progress', {
          p_workspace_id: workspaceId,
        });

        if (rpcResult.error) {
          throw rpcResult.error;
        }

        payload = rpcResult.data as OnboardingProgressPayload | null;
      } catch (rpcError) {
        logger.warn('RPC onboarding progress failed, retrying with bearer fetch', rpcError);
        payload = await fetchOnboardingProgressWithBearer(workspaceId);
      }

      setData(payload);
      setError(null);
    } catch (err) {
      logger.error('Failed to load onboarding progress', err);
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Failed to load onboarding progress';
      setError(message);
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
    }, 2000);

    return () => window.clearInterval(interval);
  }, [enabled, load, workspaceId]);

  return {
    data,
    loading,
    error,
    refresh: load,
  };
}
