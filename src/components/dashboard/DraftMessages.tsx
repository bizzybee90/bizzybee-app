import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { Send, FileEdit, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { CategoryLabel } from '@/components/shared/CategoryLabel';
import { sendReply } from '@/lib/api/sendReply';
import { safeFormatDistanceToNow, toValidDate } from '@/lib/dates';

interface DraftMessage {
  id: string;
  title: string;
  customerName?: string;
  draftPreview: string;
  updatedAt: Date | null;
  classification?: string;
}

interface DraftMessagesProps {
  onNavigate?: (path: string) => void;
  maxItems?: number;
}

export function DraftMessages({ onNavigate, maxItems = 5 }: DraftMessagesProps) {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<DraftMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const fetchDrafts = async () => {
      if (!workspace?.id) return;

      try {
        const { data, error } = await supabase
          .from('conversations')
          .select(
            `
            id, 
            title, 
            ai_draft_response, 
            updated_at, 
            email_classification,
            customers(name)
          `,
          )
          .eq('workspace_id', workspace.id)
          .not('ai_draft_response', 'is', null)
          .is('final_response', null)
          .in('status', ['new', 'open', 'ai_handling'])
          .in('decision_bucket', ['quick_win', 'act_now'])
          .eq('requires_reply', true)
          .order('updated_at', { ascending: false })
          .limit(maxItems);

        if (error) throw error;

        setDrafts(
          (data || []).map((d) => ({
            id: d.id,
            title: d.title || 'Untitled',
            customerName: (d.customers as { name?: string } | null)?.name,
            draftPreview:
              d.ai_draft_response?.substring(0, 100) +
              (d.ai_draft_response && d.ai_draft_response.length > 100 ? '...' : ''),
            updatedAt: toValidDate(d.updated_at),
            classification: d.email_classification,
          })),
        );
      } catch (error) {
        console.error('Error fetching drafts:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDrafts();

    // Realtime subscription
    const channel = supabase
      .channel('drafts-feed')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `workspace_id=eq.${workspace?.id}`,
        },
        () => fetchDrafts(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspace?.id, maxItems]);

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === drafts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(drafts.map((d) => d.id)));
    }
  };

  const handleSendSelected = async () => {
    if (selectedIds.size === 0) return;

    setSending(true);
    let successCount = 0;
    let errorCount = 0;

    for (const id of selectedIds) {
      try {
        const draft = drafts.find((d) => d.id === id);
        if (!draft) continue;

        // Get the full draft
        const { data: conv } = await supabase
          .from('conversations')
          .select('ai_draft_response, customer_id, workspace_id')
          .eq('id', id)
          .single();

        if (!conv?.ai_draft_response) continue;

        await sendReply({
          conversationId: id,
          workspaceId: conv.workspace_id || workspace?.id,
          content: conv.ai_draft_response,
          statusAfterSend: 'resolved',
        });

        // Update conversation status
        await supabase
          .from('conversations')
          .update({
            final_response: conv.ai_draft_response,
          })
          .eq('id', id);

        // Mark the email as read in Gmail/Outlook
        supabase.functions
          .invoke('mark-email-read', {
            body: { conversationId: id, markAsRead: true },
          })
          .catch((err) => console.error('Failed to mark email as read:', err));

        successCount++;
      } catch (error) {
        console.error('Error sending draft:', id, error);
        errorCount++;
      }
    }

    setSending(false);
    setSelectedIds(new Set());

    if (successCount > 0) {
      toast({
        title: 'Drafts sent',
        description: `Successfully sent ${successCount} message${successCount > 1 ? 's' : ''}${errorCount > 0 ? `, ${errorCount} failed` : ''}`,
      });
    } else if (errorCount > 0) {
      toast({
        title: 'Failed to send',
        description: `Could not send ${errorCount} message${errorCount > 1 ? 's' : ''}`,
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 animate-pulse">
            <div className="h-4 w-4 rounded bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 bg-muted rounded" />
              <div className="h-3 w-1/2 bg-muted rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <FileEdit className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No pending drafts</p>
        <p className="text-xs">AI-generated responses will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header with select all and send */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={selectedIds.size === drafts.length}
            onCheckedChange={handleSelectAll}
          />
          <span className="text-sm text-muted-foreground">
            {selectedIds.size > 0
              ? `${selectedIds.size} selected`
              : `${drafts.length} draft${drafts.length > 1 ? 's' : ''} ready`}
          </span>
        </div>
        {selectedIds.size > 0 && (
          <Button size="sm" onClick={handleSendSelected} disabled={sending} className="gap-2">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send {selectedIds.size}
          </Button>
        )}
      </div>

      {/* Draft list */}
      <div className="space-y-2">
        {drafts.map((draft) => (
          <Card
            key={draft.id}
            className={cn(
              'p-3 cursor-pointer transition-colors hover:bg-accent/50',
              selectedIds.has(draft.id) && 'border-primary/50 bg-primary/5',
            )}
          >
            <div className="flex items-start gap-3">
              <Checkbox
                checked={selectedIds.has(draft.id)}
                onCheckedChange={() => handleToggleSelect(draft.id)}
                onClick={(e) => e.stopPropagation()}
              />
              <div
                className="flex-1 min-w-0"
                onClick={() => navigate(`/needs-action?filter=drafts&conversation=${draft.id}`)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground truncate">
                    {draft.customerName || draft.title}
                  </p>
                  <div className="flex items-center gap-2">
                    <CategoryLabel classification={draft.classification} size="xs" />
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {draft.draftPreview}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  {safeFormatDistanceToNow(draft.updatedAt, { addSuffix: true })}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
