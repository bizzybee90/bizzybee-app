import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Lightbulb, TrendingUp, AlertTriangle, Info, X, Sparkles } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface Insight {
  id: string;
  insight_type: string | null;
  title: string | null;
  description: string | null;
  severity: string | null;
  is_actionable: boolean | null;
  is_read: boolean | null;
  created_at: string | null;
  metrics?: Record<string, unknown> | null;
}

interface InsightsWidgetProps {
  workspaceId: string;
}

export const InsightsWidget = ({ workspaceId }: InsightsWidgetProps) => {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInsights = useCallback(async () => {
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const actionableStatuses = ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated'];

      const [urgentResult, reviewResult, draftResult, automatedResult] = await Promise.all([
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('decision_bucket', 'act_now')
          .in('status', actionableStatuses),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('training_reviewed', false)
          .not('email_classification', 'is', null),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .not('ai_draft_response', 'is', null)
          .is('final_response', null)
          .in('status', ['new', 'open', 'ai_handling'])
          .eq('requires_reply', true),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('decision_bucket', 'auto_handled')
          .gte('auto_handled_at', weekAgo),
      ]);

      const nextInsights: Insight[] = [];
      const createdAt = new Date().toISOString();
      const urgentCount = urgentResult.count || 0;
      const reviewCount = reviewResult.count || 0;
      const draftCount = draftResult.count || 0;
      const automatedCount = automatedResult.count || 0;

      if (urgentCount > 0) {
        nextInsights.push({
          id: 'urgent-follow-up',
          insight_type: 'opportunity',
          title: `${urgentCount} urgent conversation${urgentCount === 1 ? '' : 's'} need attention`,
          description:
            urgentCount === 1
              ? 'One conversation is sitting in the act-now queue.'
              : 'Several conversations are currently flagged as act-now.',
          severity: 'warning',
          is_actionable: true,
          is_read: false,
          created_at: createdAt,
          metrics: { urgentCount },
        });
      }

      if (reviewCount > 0) {
        nextInsights.push({
          id: 'training-queue',
          insight_type: 'summary',
          title: `${reviewCount} training example${reviewCount === 1 ? '' : 's'} ready`,
          description:
            reviewCount === 1
              ? 'Confirming one more AI decision will sharpen future classifications.'
              : 'A short review pass will help BizzyBee learn faster today.',
          severity: 'info',
          is_actionable: true,
          is_read: false,
          created_at: createdAt,
          metrics: { reviewCount },
        });
      }

      if (draftCount > 0) {
        nextInsights.push({
          id: 'drafts-ready',
          insight_type: 'opportunity',
          title: `${draftCount} draft${draftCount === 1 ? '' : 's'} ready to send`,
          description:
            draftCount === 1
              ? 'There is an AI draft waiting for a quick check.'
              : 'There are AI drafts waiting for a quick check before sending.',
          severity: 'info',
          is_actionable: true,
          is_read: false,
          created_at: createdAt,
          metrics: { draftCount },
        });
      }

      if (automatedCount > 0) {
        nextInsights.push({
          id: 'automation-win',
          insight_type: 'trend',
          title: `${automatedCount} conversation${automatedCount === 1 ? '' : 's'} auto-handled this week`,
          description: 'BizzyBee is steadily clearing inbox traffic without manual intervention.',
          severity: 'info',
          is_actionable: false,
          is_read: false,
          created_at: createdAt,
          metrics: { automatedCount },
        });
      }

      if (nextInsights.length === 0) {
        nextInsights.push({
          id: 'steady-state',
          insight_type: 'summary',
          title: 'Inbox looks steady',
          description: 'No urgent issues, training backlog, or draft build-up right now.',
          severity: 'info',
          is_actionable: false,
          is_read: false,
          created_at: createdAt,
          metrics: null,
        });
      }

      setInsights(nextInsights.slice(0, 4));
    } catch (error) {
      console.error('Error fetching insights:', error);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId) {
      setLoading(true);
      void fetchInsights();
    }
  }, [fetchInsights, workspaceId]);

  const markAsRead = async (id: string) => {
    setInsights((current) => current.filter((i) => i.id !== id));
  };

  const getIcon = (type: string | null, severity: string | null) => {
    if (severity === 'critical') return <AlertTriangle className="h-4 w-4 text-red-500" />;
    if (severity === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    if (type === 'trend' || type === 'category_trend')
      return <TrendingUp className="h-4 w-4 text-blue-500" />;
    if (type === 'opportunity' || type === 'automation_opportunity')
      return <Lightbulb className="h-4 w-4 text-yellow-500" />;
    if (type === 'summary') return <Sparkles className="h-4 w-4 text-indigo-500" />;
    return <Info className="h-4 w-4 text-slate-400" />;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-3xl border border-slate-100/80 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-4 w-4 text-slate-400" />
          <h2 className="font-semibold text-slate-900">Insights</h2>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl border border-slate-100/80 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <Lightbulb className="h-4 w-4 text-indigo-500" />
        <h2 className="font-semibold text-slate-900">Insights</h2>
      </div>

      {insights.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 rounded-2xl bg-gradient-to-br from-slate-50 to-purple-50/30 border border-purple-100/50 border-dashed m-4">
          <Sparkles className="w-5 h-5 text-purple-500 animate-pulse mb-3" />
          <p className="text-sm font-medium text-slate-600">Gathering Intelligence...</p>
          <p className="text-xs text-slate-400 mt-1 max-w-[200px]">
            Insights will appear here as BizzyBee analyzes patterns.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {insights.map((insight) => (
            <div
              key={insight.id}
              className="p-3 hover:bg-slate-50/80 transition-colors cursor-pointer flex items-start gap-2.5 first:pt-0 last:pb-0 relative group"
            >
              <div className="mt-0.5 flex-shrink-0">
                {getIcon(insight.insight_type, insight.severity)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-slate-900 leading-tight">{insight.title}</p>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{insight.description}</p>
                {insight.is_actionable && (
                  <Badge variant="outline" className="mt-2 text-xs">
                    Action needed
                  </Badge>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  markAsRead(insight.id);
                }}
                className="p-1 rounded-full hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                aria-label="Dismiss"
              >
                <X className="h-3 w-3 text-slate-400" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
