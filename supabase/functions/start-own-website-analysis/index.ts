import { HttpError, createServiceClient, isUuidLike, queueSend } from '../_shared/pipeline.ts';
import {
  ONBOARDING_SUPERVISOR_QUEUE,
  ONBOARDING_WEBSITE_QUEUE,
  createOnboardingRun,
  defaultModelPolicy,
  defaultProviderPolicy,
  normalizeWebsiteUrl,
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
      website_url?: string;
      websiteUrl?: string;
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
      .select('website_url')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (businessContextError) {
      throw new Error(`Failed to load business context: ${businessContextError.message}`);
    }

    const websiteUrl = normalizeWebsiteUrl(
      body.website_url || body.websiteUrl || businessContext?.website_url,
    );
    if (!websiteUrl) {
      throw new HttpError(400, 'website_url is required');
    }

    const { data: scrapeJob, error: scrapeJobError } = await supabase
      .from('scraping_jobs')
      .insert({
        workspace_id: workspaceId,
        job_type: 'own_website_scrape',
        website_url: websiteUrl,
        status: 'pending',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (scrapeJobError || !scrapeJob) {
      throw new Error(
        `Failed to create scraping job: ${scrapeJobError?.message || 'unknown error'}`,
      );
    }

    const run = await createOnboardingRun(supabase, {
      workspaceId,
      workflowKey: 'own_website_scrape',
      triggerSource: body.trigger_source?.trim() || 'onboarding_knowledge_base',
      sourceJobId: scrapeJob.id,
      legacyProgressWorkflowType: 'own_website_scrape',
      inputSnapshot: {
        workspace_id: workspaceId,
        trigger_source: body.trigger_source?.trim() || 'onboarding_knowledge_base',
        website_url: websiteUrl,
        model_policy: defaultModelPolicy(),
        provider_policy: defaultProviderPolicy(),
      },
    });

    await queueSend(
      supabase,
      ONBOARDING_WEBSITE_QUEUE,
      {
        run_id: run.id,
        workspace_id: workspaceId,
        step: 'fetch',
        attempt: 1,
      },
      0,
    );

    await queueSend(
      supabase,
      ONBOARDING_SUPERVISOR_QUEUE,
      {
        run_id: run.id,
        workflow_key: 'own_website_scrape',
        action: 'heartbeat_check',
      },
      300,
    );

    return corsResponse({
      ok: true,
      success: true,
      run_id: run.id,
      job_id: scrapeJob.id,
      jobId: scrapeJob.id,
      workflow_key: 'own_website_scrape',
      website_url: websiteUrl,
    });
  } catch (error) {
    console.error('start-own-website-analysis error', error);
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
