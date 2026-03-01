import { useState } from 'react';
import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

interface AIContextPanelProps {
  conversation: Conversation;
  onUpdate?: () => void;
  onUseDraft?: (draft: string) => void;
}

export const AIContextPanel = ({ conversation, onUpdate, onUseDraft }: AIContextPanelProps) => {
  const [expanded, setExpanded] = useState(false);

  const getSentimentEmoji = (sentiment: string | null) => {
    switch (sentiment) {
      case 'positive': return null;
      case 'negative': return null;
      case 'frustrated': return null;
      case 'neutral': return null;
      default: return null;
    }
  };

  const briefingText = conversation.summary_for_human 
    || (conversation as any).ai_why_flagged 
    || (conversation as any).why_this_needs_you 
    || conversation.ai_reason_for_escalation 
    || 'AI is processing this conversation.';

  const sentimentEmoji = getSentimentEmoji(conversation.ai_sentiment);
  const categoryBadge = conversation.category;

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full text-left flex items-start gap-2 px-1 py-1.5 rounded-lg hover:bg-muted/30 transition-colors group"
    >
      <Sparkles className="h-3 w-3 flex-shrink-0 mt-0.5 opacity-60" />
      <div className="min-w-0 flex-1">
        <p className={cn(
          "text-xs text-muted-foreground leading-relaxed",
          !expanded && "line-clamp-1"
        )}>
          {briefingText}
        </p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
        {sentimentEmoji && (
          <span className="text-xs">{sentimentEmoji}</span>
        )}
        {categoryBadge && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground border-border/50">
            {categoryBadge}
          </Badge>
        )}
        {expanded ? (
          <ChevronUp className="h-3 w-3 text-muted-foreground/50" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
    </button>
  );
};
