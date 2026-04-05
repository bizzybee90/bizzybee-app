export type ReviewProviderKey = 'google';
export type ReviewSurface = 'onboarding' | 'settings' | 'dashboard' | 'detail' | 'notifications';
export type ReviewConnectionState =
  | 'disconnected'
  | 'needs_location'
  | 'syncing'
  | 'ready'
  | 'attention_required'
  | 'coming_soon';
export type ReviewInboxState =
  | 'new'
  | 'unreplied'
  | 'drafted'
  | 'published'
  | 'attention_required'
  | 'archived';
export type ReviewReplyStatus = 'none' | 'drafted' | 'approved' | 'published' | 'failed';
export type ReviewInboxFilterKey =
  | 'all'
  | 'new'
  | 'unreplied'
  | 'low_rating'
  | 'drafted'
  | 'published'
  | 'attention';
export type ReviewMetricKey =
  | 'avg_rating'
  | 'total_reviews'
  | 'new_reviews'
  | 'unreplied'
  | 'response_time'
  | 'low_rating_share';
export type ReviewNotificationType =
  | 'review_new'
  | 'review_low_rating'
  | 'review_stale_unreplied'
  | 'review_reply_failed'
  | 'review_sync_error';
export type ReviewAttentionLevel = 'normal' | 'high' | 'critical';

export interface ReviewAlertPolicy {
  alertsEnabled: boolean;
  notifyOnEveryNewReview: boolean;
  lowRatingThreshold: number;
  staleReviewHours: number;
}

export interface ReviewProviderDefinition {
  key: ReviewProviderKey;
  label: string;
  description: string;
  onboardingNote?: string;
  surfaces: ReviewSurface[];
  availableNow: boolean;
}

export interface ReviewConfigField {
  key: string;
  label: string;
  placeholder: string;
  helpText: string;
  required?: boolean;
}

export interface ReviewSetupProgress {
  requiredCount: number;
  completedCount: number;
  missingLabels: string[];
  isComplete: boolean;
}

export interface ReviewProviderRecord {
  provider: string;
  status?: string | null;
  config?: unknown;
  last_synced_at?: string | null;
  last_error?: string | null;
}

export interface ReviewLocationRecord {
  id?: string;
  provider_location_ref?: string | null;
  provider_account_ref?: string | null;
  place_id?: string | null;
  name?: string | null;
  address?: string | null;
  is_primary?: boolean | null;
  avg_rating_cached?: number | null;
  review_count_cached?: number | null;
  last_synced_at?: string | null;
}

export interface ReviewMetricDefinition {
  key: ReviewMetricKey;
  label: string;
  description: string;
}

export interface ReviewInboxFilterDefinition {
  key: ReviewInboxFilterKey;
  label: string;
  description: string;
}

export interface ReviewPreviewRecord {
  id: string;
  provider: ReviewProviderKey;
  locationName: string;
  authorName: string;
  rating: number;
  body: string;
  status: ReviewInboxState;
  replyStatus: ReviewReplyStatus;
  createdAt: string;
  publishedReplyAt?: string | null;
  draftReply?: string | null;
  publishedReply?: string | null;
  ownerName?: string | null;
  draftUpdatedAt?: string | null;
  publishedByName?: string | null;
}

export interface ReviewLocationSummary {
  locationName: string;
  totalReviews: number;
  averageRating: number;
  unrepliedCount: number;
  attentionCount: number;
}

export interface ReviewAlertPreviewItem {
  id: string;
  title: string;
  description: string;
  severity: ReviewAttentionLevel;
  reviewId?: string;
}

export interface ReviewActivityPreviewItem {
  id: string;
  title: string;
  detail: string;
  at: string;
  reviewId?: string;
}

export const REVIEW_PROVIDER_DEFINITIONS: Record<ReviewProviderKey, ReviewProviderDefinition> = {
  google: {
    key: 'google',
    label: 'Google Reviews',
    description: 'Manage Google Business Profile reviews in a dedicated BizzyBee review inbox.',
    onboardingNote: 'Ideal for local service businesses where public reviews drive trust.',
    surfaces: ['onboarding', 'settings', 'dashboard', 'detail', 'notifications'],
    availableNow: false,
  },
};

export const REVIEW_CONFIG_FIELDS: Record<ReviewProviderKey, ReviewConfigField[]> = {
  google: [
    {
      key: 'accountRef',
      label: 'Google Business account reference',
      placeholder: 'accounts/123456789',
      helpText: 'Used to identify the connected Google Business account.',
      required: true,
    },
    {
      key: 'locationRef',
      label: 'Google Business location reference',
      placeholder: 'locations/987654321',
      helpText: 'Used to sync reviews for the selected business location.',
      required: true,
    },
    {
      key: 'placeId',
      label: 'Google place ID',
      placeholder: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      helpText: 'Optional extra identifier for analytics and cross-surface linking.',
      required: false,
    },
  ],
};

export const REVIEW_METRICS: ReviewMetricDefinition[] = [
  {
    key: 'avg_rating',
    label: 'Average rating',
    description: 'Current average rating across connected review locations.',
  },
  {
    key: 'total_reviews',
    label: 'Total reviews',
    description: 'Total imported reviews across connected locations.',
  },
  {
    key: 'new_reviews',
    label: 'New reviews',
    description: 'Reviews received inside the selected reporting window.',
  },
  {
    key: 'unreplied',
    label: 'Unreplied',
    description: 'Reviews that still need a published response.',
  },
  {
    key: 'response_time',
    label: 'Response time',
    description: 'Average time taken to publish a reply after the review arrives.',
  },
  {
    key: 'low_rating_share',
    label: 'Low-rating share',
    description: 'Percentage of reviews that are 1-3 stars in the selected window.',
  },
];

export const REVIEW_INBOX_FILTERS: ReviewInboxFilterDefinition[] = [
  {
    key: 'all',
    label: 'All reviews',
    description: 'Everything imported into the review inbox.',
  },
  {
    key: 'new',
    label: 'New',
    description: 'Recently synced reviews that have not been touched yet.',
  },
  {
    key: 'unreplied',
    label: 'Unreplied',
    description: 'Reviews that still need a published response.',
  },
  {
    key: 'low_rating',
    label: 'Low rating',
    description: '1-3 star reviews that need closer attention.',
  },
  {
    key: 'drafted',
    label: 'Drafted',
    description: 'Reviews with a saved BizzyBee draft awaiting publication.',
  },
  {
    key: 'published',
    label: 'Published',
    description: 'Reviews where a reply has already been published.',
  },
  {
    key: 'attention',
    label: 'Needs attention',
    description: 'Failed replies, sync issues, or stale unreplied reviews.',
  },
];

export const DEFAULT_REVIEW_ALERT_POLICY: ReviewAlertPolicy = {
  alertsEnabled: true,
  notifyOnEveryNewReview: false,
  lowRatingThreshold: 3,
  staleReviewHours: 24,
};

function hasMeaningfulConfigValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (typeof value === 'number') {
    return true;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasMeaningfulConfigValue(entry));
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      hasMeaningfulConfigValue(entry),
    );
  }

  return false;
}

export function getReviewProviderDefinition(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return REVIEW_PROVIDER_DEFINITIONS[normalized as ReviewProviderKey] ?? null;
}

export function getReviewConfigFields(value: string | null | undefined): ReviewConfigField[] {
  const definition = getReviewProviderDefinition(value);
  return definition ? (REVIEW_CONFIG_FIELDS[definition.key] ?? []) : [];
}

export function getMissingReviewConfigFields(
  value: string | null | undefined,
  config: unknown,
): ReviewConfigField[] {
  const requiredFields = getReviewConfigFields(value).filter((field) => field.required !== false);

  if (!requiredFields.length) {
    return [];
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return requiredFields;
  }

  const configObject = config as Record<string, unknown>;
  return requiredFields.filter((field) => !hasMeaningfulConfigValue(configObject[field.key]));
}

export function getMissingReviewConfigLabels(value: string | null | undefined, config: unknown) {
  return getMissingReviewConfigFields(value, config).map((field) => field.label);
}

export function getReviewSetupProgress(
  value: string | null | undefined,
  config: unknown,
): ReviewSetupProgress {
  const requiredFields = getReviewConfigFields(value).filter((field) => field.required !== false);
  const missingFields = getMissingReviewConfigFields(value, config);

  return {
    requiredCount: requiredFields.length,
    completedCount: Math.max(requiredFields.length - missingFields.length, 0),
    missingLabels: missingFields.map((field) => field.label),
    isComplete: missingFields.length === 0,
  };
}

export function deriveReviewConnectionState(
  value: string | null | undefined,
  record?: ReviewProviderRecord | null,
  locations: ReviewLocationRecord[] = [],
): ReviewConnectionState {
  const definition = getReviewProviderDefinition(value);

  if (!definition) {
    return 'coming_soon';
  }

  if (!record) {
    return 'disconnected';
  }

  if (record.status === 'syncing') {
    return 'syncing';
  }

  if (record.status === 'error' || hasMeaningfulConfigValue(record.last_error)) {
    return 'attention_required';
  }

  const missingConfig = getMissingReviewConfigFields(definition.key, record.config);
  if (missingConfig.length > 0) {
    return 'needs_location';
  }

  return locations.length > 0 ? 'ready' : 'needs_location';
}

export function getReviewSetupDescription(
  definition: ReviewProviderDefinition,
  state: ReviewConnectionState,
  config?: unknown,
) {
  const missingLabels = getMissingReviewConfigLabels(definition.key, config);

  if (state === 'ready') {
    return 'Review management is connected and ready to sync live public reviews.';
  }

  if (state === 'syncing') {
    return 'BizzyBee is syncing reviews and refreshing the connected location state.';
  }

  if (state === 'attention_required') {
    return 'The review connection needs attention before BizzyBee can manage reviews reliably.';
  }

  if (state === 'needs_location') {
    if (missingLabels.length > 0) {
      return `BizzyBee still needs ${missingLabels.join(', ')} before review sync can go live.`;
    }

    return 'A review location still needs to be selected before the inbox can go live.';
  }

  if (state === 'disconnected') {
    return 'Connect a review source to turn BizzyBee into a live review-management workspace.';
  }

  return `${definition.label} is planned, but not yet available as a self-serve review source.`;
}

export function getReviewSetupActionLabel(
  definition: ReviewProviderDefinition,
  state: ReviewConnectionState,
  config?: unknown,
) {
  const missingFields = getMissingReviewConfigFields(definition.key, config);

  if (missingFields.length === 1) {
    return `Add ${missingFields[0].label}`;
  }

  if (missingFields.length > 1) {
    return 'Finish review setup';
  }

  switch (state) {
    case 'disconnected':
      return 'Connect reviews';
    case 'needs_location':
      return 'Select location';
    case 'syncing':
      return 'View sync status';
    case 'attention_required':
      return 'Fix review connection';
    default:
      return 'Open reviews';
  }
}

export function getReviewSetupHref(value: string | null | undefined) {
  const definition = getReviewProviderDefinition(value);
  const params = new URLSearchParams();

  if (definition) {
    params.set('setup', definition.key);
  }

  return params.size > 0 ? `/reviews?${params.toString()}` : '/reviews';
}

export function getReviewAttentionLevel(
  rating: number | null | undefined,
  replyStatus: ReviewReplyStatus,
) {
  if (replyStatus === 'failed') {
    return 'critical';
  }

  if (!rating) {
    return 'normal';
  }

  if (rating <= 2) {
    return replyStatus === 'published' ? 'high' : 'critical';
  }

  if (rating === 3) {
    return replyStatus === 'published' ? 'normal' : 'high';
  }

  return 'normal';
}

export function getReviewAlertPolicy(config: unknown): ReviewAlertPolicy {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return DEFAULT_REVIEW_ALERT_POLICY;
  }

  const configObject = config as Record<string, unknown>;
  const reviewAlerts =
    configObject.reviewAlerts && typeof configObject.reviewAlerts === 'object'
      ? (configObject.reviewAlerts as Record<string, unknown>)
      : {};

  return {
    alertsEnabled:
      typeof reviewAlerts.alertsEnabled === 'boolean'
        ? reviewAlerts.alertsEnabled
        : DEFAULT_REVIEW_ALERT_POLICY.alertsEnabled,
    notifyOnEveryNewReview:
      typeof reviewAlerts.notifyOnEveryNewReview === 'boolean'
        ? reviewAlerts.notifyOnEveryNewReview
        : DEFAULT_REVIEW_ALERT_POLICY.notifyOnEveryNewReview,
    lowRatingThreshold:
      typeof reviewAlerts.lowRatingThreshold === 'number'
        ? Math.max(1, Math.min(5, Math.round(reviewAlerts.lowRatingThreshold)))
        : DEFAULT_REVIEW_ALERT_POLICY.lowRatingThreshold,
    staleReviewHours:
      typeof reviewAlerts.staleReviewHours === 'number'
        ? Math.max(1, Math.round(reviewAlerts.staleReviewHours))
        : DEFAULT_REVIEW_ALERT_POLICY.staleReviewHours,
  };
}

export function getReviewAlertSummary(policy: ReviewAlertPolicy) {
  if (!policy.alertsEnabled) {
    return 'Review alerts are currently paused.';
  }

  const newReviewScope = policy.notifyOnEveryNewReview
    ? 'every new review'
    : `${policy.lowRatingThreshold}-star and below reviews`;

  return `BizzyBee will flag ${newReviewScope} and remind the team again after ${policy.staleReviewHours} hour${policy.staleReviewHours === 1 ? '' : 's'} without a published reply.`;
}

export function getReviewStatusLabel(status: ReviewInboxState) {
  switch (status) {
    case 'new':
      return 'New';
    case 'unreplied':
      return 'Unreplied';
    case 'drafted':
      return 'Drafted';
    case 'published':
      return 'Published';
    case 'attention_required':
      return 'Needs attention';
    case 'archived':
      return 'Archived';
    default:
      return status;
  }
}

export function filterReviewInbox(
  reviews: ReviewPreviewRecord[],
  filter: ReviewInboxFilterKey,
  policy: ReviewAlertPolicy,
) {
  switch (filter) {
    case 'all':
      return reviews;
    case 'new':
      return reviews.filter((review) => review.status === 'new');
    case 'unreplied':
      return reviews.filter(
        (review) => review.replyStatus === 'none' || review.status === 'unreplied',
      );
    case 'low_rating':
      return reviews.filter((review) => review.rating <= policy.lowRatingThreshold);
    case 'drafted':
      return reviews.filter((review) => review.replyStatus === 'drafted');
    case 'published':
      return reviews.filter((review) => review.replyStatus === 'published');
    case 'attention':
      return reviews.filter(
        (review) =>
          review.status === 'attention_required' ||
          getReviewAttentionLevel(review.rating, review.replyStatus) !== 'normal',
      );
    default:
      return reviews;
  }
}

export function buildReviewPreviewData(policy: ReviewAlertPolicy): ReviewPreviewRecord[] {
  return [
    {
      id: 'review-preview-1',
      provider: 'google',
      locationName: 'MAC Cleaning - St Albans',
      authorName: 'Sarah Collins',
      rating: 2,
      body: 'Lovely cleaner, but the team arrived late and one of the upstairs windows was missed. I had to chase for an update.',
      status: 'attention_required',
      replyStatus: 'none',
      createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
      ownerName: 'Michael',
    },
    {
      id: 'review-preview-2',
      provider: 'google',
      locationName: 'MAC Cleaning - St Albans',
      authorName: 'James Turner',
      rating: 5,
      body: 'Fantastic end-of-tenancy clean. Easy to book, on time, and the landlord was delighted.',
      status: 'drafted',
      replyStatus: 'drafted',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
      ownerName: 'BizzyBee Ops',
      draftUpdatedAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
      draftReply:
        'Thank you, James. We are so pleased the clean made the handover easy and that the result landed well with your landlord too.',
    },
    {
      id: 'review-preview-3',
      provider: 'google',
      locationName: 'MAC Cleaning - Harpenden',
      authorName: 'Priya Lal',
      rating: policy.lowRatingThreshold,
      body: 'Very good overall and friendly team. A couple of little touches were missed but they sorted it quickly.',
      status: 'unreplied',
      replyStatus: 'none',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
      ownerName: 'MAC CS Lead',
    },
    {
      id: 'review-preview-4',
      provider: 'google',
      locationName: 'MAC Cleaning - Harpenden',
      authorName: 'Daniel Morris',
      rating: 4,
      body: 'Good service and quick communication. Would use again.',
      status: 'published',
      replyStatus: 'published',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 40).toISOString(),
      publishedReplyAt: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
      ownerName: 'BizzyBee Ops',
      publishedByName: 'Michael',
      publishedReply:
        'Thank you, Daniel. We really appreciate you taking the time to leave a review and would be glad to help again.',
    },
  ];
}

export function summarizeReviewLocations(reviews: ReviewPreviewRecord[]): ReviewLocationSummary[] {
  const grouped = new Map<string, ReviewPreviewRecord[]>();

  for (const review of reviews) {
    const existing = grouped.get(review.locationName) ?? [];
    existing.push(review);
    grouped.set(review.locationName, existing);
  }

  return Array.from(grouped.entries())
    .map(([locationName, locationReviews]) => {
      const totalReviews = locationReviews.length;
      const averageRating =
        locationReviews.reduce((total, review) => total + review.rating, 0) / totalReviews;
      const unrepliedCount = locationReviews.filter(
        (review) => review.replyStatus !== 'published',
      ).length;
      const attentionCount = locationReviews.filter(
        (review) => getReviewAttentionLevel(review.rating, review.replyStatus) !== 'normal',
      ).length;

      return {
        locationName,
        totalReviews,
        averageRating,
        unrepliedCount,
        attentionCount,
      };
    })
    .sort((left, right) => right.attentionCount - left.attentionCount);
}

export function buildReviewAlertFeed(
  reviews: ReviewPreviewRecord[],
  policy: ReviewAlertPolicy,
): ReviewAlertPreviewItem[] {
  const items: ReviewAlertPreviewItem[] = [];

  for (const review of reviews) {
    if (review.replyStatus === 'failed') {
      items.push({
        id: `${review.id}-reply-failed`,
        title: 'Reply publish failure',
        description: `${review.authorName} on ${review.locationName} needs a retry because the last reply publish failed.`,
        severity: 'critical',
        reviewId: review.id,
      });
      continue;
    }

    if (review.rating <= policy.lowRatingThreshold) {
      items.push({
        id: `${review.id}-low-rating`,
        title: `${review.rating}-star review needs attention`,
        description: `${review.authorName} left a ${review.rating}-star review for ${review.locationName}.`,
        severity: getReviewAttentionLevel(review.rating, review.replyStatus),
        reviewId: review.id,
      });
    }

    const ageHours = (Date.now() - new Date(review.createdAt).getTime()) / (1000 * 60 * 60);
    if (review.replyStatus !== 'published' && ageHours >= policy.staleReviewHours) {
      items.push({
        id: `${review.id}-stale`,
        title: 'Unreplied review is now stale',
        description: `${review.authorName}'s review has been waiting ${Math.floor(ageHours)}h without a published reply.`,
        severity: 'critical',
        reviewId: review.id,
      });
    }
  }

  if (policy.notifyOnEveryNewReview) {
    const newestReview = [...reviews].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    )[0];

    if (newestReview) {
      items.unshift({
        id: `${newestReview.id}-new-review`,
        title: 'New review notification',
        description: `${newestReview.authorName} just left a new review for ${newestReview.locationName}.`,
        severity: 'normal',
        reviewId: newestReview.id,
      });
    }
  }

  return items.slice(0, 6);
}

export function buildReviewActivityFeed(
  reviews: ReviewPreviewRecord[],
): ReviewActivityPreviewItem[] {
  const items: ReviewActivityPreviewItem[] = reviews.flatMap((review) => {
    const reviewItems: ReviewActivityPreviewItem[] = [
      {
        id: `${review.id}-created`,
        title: 'Review received',
        detail: `${review.authorName} left ${review.rating} stars for ${review.locationName}.`,
        at: review.createdAt,
        reviewId: review.id,
      },
    ];

    if (review.draftReply?.trim()) {
      reviewItems.push({
        id: `${review.id}-drafted`,
        title: 'BizzyBee draft prepared',
        detail: `A draft reply is ready for ${review.authorName}'s review${review.ownerName ? ` and is currently owned by ${review.ownerName}` : ''}.`,
        at: review.draftUpdatedAt ?? review.createdAt,
        reviewId: review.id,
      });
    }

    if (review.publishedReplyAt) {
      reviewItems.push({
        id: `${review.id}-published`,
        title: 'Reply published',
        detail: `A reply has been published for ${review.authorName}'s review${review.publishedByName ? ` by ${review.publishedByName}` : ''}.`,
        at: review.publishedReplyAt,
        reviewId: review.id,
      });
    }

    if (review.status === 'archived') {
      reviewItems.push({
        id: `${review.id}-archived`,
        title: 'Preview review archived',
        detail: `${review.authorName}'s preview review has been cleared from the working queue.`,
        at: new Date().toISOString(),
        reviewId: review.id,
      });
    }

    return reviewItems;
  });

  return items.sort((left, right) => right.at.localeCompare(left.at)).slice(0, 8);
}
