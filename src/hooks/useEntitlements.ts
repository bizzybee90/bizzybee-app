import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import type { WorkspaceEntitlements } from '@/lib/billing/entitlements';
import { resolveWorkspaceEntitlements } from '@/lib/billing/entitlements';
import { logger } from '@/lib/logger';

export function useEntitlements(workspaceId: string | null) {
  return useQuery<WorkspaceEntitlements>({
    queryKey: ['workspace-entitlements', workspaceId],
    queryFn: async () => {
      if (!workspaceId) {
        throw new Error('workspaceId is required');
      }

      if (workspaceId === 'preview-workspace') {
        return resolveWorkspaceEntitlements(null, []);
      }

      const [subscriptionResult, addonsResult] = await Promise.all([
        supabase
          .from('workspace_subscriptions')
          .select('*')
          .eq('workspace_id', workspaceId)
          .maybeSingle(),
        supabase.from('workspace_addons').select('*').eq('workspace_id', workspaceId),
      ]);

      if (subscriptionResult.error || addonsResult.error) {
        logger.warn('Falling back to legacy entitlements', {
          workspaceId,
          subscriptionError: subscriptionResult.error,
          addonsError: addonsResult.error,
        });
        return resolveWorkspaceEntitlements(null, []);
      }

      return resolveWorkspaceEntitlements(subscriptionResult.data, addonsResult.data ?? []);
    },
    enabled: Boolean(workspaceId),
    retry: false,
    staleTime: 30_000,
  });
}
