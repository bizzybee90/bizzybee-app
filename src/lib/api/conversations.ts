import { supabase } from '@/integrations/supabase/client';
import type { Conversation } from '@/lib/types';

export async function getConversation(id: string, workspaceId: string) {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single();

  if (error) throw error;
  return data as Conversation;
}

export async function getConversations(
  workspaceId: string,
  filters?: {
    status?: string;
    channel?: string;
    requiresReply?: boolean;
    decisionBucket?: string;
    limit?: number;
  },
) {
  let query = supabase
    .from('conversations')
    .select('*, customer:customers(*)')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.channel) query = query.eq('channel', filters.channel);
  if (filters?.requiresReply !== undefined)
    query = query.eq('requires_reply', filters.requiresReply);
  if (filters?.decisionBucket) query = query.eq('decision_bucket', filters.decisionBucket);
  if (filters?.limit) query = query.limit(filters.limit);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function updateConversation(
  id: string,
  workspaceId: string,
  updates: Partial<
    Pick<Conversation, 'status' | 'assigned_to' | 'final_response' | 'resolved_at' | 'is_escalated'>
  >,
) {
  const { data, error } = await supabase
    .from('conversations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getAutoHandledCount(workspaceId: string, since: Date) {
  const { count, error } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .gte('auto_handled_at', since.toISOString());

  if (error) throw error;
  return count ?? 0;
}

export async function getConversationStats(workspaceId: string) {
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [toReply, atRisk, review, drafts, clearedToday] = await Promise.all([
    supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('requires_reply', true)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .then((r) => r.count ?? 0),
    supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('decision_bucket', 'act_now')
      .then((r) => r.count ?? 0),
    supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('needs_review', true)
      .then((r) => r.count ?? 0),
    supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .not('ai_draft_response', 'is', null)
      .is('final_response', null)
      .then((r) => r.count ?? 0),
    supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .or('decision_bucket.eq.auto_handled,status.eq.resolved')
      .gte('updated_at', todayMidnight.toISOString())
      .then((r) => r.count ?? 0),
  ]);

  return { toReply, atRisk, review, drafts, clearedToday };
}
