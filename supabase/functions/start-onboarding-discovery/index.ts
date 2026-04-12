import {
  HttpError,
  createServiceClient,
  isUuidLike,
  jsonResponse,
  queueSend,
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

    const searchQueries =
      Array.isArray(body.search_queries) && body.search_queries.length > 0
        ? body.search_queries.filter(
            (value): value is string => typeof value === 'string' && value.trim().length > 0,
          )
        : buildDefaultSearchQueries(businessContext?.business_type, businessContext?.service_area);

    if (searchQueries.length === 0) {
      throw new HttpError(400, 'search_queries could not be derived for this workspace');
    }

    const targetCount = Math.max(5, Math.min(25, Math.floor(Number(body.target_count || 15))));
    const nicheQuery = buildNicheQuery(
      businessContext?.business_type,
      businessContext?.service_area,
    );
    const websiteDomain = domainFromUrl(businessContext?.website_url);

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
        website_url: businessContext?.website_url || undefined,
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
      300,
    );

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
