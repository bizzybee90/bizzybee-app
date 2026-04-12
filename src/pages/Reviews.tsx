import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Bell,
  CircleAlert,
  CheckCircle2,
  Loader2,
  MapPin,
  MessageSquare,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Star,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { MetricPillCard } from '@/components/shared/MetricPillCard';
import { PanelNotice } from '@/components/settings/PanelNotice';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import {
  CHANNEL_DEFINITIONS,
  deriveChannelConnectionState,
  getChannelConnectionLabel,
  getChannelSetupHref,
  type WorkspaceChannelRecord,
} from '@/lib/channels';
import {
  REVIEW_CONFIG_FIELDS,
  buildReviewActivityFeed,
  buildReviewAlertFeed,
  filterReviewInbox,
  getReviewAlertPolicy,
  getReviewAlertSummary,
  getReviewStatusLabel,
  REVIEW_INBOX_FILTERS,
  REVIEW_METRICS,
  REVIEW_PROVIDER_DEFINITIONS,
  type ReviewAlertPolicy,
  type ReviewInboxFilterKey,
  type ReviewPreviewRecord,
  deriveReviewConnectionState,
  getReviewAttentionLevel,
  getReviewSetupActionLabel,
  getReviewSetupDescription,
  summarizeReviewLocations,
} from '@/lib/reviews';

interface NotificationPreferenceRow {
  summary_enabled: boolean | null;
  summary_channels: string[] | null;
  summary_times: string[] | null;
}

interface ReviewConnectionDraft {
  accountRef: string;
  locationRef: string;
  placeId: string;
  placeLabel: string;
}

interface ReviewSyncPreviewRun {
  id: string;
  status: 'queued' | 'running' | 'success' | 'attention_required';
  startedAt: string;
  completedAt: string;
  detail: string;
}

interface ReviewLocationRecord {
  id: string;
  provider_location_ref: string | null;
  provider_account_ref: string | null;
  place_id: string | null;
  name: string | null;
  address: string | null;
  is_primary: boolean | null;
  avg_rating_cached: number | null;
  review_count_cached: number | null;
  last_synced_at: string | null;
  sync_status: string | null;
  last_error: string | null;
}

interface PlacePrediction {
  description: string;
  place_id: string;
  original?: string;
}

const REVIEW_LOCATION_PRESETS = [
  {
    name: 'MAC Cleaning - St Albans',
    accountRef: 'accounts/100200300',
    locationRef: 'locations/200300400',
    placeId: 'ChIJ7d3x0k8LdkgR4I3Q9x6nStA',
  },
  {
    name: 'MAC Cleaning - Harpenden',
    accountRef: 'accounts/100200300',
    locationRef: 'locations/200300401',
    placeId: 'ChIJn6qv0aYMdkgR2dR8x7uHarp',
  },
];

const REVIEW_OWNER_OPTIONS = ['Michael', 'BizzyBee Ops', 'MAC CS Lead'] as const;

function ReviewsPageContent() {
  const [searchParams] = useSearchParams();
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [googleBusinessChannel, setGoogleBusinessChannel] = useState<WorkspaceChannelRecord | null>(
    null,
  );
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferenceRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [savingConnection, setSavingConnection] = useState(false);
  const [savingAlertPolicy, setSavingAlertPolicy] = useState(false);
  const [runningPreviewSync, setRunningPreviewSync] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<ReviewInboxFilterKey>('all');
  const [previewReviewState, setPreviewReviewState] = useState<ReviewPreviewRecord[]>([]);
  const [previewSyncRuns, setPreviewSyncRuns] = useState<ReviewSyncPreviewRun[]>([]);
  const [reviewLocations, setReviewLocations] = useState<ReviewLocationRecord[]>([]);
  const [reviewDataError, setReviewDataError] = useState<string | null>(null);
  const [reviewConnectionDraft, setReviewConnectionDraft] = useState<ReviewConnectionDraft>({
    accountRef: '',
    locationRef: '',
    placeId: '',
    placeLabel: '',
  });
  const [reviewAlertPolicyDraft, setReviewAlertPolicyDraft] = useState<ReviewAlertPolicy>({
    alertsEnabled: true,
    notifyOnEveryNewReview: false,
    lowRatingThreshold: 3,
    staleReviewHours: 24,
  });
  const [placeSearchQuery, setPlaceSearchQuery] = useState('');
  const [placePredictions, setPlacePredictions] = useState<PlacePrediction[]>([]);
  const [placeSearchError, setPlaceSearchError] = useState<string | null>(null);
  const [placeSearchProvider, setPlaceSearchProvider] = useState<string | null>(null);
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const draftSaveTimers = useRef<Record<string, number>>({});

  const isPreview = workspace?.id === 'preview-workspace';

  useEffect(() => {
    const fetchReviewsFoundation = async () => {
      if (!workspace?.id || isPreview) {
        setGoogleBusinessChannel(null);
        setNotificationPreferences(null);
        setFetchError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setFetchError(null);

      try {
        const [{ data: channelData, error: channelError }, { data: prefsData, error: prefsError }] =
          await Promise.all([
            supabase
              .from('workspace_channels')
              .select('id, channel, enabled, automation_level, config')
              .eq('workspace_id', workspace.id)
              .eq('channel', 'google_business')
              .maybeSingle(),
            supabase
              .from('notification_preferences')
              .select('summary_enabled, summary_channels, summary_times')
              .eq('workspace_id', workspace.id)
              .maybeSingle(),
          ]);

        if (channelError) {
          throw channelError;
        }

        if (prefsError) {
          throw prefsError;
        }

        setGoogleBusinessChannel(channelData as WorkspaceChannelRecord | null);
        setNotificationPreferences(prefsData as NotificationPreferenceRow | null);
      } catch (error) {
        console.error('Failed to load review foundation:', error);
        setFetchError('Failed to load review setup. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    void fetchReviewsFoundation();
  }, [workspace?.id, isPreview]);

  const googleChannelDefinition = CHANNEL_DEFINITIONS.google_business;
  const googleReviewDefinition = REVIEW_PROVIDER_DEFINITIONS.google;
  const reviewSetupRequested = searchParams.get('setup') === 'google';

  const googleBusinessMessageState = useMemo(
    () => deriveChannelConnectionState(googleChannelDefinition, googleBusinessChannel, []),
    [googleBusinessChannel, googleChannelDefinition],
  );

  const googleBusinessConfig =
    googleBusinessChannel?.config && typeof googleBusinessChannel.config === 'object'
      ? (googleBusinessChannel.config as Record<string, unknown>)
      : null;
  const reviewConnectionConfig = useMemo(
    () => ({
      accountRef:
        typeof googleBusinessConfig?.reviewAccountRef === 'string'
          ? googleBusinessConfig.reviewAccountRef
          : '',
      locationRef:
        typeof googleBusinessConfig?.reviewLocationRef === 'string'
          ? googleBusinessConfig.reviewLocationRef
          : '',
      placeId:
        typeof googleBusinessConfig?.placeId === 'string' ? googleBusinessConfig.placeId : '',
      placeLabel:
        typeof googleBusinessConfig?.reviewPlaceLabel === 'string'
          ? googleBusinessConfig.reviewPlaceLabel
          : '',
    }),
    [googleBusinessConfig],
  );
  const reviewAlertPolicy = useMemo(
    () => getReviewAlertPolicy(googleBusinessConfig),
    [googleBusinessConfig],
  );
  const googleReviewState = useMemo(() => {
    const provisionalLocations = reviewConnectionConfig.locationRef
      ? [{ provider_location_ref: reviewConnectionConfig.locationRef }]
      : [];

    return deriveReviewConnectionState(
      'google',
      googleBusinessChannel
        ? {
            provider: 'google',
            status: null,
            config: reviewConnectionConfig,
          }
        : undefined,
      provisionalLocations,
    );
  }, [googleBusinessChannel, reviewConnectionConfig]);
  const hasGooglePlaceId =
    typeof googleBusinessConfig?.placeId === 'string' &&
    googleBusinessConfig.placeId.trim().length > 0;
  const summaryChannels = notificationPreferences?.summary_channels ?? [];
  const alertsEnabled = notificationPreferences?.summary_enabled ?? false;
  const reviewAlertChannels =
    summaryChannels.length > 0 ? summaryChannels.join(', ') : 'in-app notifications';
  const isConnectionDraftDirty =
    reviewConnectionDraft.accountRef !== reviewConnectionConfig.accountRef ||
    reviewConnectionDraft.locationRef !== reviewConnectionConfig.locationRef ||
    reviewConnectionDraft.placeId !== reviewConnectionConfig.placeId ||
    reviewConnectionDraft.placeLabel !== reviewConnectionConfig.placeLabel;
  const isReviewAlertPolicyDirty =
    reviewAlertPolicyDraft.alertsEnabled !== reviewAlertPolicy.alertsEnabled ||
    reviewAlertPolicyDraft.notifyOnEveryNewReview !== reviewAlertPolicy.notifyOnEveryNewReview ||
    reviewAlertPolicyDraft.lowRatingThreshold !== reviewAlertPolicy.lowRatingThreshold ||
    reviewAlertPolicyDraft.staleReviewHours !== reviewAlertPolicy.staleReviewHours;
  const reviewConnectionReady = googleReviewState === 'ready';
  const previewReviews = previewReviewState;
  const filteredPreviewReviews = useMemo(
    () => filterReviewInbox(previewReviews, selectedFilter, reviewAlertPolicy),
    [previewReviews, reviewAlertPolicy, selectedFilter],
  );
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const selectedReview = useMemo<ReviewPreviewRecord | null>(
    () =>
      filteredPreviewReviews.find((review) => review.id === selectedReviewId) ??
      filteredPreviewReviews[0] ??
      null,
    [filteredPreviewReviews, selectedReviewId],
  );
  const lowRatingCount = previewReviews.filter(
    (review) => review.rating <= reviewAlertPolicy.lowRatingThreshold,
  ).length;
  const repliedReviews = previewReviews.filter((review) => review.replyStatus === 'published');
  const totalResponseMinutes = repliedReviews.reduce((total, review) => {
    if (!review.publishedReplyAt) {
      return total;
    }

    const createdAt = new Date(review.createdAt).getTime();
    const publishedAt = new Date(review.publishedReplyAt).getTime();
    if (Number.isNaN(createdAt) || Number.isNaN(publishedAt) || publishedAt <= createdAt) {
      return total;
    }

    return total + (publishedAt - createdAt) / (1000 * 60);
  }, 0);
  const averageResponseMinutes =
    repliedReviews.length > 0 ? totalResponseMinutes / repliedReviews.length : null;
  const reviewLocationSummaries = useMemo(
    () => summarizeReviewLocations(previewReviews),
    [previewReviews],
  );
  const reviewAlertFeed = useMemo(
    () => buildReviewAlertFeed(previewReviews, reviewAlertPolicy),
    [previewReviews, reviewAlertPolicy],
  );
  const reviewActivityFeed = useMemo(
    () => buildReviewActivityFeed(previewReviews),
    [previewReviews],
  );
  const draftedCount = previewReviews.filter((review) => review.replyStatus === 'drafted').length;
  const publishedCount = previewReviews.filter(
    (review) => review.replyStatus === 'published',
  ).length;
  const archivedCount = previewReviews.filter((review) => review.status === 'archived').length;
  const latestPublishedReplyAt = useMemo(
    () =>
      [...previewReviews]
        .map((review) => review.publishedReplyAt)
        .filter((value): value is string => typeof value === 'string')
        .sort((left, right) => right.localeCompare(left))[0] ?? null,
    [previewReviews],
  );
  const lastPreviewSyncRun = previewSyncRuns[0] ?? null;
  const assignedOwnerCount = useMemo(
    () => new Set(previewReviews.map((review) => review.ownerName).filter(Boolean)).size,
    [previewReviews],
  );
  const allPreviewReviewsAssigned =
    previewReviews.length > 0 && previewReviews.every((review) => Boolean(review.ownerName));
  const primaryStoredReviewLocation = useMemo(
    () => reviewLocations.find((location) => location.is_primary) ?? reviewLocations[0] ?? null,
    [reviewLocations],
  );
  const selectedLocationPreset =
    REVIEW_LOCATION_PRESETS.find(
      (preset) =>
        preset.locationRef === reviewConnectionDraft.locationRef ||
        (reviewConnectionDraft.placeId && preset.placeId === reviewConnectionDraft.placeId),
    ) ?? null;
  const selectedLocationLabel =
    (selectedLocationPreset?.name ??
      reviewConnectionDraft.placeLabel.trim() ??
      primaryStoredReviewLocation?.name) ||
    (reviewConnectionDraft.placeId.trim().length > 0 ? 'Custom Google place' : null);
  const savedLocationLabel =
    (primaryStoredReviewLocation?.name ??
      REVIEW_LOCATION_PRESETS.find(
        (preset) =>
          preset.locationRef === reviewConnectionConfig.locationRef ||
          (reviewConnectionConfig.placeId && preset.placeId === reviewConnectionConfig.placeId),
      )?.name ??
      reviewConnectionConfig.placeLabel.trim()) ||
    (reviewConnectionConfig.placeId.trim().length > 0 ? 'Custom Google place' : null);
  const goLiveChecklist = [
    {
      label: 'Google profile identity connected',
      complete: googleBusinessMessageState === 'ready',
      actionLabel: 'Open Google profile setup',
      actionTo: getChannelSetupHref('google_business'),
    },
    {
      label: 'Primary review location selected',
      complete: Boolean(savedLocationLabel),
      actionLabel: 'Finish review connection',
      actionTo: '/reviews?setup=google',
    },
    {
      label: 'Review alert policy saved',
      complete: reviewAlertPolicy.alertsEnabled,
      actionLabel: 'Open notification settings',
      actionTo: '/settings?category=display',
    },
    {
      label: 'Reply ownership assigned across preview inbox',
      complete: allPreviewReviewsAssigned,
      actionLabel: 'Assign review owners',
      actionTo: '/reviews',
    },
  ];
  const goLiveNextStep = goLiveChecklist.find((item) => !item.complete) ?? null;
  const reviewModuleReadyForProviderHandoff = goLiveChecklist.every((item) => item.complete);
  const reviewMetricsDisplay = useMemo(
    () => [
      {
        key: 'avg_rating',
        value:
          reviewConnectionReady && previewReviews.length > 0
            ? (
                previewReviews.reduce((total, review) => total + review.rating, 0) /
                previewReviews.length
              ).toFixed(1)
            : reviewConnectionReady
              ? '0.0'
              : '--',
        subtitle: reviewConnectionReady
          ? previewReviews.length > 0
            ? 'Seeded preview inbox average'
            : 'No synced reviews yet'
          : 'Connect reviews to start tracking rating',
      },
      {
        key: 'total_reviews',
        value: reviewConnectionReady ? previewReviews.length : 0,
        subtitle: reviewConnectionReady
          ? previewReviews.length > 0
            ? 'Seeded review objects in the module preview'
            : 'No reviews imported yet'
          : 'Review sync is not connected yet',
      },
      {
        key: 'new_reviews',
        value: reviewConnectionReady
          ? previewReviews.filter((review) => review.status === 'new').length
          : 0,
        subtitle: reviewConnectionReady
          ? 'Preview new reviews in the current window'
          : 'No new reviews in the current window',
      },
      {
        key: 'unreplied',
        value: reviewConnectionReady
          ? previewReviews.filter((review) => review.replyStatus === 'none').length
          : 0,
        subtitle: reviewConnectionReady
          ? previewReviews.length > 0
            ? 'Preview items still waiting on a published reply'
            : 'No review inbox items yet'
          : 'Inbox appears after connection is ready',
      },
      {
        key: 'response_time',
        value:
          reviewConnectionReady && averageResponseMinutes !== null
            ? averageResponseMinutes >= 60
              ? `${(averageResponseMinutes / 60).toFixed(1)}h`
              : `${Math.round(averageResponseMinutes)}m`
            : '--',
        subtitle:
          reviewConnectionReady && averageResponseMinutes !== null
            ? 'Average from seeded reply examples'
            : 'Will populate once replies are published',
      },
      {
        key: 'low_rating_share',
        value:
          reviewConnectionReady && previewReviews.length > 0
            ? `${Math.round((lowRatingCount / previewReviews.length) * 100)}%`
            : '--',
        subtitle: reviewConnectionReady
          ? previewReviews.length > 0
            ? `${lowRatingCount} preview reviews at ${reviewAlertPolicy.lowRatingThreshold} stars and below`
            : `Alerting at ${reviewAlertPolicy.lowRatingThreshold} stars and below`
          : 'Policy saved before sync is enabled',
      },
    ],
    [
      averageResponseMinutes,
      lowRatingCount,
      previewReviews,
      reviewAlertPolicy.lowRatingThreshold,
      reviewConnectionReady,
    ],
  );

  useEffect(() => {
    setReviewConnectionDraft(reviewConnectionConfig);
    setPlaceSearchQuery(
      reviewConnectionConfig.placeLabel.trim() ||
        REVIEW_LOCATION_PRESETS.find(
          (preset) =>
            preset.locationRef === reviewConnectionConfig.locationRef ||
            (reviewConnectionConfig.placeId && preset.placeId === reviewConnectionConfig.placeId),
        )?.name ||
        '',
    );
    setPlacePredictions([]);
    setPlaceSearchError(null);
    setPlaceSearchProvider(null);
  }, [reviewConnectionConfig]);

  useEffect(() => {
    setReviewAlertPolicyDraft(reviewAlertPolicy);
  }, [reviewAlertPolicy]);

  const fetchPersistedReviewData = useCallback(async () => {
    if (!workspace?.id || isPreview || !reviewConnectionReady) {
      setReviewLocations([]);
      setPreviewReviewState([]);
      setPreviewSyncRuns([]);
      setReviewDataError(null);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('reviews-foundation', {
        body: { workspace_id: workspace.id },
      });

      if (error) {
        throw error;
      }

      setReviewLocations((data?.locations as ReviewLocationRecord[] | undefined) ?? []);
      setPreviewReviewState((data?.reviews as ReviewPreviewRecord[] | undefined) ?? []);
      setPreviewSyncRuns((data?.syncRuns as ReviewSyncPreviewRun[] | undefined) ?? []);
      setReviewDataError(null);
    } catch (error) {
      console.error('Failed to load stored review data:', error);
      setReviewDataError('BizzyBee could not load the stored review inbox right now.');
      setReviewLocations([]);
      setPreviewReviewState([]);
      setPreviewSyncRuns([]);
    }
  }, [isPreview, reviewConnectionReady, workspace?.id]);

  useEffect(() => {
    void fetchPersistedReviewData();
  }, [fetchPersistedReviewData]);

  useEffect(() => {
    const activeDraftSaveTimers = draftSaveTimers.current;
    return () => {
      Object.values(activeDraftSaveTimers).forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (!filteredPreviewReviews.some((review) => review.id === selectedReviewId)) {
      setSelectedReviewId(filteredPreviewReviews[0]?.id ?? null);
    }
  }, [filteredPreviewReviews, selectedReviewId]);

  const updatePreviewReview = (
    reviewId: string,
    updater: (review: ReviewPreviewRecord) => ReviewPreviewRecord,
  ) => {
    setPreviewReviewState((current) =>
      current.map((review) => (review.id === reviewId ? updater(review) : review)),
    );
  };

  const clearDraftSaveTimer = useCallback((reviewId: string) => {
    const existingTimer = draftSaveTimers.current[reviewId];
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      delete draftSaveTimers.current[reviewId];
    }
  }, []);

  const persistReviewUpdate = useCallback(
    async (reviewId: string, updates: Record<string, unknown>) => {
      if (!workspace?.id) {
        throw new Error('Workspace not ready');
      }

      const { data, error } = await supabase.functions.invoke('update-review-item', {
        body: {
          workspace_id: workspace.id,
          review_id: reviewId,
          updates,
        },
      });

      if (error) {
        throw error;
      }

      if (data?.review) {
        setPreviewReviewState((current) =>
          current.map((review) =>
            review.id === reviewId ? (data.review as ReviewPreviewRecord) : review,
          ),
        );
      }
    },
    [workspace?.id],
  );

  const handleReviewMutationError = useCallback(
    async (
      title: string,
      error: unknown,
      options?: { refresh?: boolean; description?: string },
    ) => {
      console.error(title, error);
      toast({
        title,
        description:
          options?.description ??
          'BizzyBee could not save that review action. Refreshing the stored state.',
        variant: 'destructive',
      });
      if (options?.refresh !== false) {
        await fetchPersistedReviewData();
      }
    },
    [fetchPersistedReviewData, toast],
  );

  const createSuggestedReply = (review: ReviewPreviewRecord) => {
    if (review.rating <= reviewAlertPolicy.lowRatingThreshold) {
      return `Thank you for taking the time to share this feedback, ${review.authorName}. We are sorry this visit did not land as it should have. We are reviewing the job internally and would welcome the chance to make things right.`;
    }

    return `Thank you, ${review.authorName}. We really appreciate you taking the time to leave a review and are so pleased the experience landed well.`;
  };

  const handleGenerateDraft = async (review: ReviewPreviewRecord) => {
    const nextDraft = review.draftReply ?? createSuggestedReply(review);
    const draftUpdatedAt = new Date().toISOString();
    clearDraftSaveTimer(review.id);

    updatePreviewReview(review.id, (current) => ({
      ...current,
      draftReply: nextDraft,
      replyStatus: 'drafted',
      status: 'drafted',
      draftUpdatedAt,
    }));

    try {
      await persistReviewUpdate(review.id, {
        draftReply: nextDraft,
        replyStatus: 'drafted',
        status: 'drafted',
        draftUpdatedAt,
      });
    } catch (error) {
      await handleReviewMutationError('Could not generate the review draft', error);
    }
  };

  const handleDraftChange = (reviewId: string, value: string) => {
    const draftUpdatedAt = value.trim().length > 0 ? new Date().toISOString() : null;
    updatePreviewReview(reviewId, (current) => ({
      ...current,
      draftReply: value,
      replyStatus: value.trim().length > 0 ? 'drafted' : 'none',
      status: value.trim().length > 0 ? 'drafted' : 'unreplied',
      draftUpdatedAt: draftUpdatedAt ?? current.draftUpdatedAt,
    }));

    clearDraftSaveTimer(reviewId);

    draftSaveTimers.current[reviewId] = window.setTimeout(() => {
      delete draftSaveTimers.current[reviewId];
      void persistReviewUpdate(reviewId, {
        draftReply: value,
        replyStatus: value.trim().length > 0 ? 'drafted' : 'none',
        status: value.trim().length > 0 ? 'drafted' : 'unreplied',
        draftUpdatedAt,
      }).catch((error) => {
        void handleReviewMutationError('Could not save the draft reply', error, {
          refresh: false,
          description:
            'BizzyBee kept your draft locally so you can keep editing, but it could not save the latest change yet.',
        });
      });
    }, 500);
  };

  const handlePublishDraft = async (review: ReviewPreviewRecord) => {
    const publishedReply =
      review.draftReply?.trim() || review.publishedReply?.trim() || createSuggestedReply(review);
    const publishedReplyAt = new Date().toISOString();
    clearDraftSaveTimer(review.id);

    updatePreviewReview(review.id, (current) => ({
      ...current,
      draftReply: publishedReply,
      publishedReply,
      publishedReplyAt,
      replyStatus: 'published',
      status: 'published',
      publishedByName: current.ownerName ?? 'BizzyBee Ops',
    }));

    try {
      await persistReviewUpdate(review.id, {
        draftReply: publishedReply,
        publishedReply,
        publishedReplyAt,
        replyStatus: 'published',
        status: 'published',
        publishedByName: review.ownerName ?? 'BizzyBee Ops',
      });
    } catch (error) {
      await handleReviewMutationError('Could not publish the preview reply', error);
    }
  };

  const handleReopenReview = async (reviewId: string) => {
    clearDraftSaveTimer(reviewId);
    updatePreviewReview(reviewId, (current) => ({
      ...current,
      replyStatus: current.draftReply?.trim() ? 'drafted' : 'none',
      status: current.draftReply?.trim() ? 'drafted' : 'unreplied',
      publishedReply: null,
      publishedReplyAt: null,
    }));

    try {
      const currentReview = previewReviewState.find((review) => review.id === reviewId);
      await persistReviewUpdate(reviewId, {
        replyStatus: currentReview?.draftReply?.trim() ? 'drafted' : 'none',
        status: currentReview?.draftReply?.trim() ? 'drafted' : 'unreplied',
        publishedReply: null,
        publishedReplyAt: null,
        publishedByName: null,
      });
    } catch (error) {
      await handleReviewMutationError('Could not reopen the review', error);
    }
  };

  const handleArchivePreview = async (reviewId: string) => {
    clearDraftSaveTimer(reviewId);
    updatePreviewReview(reviewId, (current) => ({
      ...current,
      status: 'archived',
    }));

    try {
      await persistReviewUpdate(reviewId, { status: 'archived' });
      toast({
        title: 'Preview review archived',
        description: 'This now updates the stored Reviews preview state for this workspace.',
      });
    } catch (error) {
      await handleReviewMutationError('Could not archive the preview review', error);
    }
  };

  const handleRunPreviewSync = async () => {
    setRunningPreviewSync(true);

    try {
      const { error } = await supabase.functions.invoke('sync-google-reviews-preview', {
        body: { workspace_id: workspace?.id },
      });

      if (error) {
        throw error;
      }

      await fetchPersistedReviewData();
      toast({
        title: 'Preview sync complete',
        description:
          'The Reviews module now refreshed its stored preview review objects for this workspace.',
      });
    } catch (error) {
      console.error('Failed to run preview sync:', error);
      toast({
        title: 'Preview sync failed',
        description: 'BizzyBee could not seed the stored Google review preview right now.',
        variant: 'destructive',
      });
    } finally {
      setRunningPreviewSync(false);
    }
  };

  const handleSelectLocationPreset = (preset: (typeof REVIEW_LOCATION_PRESETS)[number]) => {
    setReviewConnectionDraft({
      accountRef: preset.accountRef,
      locationRef: preset.locationRef,
      placeId: preset.placeId,
      placeLabel: preset.name,
    });
    setPlaceSearchQuery(preset.name);
    setPlacePredictions([]);
    setPlaceSearchError(null);
    setPlaceSearchProvider(null);
  };

  const searchPlaces = useCallback(async (input: string) => {
    const trimmedInput = input.trim();
    if (trimmedInput.length < 2) {
      setPlacePredictions([]);
      setPlaceSearchError(null);
      setPlaceSearchProvider(null);
      return;
    }

    setPlaceSearchLoading(true);
    setPlaceSearchError(null);

    try {
      const { data, error } = await supabase.functions.invoke('google-places-autocomplete', {
        body: { input: trimmedInput },
      });

      if (error) {
        throw error;
      }

      setPlacePredictions((data?.predictions as PlacePrediction[] | undefined) ?? []);
      setPlaceSearchProvider(typeof data?.provider === 'string' ? data.provider : 'google');
    } catch (error) {
      console.error('Failed to search Google places for reviews:', error);
      setPlacePredictions([]);
      setPlaceSearchProvider(null);
      setPlaceSearchError(
        'Location search is temporarily unavailable. You can still paste a Google place ID manually.',
      );
    } finally {
      setPlaceSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void searchPlaces(placeSearchQuery);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [placeSearchQuery, searchPlaces]);

  const handleSelectPlacePrediction = (prediction: PlacePrediction) => {
    setReviewConnectionDraft((current) => ({
      ...current,
      placeId: prediction.place_id,
      placeLabel: prediction.description,
    }));
    setPlaceSearchQuery(prediction.description);
    setPlacePredictions([]);
    setPlaceSearchError(null);
  };

  const handleClearPlaceSelection = () => {
    setReviewConnectionDraft((current) => ({
      ...current,
      placeId: '',
      placeLabel: '',
    }));
    setPlaceSearchQuery('');
    setPlacePredictions([]);
    setPlaceSearchError(null);
    setPlaceSearchProvider(null);
  };

  const handleAssignOwner = async (
    reviewId: string,
    ownerName: (typeof REVIEW_OWNER_OPTIONS)[number],
  ) => {
    updatePreviewReview(reviewId, (current) => ({
      ...current,
      ownerName,
    }));

    try {
      await persistReviewUpdate(reviewId, { ownerName });
    } catch (error) {
      await handleReviewMutationError('Could not assign the review owner', error);
    }
  };

  const saveReviewConnection = async () => {
    if (!workspace?.id) {
      toast({
        title: 'Workspace not ready',
        description: 'Please refresh and try again.',
        variant: 'destructive',
      });
      return;
    }

    const mergedConfig = {
      ...(googleBusinessConfig ?? {}),
      reviewAccountRef: reviewConnectionDraft.accountRef.trim(),
      reviewLocationRef: reviewConnectionDraft.locationRef.trim(),
      placeId: reviewConnectionDraft.placeId.trim(),
      reviewPlaceLabel: reviewConnectionDraft.placeLabel.trim(),
    };

    setSavingConnection(true);

    try {
      if (googleBusinessChannel?.id) {
        const { error } = await supabase
          .from('workspace_channels')
          .update({ config: mergedConfig })
          .eq('id', googleBusinessChannel.id);

        if (error) {
          throw error;
        }

        setGoogleBusinessChannel((current) =>
          current ? { ...current, config: mergedConfig } : current,
        );
      } else {
        const { data, error } = await supabase
          .from('workspace_channels')
          .insert({
            workspace_id: workspace.id,
            channel: 'google_business',
            enabled: true,
            automation_level: 'draft_only',
            config: mergedConfig,
          })
          .select('id, channel, enabled, automation_level, config')
          .single();

        if (error) {
          throw error;
        }

        setGoogleBusinessChannel(data as WorkspaceChannelRecord);
      }

      toast({
        title: 'Review connection details saved',
        description:
          'BizzyBee now has the Google review account and location identifiers needed for the Reviews module.',
      });
    } catch (error) {
      console.error('Failed to save review connection details:', error);
      toast({
        title: 'Could not save review connection details',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSavingConnection(false);
    }
  };

  const saveReviewAlertPolicy = async () => {
    if (!workspace?.id) {
      toast({
        title: 'Workspace not ready',
        description: 'Please refresh and try again.',
        variant: 'destructive',
      });
      return;
    }

    const mergedConfig = {
      ...(googleBusinessConfig ?? {}),
      reviewAlerts: {
        alertsEnabled: reviewAlertPolicyDraft.alertsEnabled,
        notifyOnEveryNewReview: reviewAlertPolicyDraft.notifyOnEveryNewReview,
        lowRatingThreshold: Math.max(1, Math.min(5, reviewAlertPolicyDraft.lowRatingThreshold)),
        staleReviewHours: Math.max(1, reviewAlertPolicyDraft.staleReviewHours),
      },
    };

    setSavingAlertPolicy(true);

    try {
      if (googleBusinessChannel?.id) {
        const { error } = await supabase
          .from('workspace_channels')
          .update({ config: mergedConfig })
          .eq('id', googleBusinessChannel.id);

        if (error) {
          throw error;
        }

        setGoogleBusinessChannel((current) =>
          current ? { ...current, config: mergedConfig } : current,
        );
      } else {
        const { data, error } = await supabase
          .from('workspace_channels')
          .insert({
            workspace_id: workspace.id,
            channel: 'google_business',
            enabled: true,
            automation_level: 'draft_only',
            config: mergedConfig,
          })
          .select('id, channel, enabled, automation_level, config')
          .single();

        if (error) {
          throw error;
        }

        setGoogleBusinessChannel(data as WorkspaceChannelRecord);
      }

      toast({
        title: 'Review alert policy saved',
        description:
          'BizzyBee now has workspace-level rules for low-rating and stale-review alerts.',
      });
    } catch (error) {
      console.error('Failed to save review alert policy:', error);
      toast({
        title: 'Could not save review alert policy',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSavingAlertPolicy(false);
    }
  };

  const setupChecklist = [
    {
      title: 'Google Business Profile identity',
      complete: googleBusinessMessageState === 'ready',
      detail:
        googleBusinessMessageState === 'ready'
          ? 'Google Business Profile identity is already saved and ready to support Reviews.'
          : `Current status: ${getChannelConnectionLabel(
              googleChannelDefinition,
              googleBusinessMessageState,
            )}.`,
      actionLabel: 'Open Google profile setup',
      actionTo: getChannelSetupHref('google_business'),
    },
    {
      title: 'Google place reference',
      complete: hasGooglePlaceId,
      detail: hasGooglePlaceId
        ? 'A Google place ID is already saved in the current channel config.'
        : 'A Google place ID will help connect review analytics and location-level reporting later.',
      actionLabel: 'Open Google profile setup',
      actionTo: getChannelSetupHref('google_business'),
    },
    {
      title: 'Review alerts',
      complete: alertsEnabled,
      detail: alertsEnabled
        ? `AI summaries are enabled through ${reviewAlertChannels}.`
        : 'Enable notification preferences so low-rating and stale-review alerts have somewhere to go.',
      actionLabel: 'Open notification settings',
      actionTo: '/settings?category=display',
    },
  ];

  const content = (
    <div className="min-h-full bg-bb-linen/50 px-4 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-[28px] border border-bb-border bg-bb-white px-5 py-6 shadow-[0_18px_40px_rgba(28,21,16,0.05)] sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <Badge className="w-fit border-bb-gold/25 bg-bb-gold/10 text-bb-espresso hover:bg-bb-gold/10">
                Reviews module
              </Badge>
              <div className="space-y-2">
                <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-bb-text">
                  Google Reviews & Profile
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-bb-warm-gray">
                  Reviews is BizzyBee&apos;s home for Google Business Profile identity, public
                  reviews, reply workflow, alerts, and reputation analytics. It keeps review
                  operations in one place while leaving any legacy Google message routing in
                  Channels.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline">
                <Link to={getChannelSetupHref('google_business')}>
                  Prepare Google Profile
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild>
                <Link to="/settings?category=display">
                  Review alerts
                  <Bell className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>

        {workspaceLoading || loading ? (
          <PanelNotice
            title="Loading Google profile and review setup"
            description="BizzyBee is checking your Google Business Profile identity, review connection, and notification setup."
            icon={RefreshCw}
          />
        ) : fetchError ? (
          <PanelNotice
            title="Review setup could not be loaded"
            description={fetchError}
            icon={CircleAlert}
            actionLabel="Refresh page"
            actionTo="/reviews"
          />
        ) : !workspace?.id || isPreview ? (
          <PanelNotice
            title="Finish workspace setup first"
            description="BizzyBee needs a workspace before Reviews can connect a location, load alerts, or build a review inbox."
            icon={Settings}
            actionLabel="Open onboarding"
            actionTo="/onboarding"
          />
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
              <Card className="border-bb-border bg-bb-white p-5 shadow-sm">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-[0.12em] text-bb-warm-gray">
                        Connection
                      </p>
                      <h2 className="text-xl font-semibold text-bb-text">
                        {googleReviewDefinition.label}
                      </h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="border-bb-border text-bb-text">
                        {googleReviewState.replace(/_/g, ' ')}
                      </Badge>
                      {googleBusinessMessageState === 'ready' && (
                        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                          Google profile identity detected
                        </Badge>
                      )}
                    </div>
                  </div>

                  <p className="text-sm leading-6 text-bb-warm-gray">
                    {getReviewSetupDescription(
                      googleReviewDefinition,
                      googleReviewState,
                      undefined,
                    )}
                  </p>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {setupChecklist.map((item) => (
                      <div
                        key={item.title}
                        className="rounded-2xl border border-bb-border bg-bb-linen/70 p-4"
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-bb-text">{item.title}</p>
                          <Badge
                            className={
                              item.complete
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                                : 'border-bb-border bg-bb-white text-bb-warm-gray hover:bg-bb-white'
                            }
                          >
                            {item.complete ? 'Ready' : 'Needs work'}
                          </Badge>
                        </div>
                        <p className="text-sm leading-5 text-bb-warm-gray">{item.detail}</p>
                        {!item.complete && (
                          <Button asChild variant="outline" size="sm" className="mt-4">
                            <Link to={item.actionTo}>{item.actionLabel}</Link>
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </Card>

              <Card className="border-bb-border bg-bb-white p-5 shadow-sm">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-bb-warm-gray">
                      Provider setup
                    </p>
                    <h2 className="text-lg font-semibold text-bb-text">What Reviews needs next</h2>
                  </div>

                  <div className="space-y-3">
                    {REVIEW_CONFIG_FIELDS.google.map((field) => (
                      <div
                        key={field.key}
                        className="rounded-2xl border border-bb-border bg-bb-linen/70 p-4"
                      >
                        <div className="mb-2 flex items-center gap-2">
                          <p className="text-sm font-medium text-bb-text">{field.label}</p>
                          {field.required !== false && (
                            <Badge variant="outline" className="border-bb-border text-bb-warm-gray">
                              Required
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm leading-5 text-bb-warm-gray">{field.helpText}</p>
                        <p className="mt-3 rounded-lg bg-bb-white px-3 py-2 font-mono text-xs text-bb-text-secondary">
                          {field.placeholder}
                        </p>
                      </div>
                    ))}
                  </div>

                  <PanelNotice
                    title="Dedicated review connection comes next"
                    description={`The module contract is now defined. ${getReviewSetupActionLabel(
                      googleReviewDefinition,
                      googleReviewState,
                    )} will become a provider flow in the next implementation slice.`}
                    icon={Sparkles}
                  />
                </div>
              </Card>
            </div>

            <Card className="border-bb-border bg-bb-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-bb-warm-gray">
                    Launch readiness
                  </p>
                  <h2 className="text-lg font-semibold text-bb-text">Reviews control center</h2>
                  <p className="max-w-2xl text-sm leading-6 text-bb-warm-gray">
                    Reviews now owns Google profile identity, alerts, inbox ownership, and reply
                    workflow. This card shows the last blocker before the module is ready for a
                    provider handoff.
                  </p>
                </div>
                <Badge
                  className={
                    reviewModuleReadyForProviderHandoff
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                      : 'border-bb-border bg-bb-linen text-bb-warm-gray hover:bg-bb-linen'
                  }
                >
                  {goLiveChecklist.filter((item) => item.complete).length}/{goLiveChecklist.length}{' '}
                  ready
                </Badge>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {goLiveChecklist.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-bb-border bg-bb-linen/60 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-bb-text">{item.label}</p>
                      <Badge
                        className={
                          item.complete
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                            : 'border-bb-border bg-bb-white text-bb-warm-gray hover:bg-bb-white'
                        }
                      >
                        {item.complete ? 'Ready' : 'Pending'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
                <div className="rounded-2xl border border-bb-border bg-bb-linen/60 p-4">
                  <p className="text-sm font-medium text-bb-text">Next review step</p>
                  <p className="mt-2 text-sm leading-6 text-bb-warm-gray">
                    {goLiveNextStep
                      ? `${goLiveNextStep.label} is the last blocker before Reviews is ready for provider handoff.`
                      : 'Reviews has enough structure, ownership, and policy to move from preview workflow into Google review sync.'}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {goLiveNextStep ? (
                      <Button asChild size="sm" variant="outline">
                        <Link to={goLiveNextStep.actionTo}>{goLiveNextStep.actionLabel}</Link>
                      </Button>
                    ) : (
                      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                        Internal handoff ready
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-bb-border bg-bb-white p-4">
                  <p className="text-sm font-medium text-bb-text">Operational ownership</p>
                  <div className="mt-3 space-y-2 text-sm text-bb-warm-gray">
                    <div className="flex items-center justify-between gap-3">
                      <span>Assigned owners</span>
                      <Badge variant="outline" className="border-bb-border text-bb-text">
                        {assignedOwnerCount}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Primary location</span>
                      <Badge variant="outline" className="border-bb-border text-bb-text">
                        {selectedLocationLabel ?? 'Custom setup'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Alert policy</span>
                      <Badge variant="outline" className="border-bb-border text-bb-text">
                        {reviewAlertPolicy.alertsEnabled ? 'Active' : 'Disabled'}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <Card
              className={`border-bb-border bg-bb-white p-5 shadow-sm ${
                reviewSetupRequested ? 'ring-2 ring-bb-gold/20' : ''
              }`}
            >
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-bb-warm-gray">
                      Connection details
                    </p>
                    <h2 className="text-lg font-semibold text-bb-text">
                      Save Google review identifiers
                    </h2>
                    <p className="text-sm leading-6 text-bb-warm-gray">
                      BizzyBee can now store the Google review account and location identifiers it
                      will use when review sync is enabled, and this setup now includes a live place
                      search to make the primary location easier to capture cleanly.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="review-account-ref">
                        Google Business Profile account reference
                      </Label>
                      <Input
                        id="review-account-ref"
                        value={reviewConnectionDraft.accountRef}
                        onChange={(event) =>
                          setReviewConnectionDraft((current) => ({
                            ...current,
                            accountRef: event.target.value,
                          }))
                        }
                        placeholder="accounts/123456789"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="review-location-ref">
                        Google Business Profile location reference
                      </Label>
                      <Input
                        id="review-location-ref"
                        value={reviewConnectionDraft.locationRef}
                        onChange={(event) =>
                          setReviewConnectionDraft((current) => ({
                            ...current,
                            locationRef: event.target.value,
                          }))
                        }
                        placeholder="locations/987654321"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="review-place-search">Find your Google place</Label>
                      <Input
                        id="review-place-search"
                        value={placeSearchQuery}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setPlaceSearchQuery(nextValue);
                          if (!nextValue.trim()) {
                            setReviewConnectionDraft((current) => ({
                              ...current,
                              placeId: '',
                              placeLabel: '',
                            }));
                            setPlaceSearchProvider(null);
                            setPlaceSearchError(null);
                          }
                        }}
                        placeholder="Search for your business or location"
                      />
                      <div className="flex flex-wrap items-center gap-2 text-xs text-bb-warm-gray">
                        {placeSearchLoading ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Searching Google place matches...</span>
                          </>
                        ) : placeSearchProvider ? (
                          <span>
                            Search provider:{' '}
                            <span className="font-medium text-bb-text">
                              {placeSearchProvider === 'fallback'
                                ? 'fallback location search'
                                : 'Google Places'}
                            </span>
                          </span>
                        ) : (
                          <span>
                            Search helps prefill the Google place ID for the primary location.
                          </span>
                        )}
                      </div>
                      {placeSearchError && (
                        <p className="text-sm text-amber-700">{placeSearchError}</p>
                      )}
                      {!placeSearchLoading &&
                        placeSearchQuery.trim().length >= 2 &&
                        placePredictions.length > 0 && (
                          <div className="rounded-2xl border border-bb-border bg-bb-linen/60 p-3">
                            <p className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-bb-warm-gray">
                              Suggested places
                            </p>
                            <div className="space-y-2">
                              {placePredictions.map((prediction) => {
                                const isSelected =
                                  reviewConnectionDraft.placeId === prediction.place_id;

                                return (
                                  <button
                                    key={prediction.place_id}
                                    type="button"
                                    onClick={() => handleSelectPlacePrediction(prediction)}
                                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                                      isSelected
                                        ? 'border-bb-gold bg-bb-gold/10'
                                        : 'border-bb-border bg-bb-white hover:bg-bb-linen/70'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="space-y-1">
                                        <p className="text-sm font-medium text-bb-text">
                                          {prediction.description}
                                        </p>
                                        <p className="font-mono text-xs text-bb-warm-gray">
                                          {prediction.place_id}
                                        </p>
                                      </div>
                                      <Badge
                                        className={
                                          isSelected
                                            ? 'border-bb-gold/20 bg-bb-gold/15 text-bb-espresso hover:bg-bb-gold/15'
                                            : 'border-bb-border bg-bb-linen text-bb-warm-gray hover:bg-bb-linen'
                                        }
                                      >
                                        {isSelected ? 'Selected' : 'Use this place'}
                                      </Badge>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="review-place-id">Google place ID</Label>
                      <Input
                        id="review-place-id"
                        value={reviewConnectionDraft.placeId}
                        onChange={(event) =>
                          setReviewConnectionDraft((current) => ({
                            ...current,
                            placeId: event.target.value,
                            placeLabel:
                              event.target.value.trim() === current.placeId.trim()
                                ? current.placeLabel
                                : '',
                          }))
                        }
                        placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
                      />
                      <p className="text-xs text-bb-warm-gray">
                        You can still paste a Google place ID manually if you already have it from
                        your Google Business Profile setup.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-2xl border border-bb-border bg-bb-linen/60 p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-bb-text">Choose a primary location</p>
                      <p className="text-sm leading-5 text-bb-warm-gray">
                        BizzyBee can save a clear primary review location now, either from a known
                        preset or from the live place search above, so the module has one canonical
                        place to sync and report against.
                      </p>
                    </div>

                    {selectedLocationLabel && (
                      <div className="rounded-2xl border border-bb-border bg-bb-white p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-bb-text">
                              Current primary location
                            </p>
                            <p className="text-sm text-bb-warm-gray">{selectedLocationLabel}</p>
                            {reviewConnectionDraft.placeId.trim().length > 0 && (
                              <p className="font-mono text-xs text-bb-warm-gray">
                                {reviewConnectionDraft.placeId}
                              </p>
                            )}
                          </div>
                          {!selectedLocationPreset &&
                            reviewConnectionDraft.placeId.trim().length > 0 && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleClearPlaceSelection}
                              >
                                Clear place
                              </Button>
                            )}
                        </div>
                      </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-2">
                      {REVIEW_LOCATION_PRESETS.map((preset) => {
                        const isSelected =
                          selectedLocationPreset?.locationRef === preset.locationRef;

                        return (
                          <button
                            key={preset.locationRef}
                            type="button"
                            onClick={() => handleSelectLocationPreset(preset)}
                            className={`rounded-2xl border p-4 text-left transition-colors ${
                              isSelected
                                ? 'border-bb-gold bg-bb-gold/10'
                                : 'border-bb-border bg-bb-white hover:bg-bb-linen/60'
                            }`}
                          >
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-bb-text">{preset.name}</p>
                              <Badge
                                className={
                                  isSelected
                                    ? 'border-bb-gold/20 bg-bb-gold/15 text-bb-espresso hover:bg-bb-gold/15'
                                    : 'border-bb-border bg-bb-linen text-bb-warm-gray hover:bg-bb-linen'
                                }
                              >
                                {isSelected ? 'Selected' : 'Use this location'}
                              </Badge>
                            </div>
                            <p className="text-xs text-bb-warm-gray">{preset.locationRef}</p>
                            <p className="mt-1 text-xs text-bb-warm-gray">{preset.placeId}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={saveReviewConnection}
                      disabled={!isConnectionDraftDirty || savingConnection}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {savingConnection ? 'Saving...' : 'Save review connection'}
                    </Button>
                    <Button asChild variant="outline">
                      <Link to={getChannelSetupHref('google_business')}>
                        Open Google profile setup
                      </Link>
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-bb-border bg-bb-linen/70 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-bb-text">Current review foundation</p>
                      <Badge
                        className={
                          googleReviewState === 'ready'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                            : 'border-bb-border bg-bb-white text-bb-warm-gray hover:bg-bb-white'
                        }
                      >
                        {googleReviewState.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <p className="text-sm leading-6 text-bb-warm-gray">
                      {getReviewSetupDescription(
                        googleReviewDefinition,
                        googleReviewState,
                        reviewConnectionConfig,
                      )}
                    </p>
                    {savedLocationLabel && (
                      <p className="mt-3 text-sm text-bb-warm-gray">
                        Primary location:{' '}
                        <span className="font-medium text-bb-text">{savedLocationLabel}</span>
                      </p>
                    )}
                    {primaryStoredReviewLocation?.last_synced_at && (
                      <p className="mt-2 text-xs text-bb-warm-gray">
                        Stored review sync last updated{' '}
                        {formatDistanceToNow(new Date(primaryStoredReviewLocation.last_synced_at), {
                          addSuffix: true,
                        })}
                        .
                      </p>
                    )}
                    {reviewDataError && (
                      <p className="mt-3 text-sm text-amber-700">{reviewDataError}</p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-bb-border bg-bb-white p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-bb-text">Go-live handoff</p>
                      <Badge
                        className={
                          goLiveChecklist.every((item) => item.complete)
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                            : 'border-bb-border bg-bb-linen text-bb-warm-gray hover:bg-bb-linen'
                        }
                      >
                        {goLiveChecklist.filter((item) => item.complete).length}/
                        {goLiveChecklist.length} ready
                      </Badge>
                    </div>

                    <div className="space-y-2">
                      {goLiveChecklist.map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between rounded-xl border border-bb-border bg-bb-linen/50 px-3 py-2"
                        >
                          <span className="text-sm text-bb-text">{item.label}</span>
                          <Badge
                            className={
                              item.complete
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                                : 'border-bb-border bg-bb-white text-bb-warm-gray hover:bg-bb-white'
                            }
                          >
                            {item.complete ? 'Ready' : 'Pending'}
                          </Badge>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 rounded-2xl border border-bb-border bg-bb-linen/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-bb-text">Next live step</p>
                          <p className="text-sm leading-5 text-bb-warm-gray">
                            {reviewModuleReadyForProviderHandoff
                              ? 'Reviews has the right internal foundation. The next implementation layer is the Google review sync path.'
                              : goLiveNextStep
                                ? `${goLiveNextStep.label} is the next blocker before this module can hand off cleanly into a provider path.`
                                : 'BizzyBee is shaping the Reviews launch path step by step.'}
                          </p>
                        </div>

                        {goLiveNextStep ? (
                          <Button asChild size="sm">
                            <Link to={goLiveNextStep.actionTo}>{goLiveNextStep.actionLabel}</Link>
                          </Button>
                        ) : (
                          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                            Internal handoff ready
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {[
                      ['Google profile identity', googleBusinessMessageState === 'ready'],
                      ['Review account reference', reviewConnectionConfig.accountRef.length > 0],
                      ['Review location reference', reviewConnectionConfig.locationRef.length > 0],
                      ['Place ID saved', reviewConnectionConfig.placeId.length > 0],
                    ].map(([label, complete]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between rounded-xl border border-bb-border bg-bb-white px-3 py-2"
                      >
                        <span className="text-sm text-bb-text">{label}</span>
                        <Badge
                          className={
                            complete
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                              : 'border-bb-border bg-bb-linen text-bb-warm-gray hover:bg-bb-linen'
                          }
                        >
                          {complete ? 'Saved' : 'Missing'}
                        </Badge>
                      </div>
                    ))}
                  </div>

                  {googleReviewState === 'ready' && (
                    <PanelNotice
                      title="Review connection foundation is ready"
                      description="The next slice is the live review inbox and reply workflow on top of these saved identifiers."
                      icon={CheckCircle2}
                    />
                  )}
                </div>
              </div>
            </Card>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {REVIEW_METRICS.map((metric) => {
                const metricDisplay = reviewMetricsDisplay.find((item) => item.key === metric.key);

                return (
                  <MetricPillCard
                    key={metric.key}
                    title={metric.label}
                    value={metricDisplay?.value ?? '--'}
                    subtitle={metricDisplay?.subtitle ?? metric.description}
                    icon={
                      metric.key === 'avg_rating' ? (
                        <Star className="h-5 w-5" />
                      ) : metric.key === 'total_reviews' ? (
                        <MessageSquare className="h-5 w-5" />
                      ) : metric.key === 'response_time' ? (
                        <RefreshCw className="h-5 w-5" />
                      ) : metric.key === 'low_rating_share' ? (
                        <CircleAlert className="h-5 w-5" />
                      ) : (
                        <Sparkles className="h-5 w-5" />
                      )
                    }
                    iconColor="text-bb-gold"
                    bgColor="bg-bb-white"
                    className="border-bb-border"
                  />
                );
              })}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
              <Card className="border-bb-border bg-bb-white p-5 shadow-sm">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-[0.12em] text-bb-warm-gray">
                        Review inbox
                      </p>
                      <h2 className="text-lg font-semibold text-bb-text">Filters and workflow</h2>
                    </div>
                    <Badge className="border-bb-border bg-bb-linen text-bb-warm-gray hover:bg-bb-linen">
                      {reviewConnectionReady && previewReviews.length > 0
                        ? `${previewReviews.length} preview reviews`
                        : 'No live reviews yet'}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {REVIEW_INBOX_FILTERS.map((filter) => (
                      <button
                        key={filter.key}
                        type="button"
                        onClick={() => setSelectedFilter(filter.key)}
                        className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                          selectedFilter === filter.key
                            ? 'border-bb-gold bg-bb-gold/10 text-bb-espresso'
                            : 'border-bb-border bg-bb-white text-bb-text-secondary'
                        }`}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>

                  <PanelNotice
                    title="This will become the review queue"
                    description={
                      reviewConnectionReady
                        ? 'The list below is a seeded workflow preview so we can shape the review queue honestly before sync lands. It is clearly preview data, not imported production reviews.'
                        : 'New reviews, unreplied items, low-rating alerts, BizzyBee drafts, and published replies will all land here. The next build slice is the actual synced review inbox.'
                    }
                    icon={MessageSquare}
                    action={
                      <div className="flex flex-wrap gap-3">
                        <Button asChild size="sm">
                          <Link to={getChannelSetupHref('google_business')}>
                            Prepare Google Profile
                          </Link>
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <Link to="/settings?category=display">Tune alerts</Link>
                        </Button>
                      </div>
                    }
                  />

                  {reviewConnectionReady && (
                    <div className="rounded-2xl border border-bb-gold/25 bg-bb-gold/10 p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-bb-espresso">
                          Preview mode boundary
                        </p>
                        <Badge className="border-bb-gold/20 bg-bb-white text-bb-espresso hover:bg-bb-white">
                          Preview only
                        </Badge>
                      </div>
                      <p className="text-sm leading-6 text-bb-warm-gray">
                        Draft generation, publish, archive, and sync actions on this page currently
                        shape the Reviews workflow only. They do not yet publish to a Google profile
                        or import production reviews.
                      </p>
                    </div>
                  )}

                  <div className="rounded-2xl border border-bb-border bg-bb-white p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-bb-text">Current inbox readiness</p>
                      <Badge
                        className={
                          reviewConnectionReady
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                            : 'border-bb-border bg-bb-linen text-bb-warm-gray hover:bg-bb-linen'
                        }
                      >
                        {reviewConnectionReady ? 'Ready for sync' : 'Not ready yet'}
                      </Badge>
                    </div>
                    <p className="text-sm leading-6 text-bb-warm-gray">
                      {reviewConnectionReady
                        ? 'BizzyBee has the saved profile and policy foundation it needs. The next step is ingesting live reviews into this queue.'
                        : 'The inbox stays empty until the review connection is saved with a Google account and location.'}
                    </p>
                  </div>

                  {reviewConnectionReady && (
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                      <div className="space-y-3">
                        {filteredPreviewReviews.length > 0 ? (
                          filteredPreviewReviews.map((review) => (
                            <button
                              key={review.id}
                              type="button"
                              onClick={() => setSelectedReviewId(review.id)}
                              className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                                selectedReview?.id === review.id
                                  ? 'border-bb-gold bg-bb-gold/10'
                                  : 'border-bb-border bg-bb-white hover:bg-bb-linen/60'
                              }`}
                            >
                              <div className="mb-2 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-bb-text">
                                    {review.authorName}
                                  </p>
                                  <p className="text-xs text-bb-warm-gray">{review.locationName}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge
                                    className={
                                      getReviewAttentionLevel(review.rating, review.replyStatus) ===
                                      'critical'
                                        ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-50'
                                        : getReviewAttentionLevel(
                                              review.rating,
                                              review.replyStatus,
                                            ) === 'high'
                                          ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50'
                                          : 'border-bb-border bg-bb-linen text-bb-warm-gray hover:bg-bb-linen'
                                    }
                                  >
                                    {review.rating} stars
                                  </Badge>
                                </div>
                              </div>

                              <div className="mb-3 flex flex-wrap items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="border-bb-border text-bb-text-secondary"
                                >
                                  {getReviewStatusLabel(review.status)}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className="border-bb-border text-bb-text-secondary"
                                >
                                  {review.replyStatus}
                                </Badge>
                                {review.ownerName ? (
                                  <Badge
                                    variant="outline"
                                    className="border-bb-border text-bb-text-secondary"
                                  >
                                    {review.ownerName}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="border-red-200 text-red-700">
                                    Owner needed
                                  </Badge>
                                )}
                                <span className="text-xs text-bb-warm-gray">
                                  {formatDistanceToNow(new Date(review.createdAt), {
                                    addSuffix: true,
                                  })}
                                </span>
                              </div>

                              <p className="line-clamp-3 text-sm leading-6 text-bb-warm-gray">
                                {review.body}
                              </p>
                            </button>
                          ))
                        ) : (
                          <div className="rounded-2xl border border-dashed border-bb-border bg-bb-linen/50 p-5 text-sm text-bb-warm-gray">
                            No preview reviews match this filter yet.
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl border border-bb-border bg-bb-white p-4">
                        {selectedReview ? (
                          <div className="space-y-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-lg font-semibold text-bb-text">
                                  {selectedReview.authorName}
                                </p>
                                <p className="text-sm text-bb-warm-gray">
                                  {selectedReview.locationName}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Badge
                                  className={
                                    getReviewAttentionLevel(
                                      selectedReview.rating,
                                      selectedReview.replyStatus,
                                    ) === 'critical'
                                      ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-50'
                                      : 'border-bb-border bg-bb-linen text-bb-warm-gray hover:bg-bb-linen'
                                  }
                                >
                                  {selectedReview.rating} stars
                                </Badge>
                                {selectedReview.ownerName && (
                                  <Badge
                                    variant="outline"
                                    className="border-bb-border text-bb-text-secondary"
                                  >
                                    Owner: {selectedReview.ownerName}
                                  </Badge>
                                )}
                              </div>
                            </div>

                            <p className="rounded-2xl border border-bb-border bg-bb-linen/60 p-4 text-sm leading-6 text-bb-text">
                              {selectedReview.body}
                            </p>

                            {selectedReview.draftReply && (
                              <div className="space-y-2">
                                <p className="text-xs font-medium uppercase tracking-[0.12em] text-bb-warm-gray">
                                  BizzyBee draft
                                </p>
                                <Textarea
                                  value={selectedReview.draftReply}
                                  onChange={(event) =>
                                    handleDraftChange(selectedReview.id, event.target.value)
                                  }
                                  className="min-h-[148px] rounded-2xl border-bb-border bg-bb-white text-sm leading-6 text-bb-text"
                                />
                              </div>
                            )}

                            {selectedReview.publishedReply && (
                              <div className="space-y-2">
                                <p className="text-xs font-medium uppercase tracking-[0.12em] text-bb-warm-gray">
                                  Published reply
                                </p>
                                <p className="rounded-2xl border border-bb-border bg-bb-white p-4 text-sm leading-6 text-bb-text">
                                  {selectedReview.publishedReply}
                                </p>
                                {selectedReview.publishedByName && (
                                  <p className="text-xs text-bb-warm-gray">
                                    Published by {selectedReview.publishedByName}
                                  </p>
                                )}
                              </div>
                            )}

                            <div className="space-y-2">
                              <p className="text-xs font-medium uppercase tracking-[0.12em] text-bb-warm-gray">
                                Reply ownership
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {REVIEW_OWNER_OPTIONS.map((owner) => (
                                  <button
                                    key={owner}
                                    type="button"
                                    onClick={() => handleAssignOwner(selectedReview.id, owner)}
                                    className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                                      selectedReview.ownerName === owner
                                        ? 'border-bb-gold bg-bb-gold/10 text-bb-espresso'
                                        : 'border-bb-border bg-bb-white text-bb-text-secondary'
                                    }`}
                                  >
                                    {owner}
                                  </button>
                                ))}
                              </div>
                              <p className="text-sm text-bb-warm-gray">
                                Reviews should have a clearly visible owner before BizzyBee drafts
                                or publishes on their behalf.
                              </p>
                            </div>

                            <div className="flex flex-wrap gap-3">
                              {selectedReview.replyStatus !== 'published' && (
                                <>
                                  <Button
                                    size="sm"
                                    variant={
                                      selectedReview.replyStatus === 'drafted'
                                        ? 'outline'
                                        : 'default'
                                    }
                                    onClick={() => handleGenerateDraft(selectedReview)}
                                  >
                                    <Sparkles className="mr-2 h-4 w-4" />
                                    {selectedReview.replyStatus === 'drafted'
                                      ? 'Refresh draft'
                                      : 'Generate draft'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => handlePublishDraft(selectedReview)}
                                  >
                                    <CheckCircle2 className="mr-2 h-4 w-4" />
                                    Publish preview reply
                                  </Button>
                                </>
                              )}

                              {selectedReview.replyStatus === 'published' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleReopenReview(selectedReview.id)}
                                >
                                  Reopen review
                                </Button>
                              )}

                              {selectedReview.status !== 'archived' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleArchivePreview(selectedReview.id)}
                                >
                                  Archive preview
                                </Button>
                              )}
                            </div>

                            <div className="rounded-2xl border border-bb-border bg-bb-linen/60 p-4">
                              <p className="text-sm font-medium text-bb-text">
                                Why this review matters
                              </p>
                              <p className="mt-2 text-sm leading-6 text-bb-warm-gray">
                                {getReviewAttentionLevel(
                                  selectedReview.rating,
                                  selectedReview.replyStatus,
                                ) === 'critical'
                                  ? 'This review crosses the current alert threshold and should sit near the top of the queue.'
                                  : selectedReview.status === 'archived'
                                    ? 'This preview review has been cleared from the working queue, which is useful for testing archive behavior before sync lands.'
                                    : selectedReview.replyStatus === 'drafted'
                                      ? 'BizzyBee has already prepared a draft, so the next action is review and publish.'
                                      : selectedReview.replyStatus === 'published'
                                        ? 'This review shows the completed end-state we want the live module to support.'
                                        : 'This review is waiting for a first reply and belongs in the day-to-day review queue.'}
                              </p>
                            </div>

                            <div className="rounded-2xl border border-dashed border-bb-border bg-bb-white p-4">
                              <p className="text-xs font-medium uppercase tracking-[0.12em] text-bb-warm-gray">
                                Live publishing boundary
                              </p>
                              <p className="mt-2 text-sm leading-6 text-bb-warm-gray">
                                This detail workflow is now structurally correct, but replies still
                                publish into the Reviews preview state only. The Google reply sync
                                path is the next implementation layer.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-bb-warm-gray">
                            Select a preview review to inspect the future detail workflow.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="space-y-3 rounded-2xl border border-dashed border-bb-border bg-bb-linen/50 p-5">
                    <div className="flex items-start gap-3">
                      <div className="rounded-full bg-bb-white p-2 text-bb-gold shadow-sm">
                        <Star className="h-4 w-4" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-bb-text">
                          First-class review handling
                        </p>
                        <p className="text-sm leading-6 text-bb-warm-gray">
                          Reviews should feel as complete as the current Training queue: clear
                          objects, clear filters, clear actions, and no confusion between drafted
                          and published states.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              <div className="space-y-4">
                <Card className="border-bb-border bg-bb-white p-5 shadow-sm">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-[0.12em] text-bb-warm-gray">
                        Alerts
                      </p>
                      <h2 className="text-lg font-semibold text-bb-text">Review alert policy</h2>
                    </div>

                    <div className="rounded-2xl border border-bb-border bg-bb-linen/70 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-bb-text">
                          Current routing foundation
                        </p>
                        <Badge
                          className={
                            alertsEnabled
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                              : 'border-bb-border bg-bb-white text-bb-warm-gray hover:bg-bb-white'
                          }
                        >
                          {alertsEnabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </div>
                      <p className="text-sm leading-5 text-bb-warm-gray">
                        {alertsEnabled
                          ? `BizzyBee can route future review alerts through ${reviewAlertChannels}.`
                          : 'Review alerts should reuse the existing notification system instead of inventing a second alert center.'}
                      </p>
                    </div>

                    <div className="space-y-4 rounded-2xl border border-bb-border bg-bb-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-bb-text">Enable review alerts</p>
                          <p className="text-sm text-bb-warm-gray">
                            Keep review-specific alert policy active for this workspace.
                          </p>
                        </div>
                        <Switch
                          checked={reviewAlertPolicyDraft.alertsEnabled}
                          onCheckedChange={(checked) =>
                            setReviewAlertPolicyDraft((current) => ({
                              ...current,
                              alertsEnabled: checked,
                            }))
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-bb-text">
                            Notify on every new review
                          </p>
                          <p className="text-sm text-bb-warm-gray">
                            Turn this on for higher-touch businesses that want all new reviews
                            surfaced.
                          </p>
                        </div>
                        <Switch
                          checked={reviewAlertPolicyDraft.notifyOnEveryNewReview}
                          onCheckedChange={(checked) =>
                            setReviewAlertPolicyDraft((current) => ({
                              ...current,
                              notifyOnEveryNewReview: checked,
                            }))
                          }
                        />
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="low-rating-threshold">Low-rating threshold</Label>
                          <Input
                            id="low-rating-threshold"
                            type="number"
                            min={1}
                            max={5}
                            value={reviewAlertPolicyDraft.lowRatingThreshold}
                            onChange={(event) =>
                              setReviewAlertPolicyDraft((current) => ({
                                ...current,
                                lowRatingThreshold: Number(event.target.value || 1),
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="stale-review-hours">Stale-review reminder (hours)</Label>
                          <Input
                            id="stale-review-hours"
                            type="number"
                            min={1}
                            value={reviewAlertPolicyDraft.staleReviewHours}
                            onChange={(event) =>
                              setReviewAlertPolicyDraft((current) => ({
                                ...current,
                                staleReviewHours: Number(event.target.value || 1),
                              }))
                            }
                          />
                        </div>
                      </div>

                      <p className="rounded-xl border border-bb-border bg-bb-linen/70 px-3 py-3 text-sm leading-6 text-bb-warm-gray">
                        {getReviewAlertSummary(reviewAlertPolicyDraft)}
                      </p>

                      <div className="flex flex-wrap gap-3">
                        <Button
                          onClick={saveReviewAlertPolicy}
                          disabled={!isReviewAlertPolicyDirty || savingAlertPolicy}
                        >
                          <Bell className="mr-2 h-4 w-4" />
                          {savingAlertPolicy ? 'Saving...' : 'Save review alert policy'}
                        </Button>
                        <Button asChild variant="outline">
                          <Link to="/settings?category=display">Open notification settings</Link>
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {[
                        {
                          label: `${reviewAlertPolicyDraft.lowRatingThreshold}-star and below reviews`,
                          critical:
                            getReviewAttentionLevel(
                              reviewAlertPolicyDraft.lowRatingThreshold,
                              'none',
                            ) === 'critical',
                        },
                        {
                          label: `Stale unreplied reviews after ${reviewAlertPolicyDraft.staleReviewHours}h`,
                          critical: true,
                        },
                        {
                          label: 'Reply publish failure',
                          critical: true,
                        },
                        {
                          label: 'Review sync error',
                          critical: true,
                        },
                      ].map((alertRule) => (
                        <div
                          key={alertRule.label}
                          className="flex items-center justify-between rounded-xl border border-bb-border bg-bb-linen/50 px-3 py-2"
                        >
                          <span className="text-sm text-bb-text">{alertRule.label}</span>
                          <Badge
                            className={
                              alertRule.critical
                                ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-50'
                                : 'border-bb-border bg-bb-white text-bb-warm-gray hover:bg-bb-white'
                            }
                          >
                            Policy set
                          </Badge>
                        </div>
                      ))}
                    </div>

                    {reviewConnectionReady && reviewAlertFeed.length > 0 && (
                      <div className="space-y-3 rounded-2xl border border-bb-border bg-bb-linen/50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-bb-text">Alert preview</p>
                          <Badge className="border-bb-border bg-bb-white text-bb-warm-gray hover:bg-bb-white">
                            {reviewAlertFeed.length} active
                          </Badge>
                        </div>

                        <div className="space-y-2">
                          {reviewAlertFeed.map((alert) => (
                            <button
                              key={alert.id}
                              type="button"
                              onClick={() => alert.reviewId && setSelectedReviewId(alert.reviewId)}
                              className="w-full rounded-xl border border-bb-border bg-bb-white px-3 py-3 text-left transition-colors hover:bg-bb-linen/60"
                            >
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <p className="text-sm font-medium text-bb-text">{alert.title}</p>
                                <Badge
                                  className={
                                    alert.severity === 'critical'
                                      ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-50'
                                      : alert.severity === 'high'
                                        ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50'
                                        : 'border-bb-border bg-bb-linen text-bb-warm-gray hover:bg-bb-linen'
                                  }
                                >
                                  {alert.severity}
                                </Badge>
                              </div>
                              <p className="text-sm leading-5 text-bb-warm-gray">
                                {alert.description}
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>

                <Card className="border-bb-border bg-bb-white p-5 shadow-sm">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-[0.12em] text-bb-warm-gray">
                        Locations
                      </p>
                      <h2 className="text-lg font-semibold text-bb-text">Multi-location ready</h2>
                    </div>

                    <div className="rounded-2xl border border-bb-border bg-bb-linen/70 p-4">
                      <div className="flex items-start gap-3">
                        <div className="rounded-full bg-bb-white p-2 text-bb-gold shadow-sm">
                          <MapPin className="h-4 w-4" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-bb-text">
                            Location-level drilldown is part of the design
                          </p>
                          <p className="text-sm leading-6 text-bb-warm-gray">
                            Reviews will eventually support one or many Google locations with their
                            own review counts, ratings, and reply workload. That’s why the module
                            now has its own dedicated data model instead of reusing conversations.
                          </p>
                        </div>
                      </div>
                    </div>

                    {reviewConnectionReady && reviewLocationSummaries.length > 0 && (
                      <div className="space-y-2">
                        {reviewLocationSummaries.map((location) => (
                          <div
                            key={location.locationName}
                            className="rounded-xl border border-bb-border bg-bb-white px-3 py-3"
                          >
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-bb-text">
                                {location.locationName}
                              </p>
                              <Badge
                                className={
                                  location.attentionCount > 0
                                    ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                                }
                              >
                                {location.averageRating.toFixed(1)} avg
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs text-bb-warm-gray">
                              <span>{location.totalReviews} reviews</span>
                              <span>{location.unrepliedCount} awaiting reply</span>
                              <span>{location.attentionCount} need attention</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>

                <Card className="border-bb-border bg-bb-white p-5 shadow-sm">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-xs font-medium uppercase tracking-[0.12em] text-bb-warm-gray">
                          Sync status
                        </p>
                        <h2 className="text-lg font-semibold text-bb-text">Review sync history</h2>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRunPreviewSync}
                        disabled={!reviewConnectionReady || runningPreviewSync}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        {runningPreviewSync ? 'Running...' : 'Run preview sync'}
                      </Button>
                    </div>

                    <div className="rounded-2xl border border-bb-border bg-bb-linen/70 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-bb-text">Current sync posture</p>
                        <Badge
                          className={
                            reviewConnectionReady
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                              : 'border-bb-border bg-bb-white text-bb-warm-gray hover:bg-bb-white'
                          }
                        >
                          {reviewConnectionReady ? 'Ready for sync' : 'Waiting on setup'}
                        </Badge>
                      </div>
                      <p className="text-sm leading-6 text-bb-warm-gray">
                        {lastPreviewSyncRun
                          ? lastPreviewSyncRun.status === 'running'
                            ? `A preview sync started ${formatDistanceToNow(
                                new Date(lastPreviewSyncRun.startedAt),
                                { addSuffix: true },
                              )} and is still running.`
                            : lastPreviewSyncRun.status === 'queued'
                              ? `A preview sync was queued ${formatDistanceToNow(
                                  new Date(lastPreviewSyncRun.startedAt),
                                  { addSuffix: true },
                                )} and is waiting to run.`
                              : `Last preview sync completed ${formatDistanceToNow(
                                  new Date(lastPreviewSyncRun.completedAt),
                                  { addSuffix: true },
                                )}.`
                          : 'No sync history yet. Once Reviews is connected, BizzyBee will show run history, imported counts, and failures here.'}
                      </p>
                      {reviewDataError && (
                        <p className="mt-3 text-sm text-amber-700">{reviewDataError}</p>
                      )}
                    </div>

                    {reviewConnectionReady ? (
                      <div className="space-y-2">
                        {previewSyncRuns.map((run) => (
                          <div
                            key={run.id}
                            className="rounded-xl border border-bb-border bg-bb-white px-3 py-3"
                          >
                            <div className="mb-1 flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-bb-text">
                                {run.status === 'success'
                                  ? 'Sync completed'
                                  : run.status === 'running'
                                    ? 'Sync in progress'
                                    : run.status === 'queued'
                                      ? 'Sync queued'
                                      : 'Sync needs attention'}
                              </p>
                              <Badge
                                className={
                                  run.status === 'success'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                                    : run.status === 'running' || run.status === 'queued'
                                      ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50'
                                      : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-50'
                                }
                              >
                                {run.status === 'success'
                                  ? 'Success'
                                  : run.status === 'running'
                                    ? 'Running'
                                    : run.status === 'queued'
                                      ? 'Queued'
                                      : 'Attention'}
                              </Badge>
                            </div>
                            <p className="text-sm leading-5 text-bb-warm-gray">{run.detail}</p>
                            <p className="mt-2 text-xs text-bb-warm-gray">
                              {run.status === 'running' || run.status === 'queued'
                                ? `Started ${formatDistanceToNow(new Date(run.startedAt), {
                                    addSuffix: true,
                                  })}.`
                                : `Started ${formatDistanceToNow(new Date(run.startedAt), {
                                    addSuffix: true,
                                  })} and finished ${formatDistanceToNow(
                                    new Date(run.completedAt),
                                    { addSuffix: true },
                                  )}.`}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-bb-border bg-bb-linen/50 p-4 text-sm text-bb-warm-gray">
                        Connect Google Reviews first, then BizzyBee can start showing sync runs and
                        import health here.
                      </div>
                    )}
                  </div>
                </Card>

                <Card className="border-bb-border bg-bb-white p-5 shadow-sm">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-[0.12em] text-bb-warm-gray">
                        Activity
                      </p>
                      <h2 className="text-lg font-semibold text-bb-text">
                        Review activity history
                      </h2>
                    </div>

                    <div className="rounded-2xl border border-bb-border bg-bb-linen/70 p-4">
                      <p className="text-sm leading-6 text-bb-warm-gray">
                        Reviews should have a visible operational trail, not just a static list.
                        This activity feed shows the kind of history we’ll preserve once sync and
                        replies become live.
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      {[
                        {
                          label: 'Drafted replies',
                          value: draftedCount,
                          tone: 'border-bb-border bg-bb-linen text-bb-text',
                        },
                        {
                          label: 'Published replies',
                          value: publishedCount,
                          tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
                        },
                        {
                          label: 'Archived items',
                          value: archivedCount,
                          tone: 'border-bb-border bg-bb-white text-bb-warm-gray',
                        },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="rounded-xl border border-bb-border bg-bb-white px-3 py-3"
                        >
                          <p className="text-xs uppercase tracking-[0.12em] text-bb-warm-gray">
                            {item.label}
                          </p>
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <p className="text-2xl font-semibold text-bb-text">{item.value}</p>
                            <Badge className={item.tone}>
                              {item.value > 0 ? 'Active' : 'Empty'}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-2xl border border-bb-border bg-bb-white p-4">
                      <p className="text-sm font-medium text-bb-text">Ownership coverage</p>
                      <p className="mt-2 text-sm leading-6 text-bb-warm-gray">
                        {assignedOwnerCount > 0
                          ? `${assignedOwnerCount} owner profiles are currently represented across the preview review queue.`
                          : 'No reply ownership is assigned yet. A first-class Reviews module should always show who owns the next action.'}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-bb-border bg-bb-linen/50 p-4">
                      <p className="text-sm font-medium text-bb-text">Reply audit summary</p>
                      <p className="mt-2 text-sm leading-6 text-bb-warm-gray">
                        {latestPublishedReplyAt
                          ? `The latest published preview reply landed ${formatDistanceToNow(
                              new Date(latestPublishedReplyAt),
                              { addSuffix: true },
                            )}. This is where live publish timestamps and reply accountability will sit.`
                          : 'No published replies yet. Once replies start going out, BizzyBee will show who replied, when it happened, and which reviews still need a response.'}
                      </p>
                    </div>

                    {reviewConnectionReady && reviewActivityFeed.length > 0 ? (
                      <div className="space-y-2">
                        {reviewActivityFeed.map((activity) => (
                          <button
                            key={activity.id}
                            type="button"
                            onClick={() =>
                              activity.reviewId && setSelectedReviewId(activity.reviewId)
                            }
                            className="w-full rounded-xl border border-bb-border bg-bb-white px-3 py-3 text-left transition-colors hover:bg-bb-linen/60"
                          >
                            <div className="mb-1 flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-bb-text">{activity.title}</p>
                              <span className="text-xs text-bb-warm-gray">
                                {formatDistanceToNow(new Date(activity.at), {
                                  addSuffix: true,
                                })}
                              </span>
                            </div>
                            <p className="text-sm leading-5 text-bb-warm-gray">{activity.detail}</p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-bb-border bg-bb-linen/50 p-4 text-sm text-bb-warm-gray">
                        Activity history will populate once reviews, drafts, and replies start
                        moving through the module.
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (isMobile) {
    return <MobilePageLayout>{content}</MobilePageLayout>;
  }

  return <ThreeColumnLayout sidebar={<Sidebar />} main={content} />;
}

export default function Reviews() {
  return <ReviewsPageContent />;
}
