import { supabase } from '@/integrations/supabase/client';

export async function getMessages(conversationId: string) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

export async function createMessage(message: {
  conversation_id: string;
  actor_type: string;
  actor_name?: string;
  direction: string;
  channel: string;
  body: string;
  is_internal?: boolean;
}) {
  const { data, error } = await supabase.from('messages').insert(message).select().single();

  if (error) throw error;
  return data;
}
