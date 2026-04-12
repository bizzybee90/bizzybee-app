import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { toast } from 'sonner';
import type { AiPhoneConfig } from '@/lib/types';

type AiPhoneConfigRow = AiPhoneConfig & {
  retell_phone_number?: string | null;
  error_message?: string | null;
};

export function useAiPhoneConfig() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const queryKey = ['ai-phone-config', workspace?.id];

  const {
    data: config = null,
    isLoading,
    error,
  } = useQuery<AiPhoneConfigRow | null>({
    queryKey,
    queryFn: async () => {
      if (!workspace?.id) return null;

      const { data, error } = await supabase
        .from('elevenlabs_agents')
        .select('*')
        .eq('workspace_id', workspace.id)
        .maybeSingle();

      if (error) throw error;
      return (data as unknown as AiPhoneConfigRow) ?? null;
    },
    enabled: !!workspace?.id,
  });

  const createConfig = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke('elevenlabs-provision', {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey });
      toast.success(
        `BizzyBee-managed AI Phone provisioned${data?.phone_number ? `: ${data.phone_number}` : ''}`,
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to provision BizzyBee-managed AI Phone');
    },
  });

  const updateConfig = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke('elevenlabs-update-agent', {
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
        .from('elevenlabs_agents')
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
