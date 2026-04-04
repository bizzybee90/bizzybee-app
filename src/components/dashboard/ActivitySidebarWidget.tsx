import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bot, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useNavigate } from 'react-router-dom';

interface QuickStats {
  aiHandled: number;
  escalated: number;
  resolved: number;
}

export const ActivitySidebarWidget = () => {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const [stats, setStats] = useState<QuickStats>({
    aiHandled: 0,
    escalated: 0,
    resolved: 0,
  });

  const fetchStats = useCallback(async () => {
    if (!workspace?.id) return;

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString();

      const { data: conversations } = await supabase
        .from('conversations')
        .select('is_escalated, status, conversation_type')
        .eq('workspace_id', workspace.id)
        .gte('created_at', todayStr);

      if (conversations) {
        const escalated = conversations.filter((c) => c.is_escalated).length;
        const aiHandled = conversations.filter(
          (c) => !c.is_escalated && c.conversation_type === 'ai_handled',
        ).length;
        const resolved = conversations.filter((c) => c.status === 'resolved').length;

        setStats({ aiHandled, escalated, resolved });
      }
    } catch (error) {
      console.error('Error fetching quick stats:', error);
    }
  }, [workspace?.id]);

  useEffect(() => {
    void fetchStats();

    // Realtime updates
    const channel = supabase
      .channel('sidebar-stats')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `workspace_id=eq.${workspace?.id}`,
        },
        () => {
          void fetchStats();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchStats, workspace?.id]);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold">Today's Activity</h4>
        <Badge variant="outline" className="text-xs flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          Live
        </Badge>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-green-600" />
            <span className="text-sm">AI Handled</span>
          </div>
          <span className="text-lg font-bold text-green-600">{stats.aiHandled}</span>
        </div>

        <div
          className="flex items-center justify-between cursor-pointer hover:bg-accent/50 -mx-2 px-2 py-1 rounded transition-colors"
          onClick={() => navigate('/escalations')}
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-orange-600" />
            <span className="text-sm">Escalated</span>
          </div>
          <span className="text-lg font-bold text-orange-600">{stats.escalated}</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-blue-600" />
            <span className="text-sm">Resolved</span>
          </div>
          <span className="text-lg font-bold text-blue-600">{stats.resolved}</span>
        </div>
      </div>
    </Card>
  );
};
