import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation } from '@/lib/types';
import { Tables } from '@/integrations/supabase/types';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { Clock, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface CustomerConversationHistoryProps {
  customerId: string;
  currentConversationId?: string;
}

export const CustomerConversationHistory = ({
  customerId,
  currentConversationId,
}: CustomerConversationHistoryProps) => {
  const [conversations, setConversations] = useState<Tables<'conversations'>[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchConversations = useCallback(async () => {
    try {
      // Fetch ALL conversations (both escalated and AI-handled)
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setConversations(data || []);
    } catch (error) {
      console.error('Error fetching conversation history:', error);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'resolved':
        return 'bg-success/10 text-success hover:bg-success/20';
      case 'new':
        return 'bg-primary/10 text-primary hover:bg-primary/20';
      case 'open':
        return 'bg-warning/10 text-warning hover:bg-warning/20';
      case 'waiting_customer':
        return 'bg-muted text-muted-foreground hover:bg-muted/80';
      default:
        return 'bg-secondary text-secondary-foreground hover:bg-secondary/80';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'text-destructive';
      case 'medium':
        return 'text-warning';
      case 'low':
        return 'text-success';
      default:
        return 'text-muted-foreground';
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-muted/30 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <MessageSquare className="h-12 w-12 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">No conversation history</p>
      </div>
    );
  }

  // Filter out current conversation
  const pastConversations = conversations.filter((c) => c.id !== currentConversationId);

  if (pastConversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <MessageSquare className="h-10 w-10 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">First conversation with customer</p>
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-[400px]">
      <div className="space-y-2">
        {pastConversations.map((conversation) => (
          <Card
            key={conversation.id}
            className="p-3 cursor-pointer hover:bg-accent/50 transition-colors border-border/50"
            onClick={() => navigate(`/?conversation=${conversation.id}`)}
          >
            <div className="space-y-2">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <ChannelIcon channel={conversation.channel} className="h-4 w-4 flex-shrink-0" />
                  <span className="text-sm font-medium truncate">
                    {conversation.title || `${conversation.channel} conversation`}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* AI vs Escalated badge */}
                  {conversation.is_escalated ? (
                    <Badge
                      variant="secondary"
                      className="text-xs bg-warning/10 text-warning hover:bg-warning/20"
                    >
                      🧑 Escalated
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="text-xs bg-success/10 text-success hover:bg-success/20"
                    >
                      🤖 AI
                    </Badge>
                  )}
                  <Badge
                    variant="secondary"
                    className={`text-xs ${getStatusColor(conversation.status || 'new')}`}
                  >
                    {conversation.status}
                  </Badge>
                </div>
              </div>

              {/* Metadata */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>
                    {formatDistanceToNow(new Date(conversation.created_at || ''), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                {conversation.priority && (
                  <span className={`font-medium ${getPriorityColor(conversation.priority)}`}>
                    {conversation.priority}
                  </span>
                )}
                {conversation.category && (
                  <Badge variant="outline" className="text-xs px-1.5 py-0">
                    {conversation.category}
                  </Badge>
                )}
                {/* Message counts */}
                {conversation.message_count > 0 && (
                  <div className="flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" />
                    <span>
                      {conversation.message_count} msg{conversation.message_count !== 1 ? 's' : ''}
                    </span>
                    {conversation.ai_message_count > 0 && (
                      <span className="text-success">({conversation.ai_message_count} AI)</span>
                    )}
                  </div>
                )}
              </div>

              {/* Summary if available */}
              {conversation.summary_for_human && (
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {conversation.summary_for_human}
                </p>
              )}
            </div>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
};
