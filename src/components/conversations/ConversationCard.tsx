import { memo } from 'react';
import { Conversation } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { differenceInMinutes, differenceInHours, differenceInDays } from 'date-fns';
import { CheckCircle2, UserPlus, FileEdit, RotateCcw } from 'lucide-react';
import { ChannelIcon } from '../shared/ChannelIcon';
import { cn } from '@/lib/utils';
import { useIsTablet } from '@/hooks/use-tablet';
import { useHaptics } from '@/hooks/useHaptics';
import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { TriageQuickActions } from './TriageQuickActions';

// Status dot color based on decision bucket / status — iOS system colours
const getStatusDotColor = (
  bucket: string | null | undefined,
  status: string | null | undefined,
): string => {
  if (bucket === 'act_now') return 'bg-[#FF3B30]';
  if (bucket === 'quick_win') return 'bg-[#FF9500]';
  if (bucket === 'auto_handled') return 'bg-[#34C759]';
  if (bucket === 'wait') return 'bg-[#007AFF]';
  if (status === 'resolved') return 'bg-[#34C759]';
  return 'bg-[#AEAEB2]';
};

// Short relative time: "2m", "1h", "3d"
const formatShortTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const mins = differenceInMinutes(now, date);
  if (mins < 60) return `${mins}m`;
  const hrs = differenceInHours(now, date);
  if (hrs < 24) return `${hrs}h`;
  const days = differenceInDays(now, date);
  return `${days}d`;
};

interface ConversationCardProps {
  conversation: Conversation;
  selected: boolean;
  onClick: () => void;
  onUpdate?: () => void;
  showTriageActions?: boolean;
}

const ConversationCardComponent = ({
  conversation,
  selected,
  onClick,
  onUpdate,
  showTriageActions,
}: ConversationCardProps) => {
  const isTablet = useIsTablet();
  const { trigger } = useHaptics();
  const { toast } = useToast();

  const [hasDraft, setHasDraft] = useState(false);
  const [isReopening, setIsReopening] = useState(false);

  useEffect(() => {
    const draftKey = `draft-${conversation.id}`;
    const draft = localStorage.getItem(draftKey);
    setHasDraft(!!draft && draft.trim().length > 0);
  }, [conversation.id]);

  const [swipeDistance, setSwipeDistance] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartX = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const SWIPE_THRESHOLD = 120;
  const isTouchDevice =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const handleClick = () => {
    if (!isSwiping) {
      trigger('light');
      onClick();
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isTouchDevice || !isTablet) return;
    touchStartX.current = e.touches[0].clientX;
    setIsSwiping(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isTouchDevice || !isTablet) return;
    const currentX = e.touches[0].clientX;
    const distance = currentX - touchStartX.current;

    if (Math.abs(distance) > 10) {
      setIsSwiping(true);
      setSwipeDistance(distance);
    }
  };

  const handleTouchEnd = async () => {
    if (!isTouchDevice || !isTablet || !isSwiping) {
      setSwipeDistance(0);
      setIsSwiping(false);
      return;
    }

    const absDistance = Math.abs(swipeDistance);

    if (absDistance >= SWIPE_THRESHOLD) {
      if (swipeDistance > 0) {
        await handleAssignToMe();
      } else {
        await handleResolve();
      }
    }

    setSwipeDistance(0);
    setIsSwiping(false);
  };

  const handleAssignToMe = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Verify workspace ownership
    const { data: userData } = await supabase
      .from('users')
      .select('workspace_id')
      .eq('id', user.id)
      .single();

    if (!userData?.workspace_id) return;

    trigger('success');
    toast({ title: 'Assigned to you' });

    const { error } = await supabase
      .from('conversations')
      .update({ assigned_to: user.id })
      .eq('id', conversation.id)
      .eq('workspace_id', userData.workspace_id);

    if (error) {
      toast({
        title: 'Assignment failed',
        description: error.message,
        variant: 'destructive',
      });
      trigger('warning');
    } else {
      onUpdate?.();
    }
  };

  const handleResolve = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Verify workspace ownership
    const { data: userData } = await supabase
      .from('users')
      .select('workspace_id')
      .eq('id', user.id)
      .single();

    if (!userData?.workspace_id) return;

    trigger('success');
    toast({ title: 'Conversation resolved' });

    const { error } = await supabase
      .from('conversations')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)
      .eq('workspace_id', userData.workspace_id);

    if (error) {
      toast({
        title: 'Failed to resolve',
        description: error.message,
        variant: 'destructive',
      });
      trigger('warning');
    } else {
      onUpdate?.();
    }
  };

  const handleReopen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsReopening(true);
    trigger('medium');

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsReopening(false);
      return;
    }

    const { data: userData } = await supabase
      .from('users')
      .select('workspace_id')
      .eq('id', user.id)
      .single();

    if (!userData?.workspace_id) {
      setIsReopening(false);
      return;
    }

    const { error } = await supabase
      .from('conversations')
      .update({
        status: 'open',
        decision_bucket: 'quick_win',
        requires_reply: true,
        resolved_at: null,
      })
      .eq('id', conversation.id)
      .eq('workspace_id', userData.workspace_id);

    if (error) {
      toast({
        title: 'Failed to reopen',
        description: error.message,
        variant: 'destructive',
      });
      trigger('warning');
    } else {
      toast({ title: 'Conversation reopened', description: 'Moved to Needs Me queue' });
      onUpdate?.();
    }
    setIsReopening(false);
  };

  const swipeProgress = Math.min(Math.abs(swipeDistance) / SWIPE_THRESHOLD, 1);
  const isRightSwipe = swipeDistance > 0;
  const isOverdue = conversation.sla_due_at && new Date() > new Date(conversation.sla_due_at);
  const isResolvable =
    conversation.status === 'resolved' || conversation.decision_bucket === 'auto_handled';

  const dotColor = getStatusDotColor(conversation.decision_bucket, conversation.status);
  const timeStr = formatShortTime(conversation.updated_at || conversation.created_at!);

  // Derive sender name from joined customer or title
  const rawSender =
    conversation.customer?.name || conversation.customer?.email || conversation.title || '';
  const senderName =
    !rawSender || rawSender.includes('unknown.invalid') || rawSender.startsWith('unknown@')
      ? 'Unknown Sender'
      : rawSender;

  // AI snippet
  const snippet =
    conversation.summary_for_human || conversation.why_this_needs_you || 'Processing...';

  // Strip HTML tags from snippet
  const stripHtml = (text: string) => {
    if (!text) return text;
    return text
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  };

  const cleanSnippet = stripHtml(snippet);

  // Status badge
  const getStatusBadge = () => {
    if (conversation.status === 'resolved' || conversation.decision_bucket === 'auto_handled') {
      return (
        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium tracking-wide uppercase">
          Archived
        </span>
      );
    }
    if (hasDraft || conversation.ai_draft_response) {
      return (
        <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 text-[10px] font-medium flex items-center gap-1 tracking-wide uppercase">
          <FileEdit className="h-2.5 w-2.5" />
          Draft
        </span>
      );
    }
    if (conversation.status === 'new') {
      return (
        <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 text-[10px] font-medium tracking-wide uppercase">
          New
        </span>
      );
    }
    return null;
  };

  // Visual differentiation based on status (Directive 6)
  const isAutoHandled =
    conversation.decision_bucket === 'auto_handled' || conversation.status === 'resolved';
  const isUnread = conversation.status === 'new';

  // Inner content shared between tablet and desktop
  const cardInner = (padClass: string) => (
    <div className={cn(padClass, isAutoHandled && 'opacity-60')}>
      {/* Row 1: Status dot · Sender · [reopen] · time */}
      <div className="flex items-center gap-2 mb-1">
        <span className={cn('h-2 w-2 rounded-full flex-shrink-0', dotColor)} />
        <span
          className={cn(
            'text-sm truncate flex-1 min-w-0',
            isUnread ? 'font-bold text-foreground' : 'font-semibold text-foreground/90',
          )}
        >
          {senderName}
        </span>
        {isOverdue && (
          <span className="h-2 w-2 rounded-full bg-destructive flex-shrink-0" title="Overdue" />
        )}
        {isResolvable && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReopen}
            disabled={isReopening}
            className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <RotateCcw className="h-3 w-3 mr-0.5" />
            Reopen
          </Button>
        )}
        <span className="text-xs text-foreground/40 flex-shrink-0">{timeStr}</span>
      </div>

      {/* Row 2: Subject/Title */}
      <p
        className={cn(
          'text-sm truncate mb-1',
          isUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground/80',
        )}
      >
        {conversation.title || 'No subject'}
      </p>

      {/* Row 3: AI snippet + indicators */}
      <div className="flex items-center gap-2">
        <p className="text-xs text-foreground/50 truncate flex-1 min-w-0">{cleanSnippet}</p>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {getStatusBadge()}
          {conversation.channel !== 'email' && (
            <ChannelIcon channel={conversation.channel} className="h-3 w-3 opacity-60" />
          )}
        </div>
      </div>

      {showTriageActions && <TriageQuickActions conversation={conversation} onUpdate={onUpdate} />}
    </div>
  );

  // Tablet layout (with swipe gestures)
  if (isTablet) {
    return (
      <div
        ref={cardRef}
        className="relative overflow-hidden touch-pan-y mb-2"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Swipe backgrounds */}
        <div
          className="absolute inset-0 bg-blue-500/20 flex items-center justify-end pr-8 pointer-events-none transition-opacity duration-200"
          style={{ opacity: !isRightSwipe && isSwiping ? swipeProgress : 0 }}
        >
          <CheckCircle2
            className="h-6 w-6 text-blue-600 dark:text-blue-400 transition-transform duration-200"
            style={{ transform: `scale(${swipeProgress})` }}
          />
        </div>

        <div
          className="absolute inset-0 bg-green-500/20 flex items-center justify-start pl-8 pointer-events-none transition-opacity duration-200"
          style={{ opacity: isRightSwipe && isSwiping ? swipeProgress : 0 }}
        >
          <UserPlus
            className="h-6 w-6 text-green-600 dark:text-green-400 transition-transform duration-200"
            style={{ transform: `scale(${swipeProgress})` }}
          />
        </div>

        {/* Main Card */}
        <div
          onClick={handleClick}
          className={cn(
            'relative cursor-pointer transition-all duration-300 rounded-[22px] overflow-hidden',
            'bg-card ring-1 ring-black/[0.04] apple-shadow hover:apple-shadow-lg spring-press spring-bounce',
            selected && 'ring-primary/40 bg-primary/[0.03]',
          )}
          style={{
            transform: isSwiping ? `translateX(${swipeDistance}px)` : 'translateX(0)',
            transition: isSwiping ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {cardInner('p-3.5')}
        </div>
      </div>
    );
  }

  // Desktop layout
  return (
    <div
      onClick={handleClick}
      className={cn(
        'relative cursor-pointer transition-all duration-200 overflow-hidden mx-2 my-1 p-0 rounded-xl',
        selected
          ? 'bg-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] ring-1 ring-slate-900/5'
          : 'hover:bg-slate-50/80 border border-transparent transition-colors',
        isAutoHandled && !selected && 'bg-slate-50',
      )}
    >
      {cardInner('p-3')}
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export const ConversationCard = memo(ConversationCardComponent, (prevProps, nextProps) => {
  return (
    prevProps.conversation.id === nextProps.conversation.id &&
    prevProps.conversation.updated_at === nextProps.conversation.updated_at &&
    prevProps.conversation.status === nextProps.conversation.status &&
    prevProps.conversation.priority === nextProps.conversation.priority &&
    prevProps.conversation.decision_bucket === nextProps.conversation.decision_bucket &&
    prevProps.conversation.why_this_needs_you === nextProps.conversation.why_this_needs_you &&
    prevProps.selected === nextProps.selected &&
    prevProps.showTriageActions === nextProps.showTriageActions
  );
});
