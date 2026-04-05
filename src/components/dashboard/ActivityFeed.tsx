import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { CheckCircle2, Send, Clock, Bot, User, AlertCircle, FileEdit, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CategoryLabel } from '@/components/shared/CategoryLabel';
import { safeFormatDistanceToNow, toValidDate } from '@/lib/dates';

interface ActivityItem {
  id: string;
  type: 'auto_handled' | 'sent' | 'draft_ready' | 'escalated' | 'reviewed' | 'inbox';
  title: string;
  description: string;
  timestamp: Date;
  conversationId?: string;
  category?: string;
}

// Decode HTML entities like &#39; &#x27; &amp; etc.
function decodeHtmlEntities(text: string | null | undefined): string {
  if (!text) return '';
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return doc.documentElement.textContent || '';
}

interface ActivityFeedProps {
  onNavigate?: (path: string) => void;
  maxItems?: number;
}

export function ActivityFeed({ onNavigate, maxItems = 10 }: ActivityFeedProps) {
  const { workspace } = useWorkspace();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchActivities = async () => {
      if (!workspace?.id) return;

      try {
        // Get recent auto-handled conversations
        const { data: autoHandled } = await supabase
          .from('conversations')
          .select('id, title, summary_for_human, auto_handled_at, email_classification')
          .eq('workspace_id', workspace.id)
          .eq('decision_bucket', 'auto_handled')
          .not('auto_handled_at', 'is', null)
          .order('auto_handled_at', { ascending: false })
          .limit(5);

        // Get recent sent messages (outbound)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: sentMessages } = await supabase
          .from('messages')
          .select(
            `
            id,
            created_at,
            body,
            conversation_id,
            conversations!inner(
              id,
              title,
              workspace_id
            )
          `,
          )
          .eq('direction', 'outbound')
          .eq('is_internal', false)
          .gte('created_at', oneDayAgo)
          .order('created_at', { ascending: false })
          .limit(5);

        // Get draft responses
        const { data: drafts } = await supabase
          .from('conversations')
          .select('id, title, summary_for_human, updated_at')
          .eq('workspace_id', workspace.id)
          .not('ai_draft_response', 'is', null)
          .is('final_response', null)
          .in('status', ['new', 'open', 'ai_handling'])
          .order('updated_at', { ascending: false })
          .limit(5);

        // Get recently reviewed
        const { data: reviewed } = await supabase
          .from('conversations')
          .select('id, title, reviewed_at, review_outcome')
          .eq('workspace_id', workspace.id)
          .not('reviewed_at', 'is', null)
          .order('reviewed_at', { ascending: false })
          .limit(3);

        // Get recent inbox emails
        const { data: recentEmails } = await supabase
          .from('email_import_queue')
          .select('id, from_name, from_email, subject, body, received_at, category, direction')
          .eq('workspace_id', workspace.id)
          .eq('direction', 'inbound')
          .or('is_noise.is.null,is_noise.eq.false')
          .not('from_email', 'ilike', '%maccleaning%')
          .order('received_at', { ascending: false })
          .limit(5);

        // Combine into activities
        const allActivities: ActivityItem[] = [];
        const addActivity = (
          activity: Omit<ActivityItem, 'timestamp'>,
          rawTimestamp: string | null | undefined,
        ) => {
          const timestamp = toValidDate(rawTimestamp);
          if (!timestamp) return;

          allActivities.push({
            ...activity,
            timestamp,
          });
        };

        autoHandled?.forEach((c) => {
          addActivity(
            {
              id: `auto-${c.id}`,
              type: 'auto_handled',
              title: decodeHtmlEntities(c.title) || 'Auto-handled',
              description: c.email_classification?.replace(/_/g, ' ') || 'Notification',
              conversationId: c.id,
              category: c.email_classification,
            },
            c.auto_handled_at,
          );
        });

        sentMessages?.forEach((m) => {
          const convJoin = m.conversations as { workspace_id?: string; title?: string } | null;
          if (convJoin?.workspace_id === workspace.id) {
            addActivity(
              {
                id: `sent-${m.id}`,
                type: 'sent',
                title: decodeHtmlEntities(convJoin?.title) || 'Message sent',
                description: decodeHtmlEntities(
                  m.body?.substring(0, 60) + (m.body && m.body.length > 60 ? '...' : ''),
                ),
                conversationId: m.conversation_id || undefined,
              },
              m.created_at,
            );
          }
        });

        drafts?.forEach((c) => {
          addActivity(
            {
              id: `draft-${c.id}`,
              type: 'draft_ready',
              title: decodeHtmlEntities(c.title) || 'Draft ready',
              description: 'AI response pending review',
              conversationId: c.id,
            },
            c.updated_at,
          );
        });

        reviewed?.forEach((c) => {
          addActivity(
            {
              id: `review-${c.id}`,
              type: 'reviewed',
              title: decodeHtmlEntities(c.title) || 'Reviewed',
              description: c.review_outcome === 'confirmed' ? 'AI confirmed' : 'AI corrected',
              conversationId: c.id,
            },
            c.reviewed_at,
          );
        });

        recentEmails?.forEach((e) => {
          addActivity(
            {
              id: `inbox-${e.id}`,
              type: 'inbox',
              title: decodeHtmlEntities(e.subject) || 'No subject',
              description: decodeHtmlEntities(e.from_name || e.from_email || 'Unknown sender'),
              category: e.category,
            },
            e.received_at,
          );
        });

        // Sort by timestamp and take top items
        allActivities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        setActivities(allActivities.slice(0, maxItems));
      } catch (error) {
        console.error('Error fetching activities:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchActivities();

    // Realtime subscription
    const channel = supabase
      .channel('activity-feed')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `workspace_id=eq.${workspace?.id}`,
        },
        () => fetchActivities(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspace?.id, maxItems]);

  const getActivityIcon = (type: ActivityItem['type']) => {
    switch (type) {
      case 'auto_handled':
        return <Bot className="h-4 w-4 text-success" />;
      case 'sent':
        return <Send className="h-4 w-4 text-primary" />;
      case 'draft_ready':
        return <FileEdit className="h-4 w-4 text-warning" />;
      case 'escalated':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'reviewed':
        return <CheckCircle2 className="h-4 w-4 text-purple-500" />;
      case 'inbox':
        return <Mail className="h-4 w-4 text-blue-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getActivityLabel = (type: ActivityItem['type']) => {
    switch (type) {
      case 'auto_handled':
        return 'Auto-handled';
      case 'sent':
        return 'Sent';
      case 'draft_ready':
        return 'Draft';
      case 'escalated':
        return 'Escalated';
      case 'reviewed':
        return 'Reviewed';
      case 'inbox':
        return 'Received';
      default:
        return 'Activity';
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 animate-pulse">
            <div className="h-8 w-8 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 bg-muted rounded" />
              <div className="h-3 w-1/2 bg-muted rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {activities.map((activity) => (
        <div
          key={activity.id}
          className={cn(
            'flex items-start gap-3 p-3 rounded-lg transition-colors',
            activity.conversationId && 'cursor-pointer hover:bg-accent/50',
            activity.type === 'draft_ready' && 'bg-warning/5 border border-warning/20',
          )}
          onClick={() => {
            if (activity.conversationId && onNavigate) {
              if (activity.type === 'draft_ready') {
                onNavigate(`/needs-action?id=${activity.conversationId}`);
              } else if (activity.type === 'inbox') {
                onNavigate(`/needs-action`);
              } else {
                onNavigate(`/needs-action?id=${activity.conversationId}`);
              }
            }
          }}
        >
          <div className="flex-shrink-0 mt-0.5">{getActivityIcon(activity.type)}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-muted-foreground">
                {getActivityLabel(activity.type)}
              </span>
              <CategoryLabel classification={activity.category} size="xs" />
              <span className="text-xs text-muted-foreground/60">
                {safeFormatDistanceToNow(activity.timestamp, { addSuffix: true })}
              </span>
            </div>
            <p className="text-sm font-medium text-foreground truncate">{activity.title}</p>
            <p className="text-xs text-muted-foreground truncate">{activity.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
