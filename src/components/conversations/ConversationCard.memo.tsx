import { memo } from 'react';
import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Clock, CheckCircle2, UserPlus, FileEdit } from 'lucide-react';
import { ChannelIcon } from '../shared/ChannelIcon';
import { cn } from '@/lib/utils';
import { useIsTablet } from '@/hooks/use-tablet';
import { useHaptics } from '@/hooks/useHaptics';
import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ConversationCardProps {
  conversation: Conversation;
  selected: boolean;
  onClick: () => void;
  onUpdate?: () => void;
}

const ConversationCardComponent = ({ conversation, selected, onClick, onUpdate }: ConversationCardProps) => {
  const isTablet = useIsTablet();
  const { trigger } = useHaptics();
  const { toast } = useToast();

  // Draft detection state
  const [hasDraft, setHasDraft] = useState(false);

  // Check for draft on mount and when conversation changes
  useEffect(() => {
    const draftKey = `draft-${conversation.id}`;
    const draft = localStorage.getItem(draftKey);
    setHasDraft(!!draft && draft.trim().length > 0);
  }, [conversation.id]);

  // Swipe gesture state
  const [swipeDistance, setSwipeDistance] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartX = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  
  const SWIPE_THRESHOLD = 120;
  const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const handleClick = () => {
    if (!isSwiping) {
      trigger('light');
      onClick();
    }
  };

  // Swipe gesture handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isTouchDevice || !isTablet) return;
    touchStartX.current = e.touches[0].clientX;
    setIsSwiping(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isTouchDevice || !isTablet) return;
    const currentX = e.touches[0].clientX;
    const distance = currentX - touchStartX.current;
    
    // Only allow horizontal swipes (not vertical scrolling)
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
    
    // Execute action if threshold met
    if (absDistance >= SWIPE_THRESHOLD) {
      if (swipeDistance > 0) {
        // Right swipe: Assign to me
        await handleAssignToMe();
      } else {
        // Left swipe: Resolve
        await handleResolve();
      }
    }
    
    // Snap back animation
    setSwipeDistance(0);
    setIsSwiping(false);
  };

  const handleAssignToMe = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    trigger('success');
    toast({ title: "Assigned to you" });

    const { error } = await supabase
      .from('conversations')
      .update({ assigned_to: user.id })
      .eq('id', conversation.id);

    if (error) {
      toast({ 
        title: "Assignment failed", 
        description: error.message, 
        variant: "destructive" 
      });
      trigger('warning');
    } else {
      onUpdate?.();
    }
  };

  const handleResolve = async () => {
    trigger('success');
    toast({ title: "Conversation resolved" });

    const { error } = await supabase
      .from('conversations')
      .update({ 
        status: 'resolved', 
        resolved_at: new Date().toISOString() 
      })
      .eq('id', conversation.id);

    if (error) {
      toast({ 
        title: "Failed to resolve", 
        description: error.message, 
        variant: "destructive" 
      });
      trigger('warning');
    } else {
      onUpdate?.();
    }
  };
  
  const getPriorityVariant = (priority: string | null) => {
    if (!priority) return 'secondary';
    switch (priority.toLowerCase()) {
      case 'urgent': return 'priority-urgent';
      case 'high': return 'priority-high';
      case 'medium': return 'priority-medium';
      case 'low': return 'priority-low';
      default: return 'secondary';
    }
  };

  const getPriorityBarColor = (priority: string | null) => {
    if (!priority) return 'bg-muted';
    switch (priority.toLowerCase()) {
      case 'urgent': return 'bg-priority-urgent';
      case 'high': return 'bg-priority-high';
      case 'medium': return 'bg-priority-medium';
      case 'low': return 'bg-priority-low';
      default: return 'bg-muted';
    }
  };


  const swipeProgress = Math.min(Math.abs(swipeDistance) / SWIPE_THRESHOLD, 1);
  const isRightSwipe = swipeDistance > 0;

  const isOverdue = conversation.sla_due_at && new Date() > new Date(conversation.sla_due_at);

  // Compact tablet layout
  if (isTablet) {
    return (
      <div 
        ref={cardRef}
        className="relative overflow-hidden touch-pan-y mb-3"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Swipe Action Background - Left (Resolve) */}
        <div 
          className="absolute inset-0 bg-blue-500/20 flex items-center justify-end pr-8 pointer-events-none transition-opacity duration-200"
          style={{ 
            opacity: !isRightSwipe && isSwiping ? swipeProgress : 0 
          }}
        >
          <CheckCircle2 
            className="h-6 w-6 text-blue-600 dark:text-blue-400 transition-transform duration-200" 
            style={{ 
              transform: `scale(${swipeProgress})` 
            }}
          />
        </div>

        {/* Swipe Action Background - Right (Assign) */}
        <div 
          className="absolute inset-0 bg-green-500/20 flex items-center justify-start pl-8 pointer-events-none transition-opacity duration-200"
          style={{ 
            opacity: isRightSwipe && isSwiping ? swipeProgress : 0 
          }}
        >
          <UserPlus 
            className="h-6 w-6 text-green-600 dark:text-green-400 transition-transform duration-200" 
            style={{ 
              transform: `scale(${swipeProgress})` 
            }}
          />
        </div>

        {/* Main Card */}
        <div
          onClick={handleClick}
          className={cn(
            "relative cursor-pointer transition-all duration-200 ease-out overflow-hidden",
            "bg-card",
            selected && "bg-primary/4"
          )}
          style={{
            borderRadius: 'var(--radius-lg)',
            border: selected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
            boxShadow: selected ? 'var(--shadow-elevated)' : 'var(--shadow-card)',
            transform: isSwiping ? `translateX(${swipeDistance}px)` : 'translateX(0)',
            transition: isSwiping ? 'none' : 'all 0.2s ease-out',
          }}
        >
        {/* Overdue Badge */}
        {isOverdue && (
          <Badge variant="priority-urgent" className="absolute top-4 right-4 text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full shadow-sm">
            Overdue
          </Badge>
        )}

        <div className="p-5">
          {/* Title */}
          <h3 className={cn(
            "font-semibold text-base leading-snug mb-2.5 line-clamp-2 text-foreground",
            isOverdue && "pr-20"
          )}>
            {conversation.title || 'Untitled Conversation'}
          </h3>

          {/* Description */}
          {(conversation.summary_for_human || conversation.ai_reason_for_escalation) && (
            <p className="text-sm text-muted-foreground leading-relaxed mb-3.5 line-clamp-2">
              {conversation.summary_for_human || conversation.ai_reason_for_escalation}
            </p>
          )}

          {/* Badge Row */}
          <div className="flex flex-wrap items-center gap-2 mb-3.5">
            {conversation.priority && (
              <Badge 
                variant={getPriorityVariant(conversation.priority)}
                className="rounded-full text-xs font-bold uppercase tracking-wide px-3 py-1.5 shadow-sm"
              >
                {conversation.priority}
              </Badge>
            )}
            
            <Badge variant="outline" className="rounded-full text-xs font-semibold px-3 py-1.5 border-border/50 flex items-center gap-1.5">
              <ChannelIcon channel={conversation.channel} className="h-3.5 w-3.5" />
              {conversation.channel}
            </Badge>

            {hasDraft && (
              <Badge variant="secondary" className="rounded-full text-xs font-semibold px-3 py-1.5 bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/20 flex items-center gap-1.5">
                <FileEdit className="h-3 w-3" />
                Draft
              </Badge>
            )}
          </div>

          {/* Meta Row */}
          <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
            <span className="uppercase tracking-wide">
              {conversation.category?.replace(/_/g, ' ') || 'General'}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="opacity-40">•</span>
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(conversation.created_at!), { addSuffix: true })}
            </span>
          </div>
          </div>
        </div>
      </div>
    );
  }

  // Desktop layout
  return (
    <div
      onClick={handleClick}
      className={cn(
        "relative cursor-pointer transition-all duration-200 ease-out mb-3 overflow-hidden",
        "bg-card",
        selected && "bg-primary/4"
      )}
      style={{
        borderRadius: 'var(--radius-lg)',
        border: selected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
        boxShadow: selected ? 'var(--shadow-elevated)' : 'var(--shadow-card)',
      }}
    >
      {/* Overdue Badge */}
      {isOverdue && (
        <Badge variant="priority-urgent" className="absolute top-4 right-4 text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full shadow-sm">
          Overdue
        </Badge>
      )}

      <div className="p-6">
        {/* Title */}
        <h3 className={cn(
          "font-semibold text-lg leading-snug mb-2.5 text-foreground line-clamp-2",
          isOverdue && "pr-20"
        )}>
          {conversation.title || 'Untitled Conversation'}
        </h3>

        {/* Description */}
        {conversation.ai_reason_for_escalation && (
          <p className="text-[15px] text-muted-foreground leading-relaxed mb-4 line-clamp-2">
            {conversation.ai_reason_for_escalation}
          </p>
        )}

        {/* Badge Row */}
        <div className="flex flex-wrap items-center gap-2.5 mb-4">
          {conversation.priority && (
            <Badge 
              variant={getPriorityVariant(conversation.priority)}
              className="rounded-full text-xs font-bold uppercase tracking-wide px-3 py-1.5 shadow-sm"
            >
              {conversation.priority}
            </Badge>
          )}
          
          <Badge variant="outline" className="rounded-full text-xs font-semibold px-3 py-1.5 border-border/50 flex items-center gap-1.5">
            <ChannelIcon channel={conversation.channel} className="h-3.5 w-3.5" />
            {conversation.channel}
          </Badge>

          {hasDraft && (
            <Badge variant="secondary" className="rounded-full text-xs font-semibold px-3 py-1.5 bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/20 flex items-center gap-1.5">
              <FileEdit className="h-3 w-3" />
              Draft
            </Badge>
          )}
        </div>

        {/* Meta Row */}
        <div className="flex items-center justify-between text-[13px] text-muted-foreground font-medium">
          <span className="uppercase tracking-wide">
            {conversation.category?.replace(/_/g, ' ') || 'General'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="opacity-40">•</span>
            {formatDistanceToNow(new Date(conversation.created_at!), { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export const ConversationCard = memo(ConversationCardComponent, (prevProps, nextProps) => {
  // Only re-render if these props change
  return (
    prevProps.conversation.id === nextProps.conversation.id &&
    prevProps.conversation.updated_at === nextProps.conversation.updated_at &&
    prevProps.conversation.status === nextProps.conversation.status &&
    prevProps.conversation.priority === nextProps.conversation.priority &&
    prevProps.selected === nextProps.selected
  );
});
