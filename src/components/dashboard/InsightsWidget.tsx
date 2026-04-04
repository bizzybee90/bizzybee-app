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
      const { data } = await supabase
        .from('inbox_insights')
        .select(
          'id, insight_type, title, description, severity, is_actionable, is_read, created_at, metrics',
        )
        .eq('workspace_id', workspaceId)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(5);
      setInsights((data as Insight[]) || []);
    } catch (error) {
      console.error('Error fetching insights:', error);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId) {
      void fetchInsights();
    }
  }, [fetchInsights, workspaceId]);

  const markAsRead = async (id: string) => {
    await supabase.from('inbox_insights').update({ is_read: true }).eq('id', id);
    setInsights(insights.filter((i) => i.id !== id));
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
