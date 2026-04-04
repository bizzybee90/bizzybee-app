import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Conversation } from '@/lib/types';
import { SearchInput } from './SearchInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, RefreshCw, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, isToday, isYesterday } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { CategoryLabel } from '@/components/shared/CategoryLabel';
import { TriageCorrectionFlow } from './TriageCorrectionFlow';
import { InboxQuickActions } from './InboxQuickActions';
import { useIsMobile } from '@/hooks/use-mobile';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';

interface JaceStyleInboxProps {
  onSelect: (conversation: Conversation) => void;
  selectedId?: string | null;
  filter?:
    | 'my-tickets'
    | 'unassigned'
    | 'sla-risk'
    | 'all-open'
    | 'awaiting-reply'
    | 'completed'
    | 'sent'
    | 'high-priority'
    | 'vip-customers'
    | 'escalations'
    | 'triaged'
    | 'needs-me'
    | 'snoozed'
    | 'cleared'
    | 'fyi'
    | 'unread'
    | 'drafts-ready';
  hideHeader?: boolean;
}

interface GroupedConversations {
  today: Conversation[];
  yesterday: Conversation[];
  older: Conversation[];
}

export const JaceStyleInbox = ({
  onSelect,
  selectedId,
  filter = 'needs-me',
  hideHeader = false,
}: JaceStyleInboxProps) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const subFilter = searchParams.get('filter'); // 'at-risk', 'to-reply', 'drafts'

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [selectedForCorrection, setSelectedForCorrection] = useState<Conversation | null>(null);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [keyboardIndex, setKeyboardIndex] = useState(0);
  const PAGE_SIZE = 50;

  // Debounce search to avoid spamming requests while typing
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  const fetchConversations = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data: userData } = await supabase
      .from('users')
      .select('workspace_id')
      .eq('id', user.id)
      .single();

    if (!userData?.workspace_id) return [];

    let query = supabase
      .from('conversations')
      .select(
        `
        id, title, status, channel, category, priority, confidence,
        requires_reply, decision_bucket, sla_status, sla_due_at,
        summary_for_human, ai_draft_response, final_response,
        triage_confidence, snoozed_until, created_at, updated_at,
        ai_reason_for_escalation, why_this_needs_you, is_escalated,
        workspace_id, customer_id, assigned_to,
        customer:customers(id, name, email),
        assigned_user:users!conversations_assigned_to_fkey(id, name, email)
      ` as string,
      )
      .eq('workspace_id', userData.workspace_id)
      .order('updated_at', { ascending: false });

    // Apply sub-filter from URL query params (at-risk, to-reply, drafts)
    if (subFilter === 'at-risk') {
      // At Risk: SLA breached or warning
      query = query
        .in('sla_status', ['warning', 'breached'])
        .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (subFilter === 'drafts') {
      // Drafts Ready: Has AI draft, no final response, requires reply
      query = query
        .not('ai_draft_response', 'is', null)
        .is('final_response', null)
        .in('status', ['new', 'open', 'ai_handling'])
        .in('decision_bucket', ['quick_win', 'act_now'])
        .eq('requires_reply', true);
    } else if (subFilter === 'to-reply') {
      // To Reply: ACT_NOW + QUICK_WIN buckets
      query = query
        .in('decision_bucket', ['act_now', 'quick_win'])
        .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (filter === 'needs-me') {
      // Inbox: all requiring reply
      query = query
        .eq('requires_reply', true)
        .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (filter === 'unread') {
      // Unread: requires reply + status new
      query = query.eq('requires_reply', true).eq('status', 'new');
    } else if (filter === 'drafts-ready') {
      // Drafts: has AI draft, no final response
      query = query
        .not('ai_draft_response', 'is', null)
        .is('final_response', null)
        .in('status', ['new', 'open', 'ai_handling'])
        .eq('requires_reply', true);
    } else if (filter === 'fyi') {
      query = query
        .eq('decision_bucket', 'wait')
        .in('status', ['new', 'open', 'waiting_internal', 'ai_handling']);
    } else if (filter === 'cleared') {
      query = query.or('decision_bucket.eq.auto_handled,status.eq.resolved');
    } else if (filter === 'snoozed') {
      query = query.not('snoozed_until', 'is', null).gt('snoozed_until', new Date().toISOString());
    } else if (filter === 'sent') {
      query = query.eq('status', 'resolved');
    } else if (filter === 'all-open') {
      // Inbox: all active conversations, exclude auto-handled/resolved
      query = query
        .neq('decision_bucket', 'auto_handled')
        .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated']);
    }

    // When searching, fetch more items so search works beyond the first page
    const limit = debouncedSearch && debouncedSearch.trim().length > 0 ? 250 : PAGE_SIZE;
    query = query.limit(limit);

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).filter((conv: any) => {
      // When viewing snoozed filter, don't filter out snoozed items
      if (filter === 'snoozed') return true;
      if (!conv.snoozed_until) return true;
      return new Date(conv.snoozed_until) <= new Date();
    });
  };

  const { data: autoHandledCount = 0 } = useQuery({
    queryKey: ['auto-handled-count'],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { count } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .gte('auto_handled_at', today.toISOString());

      return count || 0;
    },
    staleTime: 60000,
  });

  const {
    data: conversations = [],
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ['jace-inbox', filter, subFilter, debouncedSearch],
    queryFn: async () => {
      const result = await fetchConversations();
      setLastUpdated(new Date());
      return result;
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  // Filter by search
  const filteredConversations = conversations.filter((conv: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      conv.title?.toLowerCase().includes(q) ||
      conv.summary_for_human?.toLowerCase().includes(q) ||
      conv.customer?.name?.toLowerCase().includes(q) ||
      conv.customer?.email?.toLowerCase().includes(q)
    );
  });

  // Group by date
  const groupedConversations: GroupedConversations = {
    today: [],
    yesterday: [],
    older: [],
  };

  filteredConversations.forEach((conv: any) => {
    const date = new Date(conv.updated_at || conv.created_at);
    if (isToday(date)) {
      groupedConversations.today.push(conv as Conversation);
    } else if (isYesterday(date)) {
      groupedConversations.yesterday.push(conv as Conversation);
    } else {
      groupedConversations.older.push(conv as unknown as Conversation);
    }
  });

  // Keyboard navigation (j/k/Enter/e)
  useKeyboardNavigation({
    conversations: filteredConversations as unknown as Conversation[],
    selectedIndex: keyboardIndex,
    onSelectIndex: setKeyboardIndex,
    onSelect,
    enabled: !isMobile,
  });

  const handleRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['jace-inbox'] });
  };

  const getTimeSinceUpdate = () => {
    const seconds = Math.floor((new Date().getTime() - lastUpdated.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  const handleCategoryClick = (conversation: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedForCorrection(conversation);
    setCorrectionOpen(true);
  };

  const handleCorrectionUpdate = () => {
    queryClient.invalidateQueries({ queryKey: ['jace-inbox'] });
  };

  // Fixed width for all status badges to ensure consistent alignment
  const BADGE_CLASS =
    'text-[10px] px-2 py-0.5 h-auto min-w-[90px] text-center justify-center font-semibold uppercase tracking-wider rounded-md';

  // State-based labels: what does the user need to DO, not how hard is it
  const getStateConfig = (bucket: string, hasAiDraft: boolean) => {
    if (bucket === 'act_now') {
      return {
        badge: (
          <Badge
            className={`bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 ${BADGE_CLASS}`}
          >
            Needs attention
          </Badge>
        ),
        rowClass: 'bg-red-50/30 border-red-100',
      };
    }
    if (bucket === 'quick_win' && hasAiDraft) {
      return {
        badge: (
          <Badge
            className={`bg-purple-50 text-purple-700 border border-purple-100 hover:bg-purple-100 ${BADGE_CLASS}`}
          >
            Draft ready
          </Badge>
        ),
        rowClass: '',
      };
    }
    if (bucket === 'quick_win') {
      return {
        badge: (
          <Badge
            className={`bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100 ${BADGE_CLASS}`}
          >
            Needs reply
          </Badge>
        ),
        rowClass: '',
      };
    }
    if (bucket === 'wait') {
      return {
        badge: (
          <Badge
            className={`bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 ${BADGE_CLASS}`}
          >
            FYI
          </Badge>
        ),
        rowClass: '',
      };
    }
    if (bucket === 'auto_handled') {
      return {
        badge: (
          <Badge
            className={`bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 ${BADGE_CLASS}`}
          >
            Done
          </Badge>
        ),
        rowClass: '',
      };
    }
    return { badge: null, rowClass: '' };
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return format(date, 'h:mm a');
  };

  const ConversationRow = ({ conversation }: { conversation: Conversation }) => {
    const rawName =
      conversation.customer?.name || conversation.customer?.email?.split('@')[0] || '';
    const customerName =
      !rawName || rawName.includes('unknown.invalid') || rawName.startsWith('unknown@')
        ? 'Unknown Sender'
        : rawName;
    const hasAiDraft = !!conversation.ai_draft_response;
    const stateConfig = getStateConfig(conversation.decision_bucket, hasAiDraft);
    const isSelected = selectedId === conversation.id;
    const initial = customerName.charAt(0).toUpperCase();

    return (
      <div
        onClick={() => onSelect(conversation)}
        className={cn(
          'px-3 py-2.5 cursor-pointer transition-all',
          isSelected
            ? 'bg-purple-50/60 border border-purple-200 ring-1 ring-purple-100 shadow-sm z-10 rounded-xl'
            : 'border-b border-slate-100 hover:bg-slate-50',
        )}
      >
        {/* Row 1: Avatar + Sender + Time */}
        <div className="flex items-center gap-2 mb-0.5">
          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-bold text-primary">{initial}</span>
          </div>
          <span className="text-sm font-semibold text-slate-900 truncate flex-1 min-w-0">
            {customerName}
          </span>
          <span className="text-[11px] text-muted-foreground whitespace-nowrap flex-shrink-0">
            {formatTime(conv.updated_at || conv.created_at)}
          </span>
        </div>
        {/* Row 2: Subject + Category + Badge (indented under avatar) */}
        <div className="pl-9 flex items-center gap-2">
          <span className="text-xs text-slate-500 truncate flex-1 min-w-0">
            {conv.title || 'No subject'}
          </span>
          {conv.category && (
            <CategoryLabel
              classification={conv.category}
              size="xs"
              editable
              onClick={(e) => handleCategoryClick(conversation, e)}
            />
          )}
          <div className="flex-shrink-0">{stateConfig.badge}</div>
        </div>
      </div>
    );
  };

  const DateSection = ({
    title,
    conversations,
  }: {
    title: string;
    conversations: Conversation[];
  }) => {
    if (conversations.length === 0) return null;
    return (
      <div>
        <div className="px-3 py-1.5 bg-purple-50/80 border-b border-slate-100 sticky top-0 z-10">
          <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider">
            {title}
          </span>
        </div>
        {conversations.map((conv) => (
          <ConversationRow key={conv.id} conversation={conv} />
        ))}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Get title based on sub-filter
  const getFilterTitle = () => {
    if (subFilter === 'at-risk') return 'At Risk';
    if (subFilter === 'drafts') return 'Drafts Ready';
    if (subFilter === 'to-reply') return 'To Reply';
    if (filter === 'cleared') return 'Cleared';
    if (filter === 'snoozed') return 'Snoozed';
    if (filter === 'sent') return 'Sent';
    if (filter === 'unread') return 'Unread';
    if (filter === 'drafts-ready') return 'Drafts';
    if (filter === 'needs-me') return 'Needs Action';
    return 'Inbox';
  };

  const clearSubFilter = () => {
    // Navigate back to home page
    window.location.href = '/';
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {!hideHeader && (
        <>
          {/* Header with title and metrics */}
          <div
            className={cn(
              'bg-white/80 backdrop-blur-sm border-b border-slate-100',
              isMobile ? 'px-4 py-3' : 'px-6 py-4',
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {subFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSubFilter}
                    className="h-8 px-2 text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                )}
                <h1 className="text-base font-semibold text-foreground">{getFilterTitle()}</h1>
                {subFilter && (
                  <span className="text-sm text-muted-foreground">
                    ({filteredConversations.length})
                  </span>
                )}
              </div>
              {filter === 'needs-me' && autoHandledCount > 0 && !subFilter && (
                <div className="flex items-center gap-2 text-sm">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="text-foreground/80">
                    BizzyBee cleared{' '}
                    <span className="font-semibold text-primary">{autoHandledCount}</span> today
                  </span>
                </div>
              )}
            </div>
            {subFilter && (
              <p className="text-xs text-muted-foreground mt-1 ml-10">
                {subFilter === 'at-risk' && 'Conversations with SLA warnings or breaches'}
                {subFilter === 'drafts' && 'AI drafted responses ready for your review'}
                {subFilter === 'to-reply' && 'Conversations needing your attention'}
              </p>
            )}
          </div>

          {/* Search bar */}
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border/50">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex-1">
                <SearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search or ask BizzyBee..."
                />
              </div>
              <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                <span>Updated {getTimeSinceUpdate()}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={isFetching}
                  className="h-7 w-7 p-0"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-100 to-blue-50 flex items-center justify-center mb-6 shadow-inner ring-8 ring-purple-50/50">
              <Sparkles className="w-10 h-10 text-purple-500 animate-pulse" />
            </div>
            <p className="text-lg font-semibold text-foreground/80">You're all caught up!</p>
            <p className="text-sm mt-1 text-muted-foreground/70">
              No messages need your attention right now
            </p>
            <p className="text-xs text-muted-foreground/60 mt-3">⌘K to search • J/K to navigate</p>
          </div>
        ) : (
          <>
            <DateSection title="Today" conversations={groupedConversations.today} />
            <DateSection title="Yesterday" conversations={groupedConversations.yesterday} />
            <DateSection title="Earlier" conversations={groupedConversations.older} />
          </>
        )}
      </div>

      {/* Triage Correction Dialog */}
      {selectedForCorrection && (
        <TriageCorrectionFlow
          conversation={selectedForCorrection}
          open={correctionOpen}
          onOpenChange={setCorrectionOpen}
          onUpdate={handleCorrectionUpdate}
        />
      )}
    </div>
  );
};
