import { supabase } from '@/integrations/supabase/client';

interface SendReplyInput {
  conversationId: string;
  workspaceId: string;
  content: string;
  statusAfterSend?: string;
}

interface SendReplyResponse {
  success: boolean;
  error?: string;
  message_id?: string | null;
  external_id?: string | null;
}

export async function sendReply({
  conversationId,
  workspaceId,
  content,
  statusAfterSend = 'resolved',
}: SendReplyInput) {
  const { data, error } = await supabase.functions.invoke<SendReplyResponse>('send-reply', {
    body: {
      conversation_id: conversationId,
      workspace_id: workspaceId,
      content,
      status_after_send: statusAfterSend,
    },
  });

  if (error) {
    throw error;
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Failed to send reply');
  }

  return data;
}
