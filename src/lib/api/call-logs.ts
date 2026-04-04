import { supabase } from '@/integrations/supabase/client';

export async function getCallLogs(workspaceId: string, filters?: { limit?: number }) {
  let query = supabase
    .from('call_logs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });

  if (filters?.limit) query = query.limit(filters.limit);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getCallStats(workspaceId: string) {
  const { data, error } = await supabase.functions.invoke('retell-call-stats');
  if (error) throw error;
  return data;
}
