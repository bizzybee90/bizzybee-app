import { supabase } from '@/integrations/supabase/client';

export async function getCurrentWorkspace() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userData } = await supabase
    .from('users')
    .select('workspace_id')
    .eq('id', user.id)
    .single();

  if (!userData?.workspace_id) return null;

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', userData.workspace_id)
    .single();

  return workspace;
}

export async function getWorkspaceChannels(workspaceId: string) {
  const { data, error } = await supabase
    .from('workspace_channels')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (error) throw error;
  return data;
}

export async function getHouseRules(workspaceId: string) {
  const { data, error } = await supabase
    .from('house_rules')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at');

  if (error) throw error;
  return data;
}

export async function createHouseRule(rule: {
  workspace_id: string;
  rule_type: string;
  condition: string;
  action: string;
  is_active?: boolean;
}) {
  const { data, error } = await supabase.from('house_rules').insert(rule).select().single();

  if (error) throw error;
  return data;
}

export async function deleteHouseRule(id: string, workspaceId: string) {
  const { error } = await supabase
    .from('house_rules')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  if (error) throw error;
}
