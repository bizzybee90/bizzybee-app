import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, User, Bot, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { CategoryLabel } from '@/components/shared/CategoryLabel';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface RecentActivity {
  id: string;
  type: 'message' | 'escalation' | 'resolution';
  body: string;
  actor_name: string | null;
  actor_type: string;
  channel: string;
  created_at: string;
  conversation_id: string;
  category?: string;
}

interface RealtimeMessage {
  id: string;
  body: string;
  actor_name: string | null;
  actor_type: string;
  channel: string;
  created_at: string;
  conversation_id: string;
  is_internal: boolean;
}

interface RealtimeConversation {
  id: string;
  title: string | null;
  status: string;
  channel: string;
  is_escalated: boolean;
  escalated_at: string | null;
  resolved_at: string | null;
  updated_at: string;
}

export const RecentActivityWidget = () => {
  const navigate = useNavigate();
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecentActivity = async () => {
    setLoading(true);

    // Fetch 5 most recent inbound messages — true chronological feed
    const { data: messages } = await supabase
      .from('messages')
      .select(
        `
        id, body, actor_name, actor_type, channel, created_at, conversation_id,
        conversations(email_classification)
      `,
      )
      .eq('direction', 'inbound')
      .eq('is_internal', false)
      .order('created_at', { ascending: false })
      .limit(5);

    const combined: RecentActivity[] =
      messages?.map((m) => ({
        ...m,
        type: 'message' as const,
        category: (m.conversations as { email_classification?: string } | null)
          ?.email_classification,
      })) || [];

    setActivities(combined);
    setLoading(false);
  };

  useEffect(() => {
    fetchRecentActivity();

    // Subscribe to real-time updates for messages
    const messageChannel = supabase
      .channel('recent-activity-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: 'direction=eq.inbound',
        },
        (payload) => {
          const newMessage = payload.new as RealtimeMessage;
          if (!newMessage.is_internal) {
            setActivities((prev) =>
              [
                {
                  ...newMessage,
                  type: 'message',
                },
                ...prev,
              ].slice(0, 10),
            );
          }
        },
      )
      .subscribe();

    // Subscribe to conversation status changes
    const conversationChannel = supabase
      .channel('recent-activity-conversations')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
        },
        (payload) => {
          const conv = payload.new as RealtimeConversation;
          const oldConv = payload.old as RealtimeConversation;

          // New escalation
          if (conv.is_escalated && !oldConv.is_escalated) {
            const newActivity: RecentActivity = {
              id: conv.id,
              type: 'escalation',
              body: conv.title || 'New escalation',
              actor_name: null,
              actor_type: 'system',
              channel: conv.channel,
              created_at: conv.escalated_at || conv.updated_at,
              conversation_id: conv.id,
            };
            setActivities((prev) => [newActivity, ...prev].slice(0, 10));
          }

          // New resolution
          if (conv.status === 'resolved' && oldConv.status !== 'resolved') {
            const newActivity: RecentActivity = {
              id: conv.id,
              type: 'resolution',
              body: conv.title || 'Conversation resolved',
              actor_name: null,
              actor_type: 'system',
              channel: conv.channel,
              created_at: conv.resolved_at || conv.updated_at,
              conversation_id: conv.id,
            };
            setActivities((prev) => [newActivity, ...prev].slice(0, 10));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messageChannel);
      supabase.removeChannel(conversationChannel);
    };
  }, []);

  const getActivityIcon = (activity: RecentActivity) => {
    if (activity.type === 'escalation') {
      return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    }
    if (activity.type === 'resolution') {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    }
    if (activity.actor_type === 'ai_agent') {
      return <Bot className="h-4 w-4 text-blue-600" />;
    }
    return <User className="h-4 w-4 text-green-600" />;
  };

  const getActivityLabel = (activity: RecentActivity) => {
    if (activity.type === 'escalation') return 'Escalated';
    if (activity.type === 'resolution') return 'Resolved';
    if (activity.actor_type === 'ai_agent') return 'AI Reply';
    return 'New Message';
  };

  const handleActivityClick = (activity: RecentActivity) => {
    if (activity.conversation_id) {
      // Navigate to the appropriate page with the conversation selected
      if (activity.type === 'escalation') {
        navigate(`/needs-action?id=${activity.conversation_id}`);
      } else {
        navigate(`/done?id=${activity.conversation_id}`);
      }
    }
  };

  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No recent activity</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {activities.map((activity) => (
                <div
                  key={activity.id}
                  className={cn(
                    'flex items-start gap-3 pb-3 border-b last:border-0 transition-colors rounded-lg p-2 -mx-2',
                    activity.conversation_id && 'cursor-pointer hover:bg-accent/50',
                  )}
                  onClick={() => handleActivityClick(activity)}
                >
                  <div className="flex-shrink-0 mt-1">{getActivityIcon(activity)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-medium text-muted-foreground">
                        {getActivityLabel(activity)}
                      </span>
                      <CategoryLabel classification={activity.category} size="xs" />
                      {activity.type === 'message' && (
                        <>
                          <span className="text-xs text-muted-foreground">•</span>
                          <p className="text-sm font-medium truncate">
                            {activity.actor_name || 'Unknown'}
                          </p>
                        </>
                      )}
                      <ChannelIcon
                        channel={activity.channel}
                        className="h-3.5 w-3.5 flex-shrink-0 ml-auto"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-1">
                      {activity.body}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};
