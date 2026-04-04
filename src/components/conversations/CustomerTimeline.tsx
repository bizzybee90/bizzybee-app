import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow, format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import {
  Clock,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  Bot,
  User,
  ArrowRight,
  FileText,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Separator } from '@/components/ui/separator';

interface TimelineEvent {
  id: string;
  type: 'conversation' | 'message' | 'event' | 'note';
  timestamp: string;
  conversation_id?: string;
  conversation_title?: string;
  channel?: string;
  content: string;
  actor_name?: string;
  actor_type?: string;
  status?: string;
  priority?: string;
  event_type?: 'escalation' | 'resolution' | 'status_change';
}

interface CustomerTimelineProps {
  customerId: string;
  currentConversationId?: string;
}

export const CustomerTimeline = ({ customerId, currentConversationId }: CustomerTimelineProps) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'timeline' | 'conversations'>('timeline');
  const navigate = useNavigate();

  useEffect(() => {
    fetchTimeline();
  }, [customerId]);

  const fetchTimeline = async () => {
    setLoading(true);
    try {
      // Fetch conversations
      const { data: conversations } = await supabase
        .from('conversations')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(20);

      // Fetch messages for those conversations
      const conversationIds = conversations?.map((c) => c.id) || [];
      const { data: messages } = await supabase
        .from('messages')
        .select('*')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: false })
        .limit(50);

      // Fetch customer notes
      const { data: customer } = await supabase
        .from('customers')
        .select('notes')
        .eq('id', customerId)
        .single();

      // Build timeline events
      const timelineEvents: TimelineEvent[] = [];

      // Add conversation events
      conversations?.forEach((conv) => {
        // Conversation created event
        timelineEvents.push({
          id: `conv-${conv.id}`,
          type: 'conversation',
          timestamp: conv.created_at || '',
          conversation_id: conv.id,
          conversation_title: conv.title || `${conv.channel} conversation`,
          channel: conv.channel,
          content: conv.summary_for_human || conv.title || 'New conversation',
          status: conv.status || undefined,
          priority: conv.priority || undefined,
        });

        // Escalation event
        if (conv.is_escalated && conv.escalated_at) {
          timelineEvents.push({
            id: `esc-${conv.id}`,
            type: 'event',
            event_type: 'escalation',
            timestamp: conv.escalated_at,
            conversation_id: conv.id,
            conversation_title: conv.title || `${conv.channel} conversation`,
            channel: conv.channel,
            content: conv.ai_reason_for_escalation || 'Conversation escalated to human',
          });
        }

        // Resolution event
        if (conv.status === 'resolved' && conv.resolved_at) {
          timelineEvents.push({
            id: `res-${conv.id}`,
            type: 'event',
            event_type: 'resolution',
            timestamp: conv.resolved_at,
            conversation_id: conv.id,
            conversation_title: conv.title || `${conv.channel} conversation`,
            channel: conv.channel,
            content: 'Conversation resolved',
          });
        }
      });

      // Add message events
      messages?.forEach((msg) => {
        const conv = conversations?.find((c) => c.id === msg.conversation_id);
        timelineEvents.push({
          id: `msg-${msg.id}`,
          type: 'message',
          timestamp: msg.created_at || '',
          conversation_id: msg.conversation_id || undefined,
          conversation_title: conv?.title || `${msg.channel} conversation`,
          channel: msg.channel,
          content: msg.body,
          actor_name: msg.actor_name || undefined,
          actor_type: msg.actor_type,
        });
      });

      // Add customer notes
      if (customer?.notes) {
        timelineEvents.push({
          id: 'notes',
          type: 'note',
          timestamp: new Date().toISOString(),
          content: customer.notes,
        });
      }

      // Sort by timestamp (newest first)
      timelineEvents.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      setEvents(timelineEvents);
    } catch (error) {
      console.error('Error fetching timeline:', error);
    } finally {
      setLoading(false);
    }
  };

  const getEventIcon = (event: TimelineEvent) => {
    switch (event.type) {
      case 'conversation':
        return <MessageSquare className="h-4 w-4 text-primary" />;
      case 'message':
        return event.actor_type === 'ai_agent' ? (
          <Bot className="h-4 w-4 text-blue-500" />
        ) : (
          <User className="h-4 w-4 text-green-500" />
        );
      case 'event':
        if (event.event_type === 'escalation') {
          return <AlertTriangle className="h-4 w-4 text-orange-500" />;
        }
        if (event.event_type === 'resolution') {
          return <CheckCircle2 className="h-4 w-4 text-green-500" />;
        }
        return <ArrowRight className="h-4 w-4 text-muted-foreground" />;
      case 'note':
        return <FileText className="h-4 w-4 text-purple-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getEventLabel = (event: TimelineEvent) => {
    switch (event.type) {
      case 'conversation':
        return 'Conversation Started';
      case 'message':
        return event.actor_type === 'ai_agent' ? 'AI Reply' : 'Human Reply';
      case 'event':
        if (event.event_type === 'escalation') return 'Escalated';
        if (event.event_type === 'resolution') return 'Resolved';
        return 'Status Changed';
      case 'note':
        return 'Customer Note';
      default:
        return 'Event';
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'resolved':
        return 'bg-green-500/10 text-green-600 dark:text-green-400';
      case 'new':
        return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
      case 'open':
        return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400';
      case 'waiting_customer':
        return 'bg-muted text-muted-foreground';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <MessageSquare className="h-12 w-12 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">No activity history</p>
      </div>
    );
  }

  return (
    <Tabs
      value={view}
      onValueChange={(v) => setView(v as 'timeline' | 'conversations')}
      className="w-full"
    >
      <TabsList className="grid w-full grid-cols-2 mb-3">
        <TabsTrigger value="timeline" className="text-xs">
          <Clock className="h-3 w-3 mr-1.5" />
          Timeline
        </TabsTrigger>
        <TabsTrigger value="conversations" className="text-xs">
          <MessageSquare className="h-3 w-3 mr-1.5" />
          Conversations
        </TabsTrigger>
      </TabsList>

      <TabsContent value="timeline" className="mt-0">
        <ScrollArea className="h-[400px]">
          <div className="space-y-3 pr-4">
            {events.map((event, index) => (
              <div key={event.id}>
                <Card
                  className={`p-3 border-border/50 ${
                    event.conversation_id && event.conversation_id !== currentConversationId
                      ? 'cursor-pointer hover:bg-accent/50 transition-colors'
                      : ''
                  }`}
                  onClick={() => {
                    if (event.conversation_id && event.conversation_id !== currentConversationId) {
                      navigate(`/?conversation=${event.conversation_id}`);
                    }
                  }}
                >
                  <div className="space-y-2">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {getEventIcon(event)}
                        <span className="text-xs font-medium text-muted-foreground truncate">
                          {getEventLabel(event)}
                        </span>
                        {event.channel && (
                          <ChannelIcon channel={event.channel} className="h-3 w-3 flex-shrink-0" />
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                        {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                      </span>
                    </div>

                    {/* Conversation Title */}
                    {event.conversation_title && (
                      <p className="text-sm font-medium line-clamp-1">{event.conversation_title}</p>
                    )}

                    {/* Content */}
                    <p className="text-xs text-muted-foreground line-clamp-2">{event.content}</p>

                    {/* Metadata */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {event.actor_name && (
                        <Badge variant="outline" className="text-xs">
                          {event.actor_name}
                        </Badge>
                      )}
                      {event.status && (
                        <Badge className={`text-xs ${getStatusColor(event.status)}`}>
                          {event.status}
                        </Badge>
                      )}
                      {event.priority && (
                        <Badge variant="outline" className="text-xs">
                          {event.priority}
                        </Badge>
                      )}
                    </div>
                  </div>
                </Card>

                {/* Timeline connector */}
                {index < events.length - 1 && (
                  <div className="flex items-center gap-2 py-1 pl-[18px]">
                    <div className="w-px h-4 bg-border" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="conversations" className="mt-0">
        <ScrollArea className="h-[400px]">
          <div className="space-y-2 pr-4">
            {events
              .filter(
                (e) => e.type === 'conversation' && e.conversation_id !== currentConversationId,
              )
              .map((event) => (
                <Card
                  key={event.id}
                  className="p-3 cursor-pointer hover:bg-accent/50 transition-colors border-border/50"
                  onClick={() => navigate(`/?conversation=${event.conversation_id}`)}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {event.channel && (
                          <ChannelIcon channel={event.channel} className="h-4 w-4 flex-shrink-0" />
                        )}
                        <span className="text-sm font-medium truncate">
                          {event.conversation_title}
                        </span>
                      </div>
                      {event.status && (
                        <Badge className={`text-xs ${getStatusColor(event.status)}`}>
                          {event.status}
                        </Badge>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2">{event.content}</p>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>
                        {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                      </span>
                      {event.priority && (
                        <>
                          <span>•</span>
                          <span className="font-medium">{event.priority}</span>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              ))}

            {events.filter(
              (e) => e.type === 'conversation' && e.conversation_id !== currentConversationId,
            ).length === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <MessageSquare className="h-10 w-10 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">First conversation with customer</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
};
