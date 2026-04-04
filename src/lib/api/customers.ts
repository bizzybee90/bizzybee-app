import { supabase } from '@/integrations/supabase/client';

export async function getCustomers(workspaceId: string) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('name');

  if (error) throw error;
  return data;
}

export async function getCustomer(id: string, workspaceId: string) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single();

  if (error) throw error;
  return data;
}

export async function updateCustomer(
  id: string,
  workspaceId: string,
  updates: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
