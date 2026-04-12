export type ReviewInboxState =
  | 'new'
  | 'unreplied'
  | 'drafted'
  | 'published'
  | 'attention_required'
  | 'archived';

export type ReviewReplyStatus = 'none' | 'drafted' | 'approved' | 'published' | 'failed';

export interface ReviewPreviewRecord {
  id: string;
  provider: 'google';
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

export interface ReviewSyncPreviewRun {
  id: string;
  status: 'success' | 'attention_required';
  startedAt: string;
  completedAt: string;
  detail: string;
}

export interface ReviewLocationResponse {
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

export interface GooglePreviewSeed {
  providerReviewId: string;
  authorName: string;
  rating: number;
  body: string;
  status: ReviewInboxState;
  replyStatus: ReviewReplyStatus;
  createdAt: string;
  ownerName?: string | null;
  draftReply?: string | null;
  draftUpdatedAt?: string | null;
  publishedReply?: string | null;
  publishedReplyAt?: string | null;
  publishedByName?: string | null;
}

export function buildGooglePreviewSeed(
  providerLocationRef: string,
  locationName: string,
): GooglePreviewSeed[] {
  const now = Date.now();

  return [
    {
      providerReviewId: `${providerLocationRef}::preview-1`,
      authorName: 'Sarah Collins',
      rating: 2,
      body: 'Lovely cleaner, but the team arrived late and one of the upstairs windows was missed. I had to chase for an update.',
      status: 'attention_required',
      replyStatus: 'none',
      createdAt: new Date(now - 1000 * 60 * 90).toISOString(),
      ownerName: 'Michael',
    },
    {
      providerReviewId: `${providerLocationRef}::preview-2`,
      authorName: 'James Turner',
      rating: 5,
      body: 'Fantastic end-of-tenancy clean. Easy to book, on time, and the landlord was delighted.',
      status: 'drafted',
      replyStatus: 'drafted',
      createdAt: new Date(now - 1000 * 60 * 60 * 8).toISOString(),
      ownerName: 'BizzyBee Ops',
      draftUpdatedAt: new Date(now - 1000 * 60 * 35).toISOString(),
      draftReply:
        'Thank you, James. We are so pleased the clean made the handover easy and that the result landed well with your landlord too.',
    },
    {
      providerReviewId: `${providerLocationRef}::preview-3`,
      authorName: 'Priya Lal',
      rating: 3,
      body: 'Very good overall and friendly team. A couple of little touches were missed but they sorted it quickly.',
      status: 'unreplied',
      replyStatus: 'none',
      createdAt: new Date(now - 1000 * 60 * 60 * 26).toISOString(),
      ownerName: 'MAC CS Lead',
    },
    {
      providerReviewId: `${providerLocationRef}::preview-4`,
      authorName: 'Daniel Morris',
      rating: 4,
      body: 'Good service and quick communication. Would use again.',
      status: 'published',
      replyStatus: 'published',
      createdAt: new Date(now - 1000 * 60 * 60 * 40).toISOString(),
      ownerName: 'BizzyBee Ops',
      publishedByName: 'Michael',
      publishedReplyAt: new Date(now - 1000 * 60 * 60 * 30).toISOString(),
      publishedReply:
        'Thank you, Daniel. We really appreciate you taking the time to leave a review and would be glad to help again.',
    },
  ].map((seed) => ({
    ...seed,
    body: seed.body.replaceAll('{locationName}', locationName),
  }));
}

export function mapReviewLocationRow(row: Record<string, unknown>): ReviewLocationResponse {
  const avgRatingValue = row.avg_rating_cached;
  const reviewCountValue = row.review_count_cached;

  return {
    id: String(row.id),
    provider_location_ref:
      typeof row.provider_location_ref === 'string' ? row.provider_location_ref : null,
    provider_account_ref:
      typeof row.provider_account_ref === 'string' ? row.provider_account_ref : null,
    place_id: typeof row.place_id === 'string' ? row.place_id : null,
    name: typeof row.name === 'string' ? row.name : null,
    address: typeof row.address === 'string' ? row.address : null,
    is_primary: typeof row.is_primary === 'boolean' ? row.is_primary : null,
    avg_rating_cached:
      typeof avgRatingValue === 'number'
        ? avgRatingValue
        : typeof avgRatingValue === 'string' && avgRatingValue.trim().length > 0
          ? Number(avgRatingValue)
          : null,
    review_count_cached:
      typeof reviewCountValue === 'number'
        ? reviewCountValue
        : typeof reviewCountValue === 'string' && reviewCountValue.trim().length > 0
          ? Number(reviewCountValue)
          : null,
    last_synced_at: typeof row.last_synced_at === 'string' ? row.last_synced_at : null,
    sync_status: typeof row.sync_status === 'string' ? row.sync_status : null,
    last_error: typeof row.last_error === 'string' ? row.last_error : null,
  };
}

export function mapReviewItemRowToPreview(
  row: Record<string, unknown>,
  locationName: string,
): ReviewPreviewRecord {
  return {
    id: String(row.id),
    provider: 'google',
    locationName,
    authorName: typeof row.author_name === 'string' ? row.author_name : 'Unknown reviewer',
    rating: Number(row.rating ?? 0),
    body: typeof row.body === 'string' ? row.body : '',
    status: (typeof row.status === 'string' ? row.status : 'new') as ReviewInboxState,
    replyStatus: (typeof row.reply_status === 'string'
      ? row.reply_status
      : 'none') as ReviewReplyStatus,
    createdAt:
      typeof row.created_at_provider === 'string'
        ? row.created_at_provider
        : new Date().toISOString(),
    publishedReplyAt: typeof row.published_reply_at === 'string' ? row.published_reply_at : null,
    draftReply: typeof row.draft_reply === 'string' ? row.draft_reply : null,
    publishedReply: typeof row.published_reply === 'string' ? row.published_reply : null,
    ownerName: typeof row.owner_name === 'string' ? row.owner_name : null,
    draftUpdatedAt: typeof row.draft_updated_at === 'string' ? row.draft_updated_at : null,
    publishedByName: typeof row.published_by_name === 'string' ? row.published_by_name : null,
  };
}

export function mapReviewSyncRunRow(row: Record<string, unknown>): ReviewSyncPreviewRun {
  return {
    id: String(row.id),
    status:
      row.status === 'attention_required' || row.status === 'failed'
        ? 'attention_required'
        : 'success',
    startedAt: typeof row.started_at === 'string' ? row.started_at : new Date().toISOString(),
    completedAt:
      typeof row.completed_at === 'string'
        ? row.completed_at
        : typeof row.started_at === 'string'
          ? row.started_at
          : new Date().toISOString(),
    detail:
      typeof row.detail === 'string'
        ? row.detail
        : typeof row.error_message === 'string'
          ? row.error_message
          : 'Review sync run completed.',
  };
}

export function computeLocationMetricsFromSeed(seed: GooglePreviewSeed[]) {
  if (!seed.length) {
    return { count: 0, avgRating: null as number | null };
  }

  const total = seed.reduce((sum, review) => sum + review.rating, 0);
  return {
    count: seed.length,
    avgRating: Number((total / seed.length).toFixed(2)),
  };
}
