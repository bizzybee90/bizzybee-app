import { createServiceClient, HttpError, isUuidLike, jsonResponse } from '../_shared/pipeline.ts';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function corsJson(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
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
      job_id?: string;
      url?: string;
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

    const rawUrl = body.url?.trim();
    if (!rawUrl) {
      throw new HttpError(400, 'url is required');
    }

    let cleanUrl = rawUrl;
    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = `https://${cleanUrl}`;
    }

    let hostname: string;
    try {
      hostname = new URL(cleanUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      throw new HttpError(400, 'Invalid URL');
    }

    const supabase = createServiceClient();

    const { data: existingRows, error: existingError } = await supabase
      .from('competitor_sites')
      .select('id, business_name, domain, url, is_selected, discovery_source, validation_status')
      .eq('workspace_id', workspaceId)
      .or(`domain.eq.${hostname},url.eq.${cleanUrl}`)
      .limit(1);

    if (existingError) {
      throw new Error(`Failed to check existing competitors: ${existingError.message}`);
    }

    if (existingRows && existingRows.length > 0) {
      const existing = existingRows[0];

      let jobId = body.job_id?.trim() || null;
      if (!jobId) {
        const { data: latestJob, error: jobError } = await supabase
          .from('competitor_research_jobs')
          .select('id')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (jobError) {
          throw new Error(`Failed to load latest competitor job: ${jobError.message}`);
        }

        jobId = latestJob?.id ?? null;
      }

      if (!jobId || !isUuidLike(jobId)) {
        throw new HttpError(409, 'Competitor discovery is still starting');
      }

      const { data: updatedRow, error: updateError } = await supabase
        .from('competitor_sites')
        .update({
          job_id: jobId,
          url: cleanUrl,
          domain: hostname,
          is_selected: true,
          status: 'approved',
          scrape_status: 'pending',
          validation_status: 'pending',
        })
        .eq('id', existing.id)
        .select('id, business_name, domain, url, is_selected, discovery_source, validation_status')
        .single();

      if (updateError || !updatedRow) {
        throw new Error(
          `Failed to attach existing competitor to the current run: ${updateError?.message || 'unknown error'}`,
        );
      }

      return corsJson({
        ok: true,
        reused: true,
        competitor: updatedRow,
      });
    }

    let jobId = body.job_id?.trim() || null;
    if (!jobId) {
      const { data: latestJob, error: jobError } = await supabase
        .from('competitor_research_jobs')
        .select('id')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (jobError) {
        throw new Error(`Failed to load latest competitor job: ${jobError.message}`);
      }

      jobId = latestJob?.id ?? null;
    }

    if (!jobId || !isUuidLike(jobId)) {
      throw new HttpError(409, 'Competitor discovery is still starting');
    }

    const { data: insertedRow, error: insertError } = await supabase
      .from('competitor_sites')
      .insert({
        job_id: jobId,
        workspace_id: workspaceId,
        business_name: hostname,
        url: cleanUrl,
        domain: hostname,
        discovery_source: 'manual',
        status: 'approved',
        scrape_status: 'pending',
        is_selected: true,
        validation_status: 'pending',
        relevance_score: 100,
      })
      .select('id, business_name, domain, url, is_selected, discovery_source, validation_status')
      .single();

    if (insertError || !insertedRow) {
      throw new Error(`Failed to add competitor: ${insertError?.message || 'unknown error'}`);
    }

    return corsJson({
      ok: true,
      reused: false,
      competitor: insertedRow,
    });
  } catch (error) {
    console.error('add-manual-competitor error', error);
    if (error instanceof HttpError) {
      return corsJson({ ok: false, error: error.message }, error.status);
    }

    return corsJson(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected error',
      },
      500,
    );
  }
});
