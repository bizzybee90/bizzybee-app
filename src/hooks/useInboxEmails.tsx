import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from './useWorkspace';
import { isOutbound, isInbound, type InboxFolder, CATEGORY_GROUPS } from '@/lib/emailDirection';

const PAGE_SIZE = 50;

export interface InboxEmail {
  id: string;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[] | null;
  subject: string | null;
  body: string | null;
  body_html: string | null;
  received_at: string | null;
  category: string | null;
  confidence: number | null;
  needs_review: boolean | null;
  is_noise: boolean | null;
  requires_reply: boolean | null;
  thread_id: string;
  status: string | null;
  direction: string;
}

interface UseInboxEmailsOptions {
  folder: InboxFolder;
  categoryFilter: string | null;
  search: string;
  page: number;
}

// Shape of conversation row with customer join, as returned by Supabase queries
interface ConversationWithCustomer {
  id: string;
  title?: string | null;
  status?: string | null;
  channel?: string | null;
  email_classification?: string | null;
  decision_bucket?: string | null;
  requires_reply?: boolean | null;
  triage_confidence?: number | null;
  summary_for_human?: string | null;
  external_conversation_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  direction?: string;
  customer?: { id?: string; name?: string; email?: string } | null;
}

// Map a conversation row (with customer join) to the InboxEmail shape
const mapConversationToInboxEmail = (conv: ConversationWithCustomer): InboxEmail => ({
  id: conv.id,
  from_email: conv.customer?.email || null,
  from_name: conv.customer?.name || null,
  to_emails: null,
  subject: conv.title || null,
  body: conv.summary_for_human || null,
  body_html: null,
  received_at: conv.created_at || null,
  category: conv.email_classification || null,
  confidence: conv.triage_confidence || null,
  needs_review: conv.triage_confidence != null && conv.triage_confidence < 0.7,
  is_noise: conv.decision_bucket === 'auto_handled',
  requires_reply: conv.requires_reply ?? null,
  thread_id: conv.external_conversation_id || conv.id,
  status: conv.status || null,
  direction: conv.direction || 'inbound',
});

export const useInboxEmails = ({ folder, categoryFilter, search, page }: UseInboxEmailsOptions) => {
  const { workspace } = useWorkspace();

  return useQuery({
    queryKey: ['inbox-emails', workspace?.id, folder, categoryFilter, search, page],
    queryFn: async () => {
      if (!workspace?.id) return { emails: [], total: 0 };

      let query = supabase
        .from('conversations')
        .select(
          `
          id,
          title,
          status,
          channel,
          email_classification,
          decision_bucket,
          requires_reply,
          triage_confidence,
          snoozed_until,
          summary_for_human,
          external_conversation_id,
          created_at,
          updated_at,
          customer:customers(id, name, email)
        `,
          { count: 'exact' },
        )
        .eq('workspace_id', workspace.id)
        .order('updated_at', { ascending: false });

      // Apply folder filters
      switch (folder) {
        case 'inbox':
          query = query
            .neq('decision_bucket', 'auto_handled')
            .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated']);
          break;
        case 'sent':
          query = query.eq('status', 'resolved');
          break;
        case 'needs-reply':
          query = query
            .eq('requires_reply', true)
            .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
          break;
        case 'ai-review':
          query = query.lt('triage_confidence', 0.7).in('status', ['new', 'open']);
          break;
        case 'noise':
          query = query.or('decision_bucket.eq.auto_handled,email_classification.eq.spam');
          break;
        case 'all':
          // No filter
          break;
      }

      // Apply category filter
      if (categoryFilter) {
        const group = CATEGORY_GROUPS.find((g) => g.key === categoryFilter);
        if (group) {
          query = query.in('email_classification', group.categories);
        }
      }

      // Apply search (search customer name/email via title or joined customer)
      if (search.trim()) {
        query = query.or(`title.ilike.%${search}%,summary_for_human.ilike.%${search}%`);
      }

      // Pagination
      query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const { data, count, error } = await query;
      if (error) throw error;

      const emails = (data || []).map(mapConversationToInboxEmail);
      return { emails, total: count || 0 };
    },
    enabled: !!workspace?.id,
    staleTime: 30000,
  });
};

// Fetch full email with body_html for reading pane
// Tries conversations first (for metadata), falls back to email_import_queue for body content
export const useEmailDetail = (emailId: string | null) => {
  const { workspace } = useWorkspace();

  return useQuery({
    queryKey: ['inbox-email-detail', emailId],
    queryFn: async () => {
      if (!emailId || !workspace?.id) return null;

      // First try conversations (which is what the list returns)
      const { data: conv, error: convError } = await supabase
        .from('conversations')
        .select(
          `
          id, title, status, channel, email_classification,
          decision_bucket, requires_reply, triage_confidence,
          summary_for_human, external_conversation_id,
          created_at, updated_at,
          customer:customers(id, name, email)
        `,
        )
        .eq('id', emailId)
        .single();

      if (!convError && conv) {
        // Fetch the latest message body for this conversation
        const { data: latestMsg } = await supabase
          .from('messages')
          .select('body, raw_payload')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        const mapped = mapConversationToInboxEmail(conv);
        if (latestMsg) {
          mapped.body = latestMsg.body || mapped.body;
          // Try to get HTML from raw_payload
          const raw = latestMsg.raw_payload as Record<string, unknown> | null;
          if (raw?.htmlBody) {
            mapped.body_html = raw.htmlBody as string;
          } else if (
            raw?.body &&
            typeof raw.body === 'object' &&
            (raw.body as Record<string, unknown>)?.html
          ) {
            mapped.body_html = (raw.body as Record<string, unknown>).html as string;
          }
        }
        return mapped;
      }

      // Fallback: try email_import_queue (for older imported emails)
      const { data, error } = await supabase
        .from('email_import_queue')
        .select('*')
        .eq('id', emailId)
        .single();

      if (error) throw error;
      return data as InboxEmail;
    },
    enabled: !!emailId && !!workspace?.id,
  });
};

// Fetch thread emails (messages within a conversation)
export const useEmailThread = (threadId: string | null) => {
  const { workspace } = useWorkspace();

  return useQuery({
    queryKey: ['inbox-thread', threadId],
    queryFn: async () => {
      if (!threadId || !workspace?.id) return [];

      // Try to find messages for this conversation
      const { data: messages, error: msgError } = await supabase
        .from('messages')
        .select('id, actor_name, actor_type, direction, body, raw_payload, created_at')
        .eq('conversation_id', threadId)
        .order('created_at', { ascending: true });

      if (!msgError && messages && messages.length > 0) {
        // Get conversation customer info
        const { data: conv } = await supabase
          .from('conversations')
          .select('title, customer:customers(name, email)')
          .eq('id', threadId)
          .single();

        const convData = conv as {
          title?: string;
          customer?: { name?: string; email?: string } | null;
        } | null;
        return messages.map((msg): InboxEmail => {
          const raw = msg.raw_payload as Record<string, unknown> | null;
          return {
            id: msg.id,
            from_email: msg.direction === 'inbound' ? convData?.customer?.email || null : null,
            from_name:
              msg.actor_name ||
              (msg.direction === 'inbound' ? convData?.customer?.name : 'You') ||
              null,
            to_emails: null,
            subject: convData?.title || null,
            body: msg.body || null,
            body_html:
              (raw?.htmlBody as string) ||
              (raw?.body && typeof raw.body === 'object'
                ? ((raw.body as Record<string, unknown>)?.html as string)
                : null) ||
              null,
            received_at: msg.created_at,
            category: null,
            confidence: null,
            needs_review: null,
            is_noise: null,
            requires_reply: null,
            thread_id: threadId,
            status: null,
            direction: msg.direction || 'inbound',
          };
        });
      }

      // Fallback: try email_import_queue thread
      const { data, error } = await supabase
        .from('email_import_queue')
        .select(
          'id, from_email, from_name, to_emails, subject, body, body_html, received_at, category, confidence, direction',
        )
        .eq('workspace_id', workspace.id)
        .eq('thread_id', threadId)
        .order('received_at', { ascending: true });

      if (error) throw error;
      return (data || []) as InboxEmail[];
    },
    enabled: !!threadId && !!workspace?.id,
  });
};

// Folder counts from conversations table
export const useInboxCounts = () => {
  const { workspace } = useWorkspace();

  return useQuery({
    queryKey: ['inbox-counts', workspace?.id],
    queryFn: async () => {
      if (!workspace?.id) return { inbox: 0, needsReply: 0, aiReview: 0, unread: 0 };

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [inboxResult, needsReplyResult, aiReviewResult, unreadResult] = await Promise.all([
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .neq('decision_bucket', 'auto_handled')
          .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated'])
          .gte('created_at', thirtyDaysAgo),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .eq('requires_reply', true)
          .gte('created_at', thirtyDaysAgo),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .lt('triage_confidence', 0.7)
          .in('status', ['new', 'open']),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .eq('status', 'new')
          .gte('created_at', thirtyDaysAgo),
      ]);

      return {
        inbox: inboxResult.count || 0,
        needsReply: needsReplyResult.count || 0,
        aiReview: aiReviewResult.count || 0,
        unread: unreadResult.count || 0,
      };
    },
    enabled: !!workspace?.id,
    staleTime: 30000,
    refetchInterval: 60000,
  });
};

// Fetch HTML body on demand via edge function
export const useFetchEmailBody = () => {
  const fetchBody = async (emailId: string): Promise<string | null> => {
    const { data, error } = await supabase.functions.invoke('fetch-email-body', {
      body: { email_id: emailId },
    });
    if (error) throw error;
    return data?.body_html || null;
  };
  return { fetchBody };
};
