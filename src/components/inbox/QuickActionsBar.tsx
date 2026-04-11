import { Check, Ban, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CATEGORY_GROUPS } from '@/lib/emailDirection';

interface QuickActionsBarProps {
  emailId: string;
  workspaceId: string;
}

export const QuickActionsBar = ({ emailId, workspaceId }: QuickActionsBarProps) => {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['inbox-emails'] });
    queryClient.invalidateQueries({ queryKey: ['inbox-counts'] });
    queryClient.invalidateQueries({ queryKey: ['inbox-email-detail'] });
  };

  const updateConversation = async (updates: Record<string, unknown>) => {
    const { data, error } = await supabase
      .from('conversations')
      .update(updates)
      .eq('id', emailId)
      .eq('workspace_id', workspaceId)
      .select('id');

    if (error) {
      return false;
    }

    return (data?.length ?? 0) > 0;
  };

  const updateEmailQueue = async (updates: Record<string, unknown>) => {
    const { data, error } = await supabase
      .from('email_import_queue')
      .update(updates)
      .eq('id', emailId)
      .eq('workspace_id', workspaceId)
      .select('id');

    if (error) {
      return false;
    }

    return (data?.length ?? 0) > 0;
  };

  const updateHandledState = async () => {
    const handledAt = new Date().toISOString();
    const conversationUpdates = {
      status: 'resolved',
      resolved_at: handledAt,
      decision_bucket: 'auto_handled',
      auto_handled_at: handledAt,
      requires_reply: false,
    };

    return (
      (await updateConversation(conversationUpdates)) ||
      (await updateEmailQueue({
        status: 'processed',
        processed_at: handledAt,
      }))
    );
  };

  const markHandled = async () => {
    const success = await updateHandledState();
    if (!success) {
      toast.error('Failed to update');
      return;
    }
    toast.success('Marked as handled');
    invalidate();
  };

  const markSpam = async () => {
    const markedAt = new Date().toISOString();
    const success =
      (await updateConversation({
        email_classification: 'spam',
        decision_bucket: 'auto_handled',
        auto_handled_at: markedAt,
        status: 'resolved',
        resolved_at: markedAt,
        requires_reply: false,
      })) ||
      (await updateEmailQueue({ category: 'spam', is_noise: true, processed_at: markedAt }));

    if (!success) {
      toast.error('Failed to update');
      return;
    }
    toast.success('Marked as spam');
    invalidate();
  };

  const changeCategory = async (category: string) => {
    const success =
      (await updateConversation({ email_classification: category })) ||
      (await updateEmailQueue({ category }));

    if (!success) {
      toast.error('Failed to update');
      return;
    }
    toast.success(`Category changed to ${category}`);
    invalidate();
  };

  return (
    <div className="flex items-center gap-2 p-3 border-t border-border bg-card flex-nowrap overflow-x-auto">
      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={markHandled}>
        <Check className="h-3.5 w-3.5" />
        Handled
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs">
            <Tag className="h-3.5 w-3.5" />
            Category
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {CATEGORY_GROUPS.map(g => (
            <DropdownMenuItem key={g.key} onClick={() => changeCategory(g.categories[0])}>
              {g.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive" onClick={markSpam}>
        <Ban className="h-3.5 w-3.5" />
        Spam
      </Button>
    </div>
  );
};
