import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow, format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Activity,
  CheckCircle2,
  Send,
  Bot,
  FileEdit,
  AlertCircle,
  ArrowLeft,
  TrendingUp,
} from 'lucide-react';
import { CategoryLabel } from '@/components/shared/CategoryLabel';
import { cn } from '@/lib/utils';

interface ActivityItem {
  id: string;
  type: 'auto_handled' | 'sent' | 'draft_ready' | 'escalated' | 'reviewed';
  title: string;
  description: string;
  timestamp: Date;
  conversationId?: string;
  category?: string;
}

interface JoinedConversation {
  id: string;
  title: string | null;
  workspace_id: string;
  email_classification: string | null;
}

export const ActivityPage = () => {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    totalToday: 0,
    autoHandled: 0,
    sent: 0,
    reviewed: 0,
  });

  useEffect(() => {
    const fetchActivities = async () => {
      if (!workspace?.id) return;

      setError(null);
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Get all activities from today
        const [autoHandled, sentMessages, drafts, reviewed] = await Promise.all([
          supabase
            .from('conversations')
            .select('id, title, summary_for_human, auto_handled_at, email_classification')
            .eq('workspace_id', workspace.id)
            .eq('decision_bucket', 'auto_handled')
            .not('auto_handled_at', 'is', null)
            .gte('auto_handled_at', today.toISOString())
            .order('auto_handled_at', { ascending: false }),

          supabase
            .from('messages')
            .select(
              `
              id,
              created_at,
              body,
              conversation_id,
              conversations!inner(id, title, workspace_id, email_classification)
            `,
            )
            .eq('direction', 'outbound')
            .eq('is_internal', false)
            .gte('created_at', today.toISOString())
            .order('created_at', { ascending: false }),

          supabase
            .from('conversations')
            .select('id, title, summary_for_human, updated_at, email_classification')
            .eq('workspace_id', workspace.id)
            .not('ai_draft_response', 'is', null)
            .is('final_response', null)
            .in('status', ['new', 'open', 'ai_handling'])
            .order('updated_at', { ascending: false }),

          supabase
            .from('conversations')
            .select('id, title, reviewed_at, review_outcome, email_classification')
            .eq('workspace_id', workspace.id)
            .not('reviewed_at', 'is', null)
            .gte('reviewed_at', today.toISOString())
            .order('reviewed_at', { ascending: false }),
        ]);

        // Combine into activities
        const allActivities: ActivityItem[] = [];

        autoHandled.data?.forEach((c) => {
          allActivities.push({
            id: `auto-${c.id}`,
            type: 'auto_handled',
            title: c.title || 'Auto-handled',
            description: c.email_classification?.replace(/_/g, ' ') || 'Notification',
            timestamp: new Date(c.auto_handled_at!),
            conversationId: c.id,
            category: c.email_classification,
          });
        });

        sentMessages.data?.forEach((m) => {
          const conv = m.conversations as unknown as JoinedConversation | null;
          if (conv?.workspace_id === workspace.id) {
            allActivities.push({
              id: `sent-${m.id}`,
              type: 'sent',
              title: conv?.title || 'Message sent',
              description: m.body?.substring(0, 80) + (m.body && m.body.length > 80 ? '...' : ''),
              timestamp: new Date(m.created_at!),
              conversationId: m.conversation_id || undefined,
              category: conv?.email_classification ?? undefined,
            });
          }
        });

        drafts.data?.forEach((c) => {
          allActivities.push({
            id: `draft-${c.id}`,
            type: 'draft_ready',
            title: c.title || 'Draft ready',
            description: 'AI response pending review',
            timestamp: new Date(c.updated_at!),
            conversationId: c.id,
            category: c.email_classification,
          });
        });

        reviewed.data?.forEach((c) => {
          allActivities.push({
            id: `review-${c.id}`,
            type: 'reviewed',
            title: c.title || 'Reviewed',
            description: c.review_outcome === 'confirmed' ? 'AI confirmed' : 'AI corrected',
            timestamp: new Date(c.reviewed_at!),
            conversationId: c.id,
            category: c.email_classification,
          });
        });

        // Sort by timestamp
        allActivities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        setActivities(allActivities);

        // Calculate stats
        setStats({
          totalToday: allActivities.length,
          autoHandled: autoHandled.data?.length || 0,
          sent:
            sentMessages.data?.filter(
              (m) =>
                (m.conversations as unknown as JoinedConversation | null)?.workspace_id ===
                workspace.id,
            ).length || 0,
          reviewed: reviewed.data?.length || 0,
        });
      } catch (err) {
        console.error('Error fetching activities:', err);
        setError('Failed to load activity. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchActivities();
  }, [workspace?.id]);

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
      default:
        return <Activity className="h-4 w-4 text-bb-warm-gray" />;
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
      default:
        return 'Activity';
    }
  };

  const handleActivityClick = (activity: ActivityItem) => {
    if (activity.conversationId) {
      if (activity.type === 'draft_ready') {
        navigate(`/needs-action?id=${activity.conversationId}`);
      } else {
        navigate(`/done?id=${activity.conversationId}`);
      }
    }
  };

  const mainContent = (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-[18px] font-medium text-bb-text">Recent Activity</h1>
            <p className="text-sm text-bb-warm-gray">
              {format(new Date(), 'EEEE, MMMM d')} • All activity from today
            </p>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="bg-bb-cream rounded-lg border-[0.5px] border-bb-border p-4">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-bb-gold/20">
              <TrendingUp className="h-6 w-6 text-bb-gold" />
            </div>
            <div>
              <p className="text-[20px] font-medium text-bb-text">{stats.totalToday}</p>
              <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray">
                Activities today
              </p>
            </div>
            <div className="ml-auto flex gap-6">
              <div className="text-center">
                <p className="text-[20px] font-medium text-bb-text">{stats.autoHandled}</p>
                <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray">
                  Auto-handled
                </p>
              </div>
              <div className="text-center">
                <p className="text-[20px] font-medium text-bb-text">{stats.sent}</p>
                <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray">
                  Sent
                </p>
              </div>
              <div className="text-center">
                <p className="text-[20px] font-medium text-bb-text">{stats.reviewed}</p>
                <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray">
                  Reviewed
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <Card className="p-4 border-destructive bg-destructive/5">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
              <p className="text-sm font-medium text-destructive">{error}</p>
            </div>
          </Card>
        )}

        {/* Activity List */}
        <div className="bg-bb-white rounded-lg border-[0.5px] border-bb-border p-4">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-5 w-5 text-bb-gold" />
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray">
              Activity Timeline
            </h2>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 animate-pulse"
                >
                  <div className="h-8 w-8 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 bg-muted rounded" />
                    <div className="h-3 w-1/2 bg-muted rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : activities.length === 0 ? (
            <div className="text-center py-12 text-bb-warm-gray">
              <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium text-bb-text">No activity today</p>
              <p className="text-sm text-bb-warm-gray">
                Activity will appear here as you and BizzyBee work
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {activities.map((activity) => (
                <div
                  key={activity.id}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg transition-colors',
                    activity.conversationId && 'cursor-pointer hover:bg-accent/50',
                    activity.type === 'draft_ready' && 'bg-warning/5 border border-warning/20',
                  )}
                  onClick={() => handleActivityClick(activity)}
                >
                  <div className="flex-shrink-0 mt-0.5">{getActivityIcon(activity.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-bb-warm-gray">
                        {getActivityLabel(activity.type)}
                      </span>
                      <CategoryLabel classification={activity.category} size="xs" />
                      <span className="text-xs text-bb-muted ml-auto">
                        {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-bb-text truncate">{activity.title}</p>
                    <p className="text-xs text-bb-warm-gray line-clamp-2">{activity.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );

  if (isMobile) {
    return <MobilePageLayout>{mainContent}</MobilePageLayout>;
  }

  return <ThreeColumnLayout sidebar={<Sidebar />} main={mainContent} />;
};

export default ActivityPage;
