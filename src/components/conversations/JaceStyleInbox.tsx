import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Conversation } from '@/lib/types';
import { SearchInput } from './SearchInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, RefreshCw, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { CategoryLabel } from '@/components/shared/CategoryLabel';
import { TriageCorrectionFlow } from './TriageCorrectionFlow';
import { InboxQuickActions } from './InboxQuickActions';
import { useIsMobile } from '@/hooks/use-mobile';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { useWorkspace } from '@/hooks/useWorkspace';
import { isDateToday, isDateYesterday, safeFormat } from '@/lib/dates';
import { PanelNotice } from '@/components/settings/PanelNotice';
import { getPreviewAwarePath, isPreviewModeEnabled } from '@/lib/previewMode';

interface JaceStyleInboxProps {
  onSelect: (conversation: Conversation) => void;
  selectedId?: string | null;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
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
  searchValue,
  onSearchChange,
  filter = 'needs-me',
  hideHeader = false,
}: JaceStyleInboxProps) => {
  const { workspace } = useWorkspace();
  const isPreviewMode = isPreviewModeEnabled();
  const onboardingPath = getPreviewAwarePath('/onboarding?reset=true');
  const [searchParams] = useSearchParams();
  const subFilter = searchParams.get('filter'); // 'at-risk', 'to-reply', 'drafts'

  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [selectedForCorrection, setSelectedForCorrection] = useState<Conversation | null>(null);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [keyboardIndex, setKeyboardIndex] = useState(0);
  const PAGE_SIZE = 50;
  const searchQuery = searchValue ?? internalSearchQuery;
  const setSearchQuery = onSearchChange ?? setInternalSearchQuery;

  // Debounce search to avoid spamming requests while typing
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  const fetchConversations = async () => {
    if (!workspace?.id) return [];

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
      .eq('workspace_id', workspace.id)
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
    queryKey: ['auto-handled-count', workspace?.id],
    enabled: !!workspace?.id && !isPreviewMode,
    queryFn: async () => {
      if (!workspace?.id) return 0;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { count } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id)
        .gte('auto_handled_at', today.toISOString());

      return count || 0;
    },
    staleTime: 60000,
  });

  const {
    data: conversations = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['jace-inbox', workspace?.id, filter, subFilter, debouncedSearch],
    enabled: !!workspace?.id && !isPreviewMode,
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
    const timestamp = conv.updated_at || conv.created_at;
    if (isDateToday(timestamp)) {
      groupedConversations.today.push(conv as Conversation);
    } else if (isDateYesterday(timestamp)) {
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
    await queryClient.invalidateQueries({ queryKey: ['jace-inbox', workspace?.id] });
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
    queryClient.invalidateQueries({ queryKey: ['jace-inbox', workspace?.id] });
  };

  // Fixed width for all status badges to ensure consistent alignment
  const BADGE_CLASS =
    'text-[10px] px-2 py-0.5 h-auto min-w-[90px] text-center justify-center font-medium uppercase tracking-[0.08em] rounded-full';

  // State-based labels: what does the user need to DO, not how hard is it
  const getStateConfig = (bucket: string, hasAiDraft: boolean) => {
    if (bucket === 'act_now') {
      return {
        badge: (
          <Badge
            className={`bg-bb-danger-bg text-bb-danger border border-transparent ${BADGE_CLASS}`}
          >
            Needs attention
          </Badge>
        ),
        rowClass: 'bg-bb-danger-bg/50',
      };
    }
    if (bucket === 'quick_win' && hasAiDraft) {
      return {
        badge: (
          <Badge
            className={`bg-bb-neutral-bg text-bb-neutral border border-transparent ${BADGE_CLASS}`}
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
            className={`bg-bb-warning-bg text-bb-warning border border-transparent ${BADGE_CLASS}`}
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
            className={`bg-bb-neutral-bg text-bb-neutral border border-transparent ${BADGE_CLASS}`}
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
            className={`bg-bb-success-bg text-bb-success border border-transparent ${BADGE_CLASS}`}
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
    return safeFormat(dateStr, 'h:mm a');
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
          'px-4 py-3 cursor-pointer transition-all',
          isSelected
            ? 'mx-2 rounded-xl border border-bb-gold-border bg-bb-gold-light shadow-sm'
            : 'border-b border-bb-border-light hover:bg-bb-cream',
          stateConfig.rowClass,
        )}
      >
        <div className="mb-1 flex items-center gap-3">
          <div
            className={cn(
              'flex h-[30px] w-[30px] items-center justify-center rounded-full flex-shrink-0',
              conversation.decision_bucket === 'act_now'
                ? 'bg-bb-warning-bg text-bb-warning'
                : 'bg-bb-cream text-bb-text-secondary',
            )}
          >
            <span className="text-[11px] font-medium">{initial}</span>
          </div>
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-bb-text">
            {customerName}
          </span>
          <span className="flex-shrink-0 whitespace-nowrap text-[10px] text-bb-muted">
            {formatTime(conversation.updated_at || conversation.created_at)}
          </span>
        </div>
        <div className="flex items-center gap-2 pl-[42px]">
          <span className="min-w-0 flex-1 truncate text-[11px] text-bb-warm-gray">
            {conversation.title || 'No subject'}
          </span>
          {conversation.category && (
            <CategoryLabel
              classification={conversation.category}
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
        <div className="sticky top-0 z-10 border-b border-bb-border-light bg-bb-cream/90 px-4 py-2 backdrop-blur-sm">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-bb-warm-gray">
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
      <div className="flex items-center justify-center h-full bg-bb-white">
        <Loader2 className="h-8 w-8 animate-spin text-bb-warm-gray" />
      </div>
    );
  }

  if (!workspace?.id) {
    return (
      <div className="flex h-full items-center justify-center bg-bb-white p-6">
        <div className="w-full max-w-lg">
          <PanelNotice
            title="Finish setup before using the inbox"
            description="BizzyBee needs a workspace and onboarding context before customer conversations can appear here."
            actionLabel="Open onboarding"
            actionTo="/onboarding?reset=true"
          />
        </div>
      </div>
    );
  }

  if (isPreviewMode) {
    return (
      <div className="flex h-full items-center justify-center bg-bb-white p-6">
        <div className="w-full max-w-lg">
          <PanelNotice
            title="Finish setup before using the inbox"
            description="This preview shell can open the app, but the inbox needs onboarding and real channels before conversations can load."
            actionLabel="Open onboarding"
            actionTo={onboardingPath}
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-bb-white p-6">
        <div className="w-full max-w-lg">
          <PanelNotice
            title="Inbox unavailable"
            description={
              error instanceof Error
                ? error.message
                : 'BizzyBee could not load the inbox right now.'
            }
            action={
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Try again
              </Button>
            }
          />
        </div>
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
    <div className="flex h-full flex-col bg-bb-white">
      {!hideHeader && (
        <>
          <div
            className={cn(
              'border-b border-bb-border-light bg-bb-white/90 backdrop-blur-sm',
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
                    className="h-8 px-2 text-bb-warm-gray hover:text-bb-text"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                )}
                <h1 className="text-[15px] font-medium text-bb-text">{getFilterTitle()}</h1>
                {subFilter && (
                  <span className="text-sm text-bb-warm-gray">
                    ({filteredConversations.length})
                  </span>
                )}
              </div>
              {filter === 'needs-me' && autoHandledCount > 0 && !subFilter && (
                <div className="flex items-center gap-2 text-sm">
                  <Sparkles className="h-4 w-4 text-bb-gold" />
                  <span className="text-bb-text-secondary">
                    BizzyBee cleared{' '}
                    <span className="font-medium text-bb-gold">{autoHandledCount}</span> today
                  </span>
                </div>
              )}
            </div>
            {subFilter && (
              <p className="ml-10 mt-1 text-xs text-bb-warm-gray">
                {subFilter === 'at-risk' && 'Conversations with SLA warnings or breaches'}
                {subFilter === 'drafts' && 'AI drafted responses ready for your review'}
                {subFilter === 'to-reply' && 'Conversations needing your attention'}
              </p>
            )}
          </div>

          <div className="border-b border-bb-border-light px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex-1">
                <SearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search or ask BizzyBee..."
                />
              </div>
              <div className="flex items-center justify-end gap-2 text-xs text-bb-warm-gray">
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
          <div className="flex h-64 flex-col items-center justify-center text-bb-warm-gray">
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-bb-gold-light shadow-inner ring-8 ring-bb-cream">
              <Sparkles className="h-10 w-10 animate-pulse text-bb-gold" />
            </div>
            <p className="text-lg font-medium text-bb-text">
              {searchQuery ? 'No matching conversations' : "You're all caught up"}
            </p>
            <p className="mt-1 text-sm text-bb-warm-gray">
              {searchQuery
                ? 'Try a different search term or clear your filters.'
                : 'No messages need your attention right now'}
            </p>
            <p className="mt-3 text-xs text-bb-muted">⌘K to search • J/K to navigate</p>
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
