import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AiPhoneStats } from '@/lib/types';

export function useCallStats() {
  const { data: stats = null, isLoading } = useQuery<AiPhoneStats | null>({
    queryKey: ['ai-phone-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('retell-call-stats');
      if (error) throw error;
      return (data as AiPhoneStats) ?? null;
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  return {
    stats,
    isLoading,
  };
}
