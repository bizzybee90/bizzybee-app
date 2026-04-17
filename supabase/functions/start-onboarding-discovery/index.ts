import {
  HttpError,
  createServiceClient,
  isUuidLike,
  jsonResponse,
  queueSend,
  wakeWorker,
} from '../_shared/pipeline.ts';
import {
  ONBOARDING_DISCOVERY_QUEUE,
  ONBOARDING_SUPERVISOR_QUEUE,
  buildDefaultSearchQueries,
  createOnboardingRun,
  defaultModelPolicy,
  defaultProviderPolicy,
  domainFromUrl,
  normalizePrimaryServiceLocation,
} from '../_shared/onboarding.ts';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';
import {
  MAX_SEARCH_QUERIES,
  MAX_SEARCH_QUERY_LENGTH,
  normalizeSearchQueries,
} from '../_shared/searchQueryValidation.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function corsResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function buildNicheQuery(
  businessType: string | null | undefined,
  serviceArea: string | null | undefined,
): string {
  const normalizedType = String(businessType || '').trim() || 'business';
  const normalizedLocation = normalizePrimaryServiceLocation(serviceArea);
  return normalizedLocation ? `${normalizedType} near ${normalizedLocation}` : normalizedType;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }

    const body = (await req.json()) as {
      workspace_id?: string;
      target_count?: number;
      search_queries?: string[];
      towns_used?: string[];
      trigger_source?: string;
    };

    const workspaceId = body.workspace_id?.trim();
    if (!workspaceId || !isUuidLike(workspaceId)) {
      throw new HttpError(400, 'workspace_id must be a UUID');
    }

    try {
      await validateAuth(req, workspaceId);
    } catch (error) {
      if (error instanceof AuthError) return authErrorResponse(error);
      throw error;
    }

    const supabase = createServiceClient();

    const { data: businessContext, error: businessContextError } = await supabase
      .from('business_context')
      .select('company_name, business_type, service_area, website_url')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (businessContextError) {
      throw new Error(`Failed to load business context: ${businessContextError.message}`);
    }

    // Normalise user-supplied search terms: cap count, trim length, dedupe,
    // reject non-strings. Previously this was a bare filter that left Apify
    // spend unbounded — 50 terms = 50 Apify calls. See searchQueryValidation.ts.
    let searchQueries: string[];
    if (Array.isArray(body.search_queries) && body.search_queries.length > 0) {
      const normalised = normalizeSearchQueries(body.search_queries);
      if (normalised.queries.length === 0) {
        throw new HttpError(
          400,
          `search_queries contained no valid terms after normalisation (max ${MAX_SEARCH_QUERIES} terms, ${MAX_SEARCH_QUERY_LENGTH} chars each)`,
        );
      }
      if (normalised.rejections.length > 0) {
        console.warn('[start-onboarding-discovery] search_queries normalisation rejected entries', {
          workspaceId,
          rejections: normalised.rejections,
          accepted: normalised.queries.length,
        });
      }
      searchQueries = normalised.queries;
    } else {
      searchQueries = buildDefaultSearchQueries(
        businessContext?.business_type,
        businessContext?.service_area,
      );
    }

    if (searchQueries.length === 0) {
      throw new HttpError(400, 'search_queries could not be derived for this workspace');
    }

    const targetCount = Math.max(5, Math.min(25, Math.floor(Number(body.target_count || 15))));
    const nicheQuery = buildNicheQuery(
      businessContext?.business_type,
      businessContext?.service_area,
    );
    const websiteDomain = domainFromUrl(businessContext?.website_url);

    const { error: clearCompetitorsError } = await supabase
      .from('competitor_sites')
      .delete()
      .eq('workspace_id', workspaceId);
    if (clearCompetitorsError) {
      throw new Error(`Failed to clear previous competitors: ${clearCompetitorsError.message}`);
    }

    const { error: clearCompetitorFaqsError } = await supabase
      .from('faq_database')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('category', 'competitor_research')
      .eq('is_own_content', false);
    if (clearCompetitorFaqsError) {
      throw new Error(
        `Failed to clear previous competitor FAQs: ${clearCompetitorFaqsError.message}`,
      );
    }

    const { data: researchJob, error: researchError } = await supabase
      .from('competitor_research_jobs')
      .insert({
        workspace_id: workspaceId,
        status: 'discovering',
        niche_query: nicheQuery,
        industry: businessContext?.business_type || null,
        location: normalizePrimaryServiceLocation(businessContext?.service_area) || null,
        service_area: businessContext?.service_area || null,
        search_queries: searchQueries,
        target_count: targetCount,
        exclude_domains: websiteDomain ? [websiteDomain] : [],
        started_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (researchError || !researchJob) {
      throw new Error(
        `Failed to create competitor research job: ${researchError?.message || 'unknown error'}`,
      );
    }

    // Towns the user retained on the radius-expansion chip row. Consumed
    // by the Places-first discovery path in pipeline-worker-onboarding-
    // discovery so Text Search fans out across every town instead of
    // querying the primary town only (which capped us at ~10 candidates
    // for a 20-mile radius). Ordered primary-first, nearest-first by the
    // RPC; the backend preserves that order for ranking ties.
    const townsUsed: string[] = Array.isArray(body.towns_used)
      ? body.towns_used
          .map((t) => (typeof t === 'string' ? t.trim() : ''))
          .filter((t): t is string => t.length > 0)
          .slice(0, 10)
      : [];

    const run = await createOnboardingRun(supabase, {
      workspaceId,
      workflowKey: 'competitor_discovery',
      triggerSource: body.trigger_source?.trim() || 'onboarding_search_terms',
      sourceJobId: researchJob.id,
      legacyProgressWorkflowType: 'competitor_discovery',
      inputSnapshot: {
        workspace_id: workspaceId,
        trigger_source: body.trigger_source?.trim() || 'onboarding_search_terms',
        target_count: targetCount,
        search_queries: searchQueries,
        towns_used: townsUsed,
        website_url: businessContext?.website_url || undefined,
        competitor_research_job_id: researchJob.id,
        model_policy: defaultModelPolicy(),
        provider_policy: defaultProviderPolicy(),
      },
    });

    await queueSend(
      supabase,
      ONBOARDING_DISCOVERY_QUEUE,
      {
        run_id: run.id,
        workspace_id: workspaceId,
        step: 'acquire',
        attempt: 1,
      },
      0,
    );

    await queueSend(
      supabase,
      ONBOARDING_SUPERVISOR_QUEUE,
      {
        run_id: run.id,
        workflow_key: 'competitor_discovery',
        action: 'heartbeat_check',
      },
      30,
    );

    try {
      await wakeWorker(supabase, 'pipeline-worker-onboarding-discovery');
    } catch (workerKickError) {
      console.warn('Failed to kick onboarding discovery worker immediately', workerKickError);
    }

    return corsResponse({
      ok: true,
      run_id: run.id,
      job_id: researchJob.id,
      workflow_key: 'competitor_discovery',
      search_queries: searchQueries,
      target_count: targetCount,
    });
  } catch (error) {
    console.error('start-onboarding-discovery error', error);
    if (error instanceof HttpError) {
      return corsResponse({ ok: false, error: error.message }, error.status);
    }

    return corsResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected error',
      },
      500,
    );
  }
});
