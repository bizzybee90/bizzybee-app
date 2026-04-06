import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { Conversation } from '@/lib/types';
import { ConversationCard } from './ConversationCard';
import { ConversationCardSkeleton } from './ConversationCardSkeleton';
import { ConversationFilters } from './ConversationFilters';
import { SearchInput } from './SearchInput';
import { useIsTablet } from '@/hooks/use-tablet';
import { useWorkspace } from '@/hooks/useWorkspace';
import { Loader2, SlidersHorizontal, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import PullToRefresh from 'react-simple-pull-to-refresh';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PanelNotice } from '@/components/settings/PanelNotice';
import { getPreviewAwarePath, isPreviewModeEnabled } from '@/lib/previewMode';

interface SortRule {
  id: string;
  field: string;
  direction: 'asc' | 'desc';
  label: string;
  enabled: boolean;
}

const priorityRank: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function readCustomSortRules(): SortRule[] {
  try {
    const stored = localStorage.getItem('conversation-ordering-rules');
    if (!stored) return [];

    const parsed = JSON.parse(stored) as SortRule[];
    return Array.isArray(parsed) ? parsed.filter((rule) => rule?.enabled) : [];
  } catch {
    return [];
  }
}

function compareMaybeDates(left: string | null | undefined, right: string | null | undefined) {
  const leftTime = left ? new Date(left).getTime() : Number.NEGATIVE_INFINITY;
  const rightTime = right ? new Date(right).getTime() : Number.NEGATIVE_INFINITY;
  return leftTime - rightTime;
}

function compareRuleValues(left: Conversation, right: Conversation, field: string) {
  if (field === 'priority') {
    return (
      (priorityRank[left.priority ?? 'low'] ?? 0) - (priorityRank[right.priority ?? 'low'] ?? 0)
    );
  }

  if (field === 'message_count') {
    const leftCount = Number(left.metadata?.message_count ?? 0);
    const rightCount = Number(right.metadata?.message_count ?? 0);
    return leftCount - rightCount;
  }

  if (field === 'sla_due_at' || field === 'created_at' || field === 'updated_at') {
    return compareMaybeDates(
      left[field as 'sla_due_at' | 'created_at' | 'updated_at'],
      right[field as 'sla_due_at' | 'created_at' | 'updated_at'],
    );
  }

  const leftValue = left[field as keyof Conversation];
  const rightValue = right[field as keyof Conversation];

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return leftValue - rightValue;
  }

  return String(leftValue ?? '').localeCompare(String(rightValue ?? ''));
}

function applyCustomSortRules(conversations: Conversation[]) {
  const enabledRules = readCustomSortRules();

  if (enabledRules.length === 0) {
    return conversations;
  }

  return [...conversations].sort((left, right) => {
    for (const rule of enabledRules) {
      const comparison = compareRuleValues(left, right, rule.field);

      if (comparison !== 0) {
        return rule.direction === 'asc' ? comparison : -comparison;
      }
    }

    return compareMaybeDates(right.updated_at, left.updated_at);
  });
}

interface ConversationListProps {
  selectedId?: string;
  onSelect: (conversation: Conversation) => void;
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
    | 'fyi';
  onConversationsChange?: (conversations: Conversation[]) => void;
  channelFilter?: string;
}

export const ConversationList = ({
  selectedId,
  onSelect,
  filter = 'all-open',
  onConversationsChange,
  channelFilter: initialChannelFilter,
}: ConversationListProps) => {
  const { workspace } = useWorkspace();
  const isPreviewMode = isPreviewModeEnabled();
  const onboardingPath = getPreviewAwarePath('/onboarding?reset=true');
  const [page, setPage] = useState(0);
  const isTablet = useIsTablet();
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [channelFilter, setChannelFilter] = useState<string[]>(() => {
    return initialChannelFilter ? [initialChannelFilter] : [];
  });
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<string>(() => {
    return localStorage.getItem('conversation-sort') || 'newest';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 50;
  const queryClient = useQueryClient();

  // Debounce search to avoid too many requests
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(0); // Reset to first page when searching
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Persist sort preference
  useEffect(() => {
    localStorage.setItem('conversation-sort', sortBy);
  }, [sortBy]);

  const fetchConversations = async (pageNum: number = 0) => {
    if (!workspace?.id) {
      return { data: [], count: 0 };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    logger.debug('Fetching conversations', { userId: user?.id });

    if (!user) {
      logger.error('No authenticated user');
      return { data: [], count: 0 };
    }

    // Use optimized RPC for "sent" filter
    if (filter === 'sent') {
      const { data, error } = await supabase.rpc('get_sent_conversations', {
        p_user_id: user.id,
        p_limit: PAGE_SIZE,
        p_offset: pageNum * PAGE_SIZE,
      });

      if (error) throw error;

      const activeConversations = (data || []).filter(
        (conv: Conversation & { snoozed_until?: string | null }) => {
          if (!conv.snoozed_until) return true;
          return new Date(conv.snoozed_until) <= new Date();
        },
      );

      logger.debug('Sent conversations fetched', { count: activeConversations.length });
      return { data: activeConversations, count: activeConversations.length };
    }

    logger.debug('Using workspace_id', { workspaceId: workspace.id });

    let query = supabase
      .from('conversations')
      .select(
        `
        *,
        customer:customers(*),
        assigned_user:users!conversations_assigned_to_fkey(*)
      `,
        { count: 'exact' },
      )
      .eq('workspace_id', workspace.id);

    // Apply sorting
    switch (sortBy) {
      case 'newest':
        query = query.order('updated_at', { ascending: false });
        break;
      case 'oldest':
        query = query.order('created_at', { ascending: true });
        break;
      case 'priority_high':
        query = query
          .order('priority', { ascending: false })
          .order('created_at', { ascending: false });
        break;
      case 'priority_low':
        query = query
          .order('priority', { ascending: true })
          .order('created_at', { ascending: false });
        break;
      case 'sla_urgent':
        query = query
          .order('sla_due_at', { ascending: true, nullsFirst: false })
          .order('updated_at', { ascending: false });
        break;
      case 'custom':
        query = query.order('updated_at', { ascending: false });
        break;
      default:
        query = query.order('updated_at', { ascending: false });
        break;
    }

    // Apply view filter
    if (filter === 'needs-me') {
      // PRIMARY VIEW: ACT_NOW + QUICK_WIN buckets - things that need human attention
      query = query
        .in('decision_bucket', ['act_now', 'quick_win'])
        .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated']);
      // Sort ACT_NOW first, then QUICK_WIN
      query = query.order('decision_bucket', { ascending: true }); // act_now comes before quick_win alphabetically
    } else if (filter === 'fyi') {
      // FYI view: WAIT bucket - things to be aware of, no action needed
      query = query
        .eq('decision_bucket', 'wait')
        .in('status', ['new', 'open', 'waiting_internal', 'ai_handling']);
    } else if (filter === 'snoozed') {
      // Snoozed - manually snoozed items
      query = query.not('snoozed_until', 'is', null).gt('snoozed_until', new Date().toISOString());
    } else if (filter === 'cleared') {
      // AUTO_HANDLED bucket + resolved - trust-building view
      query = query.or('decision_bucket.eq.auto_handled,status.eq.resolved');
    } else if (filter === 'my-tickets') {
      query = query
        .eq('assigned_to', user.id)
        .in('status', [
          'new',
          'open',
          'waiting_customer',
          'waiting_internal',
          'ai_handling',
          'escalated',
        ]);
    } else if (filter === 'unassigned') {
      query = query
        .is('assigned_to', null)
        .in('status', [
          'new',
          'open',
          'waiting_customer',
          'waiting_internal',
          'ai_handling',
          'escalated',
        ]);
    } else if (filter === 'sla-risk') {
      query = query
        .in('sla_status', ['warning', 'breached'])
        .in('status', [
          'new',
          'open',
          'waiting_customer',
          'waiting_internal',
          'ai_handling',
          'escalated',
        ]);
    } else if (filter === 'all-open') {
      // Directive 6: Show ALL conversations, not just needs-reply
      // Sorted by updated_at DESC (already handled above)
      // Visual differentiation handled in ConversationCard
    } else if (filter === 'awaiting-reply') {
      query = query.in('status', ['waiting_customer', 'waiting_internal']);
    } else if (filter === 'completed') {
      query = query.eq('status', 'resolved');
    } else if (filter === 'high-priority') {
      query = query
        .in('priority', ['high', 'urgent'])
        .in('status', [
          'new',
          'open',
          'waiting_customer',
          'waiting_internal',
          'ai_handling',
          'escalated',
        ]);
    } else if (filter === 'vip-customers') {
      query = query
        .eq('metadata->>tier', 'vip')
        .in('status', [
          'new',
          'open',
          'waiting_customer',
          'waiting_internal',
          'ai_handling',
          'escalated',
        ]);
    } else if (filter === 'escalations') {
      query = query
        .eq('is_escalated', true)
        .in('status', ['new', 'in_progress', 'waiting', 'open', 'escalated', 'ai_handling']);
    } else if (filter === 'triaged') {
      // Show auto-triaged emails that don't require a reply
      query = query.eq('requires_reply', false);
    }

    logger.debug('Applied filter', { filter });

    // Apply additional filters
    if (statusFilter.length > 0) {
      query = query.in('status', statusFilter);
    }
    if (priorityFilter.length > 0) {
      query = query.in('priority', priorityFilter);
    }
    if (channelFilter.length > 0) {
      query = query.in('channel', channelFilter);
    }
    if (categoryFilter.length > 0) {
      query = query.in('category', categoryFilter);
    }

    // Add server-side search if search query provided
    if (debouncedSearch && debouncedSearch.trim().length > 0) {
      const searchTerm = debouncedSearch.trim();
      query = query.or(`title.ilike.%${searchTerm}%,summary_for_human.ilike.%${searchTerm}%`);
    }

    // Add pagination
    query = query.range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);

    const { data, count, error } = await query;
    if (error) {
      logger.error('Query error', error);
      throw error;
    }

    const conversationData = (data || []) as Array<
      Conversation & { snoozed_until?: string | null }
    >;
    const activeConversations = conversationData.filter((conv) => {
      if (!conv.snoozed_until) return true;
      return new Date(conv.snoozed_until) <= new Date();
    });

    const sortedConversations =
      sortBy === 'custom' ? applyCustomSortRules(activeConversations) : activeConversations;

    logger.debug('Active conversations after filtering', { count: sortedConversations.length });
    return { data: sortedConversations, count: count || 0 };
  };

  // Track last update time
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Fetch auto-handled count for "BizzyBee handled X today" metric
  const { data: autoHandledCount = 0 } = useQuery({
    queryKey: ['auto-handled-count', workspace?.id],
    enabled: !!workspace?.id,
    queryFn: async () => {
      if (!workspace?.id) return 0;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { count, error } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id)
        .gte('auto_handled_at', today.toISOString());

      if (error) {
        logger.error('Error fetching auto-handled count', error);
        return 0;
      }
      return count || 0;
    },
    staleTime: 60000, // Cache for 1 minute
    refetchInterval: 60000, // Refetch every minute
  });

  // React Query setup with optimistic UI
  const queryKey = [
    'conversations',
    workspace?.id,
    filter,
    statusFilter,
    priorityFilter,
    channelFilter,
    categoryFilter,
    sortBy,
    page,
    debouncedSearch,
  ];

  const {
    data: queryData,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey,
    enabled: !!workspace?.id,
    queryFn: async () => {
      const result = await fetchConversations(page);
      setLastUpdated(new Date());
      return result;
    },
    staleTime: 30000, // Cache for 30 seconds
    refetchInterval: 60000, // Refetch every 60 seconds in background
  });

  const conversations = useMemo(() => queryData?.data ?? [], [queryData?.data]);
  const hasMore = queryData ? (page + 1) * PAGE_SIZE < (queryData.count || 0) : false;

  // Use server-side search results directly (no client-side filter needed)
  const filteredConversations = conversations;

  // Notify parent of conversation changes
  useEffect(() => {
    onConversationsChange?.(conversations);
  }, [conversations, onConversationsChange]);

  // Real-time updates with improved subscription scoped to workspace
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupRealtimeSubscription = async () => {
      if (!workspace?.id) return;

      logger.debug('Setting up realtime subscription', {
        filter,
        workspaceId: workspace.id,
      });

      channel = supabase
        .channel('conversations-changes')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'conversations',
            filter: `workspace_id=eq.${workspace.id}`,
          },
          (payload) => {
            logger.debug('New conversation inserted');
            queryClient.invalidateQueries({ queryKey: ['conversations', workspace.id] });
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'conversations',
            filter: `workspace_id=eq.${workspace.id}`,
          },
          (payload) => {
            logger.debug('Conversation updated');
            queryClient.invalidateQueries({ queryKey: ['conversations', workspace.id] });
          },
        )
        .subscribe((status) => {
          logger.debug('Realtime subscription status', { status });
        });
    };

    setupRealtimeSubscription();

    return () => {
      logger.debug('Cleaning up realtime subscription');
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [filter, queryClient, workspace?.id]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [filter, statusFilter, priorityFilter, channelFilter, categoryFilter, sortBy, searchQuery]);

  const loadMore = useCallback(() => {
    if (!isLoading && !isFetching && hasMore) {
      setPage((prev) => prev + 1);
    }
  }, [isLoading, isFetching, hasMore]);

  const activeFilterCount =
    statusFilter.length + priorityFilter.length + channelFilter.length + categoryFilter.length;

  const handleRefresh = async () => {
    logger.debug('Manual refresh triggered');
    setPage(0);
    await queryClient.invalidateQueries({ queryKey: ['conversations', workspace?.id] });
  };

  const getTimeSinceUpdate = () => {
    const seconds = Math.floor((new Date().getTime() - lastUpdated.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const isTouchDevice = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  };

  const skeletonList = (
    <div className={cn('flex-1 overflow-y-auto', isTablet ? 'px-0' : 'p-4')}>
      {Array.from({ length: 6 }).map((_, i) => (
        <ConversationCardSkeleton key={i} />
      ))}
    </div>
  );

  // Show skeleton only on initial load (not when refetching)
  if (isLoading && conversations.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col h-full',
          isTablet ? 'bg-transparent' : 'bg-bb-linen min-w-[300px]',
        )}
      >
        {skeletonList}
      </div>
    );
  }

  if (!workspace?.id) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center p-6',
          isTablet ? 'bg-transparent' : 'bg-bb-linen min-w-[300px]',
        )}
      >
        <div className="w-full max-w-lg">
          <PanelNotice
            title="Finish setup before using the inbox"
            description="BizzyBee needs a workspace and onboarding context before customer conversations can appear here."
            actionLabel="Open onboarding"
            actionTo={onboardingPath}
          />
        </div>
      </div>
    );
  }

  if (isPreviewMode) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center p-6',
          isTablet ? 'bg-transparent' : 'bg-bb-linen min-w-[300px]',
        )}
      >
        <div className="w-full max-w-lg">
          <PanelNotice
            title="Finish setup before using the inbox"
            description="This local preview shows the product shell. Complete onboarding to unlock real conversations and channel data."
            actionLabel="Open onboarding"
            actionTo={onboardingPath}
          />
        </div>
      </div>
    );
  }

  if (error && conversations.length === 0) {
    const message = error instanceof Error ? error.message : 'Please try again.';

    return (
      <div
        className={cn(
          'flex h-full items-center justify-center p-6',
          isTablet ? 'bg-transparent' : 'bg-bb-linen min-w-[300px]',
        )}
      >
        <div className="w-full max-w-lg">
          <PanelNotice
            title="Inbox unavailable"
            description={`BizzyBee couldn't load conversations for this workspace right now. ${message}`}
            actionLabel="Retry inbox"
            onAction={handleRefresh}
          />
        </div>
      </div>
    );
  }

  const conversationListContent = (
    <div
      ref={parentRef}
      className={cn('flex-1 overflow-y-auto', isTablet ? 'px-0' : 'p-4')}
      onScroll={(e) => {
        const bottom =
          e.currentTarget.scrollHeight - e.currentTarget.scrollTop <=
          e.currentTarget.clientHeight + 100;
        if (bottom && !isLoading && !isFetching && hasMore) {
          loadMore();
        }
      }}
    >
      {filteredConversations.length === 0 && !isLoading ? (
        <div className="flex flex-col items-center justify-center h-64 text-bb-warm-gray">
          <p className={cn('font-medium', isTablet ? 'text-sm' : 'text-lg')}>
            {debouncedSearch ? 'No matching conversations' : 'No conversations yet'}
          </p>
          <p className="text-xs mt-1 text-bb-muted">
            {debouncedSearch
              ? 'Try a different search or clear some filters.'
              : 'New customer conversations will appear here once your channels are active.'}
          </p>
        </div>
      ) : (
        <>
          {filteredConversations.map((conversation) => (
            <ConversationCard
              key={conversation.id}
              conversation={conversation}
              selected={selectedId === conversation.id}
              onClick={() => onSelect(conversation)}
              onUpdate={handleRefresh}
              showTriageActions={filter === 'triaged' || filter === 'cleared'}
            />
          ))}
          {isFetching && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-bb-warm-gray" />
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        'flex flex-col h-full',
        isTablet ? 'bg-transparent' : 'bg-bb-linen min-w-[300px]',
      )}
    >
      {/* BizzyBee handled X today - Emotional metric header */}
      {filter === 'needs-me' && autoHandledCount > 0 && (
        <div className="px-4 py-3 bg-gradient-to-r from-bb-gold/5 to-bb-gold/10 border-b border-bb-gold/10">
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-bb-gold" />
            <span className="text-bb-text/80">
              BizzyBee cleared <span className="font-medium text-bb-gold">{autoHandledCount}</span>{' '}
              messages for you today
            </span>
          </div>
        </div>
      )}

      {/* Search and Filter Controls */}
      <div
        className={cn(
          'py-3 border-b border-bb-border/50 bg-bb-white/80 backdrop-blur-sm space-y-2',
          isTablet ? 'px-0 mb-4' : 'px-4',
        )}
      >
        {/* Last Updated Indicator */}
        <div className="flex items-center justify-between text-xs text-bb-muted mb-1">
          <span>Last updated: {getTimeSinceUpdate()}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
            className="h-6 px-2 text-xs"
          >
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        {/* Search Input */}
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by name, email, or content..."
        />

        <div className="flex gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="flex-1 justify-between h-9 text-sm font-medium border-bb-border"
              >
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4" />
                  <span>Filters</span>
                </div>
                {activeFilterCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-auto h-5 min-w-5 px-1.5 text-[10px] font-medium"
                  >
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-4" align="start">
              <ConversationFilters
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                priorityFilter={priorityFilter}
                setPriorityFilter={setPriorityFilter}
                channelFilter={channelFilter}
                setChannelFilter={setChannelFilter}
                categoryFilter={categoryFilter}
                setCategoryFilter={setCategoryFilter}
              />
            </PopoverContent>
          </Popover>
        </div>

        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-full h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sla_urgent">SLA Urgent First</SelectItem>
            <SelectItem value="newest">Newest First</SelectItem>
            <SelectItem value="oldest">Oldest First</SelectItem>
            <SelectItem value="priority_high">High Priority First</SelectItem>
            <SelectItem value="priority_low">Low Priority First</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Pull-to-refresh wrapper (only on touch devices and tablet) */}
      {isTouchDevice() && isTablet ? (
        <PullToRefresh
          onRefresh={handleRefresh}
          pullingContent={
            <div className="text-center py-4 text-sm text-bb-warm-gray">Pull to refresh</div>
          }
          refreshingContent={
            <div className="text-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-bb-warm-gray mx-auto" />
              <p className="text-sm text-bb-warm-gray mt-2">Refreshing...</p>
            </div>
          }
        >
          {conversationListContent}
        </PullToRefresh>
      ) : (
        conversationListContent
      )}
    </div>
  );
};
