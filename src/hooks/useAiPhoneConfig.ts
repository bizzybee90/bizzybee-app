import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { toast } from 'sonner';
import type { AiPhoneConfig } from '@/lib/types';

export function useAiPhoneConfig() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const queryKey = ['ai-phone-config', workspace?.id];

  const {
    data: config = null,
    isLoading,
    error,
  } = useQuery<AiPhoneConfig | null>({
    queryKey,
    queryFn: async () => {
      if (!workspace?.id) return null;

      const { data, error } = await supabase
        .from('ai_phone_configs')
        .select('*')
        .eq('workspace_id', workspace.id)
        .maybeSingle();

      if (error) throw error;
      return (data as unknown as AiPhoneConfig) ?? null;
    },
    enabled: !!workspace?.id,
  });

  const createConfig = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke('retell-provision', {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey });
      toast.success(
        `AI Phone provisioned${data?.phone_number ? `: ${data.phone_number}` : ''}`
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to provision AI Phone');
    },
  });

  const updateConfig = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke('retell-update-agent', {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('AI Phone configuration updated');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update configuration');
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (isActive: boolean) => {
      if (!config?.id) throw new Error('No config found');

      const { error } = await supabase
        .from('ai_phone_configs')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', config.id);

      if (error) throw error;
      return isActive;
    },
    onSuccess: (isActive) => {
      queryClient.invalidateQueries({ queryKey });
      toast.success(isActive ? 'AI Phone activated' : 'AI Phone deactivated');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to toggle AI Phone');
    },
  });

  return {
    config,
    isLoading,
    error,
    createConfig,
    updateConfig,
    toggleActive,
    isProvisioning: createConfig.isPending,
  };
}
