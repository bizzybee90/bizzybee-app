import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useEffect, useState } from 'react';
import type { AiPhoneCallLog } from '@/lib/types';

export interface CallLogFilters {
  dateRange: 'today' | 'week' | 'month' | 'all';
  outcome: string | null;
  sentiment: string | null;
}

const defaultFilters: CallLogFilters = {
  dateRange: 'today',
  outcome: null,
  sentiment: null,
};

function getDateCutoff(range: CallLogFilters['dateRange']): string | null {
  const now = new Date();
  switch (range) {
    case 'today': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return start.toISOString();
    }
    case 'week': {
      const start = new Date(now);
      start.setDate(now.getDate() - 7);
      return start.toISOString();
    }
    case 'month': {
      const start = new Date(now);
      start.setMonth(now.getMonth() - 1);
      return start.toISOString();
    }
    case 'all':
      return null;
  }
}

export function useCallLogs() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<CallLogFilters>(defaultFilters);

  const queryKey = ['ai-phone-call-logs', workspace?.id, filters];

  const { data: calls = [], isLoading } = useQuery<AiPhoneCallLog[]>({
    queryKey,
    queryFn: async () => {
      if (!workspace?.id) return [];

      let query = supabase
        .from('call_logs')
        .select('*')
        .eq('workspace_id', workspace.id)
        .order('created_at', { ascending: false })
        .limit(25);

      const dateCutoff = getDateCutoff(filters.dateRange);
      if (dateCutoff) {
        query = query.gte('created_at', dateCutoff);
      }

      if (filters.outcome) {
        query = query.eq('outcome', filters.outcome);
      }

      if (filters.sentiment) {
        query = query.eq('sentiment', filters.sentiment);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as unknown as AiPhoneCallLog[]) ?? [];
    },
    enabled: !!workspace?.id,
  });

  // Realtime subscription for live updates
  useEffect(() => {
    if (!workspace?.id) return;

    const channel = supabase
      .channel(`ai-phone-calls-${workspace.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_logs',
          filter: `workspace_id=eq.${workspace.id}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ['ai-phone-call-logs', workspace.id],
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspace?.id, queryClient]);

  return {
    calls,
    isLoading,
    filters,
    setFilters,
  };
}
