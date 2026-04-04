import { supabase } from '@/integrations/supabase/client';

export async function getFaqs(workspaceId: string) {
  const { data, error } = await supabase
    .from('faq_database')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('archived', false)
    .order('priority', { ascending: false });

  if (error) throw error;
  return data;
}

export async function createFaq(faq: {
  workspace_id: string;
  category: string;
  question: string;
  answer: string;
  keywords?: string[];
  is_active?: boolean;
}) {
  const { data, error } = await supabase.from('faq_database').insert(faq).select().single();

  if (error) throw error;
  return data;
}

export async function updateFaq(
  id: string,
  workspaceId: string,
  updates: { question?: string; answer?: string; category?: string; is_active?: boolean },
) {
  const { data, error } = await supabase
    .from('faq_database')
    .update(updates)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteFaq(id: string, workspaceId: string) {
  const { error } = await supabase
    .from('faq_database')
    .update({ archived: true })
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  if (error) throw error;
}

export async function getBusinessContext(workspaceId: string) {
  const { data, error } = await supabase
    .from('business_context')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) throw error;
  return data;
}
