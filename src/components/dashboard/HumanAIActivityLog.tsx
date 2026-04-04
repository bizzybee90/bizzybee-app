import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { formatDistanceToNow } from 'date-fns';
import {
  Bot,
  User,
  CheckCircle2,
  XCircle,
  ArrowRightCircle,
  AlertTriangle,
  Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CategoryLabel } from '@/components/shared/CategoryLabel';

interface LogEntry {
  id: string;
  actor: 'ai' | 'human';
  action: string;
  description: string;
  timestamp: Date;
  conversationId?: string;
  wasOverridden?: boolean;
  category?: string;
}

interface HumanAIActivityLogProps {
  onNavigate?: (path: string) => void;
  maxItems?: number;
}

export function HumanAIActivityLog({ onNavigate, maxItems = 8 }: HumanAIActivityLogProps) {
  const { workspace } = useWorkspace();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      if (!workspace?.id) return;

      try {
        // Get triage corrections (human overrides)
        const { data: corrections } = await supabase
          .from('triage_corrections')
          .select('id, conversation_id, corrected_at, original_classification, new_classification')
          .eq('workspace_id', workspace.id)
          .order('corrected_at', { ascending: false })
          .limit(5);

        // Get AI auto-handles
        const { data: autoHandled } = await supabase
          .from('conversations')
          .select('id, title, auto_handled_at, email_classification')
          .eq('workspace_id', workspace.id)
          .eq('decision_bucket', 'auto_handled')
          .not('auto_handled_at', 'is', null)
          .order('auto_handled_at', { ascending: false })
          .limit(5);

        // Get human reviews
        const { data: reviews } = await supabase
          .from('conversations')
          .select('id, title, reviewed_at, review_outcome, needs_review')
          .eq('workspace_id', workspace.id)
          .not('reviewed_at', 'is', null)
          .order('reviewed_at', { ascending: false })
          .limit(5);

        // Get human responses (messages sent)
        const { data: sentMessages } = await supabase
          .from('messages')
          .select(
            `
            id,
            created_at,
            actor_type,
            conversation_id,
            conversations!inner(
              workspace_id,
              title
            )
          `,
          )
          .eq('direction', 'outbound')
          .eq('is_internal', false)
          .order('created_at', { ascending: false })
          .limit(5);

        // Combine into log entries
        const allLogs: LogEntry[] = [];

        corrections?.forEach((c) => {
          allLogs.push({
            id: `correction-${c.id}`,
            actor: 'human',
            action: 'Corrected AI',
            description: `Changed from ${c.original_classification?.replace(/_/g, ' ') || 'unknown'} to ${c.new_classification?.replace(/_/g, ' ') || 'unknown'}`,
            timestamp: new Date(c.corrected_at!),
            conversationId: c.conversation_id || undefined,
            wasOverridden: true,
          });
        });

        autoHandled?.forEach((c) => {
          allLogs.push({
            id: `ai-handle-${c.id}`,
            actor: 'ai',
            action: 'Auto-handled',
            description: c.email_classification?.replace(/_/g, ' ') || 'Processed automatically',
            timestamp: new Date(c.auto_handled_at!),
            conversationId: c.id,
            category: c.email_classification,
          });
        });

        reviews?.forEach((c) => {
          allLogs.push({
            id: `review-${c.id}`,
            actor: 'human',
            action: c.review_outcome === 'confirmed' ? 'Confirmed AI' : 'Reviewed',
            description: c.title || 'Conversation reviewed',
            timestamp: new Date(c.reviewed_at!),
            conversationId: c.id,
          });
        });

        sentMessages?.forEach((m) => {
          const convJoin = m.conversations as { workspace_id?: string; title?: string } | null;
          if (convJoin?.workspace_id === workspace.id) {
            allLogs.push({
              id: `sent-${m.id}`,
              actor: m.actor_type === 'ai' ? 'ai' : 'human',
              action: 'Sent response',
              description: convJoin?.title || 'Message sent',
              timestamp: new Date(m.created_at!),
              conversationId: m.conversation_id || undefined,
            });
          }
        });

        // Sort by timestamp and take top items
        allLogs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        setLogs(allLogs.slice(0, maxItems));
      } catch (error) {
        console.error('Error fetching activity log:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();

    // Realtime subscription
    const channel = supabase
      .channel('activity-log')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `workspace_id=eq.${workspace?.id}`,
        },
        () => fetchLogs(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'triage_corrections',
          filter: `workspace_id=eq.${workspace?.id}`,
        },
        () => fetchLogs(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspace?.id, maxItems]);

  const getLogIcon = (entry: LogEntry) => {
    if (entry.wasOverridden) {
      return <AlertTriangle className="h-3.5 w-3.5 text-warning" />;
    }
    if (entry.actor === 'ai') {
      return <Bot className="h-3.5 w-3.5 text-primary" />;
    }
    return <User className="h-3.5 w-3.5 text-success" />;
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'Confirmed AI':
        return <CheckCircle2 className="h-3 w-3 text-success" />;
      case 'Corrected AI':
        return <XCircle className="h-3 w-3 text-warning" />;
      case 'Sent response':
        return <ArrowRightCircle className="h-3 w-3 text-primary" />;
      default:
        return <Eye className="h-3 w-3 text-muted-foreground" />;
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-2 py-2 animate-pulse">
            <div className="h-5 w-5 rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-3/4 bg-muted rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Eye className="h-6 w-6 mx-auto mb-2 opacity-50" />
        <p className="text-xs">Activity will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {logs.map((log) => (
        <div
          key={log.id}
          className={cn(
            'flex items-center gap-2 py-1.5 px-2 rounded text-xs transition-colors',
            log.conversationId && 'cursor-pointer hover:bg-accent/50',
            log.wasOverridden && 'bg-warning/5',
          )}
          onClick={() => {
            if (log.conversationId && onNavigate) {
              onNavigate(`/conversation/${log.conversationId}`);
            }
          }}
        >
          <div className="flex-shrink-0">{getLogIcon(log)}</div>
          <div className="flex items-center gap-1.5 flex-1 min-w-0 flex-wrap">
            {getActionIcon(log.action)}
            <span className="font-medium text-foreground truncate">{log.action}</span>
            <CategoryLabel classification={log.category} size="xs" />
            <span className="text-muted-foreground truncate">{log.description}</span>
          </div>
          <span className="text-muted-foreground/60 flex-shrink-0">
            {formatDistanceToNow(log.timestamp, { addSuffix: false })}
          </span>
        </div>
      ))}
    </div>
  );
}
