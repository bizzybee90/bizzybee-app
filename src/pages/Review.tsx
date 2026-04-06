import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { MobileHeader } from '@/components/sidebar/MobileHeader';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { CategoryLabel, getCategoryConfig } from '@/components/shared/CategoryLabel';
import { BackButton } from '@/components/shared/BackButton';
import { DraftReplyEditor } from '@/components/review/DraftReplyEditor';
import { EmailPreview } from '@/components/review/EmailPreview';
import { TriageCorrectionFlow } from '@/components/conversations/TriageCorrectionFlow';
import type { Conversation } from '@/lib/types';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
  ChevronRight,
  Check,
  SkipForward,
  Sparkles,
  Bot,
  FileEdit,
  Eye,
  Send,
  Pencil,
  Trophy,
  TrendingUp,
  Zap,
  PartyPopper,
  CheckCheck,
  X,
} from 'lucide-react';
import { cleanEmailContent } from '@/utils/emailParser';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useReviewFeedback } from '@/hooks/useReviewFeedback';
import { useWorkspace } from '@/hooks/useWorkspace';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PanelNotice } from '@/components/settings/PanelNotice';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DOMPurify from 'dompurify';
import { getPreviewAwarePath, isPreviewModeEnabled } from '@/lib/previewMode';

// Helper to strip HTML tags safely
const stripHtml = (html: string): string => {
  if (!html) return '';
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: [], KEEP_CONTENT: true });
};

interface ReviewConversation {
  id: string;
  title: string;
  summary_for_human: string;
  decision_bucket: string;
  why_this_needs_you: string;
  triage_confidence: number;
  created_at: string;
  channel?: string;
  email_classification?: string;
  ai_draft_response?: string;
  ai_reasoning?: string;
  requires_reply?: boolean;
  training_reviewed?: boolean;
  training_reviewed_at?: string;
  customer: {
    name: string;
    email: string;
  } | null;
  messages: {
    body: string;
    created_at: string;
    actor_name?: string | null;
    raw_payload?: { body?: string } | null;
  }[];
}

const getSenderName = (conv: ReviewConversation): string => {
  const msg = conv.messages?.[0];
  return (
    msg?.actor_name ||
    conv.customer?.name ||
    conv.customer?.email?.split('@')[0] ||
    'Unknown Sender'
  );
};

const getSenderEmail = (conv: ReviewConversation): string => {
  return conv.customer?.email || 'No email';
};

// 9-category taxonomy for the change picker
const CATEGORIES = [
  { key: 'quote', label: 'Quote', dot: 'bg-amber-500' },
  { key: 'booking', label: 'Booking', dot: 'bg-blue-500' },
  { key: 'complaint', label: 'Complaint', dot: 'bg-red-500' },
  { key: 'follow_up', label: 'Follow-up', dot: 'bg-orange-500' },
  { key: 'inquiry', label: 'Enquiry', dot: 'bg-blue-400' },
  { key: 'notification', label: 'Notification', dot: 'bg-slate-500' },
  { key: 'newsletter', label: 'Newsletter', dot: 'bg-pink-500' },
  { key: 'spam', label: 'Spam', dot: 'bg-red-600' },
  { key: 'personal', label: 'Personal', dot: 'bg-purple-500' },
];

type AutomationLevel = 'auto' | 'draft_first' | 'always_review';
type TonePreference = 'keep_current' | 'more_formal' | 'more_brief' | 'more_friendly';

const REVIEW_PREFERENCES_KEY = 'bizzybee:review-teach-more-preferences';

function readReviewPreferences() {
  try {
    const raw = localStorage.getItem(REVIEW_PREFERENCES_KEY);
    return raw
      ? (JSON.parse(raw) as {
          automationLevel?: AutomationLevel;
          tonePreference?: TonePreference;
        })
      : {};
  } catch {
    return {};
  }
}

export default function Review() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { workspace, loading: workspaceLoading, needsOnboarding } = useWorkspace();
  const isPreviewMode = isPreviewModeEnabled();
  const onboardingPath = getPreviewAwarePath('/onboarding?reset=true');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showChangePicker, setShowChangePicker] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [selectedChangeCategory, setSelectedChangeCategory] = useState('');
  const [showDraftEditor, setShowDraftEditor] = useState(false);
  const [showCorrectionFlow, setShowCorrectionFlow] = useState(false);
  const savedPreferences = readReviewPreferences();
  const [automationLevel, setAutomationLevel] = useState<AutomationLevel>(
    savedPreferences.automationLevel ?? 'auto',
  );
  const [tonePreference, setTonePreference] = useState<TonePreference>(
    savedPreferences.tonePreference ?? 'keep_current',
  );
  const [confirmedToday, setConfirmedToday] = useState<Set<string>>(new Set());
  const [showConfirmedSection, setShowConfirmedSection] = useState(false);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [confirmFlashId, setConfirmFlashId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { celebrateConfirmation, celebratePatternLearned, celebrateQueueComplete } =
    useReviewFeedback();
  const shouldPersistSenderRulePreferences =
    automationLevel !== 'auto' || tonePreference !== 'keep_current';

  useEffect(() => {
    localStorage.setItem(
      REVIEW_PREFERENCES_KEY,
      JSON.stringify({
        automationLevel,
        tonePreference,
      }),
    );
  }, [automationLevel, tonePreference]);

  // Fetch ALL conversations that need reconciliation (training_reviewed = false)
  const {
    data: unreviewedQueue = [],
    isLoading,
    error: queueError,
    refetch: refetchQueue,
  } = useQuery({
    queryKey: ['reconciliation-queue', workspace?.id],
    enabled: !!workspace?.id && !needsOnboarding && !isPreviewMode,
    queryFn: async () => {
      if (!workspace?.id) return [];

      const { data, error } = await supabase
        .from('conversations')
        .select(
          `
          id, title, summary_for_human, decision_bucket, why_this_needs_you,
          triage_confidence, created_at, channel, email_classification,
          ai_draft_response, ai_reasoning, requires_reply, training_reviewed,
          customer:customers(name, email),
          messages(body, created_at, raw_payload, actor_name)
        `,
        )
        .eq('workspace_id', workspace.id)
        .eq('training_reviewed', false)
        .not('email_classification', 'is', null)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      return (data || []).map((c) => ({
        ...c,
        customer: c.customer?.[0] || null,
        messages: c.messages || [],
      })) as ReviewConversation[];
    },
    staleTime: 15000,
  });

  // Fetch recently confirmed today
  const { data: recentlyConfirmed = [], error: confirmedError } = useQuery({
    queryKey: ['reconciliation-confirmed-today', workspace?.id],
    enabled: !!workspace?.id && !needsOnboarding && !isPreviewMode,
    queryFn: async () => {
      if (!workspace?.id) return [];

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('conversations')
        .select(
          `
          id, title, summary_for_human, decision_bucket, triage_confidence,
          created_at, channel, email_classification, training_reviewed,
          training_reviewed_at,
          customer:customers(name, email),
          messages(body, created_at, raw_payload, actor_name)
        `,
        )
        .eq('workspace_id', workspace.id)
        .eq('training_reviewed', true)
        .gte('training_reviewed_at', todayStart.toISOString())
        .order('training_reviewed_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      return (data || []).map((c) => ({
        ...c,
        customer: c.customer?.[0] || null,
        messages: c.messages || [],
      })) as ReviewConversation[];
    },
    staleTime: 15000,
  });

  // Weekly stats
  const { data: weeklyStats, error: weeklyStatsError } = useQuery({
    queryKey: ['reconciliation-weekly-stats', workspace?.id],
    enabled: !!workspace?.id && !needsOnboarding && !isPreviewMode,
    queryFn: async () => {
      if (!workspace?.id) return null;

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      // Total processed this week
      const { count: totalProcessed } = await supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id)
        .not('email_classification', 'is', null)
        .gte('created_at', weekAgo.toISOString());

      // Auto-handled this week
      const { count: autoHandled } = await supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id)
        .eq('decision_bucket', 'auto_handled')
        .gte('created_at', weekAgo.toISOString());

      // Corrections this week
      const { count: corrections } = await supabase
        .from('triage_corrections')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id)
        .gte('created_at', weekAgo.toISOString());

      const total = totalProcessed || 0;
      const auto = autoHandled || 0;
      const corr = corrections || 0;
      const accuracy = total > 0 ? Math.round(((total - corr) / total) * 100) : 100;

      return {
        totalProcessed: total,
        autoHandled: auto,
        autoHandledPercent: total > 0 ? Math.round((auto / total) * 100) : 0,
        corrections: corr,
        accuracy,
      };
    },
    staleTime: 60000,
  });

  const totalToReview = unreviewedQueue.length;
  const confirmedTodayCount = confirmedToday.size + recentlyConfirmed.length;
  const totalItems = totalToReview + confirmedTodayCount;
  const progressPercent =
    totalItems > 0 ? Math.round((confirmedTodayCount / totalItems) * 100) : 100;
  const hasDraftReadyItems = unreviewedQueue.some((conversation) =>
    Boolean(conversation.ai_draft_response),
  );
  const trainingChecklist = [
    {
      label: 'Workspace connected',
      complete: Boolean(workspace?.id),
    },
    {
      label: 'Review queue available',
      complete: !isLoading && !queueError,
    },
    {
      label: 'Learning feedback has started',
      complete:
        confirmedTodayCount > 0 ||
        recentlyConfirmed.length > 0 ||
        Boolean((weeklyStats?.corrections ?? 0) > 0 || (weeklyStats?.totalProcessed ?? 0) > 0),
    },
    {
      label: 'AI draft assistance is available',
      complete: hasDraftReadyItems,
    },
  ];
  const nextTrainingStep =
    trainingChecklist.find((item) => !item.complete)?.label ?? 'Training module is ready';

  const currentConversation = unreviewedQueue[currentIndex] || null;

  // Confirm mutation
  const confirmMutation = useMutation({
    mutationFn: async ({
      conversationId,
      newCategory,
      reason,
    }: {
      conversationId: string;
      newCategory?: string;
      reason?: string;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      if (!workspace?.id) throw new Error('Workspace not loaded');

      const conv = unreviewedQueue.find((c) => c.id === conversationId);
      const senderEmail = conv?.customer?.email;
      const senderDomain = senderEmail?.split('@')[1];

      // Mark as reviewed
      const updates: Record<string, string | boolean> = {
        training_reviewed: true,
        training_reviewed_at: new Date().toISOString(),
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
        needs_review: false,
      };

      if (newCategory) {
        updates.email_classification = newCategory;
        updates.review_outcome = 'changed';
      } else {
        updates.review_outcome = 'confirmed';
      }

      const { error } = await supabase
        .from('conversations')
        .update(updates)
        .eq('id', conversationId);

      if (error) throw error;

      // If changed, log correction
      if (newCategory) {
        await supabase.from('triage_corrections').insert({
          workspace_id: workspace.id,
          conversation_id: conversationId,
          original_classification: conv?.email_classification,
          new_classification: newCategory,
          corrected_by: user.id,
          sender_email: senderEmail,
          sender_domain: senderDomain,
        });

        // Check for auto-rule creation (3+ corrections from same domain)
        if (senderDomain) {
          const { count } = await supabase
            .from('triage_corrections')
            .select('id', { count: 'exact', head: true })
            .eq('sender_domain', senderDomain)
            .eq('workspace_id', workspace.id);

          if (count && count >= 2) {
            const { data: existingRule } = await supabase
              .from('sender_rules')
              .select('id')
              .eq('sender_pattern', `@${senderDomain}`)
              .eq('workspace_id', workspace.id)
              .single();

            if (!existingRule) {
              await supabase.from('sender_rules').insert({
                workspace_id: workspace.id,
                sender_pattern: `@${senderDomain}`,
                default_classification: newCategory,
                skip_llm: true,
              });
              return { ruleCreated: true, domain: senderDomain, changed: true, newCategory };
            }
          }
        }
      }

      // Persist sender handling preferences when the operator intentionally changes them.
      if (senderDomain && shouldPersistSenderRulePreferences) {
        const { data: existingRule } = await supabase
          .from('sender_rules')
          .select('id')
          .eq('sender_pattern', `@${senderDomain}`)
          .eq('workspace_id', workspace.id)
          .single();

        if (existingRule) {
          await supabase
            .from('sender_rules')
            .update({
              automation_level: automationLevel,
              tone_preference: tonePreference,
            })
            .eq('id', existingRule.id);
        } else {
          await supabase.from('sender_rules').insert({
            workspace_id: workspace.id,
            sender_pattern: `@${senderDomain}`,
            automation_level: automationLevel,
            tone_preference: tonePreference,
            default_classification: newCategory || conv?.email_classification,
          });
        }
      }

      return { ruleCreated: false, changed: !!newCategory, newCategory };
    },
    onSuccess: (result, variables) => {
      // Flash green
      setConfirmFlashId(variables.conversationId);
      setTimeout(() => setConfirmFlashId(null), 600);

      // Track locally
      setConfirmedToday((prev) => new Set([...prev, variables.conversationId]));

      queryClient.invalidateQueries({ queryKey: ['reconciliation-queue', workspace?.id] });
      queryClient.invalidateQueries({
        queryKey: ['reconciliation-confirmed-today', workspace?.id],
      });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-weekly-stats', workspace?.id] });

      if (result.changed && result.newCategory) {
        const conv = unreviewedQueue.find((c) => c.id === variables.conversationId);
        const senderName = conv ? getSenderName(conv) : 'this sender';
        toast({
          title: 'Learned',
          description: `Future emails from ${senderName} will be classified as ${result.newCategory.replace(/_/g, ' ')}`,
          duration: 3000,
        });
      } else {
        celebrateConfirmation();
      }

      if (result.ruleCreated && result.domain) {
        celebratePatternLearned(result.domain);
      }

      // Reset state
      setShowChangePicker(false);
      setChangeReason('');
      setSelectedChangeCategory('');
      setAutomationLevel('auto');
      setTonePreference('keep_current');

      // Auto-advance
      const remaining = unreviewedQueue.filter(
        (c) => c.id !== variables.conversationId && !confirmedToday.has(c.id),
      );
      if (remaining.length === 0) {
        celebrateQueueComplete(confirmedTodayCount + 1);
      } else {
        setCurrentIndex((prev) => Math.min(prev, remaining.length - 1));
      }
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to save. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleConfirm = useCallback(() => {
    if (!currentConversation) return;
    confirmMutation.mutate({ conversationId: currentConversation.id });
  }, [currentConversation, confirmMutation]);

  const handleChange = useCallback(() => {
    if (!currentConversation || !selectedChangeCategory) return;
    confirmMutation.mutate({
      conversationId: currentConversation.id,
      newCategory: selectedChangeCategory,
      reason: changeReason,
    });
  }, [currentConversation, selectedChangeCategory, changeReason, confirmMutation]);

  const handleSkip = useCallback(() => {
    if (currentIndex < unreviewedQueue.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setShowChangePicker(false);
    }
  }, [currentIndex, unreviewedQueue.length]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case 'ArrowUp':
        case 'k':
          e.preventDefault();
          setCurrentIndex((prev) => Math.max(0, prev - 1));
          setShowChangePicker(false);
          break;
        case 'ArrowDown':
        case 'j':
          e.preventDefault();
          setCurrentIndex((prev) => Math.min(unreviewedQueue.length - 1, prev + 1));
          setShowChangePicker(false);
          break;
        case 'l':
          if (!showChangePicker && currentConversation) {
            e.preventDefault();
            handleConfirm();
          }
          break;
        case 'h':
          if (!showChangePicker) {
            e.preventDefault();
            setShowChangePicker(true);
          }
          break;
        case 's':
          e.preventDefault();
          handleSkip();
          break;
        case 'Escape':
          if (showChangePicker) {
            e.preventDefault();
            setShowChangePicker(false);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentConversation, handleConfirm, handleSkip, showChangePicker, unreviewedQueue.length]);

  // Sender patterns for selected conversation
  const selectedSenderDomain = currentConversation?.customer?.email?.split('@')[1];
  const senderEmailCount = selectedSenderDomain
    ? unreviewedQueue.filter((c) => c.customer?.email?.endsWith(`@${selectedSenderDomain}`)).length
    : 0;
  const senderClassifications = selectedSenderDomain
    ? unreviewedQueue
        .filter((c) => c.customer?.email?.endsWith(`@${selectedSenderDomain}`))
        .map((c) => c.email_classification)
        .filter(Boolean)
    : [];
  const dominantClassification =
    senderClassifications.length > 0
      ? senderClassifications.sort(
          (a, b) =>
            senderClassifications.filter((v) => v === b).length -
            senderClassifications.filter((v) => v === a).length,
        )[0]
      : null;

  // Confidence helpers
  const confidencePercent =
    currentConversation?.triage_confidence != null
      ? Math.round(currentConversation.triage_confidence * 100)
      : null;
  const confidenceColor =
    confidencePercent != null
      ? confidencePercent >= 90
        ? 'text-green-600'
        : confidencePercent >= 70
          ? 'text-amber-500'
          : 'text-red-500'
      : 'text-muted-foreground';
  const confidenceBarColor =
    confidencePercent != null
      ? confidencePercent >= 90
        ? 'bg-green-500'
        : confidencePercent >= 70
          ? 'bg-amber-500'
          : 'bg-red-500'
      : 'bg-muted';

  // All caught up state
  const allCaughtUp = !isLoading && unreviewedQueue.length === 0;
  const hasReviewError = Boolean(queueError || confirmedError || weeklyStatsError);
  const reviewErrorMessage =
    queueError instanceof Error
      ? queueError.message
      : confirmedError instanceof Error
        ? confirmedError.message
        : weeklyStatsError instanceof Error
          ? weeklyStatsError.message
          : 'BizzyBee could not load the review queue right now.';

  if (workspaceLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Sparkles className="h-5 w-5 animate-pulse text-bb-gold" />
          <span className="text-sm">Loading training workspace…</span>
        </div>
      </div>
    );
  }

  if (!workspace?.id || needsOnboarding) {
    return (
      <div className="flex h-screen bg-background">
        {!isMobile && <Sidebar />}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-xl">
            <PanelNotice
              title="Finish setup before reviewing training"
              description={
                !workspace?.id
                  ? 'BizzyBee needs a workspace and onboarding context before the training queue can load. Finish setup first, then come back here to teach the AI.'
                  : 'BizzyBee still needs your onboarding details before the training queue can load. Continue onboarding, then come back here to teach the AI.'
              }
              actionLabel="Open onboarding"
              actionTo={onboardingPath}
            />
          </div>
        </div>
      </div>
    );
  }

  if (isPreviewMode) {
    return (
      <div className="flex min-h-[100dvh] bg-background">
        {!isMobile && <Sidebar />}
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-xl">
            <PanelNotice
              title="Finish setup before reviewing training"
              description="This preview can open the Training module, but BizzyBee needs onboarding and a real workspace before the review queue can load."
              actionLabel="Open onboarding"
              actionTo={onboardingPath}
            />
          </div>
        </div>
      </div>
    );
  }

  if (hasReviewError) {
    return (
      <div className="flex h-screen bg-background">
        {!isMobile && <Sidebar />}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-xl">
            <PanelNotice
              title="Review queue unavailable"
              description={reviewErrorMessage}
              action={
                <Button size="sm" variant="outline" onClick={() => void refetchQueue()}>
                  Try again
                </Button>
              }
            />
          </div>
        </div>
      </div>
    );
  }

  // ============ MOBILE ============
  if (isMobile) {
    if (allCaughtUp) {
      return (
        <div className="flex flex-col h-screen bg-background overflow-hidden">
          <MobileHeader onMenuClick={() => setSidebarOpen(true)} />
          <MobileSidebarSheet
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            onNavigate={() => setSidebarOpen(false)}
          />
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center max-w-xs">
              <div className="w-16 h-16 bg-gradient-to-br from-green-100 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <PartyPopper className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-lg font-semibold mb-2">All caught up!</h2>
              <p className="text-sm text-muted-foreground">
                BizzyBee classified {weeklyStats?.totalProcessed || 0} emails with{' '}
                {weeklyStats?.accuracy || 100}% accuracy this week.
              </p>
            </div>
          </div>
        </div>
      );
    }

    const conv = currentConversation;
    const rawEmailBody = conv?.messages?.[0]?.raw_payload?.body || conv?.messages?.[0]?.body || '';
    const emailBody = cleanEmailContent(stripHtml(rawEmailBody));

    if (mobileShowDetail && conv) {
      return (
        <div className="flex flex-col h-screen bg-background overflow-hidden">
          <MobileHeader
            onMenuClick={() => setSidebarOpen(true)}
            showBackButton
            onBackClick={() => setMobileShowDetail(false)}
            backToText="Back"
          />
          <MobileSidebarSheet
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            onNavigate={() => setSidebarOpen(false)}
          />
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-4">
              <div>
                <h2 className="font-semibold text-base">{getSenderName(conv)}</h2>
                <p className="text-xs text-muted-foreground">{getSenderEmail(conv)}</p>
              </div>
              <div>
                <h3 className="font-medium text-sm">{conv.title}</h3>
              </div>
              <Card className="p-3">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">
                  {emailBody}
                </p>
              </Card>
              {conv.email_classification && (
                <div className="flex items-center gap-2">
                  <CategoryLabel classification={conv.email_classification} size="md" />
                  {confidencePercent != null && (
                    <span className={cn('text-sm font-semibold', confidenceColor)}>
                      {confidencePercent}%
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex-shrink-0 border-t bg-background p-4 space-y-2">
            <Button
              className="w-full h-12 bg-purple-600 hover:bg-purple-700 text-white text-base font-semibold shadow-sm rounded-lg"
              onClick={handleConfirm}
              disabled={confirmMutation.isPending}
            >
              <Check className="h-5 w-5 mr-2" />
              Confirm Correct
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 bg-white border border-amber-200 text-amber-700 hover:bg-amber-50 shadow-sm rounded-lg"
                onClick={() => setShowChangePicker(true)}
              >
                <Pencil className="h-4 w-4 mr-1.5" />
                Change
              </Button>
              <Button variant="ghost" className="text-muted-foreground" onClick={handleSkip}>
                <SkipForward className="h-4 w-4 mr-1.5" />
                Skip
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // Mobile List
    return (
      <div className="flex flex-col h-screen bg-background overflow-hidden">
        <MobileHeader onMenuClick={() => setSidebarOpen(true)} />
        <MobileSidebarSheet
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          onNavigate={() => setSidebarOpen(false)}
        />
        <div className="px-4 py-3 border-b bg-card/50 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-base font-semibold">AI Reconciliation</h1>
            <span className="text-xs text-muted-foreground">
              {confirmedTodayCount} of {totalItems} reconciled
            </span>
          </div>
          <Progress value={progressPercent} className="h-2 [&>div]:bg-purple-600" />
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="p-3 space-y-2">
            {unreviewedQueue.map((conv, idx) => {
              const conf =
                conv.triage_confidence != null ? Math.round(conv.triage_confidence * 100) : null;
              const confColor =
                conf != null
                  ? conf >= 90
                    ? 'text-green-600'
                    : conf >= 70
                      ? 'text-amber-500'
                      : 'text-red-500'
                  : '';
              return (
                <Card
                  key={conv.id}
                  className="p-3 cursor-pointer transition-all active:scale-[0.98]"
                  onClick={() => {
                    setCurrentIndex(idx);
                    setMobileShowDetail(true);
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-semibold text-primary">
                        {getSenderName(conv)[0]?.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{getSenderName(conv)}</p>
                      <p className="text-xs text-muted-foreground truncate">{conv.title}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {conv.email_classification && (
                        <CategoryLabel
                          classification={conv.email_classification}
                          size="xs"
                          showIcon={false}
                        />
                      )}
                      {conf != null && (
                        <span className={cn('text-xs font-bold', confColor)}>{conf}%</span>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ============ DESKTOP — ALL CAUGHT UP ============
  if (allCaughtUp) {
    return (
      <div className="flex h-screen bg-slate-50/50">
        <Sidebar />
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-center max-w-md px-6 animate-fade-in">
            <div className="w-24 h-24 bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-full flex items-center justify-center mx-auto mb-6 ring-8 ring-emerald-50/50">
              <Sparkles className="w-10 h-10 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              You're all caught up!
            </h2>
            <p className="text-muted-foreground mb-6">
              BizzyBee classified <strong>{weeklyStats?.totalProcessed || 0}</strong> emails with{' '}
              <strong className="text-purple-600">{weeklyStats?.accuracy || 100}%</strong> accuracy
              this week.
            </p>

            {weeklyStats && (
              <div className="grid grid-cols-2 gap-3 text-left mb-6">
                <Card className="p-4 bg-card">
                  <p className="text-2xl font-bold">{weeklyStats.totalProcessed}</p>
                  <p className="text-xs text-muted-foreground">Emails processed</p>
                </Card>
                <Card className="p-4 bg-card">
                  <p className="text-2xl font-bold text-green-600">{weeklyStats.autoHandled}</p>
                  <p className="text-xs text-muted-foreground">
                    Auto-handled ({weeklyStats.autoHandledPercent}%)
                  </p>
                </Card>
                <Card className="p-4 bg-card">
                  <p className="text-2xl font-bold text-amber-600">{weeklyStats.corrections}</p>
                  <p className="text-xs text-muted-foreground">Your corrections</p>
                </Card>
                <Card className="p-4 bg-card">
                  <div className="flex items-center gap-2">
                    <p className="text-2xl font-bold text-green-600">{weeklyStats.accuracy}%</p>
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  </div>
                  <p className="text-xs text-muted-foreground">Current accuracy</p>
                </Card>
              </div>
            )}

            <Button variant="outline" onClick={() => navigate('/')}>
              Back to Inbox
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ============ DESKTOP — 3-COLUMN RECONCILIATION ============
  const selectedEmailBody = currentConversation
    ? cleanEmailContent(
        stripHtml(
          currentConversation.messages?.[0]?.raw_payload?.body ||
            currentConversation.messages?.[0]?.body ||
            '',
        ),
      )
    : '';

  return (
    <div className="flex h-screen bg-slate-50/50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="px-6 py-2.5 flex-shrink-0 flex items-center justify-between bg-white/80 backdrop-blur-sm border-b border-slate-100">
          <div className="flex items-center gap-3">
            <BackButton to="/" label="Home" />
            <h1 className="text-base font-semibold">AI Reconciliation</h1>
            <Sparkles className="h-4 w-4 text-purple-500" />
          </div>
          <div className="flex items-center gap-4">
            {weeklyStats && (
              <div className="flex items-center gap-1.5 text-sm">
                <Trophy className="h-3.5 w-3.5 text-purple-500" />
                <span className="text-muted-foreground">Accuracy:</span>
                <span className="font-bold text-purple-600">{weeklyStats.accuracy}%</span>
                <span className="text-muted-foreground text-xs">this week</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                <strong className="text-purple-600">{confirmedTodayCount}</strong> of{' '}
                <strong>{totalItems}</strong> reconciled
              </span>
              <div className="w-24">
                <Progress value={progressPercent} className="h-2 [&>div]:bg-purple-600" />
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 pt-4">
          <Card className="border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Training readiness
                </p>
                <h2 className="text-sm font-medium text-slate-900">
                  AI reconciliation control center
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  Training should feel like a managed workflow: clear queue health, clear learning
                  progress, and a visible next step for the team.
                </p>
              </div>
              <Badge
                variant="outline"
                className={
                  trainingChecklist.every((item) => item.complete)
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
                }
              >
                {trainingChecklist.filter((item) => item.complete).length}/
                {trainingChecklist.length} ready
              </Badge>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {trainingChecklist.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3"
                >
                  <span className="text-sm text-slate-700">{item.label}</span>
                  <Badge
                    className={
                      item.complete
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                        : 'border-slate-200 bg-white text-slate-500 hover:bg-white'
                    }
                  >
                    {item.complete ? 'Ready' : 'Pending'}
                  </Badge>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-sm font-medium text-slate-900">Next training step</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {nextTrainingStep === 'Training module is ready'
                  ? 'Training now has a strong workflow foundation. The next gains come from ongoing accuracy improvements and deeper operator feedback.'
                  : `${nextTrainingStep} is the next blocker before Training feels fully production-ready.`}
              </p>
            </div>
          </Card>
        </div>

        {/* 3-Column Layout */}
        <div className="flex-1 flex overflow-hidden gap-4 p-4 pt-4">
          {/* Column 1: Reconciliation Queue (350px) */}
          <div className="w-[350px] min-w-[350px] flex-shrink-0 flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100">
              <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                Reconciliation Queue
              </span>
            </div>

            <ScrollArea className="flex-1">
              {/* To Review section */}
              {unreviewedQueue.length > 0 && (
                <>
                  <div className="px-3 py-1.5 bg-purple-50/80 border-b border-slate-100 sticky top-0 z-10">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-400">
                      To Review ({unreviewedQueue.length})
                    </span>
                  </div>
                  {unreviewedQueue.map((conv, idx) => {
                    const conf =
                      conv.triage_confidence != null
                        ? Math.round(conv.triage_confidence * 100)
                        : null;
                    const confColor =
                      conf != null
                        ? conf >= 90
                          ? 'text-green-600'
                          : conf >= 70
                            ? 'text-amber-500'
                            : 'text-red-500'
                        : '';
                    const isFlashing = confirmFlashId === conv.id;

                    return (
                      <div
                        key={conv.id}
                        onClick={() => {
                          setCurrentIndex(idx);
                          setShowChangePicker(false);
                        }}
                        className={cn(
                          'px-3 py-2.5 cursor-pointer border-b border-slate-100 transition-all',
                          'hover:bg-slate-50',
                          idx === currentIndex &&
                            'bg-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] ring-1 ring-slate-900/5',
                          isFlashing &&
                            'bg-green-100 dark:bg-green-900/40 transition-colors duration-300',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-bold text-primary">
                              {getSenderName(conv)[0]?.toUpperCase() || '?'}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className={cn('text-sm truncate block font-semibold')}>
                              {getSenderName(conv)}
                            </span>
                          </div>
                          {conf != null && (
                            <span
                              className={cn(
                                'text-[11px] font-bold flex-shrink-0 tabular-nums',
                                confColor,
                              )}
                            >
                              {conf}%
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 pl-9">
                          <p className="text-xs text-muted-foreground truncate flex-1">
                            {conv.title || 'No subject'}
                          </p>
                          {conv.email_classification && (
                            <CategoryLabel
                              classification={conv.email_classification}
                              size="xs"
                              showIcon={false}
                            />
                          )}
                          {conv.decision_bucket && (
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] px-1.5 py-0 h-4 font-semibold uppercase tracking-wider rounded-md border flex-shrink-0',
                                conv.decision_bucket === 'act_now' &&
                                  'bg-red-50 text-red-600 border-red-200',
                                conv.decision_bucket === 'quick_win' &&
                                  conv.ai_draft_response &&
                                  'bg-purple-50 text-purple-700 border-purple-100',
                                conv.decision_bucket === 'quick_win' &&
                                  !conv.ai_draft_response &&
                                  'bg-amber-50 text-amber-600 border-amber-200',
                                conv.decision_bucket === 'wait' &&
                                  'bg-slate-100 text-slate-600 border-slate-200',
                                conv.decision_bucket === 'auto_handled' &&
                                  'bg-slate-100 text-slate-600 border-slate-200',
                              )}
                            >
                              {conv.decision_bucket === 'act_now' && 'Urgent'}
                              {conv.decision_bucket === 'quick_win' &&
                                conv.ai_draft_response &&
                                'Draft ready'}
                              {conv.decision_bucket === 'quick_win' &&
                                !conv.ai_draft_response &&
                                'Needs reply'}
                              {conv.decision_bucket === 'wait' && 'FYI'}
                              {conv.decision_bucket === 'auto_handled' && 'Auto-handled'}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {/* Confirmed Today section (collapsed) */}
              {recentlyConfirmed.length > 0 && (
                <Collapsible open={showConfirmedSection} onOpenChange={setShowConfirmedSection}>
                  <CollapsibleTrigger asChild>
                    <button className="w-full px-3 py-1.5 bg-slate-50 border-b border-t border-slate-100 flex items-center justify-between sticky top-0 z-10 hover:bg-slate-100 transition-colors">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                        Confirmed ({recentlyConfirmed.length})
                      </span>
                      {showConfirmedSection ? (
                        <ChevronDown className="h-3 w-3 text-slate-500" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-slate-500" />
                      )}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {recentlyConfirmed.map((conv) => (
                      <div key={conv.id} className="px-3 py-2 border-b border-border/30 opacity-60">
                        <div className="flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                          <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-semibold text-muted-foreground">
                              {getSenderName(conv)[0]?.toUpperCase()}
                            </span>
                          </div>
                          <span className="text-xs truncate flex-1 text-muted-foreground">
                            {getSenderName(conv)}
                          </span>
                          {conv.email_classification && (
                            <CategoryLabel
                              classification={conv.email_classification}
                              size="xs"
                              showIcon={false}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}

              {unreviewedQueue.length === 0 && recentlyConfirmed.length === 0 && !isLoading && (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  No emails to reconcile
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Column 2: Email Preview + AI Reasoning (flex) */}
          <div className="flex-1 flex flex-col overflow-hidden bg-white rounded-2xl shadow-sm border border-slate-200">
            {currentConversation ? (
              <div className="flex-1 flex flex-col overflow-y-auto">
                {/* Sender row */}
                <div className="px-6 py-4 border-b flex items-start justify-between flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary">
                        {getSenderName(currentConversation)[0]?.toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold">{getSenderName(currentConversation)}</p>
                      <p className="text-xs text-muted-foreground">
                        {getSenderEmail(currentConversation)}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(currentConversation.created_at), 'MMM d, h:mm a')}
                  </span>
                </div>

                {/* AI context bento strip */}
                <div className="mx-6 mt-4 mb-2 p-4 bg-gradient-to-r from-amber-50/60 via-purple-50/40 to-blue-50/40 rounded-2xl border border-white/60 shadow-sm ring-1 ring-slate-900/5 flex items-center gap-3 flex-wrap flex-shrink-0">
                  {currentConversation.summary_for_human && (
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <Sparkles className="h-4 w-4 text-amber-600 shrink-0" />
                      <span className="text-sm font-medium text-slate-700 line-clamp-2">
                        {currentConversation.summary_for_human}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
                    {currentConversation.email_classification && (
                      <CategoryLabel
                        classification={currentConversation.email_classification}
                        size="sm"
                      />
                    )}
                  </div>
                </div>

                {/* Subject */}
                <div className="px-6 pt-4 pb-2 flex-shrink-0">
                  <h2 className="text-lg font-semibold">
                    {currentConversation.title || 'No subject'}
                  </h2>
                </div>

                {/* Email body */}
                <div className="flex-1 px-6 pb-4 overflow-y-auto">
                  <EmailPreview
                    body={currentConversation.messages[0]?.body || ''}
                    summary={currentConversation.summary_for_human}
                    maxLength={2000}
                    rawHtmlBody={
                      (currentConversation.messages[0]?.raw_payload as { body?: string })?.body
                    }
                  />

                  {/* AI Draft */}
                  {currentConversation.ai_draft_response && (
                    <div className="bg-purple-50/50 dark:bg-purple-900/20 rounded-lg p-4 ring-1 ring-purple-200/50 mb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-purple-600" />
                          <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                            AI draft ready
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5 bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm rounded-lg"
                          onClick={() => setShowDraftEditor(true)}
                        >
                          <Send className="h-3 w-3" />
                          Edit & Send
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                        {currentConversation.ai_draft_response.substring(0, 200)}...
                      </p>
                    </div>
                  )}

                  {/* AI Reasoning card */}
                  <div className="mt-4 bg-purple-50/50 border border-purple-100/50 rounded-2xl p-5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Bot className="h-3.5 w-3.5 text-purple-500" />
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        AI Reasoning
                      </span>
                    </div>
                    <p className="text-sm text-foreground/80 leading-relaxed">
                      {currentConversation.why_this_needs_you ||
                        currentConversation.ai_reasoning || (
                          <>
                            Classified as{' '}
                            <strong className="capitalize">
                              {currentConversation.email_classification?.replace(/_/g, ' ')}
                            </strong>
                            {currentConversation.requires_reply
                              ? ' — this email needs a reply.'
                              : ' — no reply needed, auto-handled.'}
                            {confidencePercent != null && (
                              <>
                                {' '}
                                Confidence:{' '}
                                <span className={cn('font-semibold', confidenceColor)}>
                                  {confidencePercent}%
                                </span>
                                .
                              </>
                            )}
                          </>
                        )}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center max-w-xs">
                  <Sparkles className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Select an email from the queue to preview
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Column 3: Reconciliation Panel (300px) */}
          <div className="w-[300px] min-w-[300px] flex-shrink-0 flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            {currentConversation ? (
              <div className="flex-1 flex flex-col overflow-y-auto">
                {/* The Verdict */}
                <div className="p-4 border-b space-y-3">
                  {/* Large category badge */}
                  <div className="flex justify-center">
                    {currentConversation.email_classification && (
                      <CategoryLabel
                        classification={currentConversation.email_classification}
                        size="md"
                      />
                    )}
                  </div>

                  {/* Confidence bar */}
                  {confidencePercent != null && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Confidence</span>
                        <span className={cn('font-bold text-sm', confidenceColor)}>
                          {confidencePercent}%
                        </span>
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden mt-3">
                        <div
                          className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-700 ease-out"
                          style={{ width: `${confidencePercent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Decision badge */}
                  <div className="flex justify-center">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs',
                        currentConversation.decision_bucket === 'auto_handled' ||
                          !currentConversation.requires_reply
                          ? 'border-green-300 text-green-700 bg-green-50 dark:bg-green-900/20 dark:text-green-400'
                          : currentConversation.decision_bucket === 'act_now'
                            ? 'border-red-300 text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-400'
                            : 'border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400',
                      )}
                    >
                      {currentConversation.decision_bucket === 'auto_handled' ||
                      !currentConversation.requires_reply
                        ? 'Auto-handled'
                        : currentConversation.decision_bucket === 'act_now'
                          ? 'Escalated'
                          : 'Needs Reply'}
                    </Badge>
                  </div>
                </div>

                {/* Quick Actions — The reconciliation buttons */}
                <div className="p-4 border-b space-y-3">
                  {!showChangePicker ? (
                    <>
                      <div className="grid grid-cols-2 gap-3 mt-4">
                        {/* CONFIRM — the hero button */}
                        <Button
                          className="h-11 bg-purple-600 hover:bg-purple-700 text-white font-medium shadow-sm rounded-xl"
                          onClick={handleConfirm}
                          disabled={confirmMutation.isPending}
                        >
                          <Check className="h-5 w-5 mr-2" />
                          Confirm
                        </Button>

                        {/* CHANGE */}
                        <Button
                          variant="outline"
                          className="h-11 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm rounded-xl font-medium"
                          onClick={() => setShowChangePicker(true)}
                          disabled={confirmMutation.isPending}
                        >
                          <Pencil className="h-4 w-4 mr-1.5" />
                          Change
                        </Button>
                      </div>

                      {/* SKIP */}
                      {currentIndex < unreviewedQueue.length - 1 && (
                        <button
                          className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                          onClick={handleSkip}
                        >
                          Skip ·{' '}
                          <kbd className="bg-muted rounded px-1 py-0.5 font-mono text-[10px]">
                            S
                          </kbd>
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                        Select correct category:
                      </p>
                      <div className="grid grid-cols-1 gap-1">
                        {CATEGORIES.map((cat) => (
                          <button
                            key={cat.key}
                            onClick={() => setSelectedChangeCategory(cat.key)}
                            className={cn(
                              'flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left transition-all',
                              selectedChangeCategory === cat.key
                                ? 'bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 font-semibold'
                                : 'hover:bg-muted/50 border border-transparent',
                            )}
                          >
                            <span
                              className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', cat.dot)}
                            />
                            {cat.label}
                          </button>
                        ))}
                      </div>

                      {selectedChangeCategory && (
                        <div className="space-y-2 pt-2">
                          <Textarea
                            placeholder="Why? (optional)"
                            value={changeReason}
                            onChange={(e) => setChangeReason(e.target.value)}
                            className="h-16 text-xs resize-none"
                          />
                          <Button
                            className="w-full bg-purple-600 hover:bg-purple-700 text-white shadow-sm rounded-lg"
                            onClick={handleChange}
                            disabled={confirmMutation.isPending}
                          >
                            Save Correction
                          </Button>
                        </div>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => {
                          setShowChangePicker(false);
                          setSelectedChangeCategory('');
                          setChangeReason('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>

                {/* Sender Patterns */}
                {selectedSenderDomain && (
                  <div className="p-4 border-b space-y-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Sender Patterns
                    </span>
                    <p className="text-xs text-foreground/80">
                      <strong>{senderEmailCount}</strong> email{senderEmailCount !== 1 ? 's' : ''}{' '}
                      from <span className="font-medium text-primary">@{selectedSenderDomain}</span>
                      {dominantClassification && (
                        <>
                          {' '}
                          — all{' '}
                          <CategoryLabel
                            classification={dominantClassification}
                            size="xs"
                            showIcon={false}
                            className="inline ml-1"
                          />
                        </>
                      )}
                    </p>
                  </div>
                )}

                {/* Teach More (always visible) */}
                <div className="border-b">
                  <div className="px-4 py-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    Teach more (optional)
                  </div>
                  <div className="px-4 pb-3 space-y-3">
                    <div className="space-y-2">
                      <span className="text-xs font-medium text-slate-700">
                        Handle all from this sender:
                      </span>
                      <div className="space-y-2">
                        {[
                          {
                            value: 'auto',
                            label: 'Auto-handle',
                            icon: <Bot className="h-3.5 w-3.5 text-green-500" />,
                          },
                          {
                            value: 'draft_first',
                            label: 'Draft first',
                            icon: <FileEdit className="h-3.5 w-3.5 text-amber-500" />,
                          },
                          {
                            value: 'always_review',
                            label: 'Always review',
                            icon: <Eye className="h-3.5 w-3.5 text-blue-500" />,
                          },
                        ].map((opt) => (
                          <label
                            key={opt.value}
                            className={cn(
                              'flex items-center gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-all text-sm font-medium text-slate-700',
                              automationLevel === opt.value &&
                                'border-purple-500 bg-purple-50 ring-1 ring-purple-200',
                            )}
                            onClick={() => setAutomationLevel(opt.value as AutomationLevel)}
                          >
                            <input
                              type="radio"
                              name="automation"
                              value={opt.value}
                              checked={automationLevel === opt.value}
                              onChange={() => setAutomationLevel(opt.value as AutomationLevel)}
                              className="sr-only"
                            />
                            {opt.icon}
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2 pt-2 border-t border-border/50">
                      <span className="text-xs font-medium text-slate-700">Tone for replies:</span>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: 'keep_current', label: 'Keep' },
                          { value: 'more_formal', label: 'Formal' },
                          { value: 'more_brief', label: 'Brief' },
                          { value: 'more_friendly', label: 'Friendly' },
                        ].map((opt) => (
                          <label
                            key={opt.value}
                            className={cn(
                              'px-3 py-2 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-all text-xs font-medium text-slate-700',
                              tonePreference === opt.value &&
                                'border-purple-500 bg-purple-50 ring-1 ring-purple-200',
                            )}
                            onClick={() => setTonePreference(opt.value as TonePreference)}
                          >
                            <input
                              type="radio"
                              name="tone"
                              value={opt.value}
                              checked={tonePreference === opt.value}
                              onChange={() => setTonePreference(opt.value as TonePreference)}
                              className="sr-only"
                            />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Keyboard shortcuts */}
                <div className="mt-auto p-3 border-t bg-muted/20">
                  <div className="flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
                    <span>
                      <kbd className="bg-card border border-border rounded px-1 py-0.5 font-mono shadow-sm">
                        ↑↓
                      </kbd>{' '}
                      nav
                    </span>
                    <span>
                      <kbd className="bg-card border border-border rounded px-1 py-0.5 font-mono shadow-sm">
                        L
                      </kbd>{' '}
                      confirm
                    </span>
                    <span>
                      <kbd className="bg-card border border-border rounded px-1 py-0.5 font-mono shadow-sm">
                        H
                      </kbd>{' '}
                      change
                    </span>
                    <span>
                      <kbd className="bg-card border border-border rounded px-1 py-0.5 font-mono shadow-sm">
                        S
                      </kbd>{' '}
                      skip
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-6">
                <p className="text-xs text-muted-foreground text-center">
                  Select an email to reconcile
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Draft Reply Editor Sheet */}
      {currentConversation?.ai_draft_response && (
        <DraftReplyEditor
          open={showDraftEditor}
          onOpenChange={setShowDraftEditor}
          conversationId={currentConversation.id}
          conversationTitle={currentConversation.title || 'No subject'}
          customerEmail={currentConversation.customer?.email || ''}
          aiDraft={currentConversation.ai_draft_response}
          onSent={() => {
            handleConfirm();
          }}
        />
      )}

      {/* Classification Correction Dialog */}
      {currentConversation && (
        <TriageCorrectionFlow
          conversation={
            {
              id: currentConversation.id,
              title: currentConversation.title,
              channel: currentConversation.channel || 'email',
              email_classification: currentConversation.email_classification,
              requires_reply: currentConversation.requires_reply,
              customer: currentConversation.customer,
            } as unknown as Conversation
          }
          open={showCorrectionFlow}
          onOpenChange={setShowCorrectionFlow}
          onUpdate={() => {
            queryClient.invalidateQueries({ queryKey: ['reconciliation-queue', workspace?.id] });
          }}
        />
      )}
    </div>
  );
}
