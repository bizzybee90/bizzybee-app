import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Bot, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  TrendingUp,
  MessageSquare,
  Zap
} from 'lucide-react';
import { format } from 'date-fns';
import { useWorkspace } from '@/hooks/useWorkspace';

interface ConversationStats {
  total: number;
  aiHandled: number;
  escalated: number;
  resolved: number;
  avgConfidence: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  unread: number;
  unreadByChannel: {
    email: number;
    whatsapp: number;
    sms: number;
    phone: number;
    webchat: number;
  };
}

interface RecentConversation {
  id: string;
  title: string;
  status: string;
  is_escalated: boolean;
  ai_confidence: number | null;
  ai_sentiment: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
}

import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { AIActivityWidget } from './AIActivityWidget';
import { AIConversationSummaryWidget } from './AIConversationSummaryWidget';
import { MetricPillCard } from '@/components/shared/MetricPillCard';
import { useIsMobile } from '@/hooks/use-mobile';

export const LiveActivityDashboard = () => {
  const { workspace } = useWorkspace();
  const isMobile = useIsMobile();
  const [stats, setStats] = useState<ConversationStats>({
    total: 0,
    aiHandled: 0,
    escalated: 0,
    resolved: 0,
    avgConfidence: 0,
    positiveCount: 0,
    neutralCount: 0,
    negativeCount: 0,
    unread: 0,
    unreadByChannel: {
      email: 0,
      whatsapp: 0,
      sms: 0,
      phone: 0,
      webchat: 0
    }
  });
  const [recentConversations, setRecentConversations] = useState<RecentConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!workspace?.id) return;

    try {
      // Get recent conversations (last 7 days for meaningful stats)
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      weekAgo.setHours(0, 0, 0, 0);
      const weekAgoStr = weekAgo.toISOString();

      // Fetch recent conversations for stats
      const { data: conversations, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('workspace_id', workspace.id)
        .gte('created_at', weekAgoStr)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      if (conversations) {
        // Calculate stats
        const total = conversations.length;
        const escalated = conversations.filter(c => c.is_escalated).length;
        const aiHandled = conversations.filter(c => !c.is_escalated && c.conversation_type === 'ai_handled').length;
        const resolved = conversations.filter(c => c.status === 'resolved').length;
        
        const confidenceScores = conversations
          .filter(c => c.ai_confidence !== null)
          .map(c => c.ai_confidence as number);
        const avgConfidence = confidenceScores.length > 0
          ? confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
          : 0;

        const positiveCount = conversations.filter(c => c.ai_sentiment === 'positive').length;
        const neutralCount = conversations.filter(c => c.ai_sentiment === 'neutral').length;
        const negativeCount = conversations.filter(c => c.ai_sentiment === 'negative').length;

        // Calculate unread (status='new') conversations
        const unreadConversations = conversations.filter(c => c.status === 'new');
        const unread = unreadConversations.length;
        
        // Break down unread by channel
        const unreadByChannel = {
          email: unreadConversations.filter(c => c.channel === 'email').length,
          whatsapp: unreadConversations.filter(c => c.channel === 'whatsapp').length,
          sms: unreadConversations.filter(c => c.channel === 'sms').length,
          phone: unreadConversations.filter(c => c.channel === 'phone').length,
          webchat: unreadConversations.filter(c => c.channel === 'webchat').length,
        };

        setStats({
          total,
          aiHandled,
          escalated,
          resolved,
          avgConfidence,
          positiveCount,
          neutralCount,
          negativeCount,
          unread,
          unreadByChannel
        });

        setRecentConversations(conversations.slice(0, 20) as RecentConversation[]);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Set up realtime subscription
    const channel = supabase
      .channel('dashboard-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `workspace_id=eq.${workspace?.id}`
        },
        (payload) => {
          console.log('Realtime update:', payload);
          fetchData(); // Re-fetch data on any change
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspace?.id]);

  const getSentimentIcon = (sentiment: string | null) => {
    switch (sentiment) {
      case 'positive': return '';
      case 'negative': return '';
      default: return '';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'resolved': return 'default';
      case 'in_progress': return 'secondary';
      case 'waiting': return 'outline';
      default: return 'secondary';
    }
  };

  return (
    <ThreeColumnLayout
      sidebar={<Sidebar />}
      main={
        loading ? (
          <div className="flex items-center justify-center min-h-screen">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading dashboard...</p>
            </div>
          </div>
        ) : (
          <div className="p-4 md:p-8 space-y-4 md:space-y-6 min-w-0">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold">Live Activity Dashboard</h1>
        <p className="text-muted-foreground text-sm md:text-base">Real-time AI performance metrics (last 7 days)</p>
      </div>

      {/* Unread Messages */}
      {isMobile ? (
        <MetricPillCard
          title="Unread"
          value={stats.unread}
          icon={<MessageSquare className="h-6 w-6" />}
          iconColor="text-purple-600 dark:text-purple-400"
          bgColor="bg-purple-50 dark:bg-purple-950/20"
        />
      ) : (
        <Card className="p-6 bg-purple-50 dark:bg-purple-950/20">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Unread Conversations</p>
              <h3 className="text-4xl font-bold mt-2 text-purple-600 dark:text-purple-400">
                {stats.unread}
              </h3>
            </div>
            <MessageSquare className="h-10 w-10 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="space-y-2 pt-4 border-t">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Email</span>
              <span className="font-semibold">{stats.unreadByChannel.email}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">WhatsApp</span>
              <span className="font-semibold">{stats.unreadByChannel.whatsapp}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">SMS</span>
              <span className="font-semibold">{stats.unreadByChannel.sms}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Phone</span>
              <span className="font-semibold">{stats.unreadByChannel.phone}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Web Chat</span>
              <span className="font-semibold">{stats.unreadByChannel.webchat}</span>
            </div>
          </div>
        </Card>
      )}

      {/* Channel Breakdown - Mobile Only */}
      {isMobile && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Channel Breakdown</h2>
          <div className="grid grid-cols-2 gap-3">
            <MetricPillCard
              title="Email"
              value={stats.unreadByChannel.email}
              icon={<MessageSquare className="h-5 w-5" />}
              iconColor="text-blue-600"
              bgColor="bg-blue-50/50 dark:bg-blue-950/10"
            />
            <MetricPillCard
              title="WhatsApp"
              value={stats.unreadByChannel.whatsapp}
              icon={<MessageSquare className="h-5 w-5" />}
              iconColor="text-green-600"
              bgColor="bg-green-50/50 dark:bg-green-950/10"
            />
            <MetricPillCard
              title="SMS"
              value={stats.unreadByChannel.sms}
              icon={<MessageSquare className="h-5 w-5" />}
              iconColor="text-purple-600"
              bgColor="bg-purple-50/50 dark:bg-purple-950/10"
            />
            <MetricPillCard
              title="Phone"
              value={stats.unreadByChannel.phone}
              icon={<MessageSquare className="h-5 w-5" />}
              iconColor="text-orange-600"
              bgColor="bg-orange-50/50 dark:bg-orange-950/10"
            />
            <MetricPillCard
              title="Web Chat"
              value={stats.unreadByChannel.webchat}
              icon={<MessageSquare className="h-5 w-5" />}
              iconColor="text-indigo-600"
              bgColor="bg-indigo-50/50 dark:bg-indigo-950/10"
            />
          </div>
        </div>
      )}

      {/* Stats Grid */}
      {isMobile && (
        <h2 className="text-base font-semibold text-foreground">Performance Metrics</h2>
      )}
      <div className={isMobile ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4"}>
        {isMobile ? (
          <>
            <MetricPillCard
              title="Total"
              value={stats.total}
              icon={<MessageSquare className="h-5 w-5" />}
              iconColor="text-primary"
            />
            <MetricPillCard
              title="AI Handled"
              value={stats.aiHandled}
              subtitle={`${stats.total > 0 ? Math.round((stats.aiHandled / stats.total) * 100) : 0}%`}
              icon={<Bot className="h-5 w-5" />}
              iconColor="text-green-600 dark:text-green-400"
              bgColor="bg-green-50 dark:bg-green-950/20"
            />
            <MetricPillCard
              title="Escalated"
              value={stats.escalated}
              subtitle="Needs review"
              icon={<AlertCircle className="h-5 w-5" />}
              iconColor="text-orange-600 dark:text-orange-400"
              bgColor="bg-orange-50 dark:bg-orange-950/20"
            />
            <MetricPillCard
              title="Confidence"
              value={`${Math.round(stats.avgConfidence)}%`}
              subtitle="AI accuracy"
              icon={<Zap className="h-5 w-5" />}
              iconColor="text-blue-600 dark:text-blue-400"
              bgColor="bg-blue-50 dark:bg-blue-950/20"
            />
          </>
        ) : (
          <>
            <Card className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm font-medium text-muted-foreground">Total Conversations</p>
                  <h3 className="text-2xl md:text-3xl font-bold mt-2">{stats.total}</h3>
                </div>
                <MessageSquare className="h-6 w-6 md:h-8 md:w-8 text-primary" />
              </div>
            </Card>

            <Card className="p-4 md:p-6 bg-green-50 dark:bg-green-950/20">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm font-medium text-muted-foreground">AI Handled</p>
                  <h3 className="text-2xl md:text-3xl font-bold mt-2 text-green-600 dark:text-green-400">
                    {stats.aiHandled}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stats.total > 0 ? Math.round((stats.aiHandled / stats.total) * 100) : 0}% auto-resolved
                  </p>
                </div>
                <Bot className="h-6 w-6 md:h-8 md:w-8 text-green-600 dark:text-green-400" />
              </div>
            </Card>

            <Card className="p-4 md:p-6 bg-orange-50 dark:bg-orange-950/20">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm font-medium text-muted-foreground">Escalated</p>
                  <h3 className="text-2xl md:text-3xl font-bold mt-2 text-orange-600 dark:text-orange-400">
                    {stats.escalated}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">Needs human attention</p>
                </div>
                <AlertCircle className="h-8 w-8 text-orange-600 dark:text-orange-400" />
              </div>
            </Card>

            <Card className="p-6 bg-blue-50 dark:bg-blue-950/20">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Avg Confidence</p>
                  <h3 className="text-3xl font-bold mt-2 text-blue-600 dark:text-blue-400">
                    {Math.round(stats.avgConfidence)}%
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">AI certainty score</p>
                </div>
                <Zap className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              </div>
            </Card>
          </>
        )}
      </div>

      {/* AI Activity Summary */}
      <AIActivityWidget />

      {/* AI Conversation Details */}
      <AIConversationSummaryWidget />

      {/* Sentiment Breakdown */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Customer Sentiment</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{stats.positiveCount}</p>
            <p className="text-sm text-muted-foreground">Positive</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{stats.neutralCount}</p>
            <p className="text-sm text-muted-foreground">Neutral</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-600">{stats.negativeCount}</p>
            <p className="text-sm text-muted-foreground">Negative</p>
          </div>
        </div>
      </Card>

      {/* Recent Conversations */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Recent Conversations (Live)</h3>
        <ScrollArea className="h-[400px]">
          <div className="space-y-3">
            {recentConversations.map((conv) => (
              <div
                key={conv.id}
                className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      {conv.is_escalated ? (
                        <AlertCircle className="h-4 w-4 text-orange-600 shrink-0" />
                      ) : (
                        <Bot className="h-4 w-4 text-green-600 shrink-0" />
                      )}
                      <p className="font-medium truncate">{conv.title}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant={getStatusColor(conv.status)}>{conv.status}</Badge>
                      {conv.category && (
                        <Badge variant="outline">{conv.category}</Badge>
                      )}
                      {conv.ai_confidence !== null && (
                        <span className="text-xs text-muted-foreground">
                          {Math.round(conv.ai_confidence)}% confident
                        </span>
                      )}
                      {conv.ai_sentiment && (
                        <span className="text-xs">{getSentimentIcon(conv.ai_sentiment)}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    <div>{format(new Date(conv.created_at), 'HH:mm')}</div>
                    <div className="flex items-center gap-1 mt-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(conv.updated_at), 'HH:mm')}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {recentConversations.length === 0 && (
              <p className="text-center text-muted-foreground py-8">
                No conversations yet today
              </p>
            )}
          </div>
        </ScrollArea>
      </Card>
          </div>
        )
      }
    />
  );
};
