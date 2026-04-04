import { Conversation } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CheckCircle2, Clock, UserPlus, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import { SnoozeDialog } from './SnoozeDialog';
import { TabletFilters } from './TabletFilters';

interface TabletQuickActionsPanelProps {
  conversation: Conversation;
  onUpdate: () => void;
  isOpen: boolean;
  statusFilter: string[];
  priorityFilter: string[];
  channelFilter: string[];
  categoryFilter: string[];
  onStatusChange: (filters: string[]) => void;
  onPriorityChange: (filters: string[]) => void;
  onChannelChange: (filters: string[]) => void;
  onCategoryChange: (filters: string[]) => void;
}

export const TabletQuickActionsPanel = ({
  conversation,
  onUpdate,
  isOpen,
  statusFilter,
  priorityFilter,
  channelFilter,
  categoryFilter,
  onStatusChange,
  onPriorityChange,
  onChannelChange,
  onCategoryChange,
}: TabletQuickActionsPanelProps) => {
  const { toast } = useToast();
  const [snoozeDialogOpen, setSnoozeDialogOpen] = useState(false);

  if (!isOpen) return null;

  const handleResolve = async () => {
    const { error } = await supabase
      .from('conversations')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);

    if (error) {
      logger.error('Failed to resolve conversation', error);
      toast({
        title: 'Failed to resolve',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    // Mark the email as read in Gmail/Outlook
    if (conversation.channel === 'email') {
      supabase.functions
        .invoke('mark-email-read', {
          body: { conversationId: conversation.id, markAsRead: true },
        })
        .catch((err) => logger.error('Failed to mark email as read', err));
    }

    toast({ title: 'Conversation resolved' });
    onUpdate();
  };

  const handleAssignToMe = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('conversations').update({ assigned_to: user.id }).eq('id', conversation.id);

    toast({ title: 'Assigned to you' });
    onUpdate();
  };

  const handlePriorityChange = async (priority: string) => {
    await supabase.from('conversations').update({ priority }).eq('id', conversation.id);

    toast({ title: `Priority changed to ${priority}` });
    onUpdate();
  };

  return (
    <div className="animate-in slide-in-from-top-2 duration-200">
      {/* Filters Section */}
      <div className="mx-6 mb-4 rounded-2xl bg-gradient-to-br from-muted/30 to-muted/10 border border-border/50 p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Filters</h3>
        <TabletFilters
          statusFilter={statusFilter}
          priorityFilter={priorityFilter}
          channelFilter={channelFilter}
          categoryFilter={categoryFilter}
          onStatusChange={onStatusChange}
          onPriorityChange={onPriorityChange}
          onChannelChange={onChannelChange}
          onCategoryChange={onCategoryChange}
        />
      </div>

      {/* Quick Actions */}
      <div className="mx-6 mb-4 rounded-2xl bg-gradient-to-br from-card to-card/50 border border-border/50 shadow-lg p-6 space-y-4">
        {/* Resolve Button */}
        <Button
          onClick={handleResolve}
          className="w-full h-12 bg-success hover:bg-success/90 text-success-foreground font-semibold rounded-xl shadow-sm"
          disabled={conversation.status === 'resolved'}
        >
          <CheckCircle2 className="h-5 w-5 mr-2" />
          {conversation.status === 'resolved' ? 'Resolved' : 'Resolve & Close'}
        </Button>

        {/* Priority Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">Priority</label>
          <Select value={conversation.priority || 'medium'} onValueChange={handlePriorityChange}>
            <SelectTrigger className="h-11 rounded-xl bg-muted/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="high">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  High Priority
                </span>
              </SelectItem>
              <SelectItem value="medium">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-warning" />
                  Medium Priority
                </span>
              </SelectItem>
              <SelectItem value="low">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                  Low Priority
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Snooze Button */}
        <Button
          onClick={() => setSnoozeDialogOpen(true)}
          variant="outline"
          className="w-full h-11 rounded-xl"
        >
          <Clock className="h-4 w-4 mr-2" />
          Snooze
        </Button>

        {/* Assign to Me */}
        <Button onClick={handleAssignToMe} variant="outline" className="w-full h-11 rounded-xl">
          <UserPlus className="h-4 w-4 mr-2" />
          Assign to Me
        </Button>
      </div>

      <SnoozeDialog
        conversationId={conversation.id}
        open={snoozeDialogOpen}
        onOpenChange={setSnoozeDialogOpen}
        onSuccess={onUpdate}
      />
    </div>
  );
};
