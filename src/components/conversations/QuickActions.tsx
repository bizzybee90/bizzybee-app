import { Conversation } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CheckCircle2, Clock, UserPlus, UserCheck, Tag } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect } from 'react';
import { SnoozeDialog } from './SnoozeDialog';
import { TriageCorrectionFlow } from './TriageCorrectionFlow';

interface QuickActionsProps {
  conversation: Conversation;
  onUpdate: () => void;
  onBack?: () => void;
}

export const QuickActions = ({ conversation, onUpdate, onBack }: QuickActionsProps) => {
  const { toast } = useToast();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [assignedUserName, setAssignedUserName] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setCurrentUserId(user?.id || null);

      // Fetch assigned user name if conversation is assigned
      if (conversation.assigned_to) {
        const { data } = await supabase
          .from('users')
          .select('name')
          .eq('id', conversation.assigned_to)
          .maybeSingle();

        if (data) {
          setAssignedUserName(data.name);
        } else {
          setAssignedUserName(null);
        }
      } else {
        setAssignedUserName(null);
      }
    };
    fetchUser();
  }, [conversation.assigned_to]);

  const handleAssignToMe = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('conversations').update({ assigned_to: user.id }).eq('id', conversation.id);

    toast({
      title: 'Assigned to you',
      description: 'This conversation is now yours.',
    });

    onUpdate();
  };

  const handleResolve = async () => {
    // Optimistic UI update with animation
    const button = document.activeElement as HTMLButtonElement;
    if (button) {
      button.classList.add('animate-scale-out');
    }

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

    toast({
      title: 'Resolved',
      description: 'Conversation marked as resolved.',
    });

    // Small delay for animation before updating
    setTimeout(() => {
      onUpdate();
      onBack?.();
    }, 300);
  };

  const handlePriorityChange = async (value: string) => {
    await supabase.from('conversations').update({ priority: value }).eq('id', conversation.id);
    onUpdate();
  };

  const handleAssignChange = async (value: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const assignedTo = value === 'me' ? user.id : null;

    await supabase
      .from('conversations')
      .update({ assigned_to: assignedTo })
      .eq('id', conversation.id);

    if (value === 'me') {
      toast({
        title: 'Assigned to you',
        description: 'This conversation is now yours.',
      });
    }

    onUpdate();
  };

  const handleStatusChange = async (value: string) => {
    await supabase.from('conversations').update({ status: value }).eq('id', conversation.id);
    onUpdate();
  };

  return (
    <>
      <div className="space-y-3 mobile-section-spacing">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Quick Actions
        </h3>

        {conversation.status !== 'resolved' && (
          <Button
            onClick={handleResolve}
            className="w-full justify-center bg-success hover:bg-success/90 smooth-transition spring-press h-12 md:h-10 rounded-[18px] font-semibold text-base md:text-sm apple-shadow"
            size="lg"
          >
            <CheckCircle2 className="h-5 w-5 mr-2" />
            Resolve & Close
          </Button>
        )}

        <div className="space-y-2">
          <Select value={conversation.status || ''} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-full h-11 md:h-10 rounded-[18px] spring-press">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="rounded-[18px]">
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>

          <Select value={conversation.assigned_to || ''} onValueChange={handleAssignChange}>
            <SelectTrigger className="w-full h-11 md:h-10 rounded-[18px] spring-press">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent className="rounded-[18px]">
              <SelectItem value="unassigned">Unassigned</SelectItem>
              <SelectItem value="me">Assign to Me</SelectItem>
            </SelectContent>
          </Select>

          <Select value={conversation.priority || 'medium'} onValueChange={handlePriorityChange}>
            <SelectTrigger className="w-full h-11 md:h-10 rounded-[18px] spring-press">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent className="rounded-[18px]">
              <SelectItem value="urgent">🔴 Urgent</SelectItem>
              <SelectItem value="high">🟠 High</SelectItem>
              <SelectItem value="medium">🟡 Medium</SelectItem>
              <SelectItem value="low">🟢 Low</SelectItem>
            </SelectContent>
          </Select>

          <Button
            onClick={() => setSnoozeOpen(true)}
            variant="outline"
            className="w-full justify-start smooth-transition spring-press h-11 md:h-9 rounded-[18px]"
            size="default"
          >
            <Clock className="h-4 w-4 mr-2" />
            Snooze
          </Button>

          <Button
            onClick={() => setCorrectionOpen(true)}
            variant="outline"
            className="w-full justify-start smooth-transition spring-press h-11 md:h-9 rounded-[18px]"
            size="default"
          >
            <Tag className="h-4 w-4 mr-2" />
            Correct Classification
          </Button>

          {conversation.assigned_to ? (
            conversation.assigned_to === currentUserId ? (
              <Button
                variant="outline"
                disabled
                className="w-full justify-start h-11 md:h-9 rounded-[18px] bg-success/10 border-success/20"
                size="default"
              >
                <UserCheck className="h-4 w-4 mr-2 text-success" />
                Assigned to You
              </Button>
            ) : (
              <Button
                onClick={handleAssignToMe}
                variant="outline"
                className="w-full justify-start smooth-transition spring-press h-11 md:h-9 rounded-[18px]"
                size="default"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Assigned to {assignedUserName || 'Someone'}
              </Button>
            )
          ) : (
            <Button
              onClick={handleAssignToMe}
              variant="outline"
              className="w-full justify-start smooth-transition spring-press h-11 md:h-9 rounded-[18px]"
              size="default"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Assign to Me
            </Button>
          )}
        </div>
      </div>

      <SnoozeDialog
        conversationId={conversation.id}
        open={snoozeOpen}
        onOpenChange={setSnoozeOpen}
        onSuccess={onUpdate}
      />

      <TriageCorrectionFlow
        conversation={conversation}
        open={correctionOpen}
        onOpenChange={setCorrectionOpen}
        onUpdate={onUpdate}
      />
    </>
  );
};
