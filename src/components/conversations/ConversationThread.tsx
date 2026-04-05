import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation, Message } from '@/lib/types';
import { ConversationHeader } from './ConversationHeader';
import { MessageTimeline } from './MessageTimeline';
import { ReplyArea } from './ReplyArea';
import { CustomerIntelligence } from '@/components/customers/CustomerIntelligence';
import { Loader2, Brain, Sparkles, ChevronRight, TrendingUp, Reply } from 'lucide-react';
import { CategoryLabel } from '@/components/shared/CategoryLabel';
import { useToast } from '@/hooks/use-toast';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { sendReply } from '@/lib/api/sendReply';

interface ConversationThreadProps {
  conversation: Conversation;
  onUpdate: () => void;
  onBack?: () => void;
  hideBackButton?: boolean;
}

const WIDE_BREAKPOINT = 1400;

export const ConversationThread = ({
  conversation,
  onUpdate,
  onBack,
  hideBackButton,
}: ConversationThreadProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftText, setDraftText] = useState<string>('');
  const [customer, setCustomer] = useState<import('@/lib/types').Customer | null>(null);
  const [intelligenceDrawerOpen, setIntelligenceDrawerOpen] = useState(false);
  const [isWide, setIsWide] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { toast } = useToast();
  const draftSaveTimeoutRef = useRef<NodeJS.Timeout>();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Track wide viewport for permanent intelligence panel
  useEffect(() => {
    const check = () => setIsWide(window.innerWidth >= WIDE_BREAKPOINT);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Reset AI draft and scroll position when conversation changes
  useEffect(() => {
    setDraftText('');
    scrollContainerRef.current?.scrollTo(0, 0);
  }, [conversation.id, reloadKey]);

  // Fetch real customer data
  useEffect(() => {
    const fetchCustomer = async () => {
      if (!conversation.customer_id) {
        setCustomer(conversation.customer || null);
        return;
      }
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('id', conversation.customer_id)
        .single();
      setCustomer((data as import('@/lib/types').Customer | null) || conversation.customer || null);
    };
    fetchCustomer();
  }, [conversation.customer, conversation.customer_id, conversation.id]);

  useEffect(() => {
    const fetchMessages = async () => {
      setLoading(true);
      setLoadError(null);
      setMessages([]);

      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });

      if (data) {
        setMessages(data as unknown as Message[]);
      }
      setLoading(false);
    };

    fetchMessages().catch((error) => {
      setLoadError(error instanceof Error ? error.message : 'Failed to load conversation.');
      setLoading(false);
    });

    const channel = supabase
      .channel(`messages-${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation.id]);

  const handleReply = async (body: string, isInternal: boolean) => {
    try {
      if (isInternal) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: userData } = await supabase
          .from('users')
          .select('name')
          .eq('id', user.id)
          .single();

        const { error: insertError } = await supabase.from('messages').insert({
          conversation_id: conversation.id,
          actor_type: 'human_agent',
          actor_id: user.id,
          actor_name: userData?.name || 'Agent',
          direction: 'outbound',
          channel: conversation.channel,
          body,
          is_internal: true,
        });

        if (insertError) {
          throw insertError;
        }
      } else {
        await sendReply({
          conversationId: conversation.id,
          workspaceId: conversation.workspace_id,
          content: body,
          statusAfterSend: 'waiting_customer',
        });
      }

      localStorage.removeItem(`draft-${conversation.id}`);
      toast({
        title: isInternal ? 'Note added' : 'Message sent',
        description: isInternal ? 'Internal note saved' : 'Your reply has been sent successfully',
      });
      onUpdate();
    } catch (error) {
      const description = error instanceof Error ? error.message : 'Please try again.';
      toast({
        title: isInternal ? 'Error saving note' : 'Send failed',
        description,
        variant: 'destructive',
      });
      throw error;
    }
  };

  const handleReopen = async () => {
    await supabase
      .from('conversations')
      .update({ status: 'open', resolved_at: null })
      .eq('id', conversation.id);
    onUpdate();
  };

  const isCompleted = conversation.status === 'resolved';

  // AI Briefing text
  const briefingText =
    conversation.summary_for_human ||
    conversation.ai_why_flagged ||
    conversation.why_this_needs_you ||
    conversation.ai_reason_for_escalation ||
    null;

  const getSentimentLabel = (s: string | null) => {
    switch (s) {
      case 'positive':
        return {
          emoji: '',
          label: 'Positive',
          color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        };
      case 'negative':
        return { emoji: '', label: 'Negative', color: 'bg-red-50 text-red-700 border-red-200' };
      case 'frustrated':
        return {
          emoji: '',
          label: 'Frustrated',
          color: 'bg-orange-50 text-orange-700 border-orange-200',
        };
      case 'neutral':
        return {
          emoji: '',
          label: 'Neutral',
          color: 'bg-slate-50 text-slate-600 border-slate-200',
        };
      default:
        return null;
    }
  };

  // Extract topics from conversation metadata
  const topics = conversation.extracted_entities?.topics || conversation.metadata?.topics || [];

  const sentiment = getSentimentLabel(conversation.ai_sentiment);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-bb-border bg-bb-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-bb-text">Conversation unavailable</p>
          <p className="mt-2 text-sm text-bb-warm-gray">{loadError}</p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => setReloadKey((value) => value + 1)}
          >
            Refresh thread
          </Button>
        </div>
      </div>
    );
  }

  const intelligencePanel =
    conversation.workspace_id && (conversation.customer_id || customer?.id) ? (
      <CustomerIntelligence
        workspaceId={conversation.workspace_id}
        customerId={conversation.customer_id || customer?.id}
        conversationId={conversation.id}
      />
    ) : null;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Main reading pane */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        {/* Nav header bar */}
        <div className="flex-shrink-0 bg-background border-b border-border">
          <ConversationHeader
            conversation={conversation}
            onUpdate={onUpdate}
            onBack={onBack}
            hideBackButton={hideBackButton}
          />
        </div>

        {/* 1. Sender Info Row — first thing after nav */}
        {(conversation.customer_id || customer) &&
          (() => {
            // Prioritize actual sender name from first inbound message
            const firstInbound = messages.find((m) => m.actor_type === 'customer');
            const rawPayload = firstInbound?.raw_payload as Record<string, unknown> | null;
            const rawFrom = rawPayload?.from as { name?: string } | undefined;
            const senderDisplayName =
              rawFrom?.name || firstInbound?.actor_name || customer?.name || 'Unknown';
            const senderInitials = senderDisplayName
              .split(' ')
              .map((n: string) => n[0])
              .join('')
              .toUpperCase()
              .slice(0, 2);

            return (
              <div className="flex-shrink-0 px-4 py-2.5 border-b border-border/40 flex items-center justify-between bg-background">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-[11px] font-semibold flex-shrink-0 shadow-sm">
                    {senderInitials}
                  </div>
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground truncate">
                      {senderDisplayName}
                    </span>
                    {customer?.email && (
                      <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                        {'<'}
                        {customer.email}
                        {'>'}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {conversation.created_at
                    ? new Date(conversation.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : ''}
                </span>
              </div>
            );
          })()}

        {/* 2. Elevated AI Bento Strip — Frosted Glass (Home page aesthetic) */}
        {briefingText && (
          <div className="flex-shrink-0 mx-6 mt-6 mb-2 p-5 bg-gradient-to-r from-amber-50/60 via-purple-50/40 to-blue-50/40 rounded-2xl border border-white/60 shadow-sm flex flex-col gap-3 ring-1 ring-slate-900/5">
            {/* Top row: AI Summary */}
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed line-clamp-2 font-medium flex-1">
                {briefingText}
              </p>
            </div>
            {/* Bottom row: Intelligence pills + Deep Dive */}
            <div className="flex items-center gap-2 flex-wrap">
              {sentiment && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border',
                    sentiment.color,
                  )}
                >
                  {sentiment.label}
                </span>
              )}
              {conversation.category && (
                <CategoryLabel classification={conversation.category} size="sm" />
              )}
              {Array.isArray(topics) &&
                topics.slice(0, 2).map((topic: string, i: number) => (
                  <span
                    key={i}
                    className="px-2 py-1 text-xs font-medium rounded-md border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                  >
                    {topic}
                  </span>
                ))}
              {conversation.priority && conversation.priority !== 'medium' && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border',
                    conversation.priority === 'high'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600',
                  )}
                >
                  <TrendingUp className="w-3 h-3" />
                  {conversation.priority}
                </span>
              )}
              {!isWide && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIntelligenceDrawerOpen(true)}
                  className="ml-auto text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:text-indigo-200 dark:hover:bg-indigo-950/40 font-medium h-8 px-3"
                >
                  Deep Dive
                  <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* 3. Email body — naked canvas, fills remaining space */}
        <div ref={scrollContainerRef} className="flex-1 min-h-[200px] overflow-y-auto">
          <MessageTimeline
            messages={messages}
            workspaceId={conversation.workspace_id}
            onDraftTextChange={setDraftText}
            conversationCustomerName={customer?.name}
          />
        </div>

        {/* Reply area at bottom — always render */}
        <div className="flex-shrink-0">
          {isCompleted ? (
            <div className="flex-shrink-0 px-4 pb-4">
              <button
                onClick={handleReopen}
                className="border border-slate-200 rounded-full py-3 px-4 text-muted-foreground cursor-pointer shadow-sm bg-white hover:border-purple-300 transition-all flex items-center gap-3 w-full text-left text-sm"
              >
                <Reply className="w-4 h-4" />
                Reopen &amp; reply...
              </button>
            </div>
          ) : (
            <ReplyArea
              conversationId={conversation.id}
              channel={conversation.channel}
              aiDraftResponse={
                conversation.ai_draft_response ||
                (conversation.metadata?.ai_draft_response as string)
              }
              onSend={handleReply}
              externalDraftText={
                draftText ||
                (conversation.ai_draft_response as string) ||
                (conversation.metadata?.ai_draft_response as string) ||
                ''
              }
              onDraftTextCleared={() => setDraftText('')}
              onDraftChange={setDraftText}
              senderName={customer?.name || 'sender'}
            />
          )}
        </div>
      </div>

      {/* Permanent right intelligence panel on wide screens */}
      {isWide && intelligencePanel && (
        <div className="flex-shrink-0 w-[300px] overflow-y-auto bg-gradient-to-b from-indigo-50/30 to-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] ring-1 ring-slate-900/5 rounded-xl m-3 ml-0 p-3">
          {intelligencePanel}
        </div>
      )}

      {/* Slide-out drawer for narrow screens */}
      {!isWide && (
        <Sheet open={intelligenceDrawerOpen} onOpenChange={setIntelligenceDrawerOpen}>
          <SheetContent side="right" className="w-[400px] sm:w-[450px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-indigo-600" />
                Customer Intelligence
              </SheetTitle>
            </SheetHeader>
            <div className="mt-4">{intelligencePanel}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
};
