import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Loader2,
  Bot,
  User,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Mail,
  MessageSquare,
  Phone,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { ChannelIcon } from '@/components/shared/ChannelIcon';

interface ConversationWithMessages {
  id: string;
  title: string | null;
  summary_for_human: string | null;
  category: string | null;
  ai_sentiment: string | null;
  ai_confidence: number | null;
  channel: string;
  created_at: string;
  customer_message: string | null;
  ai_response: string | null;
}

export const AIConversationSummaryWidget = () => {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<ConversationWithMessages[]>([]);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchConversations();

    // Set up realtime subscription
    const channel = supabase
      .channel('ai-conversations-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `is_escalated=eq.false`,
        },
        () => {
          fetchConversations();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspace?.id]);

  const fetchConversations = async () => {
    if (!workspace?.id) return;

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Fetch conversations
      const { data: convos, error: convosError } = await supabase
        .from('conversations')
        .select('*')
        .eq('workspace_id', workspace.id)
        .eq('is_escalated', false)
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false })
        .limit(10);

      if (convosError) throw convosError;

      if (convos && convos.length > 0) {
        // Fetch messages for each conversation
        const conversationsWithMessages = await Promise.all(
          convos.map(async (convo) => {
            // Get customer message (first inbound)
            const { data: customerMsg } = await supabase
              .from('messages')
              .select('body')
              .eq('conversation_id', convo.id)
              .eq('direction', 'inbound')
              .order('created_at', { ascending: true })
              .limit(1)
              .single();

            // Get AI response (first outbound from ai_agent)
            const { data: aiMsg } = await supabase
              .from('messages')
              .select('body')
              .eq('conversation_id', convo.id)
              .eq('direction', 'outbound')
              .eq('actor_type', 'ai_agent')
              .order('created_at', { ascending: true })
              .limit(1)
              .single();

            return {
              id: convo.id,
              title: convo.title,
              summary_for_human: convo.summary_for_human,
              category: convo.category,
              ai_sentiment: convo.ai_sentiment,
              ai_confidence: convo.ai_confidence,
              channel: convo.channel,
              created_at: convo.created_at,
              customer_message: customerMsg?.body || null,
              ai_response: aiMsg?.body || null,
            };
          }),
        );

        setConversations(
          conversationsWithMessages.filter((c) => c.customer_message || c.ai_response),
        );
      }
    } catch (error) {
      console.error('Error fetching conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedCards((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const getSentimentEmoji = (sentiment: string | null) => {
    switch (sentiment?.toLowerCase()) {
      case 'positive':
        return '';
      case 'negative':
        return '';
      case 'neutral':
        return '';
      default:
        return '';
    }
  };

  const getCategoryColor = (category: string | null) => {
    const colors: Record<string, string> = {
      scheduling: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
      billing: 'bg-green-500/10 text-green-700 dark:text-green-400',
      support: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
      inquiry: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
      complaint: 'bg-red-500/10 text-red-700 dark:text-red-400',
    };
    return colors[category?.toLowerCase() || ''] || 'bg-muted text-muted-foreground';
  };

  const truncateText = (text: string | null, maxLength: number = 120) => {
    if (!text) return '';
    return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Recent AI Conversations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (conversations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Recent AI Conversations
          </CardTitle>
          <CardDescription>View customer inquiries and AI responses</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No AI conversations today yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          Recent AI Conversations
        </CardTitle>
        <CardDescription>Customer inquiries and AI responses from today</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px] pr-4">
          <div className="space-y-3">
            {conversations.map((convo) => {
              const isExpanded = expandedCards.has(convo.id);

              return (
                <Collapsible
                  key={convo.id}
                  open={isExpanded}
                  onOpenChange={() => toggleExpanded(convo.id)}
                >
                  <div className="rounded-lg border border-border bg-card hover:bg-accent/5 transition-colors">
                    {/* Header */}
                    <CollapsibleTrigger asChild>
                      <button className="w-full p-4 text-left">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* Category & Time */}
                            <div className="flex items-center gap-2 mb-2">
                              {convo.category && (
                                <Badge
                                  variant="secondary"
                                  className={`text-xs ${getCategoryColor(convo.category)}`}
                                >
                                  {convo.category}
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(convo.created_at), 'h:mm a')}
                              </span>
                              <ChannelIcon channel={convo.channel} className="h-3 w-3" />
                            </div>

                            {/* Summary or Title */}
                            <p className="text-sm font-medium mb-2 line-clamp-1">
                              {convo.summary_for_human || convo.title || 'Conversation'}
                            </p>

                            {/* Preview */}
                            {!isExpanded && convo.customer_message && (
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {truncateText(convo.customer_message, 100)}
                              </p>
                            )}
                          </div>

                          {/* Expand Icon */}
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </div>
                      </button>
                    </CollapsibleTrigger>

                    {/* Expanded Content */}
                    <CollapsibleContent>
                      <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
                        {/* Customer Message */}
                        {convo.customer_message && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                              <User className="h-3 w-3" />
                              Customer asked:
                            </div>
                            <div className="pl-5 text-sm bg-muted/50 rounded-lg p-3 border border-border">
                              {convo.customer_message}
                            </div>
                          </div>
                        )}

                        {/* AI Response */}
                        {convo.ai_response && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                              <Bot className="h-3 w-3" />
                              AI responded:
                            </div>
                            <div className="pl-5 text-sm bg-primary/5 rounded-lg p-3 border border-primary/20">
                              {convo.ai_response}
                            </div>
                          </div>
                        )}

                        {/* Footer with Metrics */}
                        <div className="flex items-center justify-between pt-2 border-t border-border">
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              {getSentimentEmoji(convo.ai_sentiment)}
                              <span className="capitalize">{convo.ai_sentiment || 'N/A'}</span>
                            </span>
                            {convo.ai_confidence && (
                              <span className="flex items-center gap-1">
                                <span
                                  className={
                                    convo.ai_confidence >= 0.8
                                      ? 'text-success'
                                      : convo.ai_confidence >= 0.6
                                        ? 'text-warning'
                                        : 'text-destructive'
                                  }
                                >
                                  {Math.round(convo.ai_confidence * 100)}% confident
                                </span>
                              </span>
                            )}
                          </div>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/?conversation=${convo.id}`);
                            }}
                            className="h-7 text-xs"
                          >
                            View Full
                            <ExternalLink className="h-3 w-3 ml-1" />
                          </Button>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
