import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-n8n-signature',
};

const FAQ_WORKFLOW_URL = 'https://bizzybee.app.n8n.cloud/webhook/faq-generation';

async function verifyN8nSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (computed.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < computed.length; i++) {
    result |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

async function triggerFaqWorkflow(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  callbackUrl: string,
  details: Record<string, unknown>,
) {
  console.log(
    `[n8n-callback] discovery_complete for workspace=${workspaceId}, triggering FAQ workflow`,
  );

  const { data: competitors, error: fetchError } = (await (supabase as any)
    .from('competitor_sites')
    .select('id, business_name, domain, url, address, rating, reviews_count, phone')
    .eq('workspace_id', workspaceId)
    .in('status', ['discovered', 'validated', 'approved'])
    .order('created_at', { ascending: false })
    .limit(100)) as {
    data: Array<{
      id: string;
      business_name: string;
      domain: string;
      url: string;
      address: string;
      rating: number;
      reviews_count: number;
      phone: string;
    }> | null;
    error: unknown;
  };

  if (fetchError) {
    console.error('[n8n-callback] Failed to fetch competitors:', fetchError);
    return;
  }

  if (!competitors || competitors.length === 0) {
    console.warn('[n8n-callback] No competitors found to scrape');
    await (supabase as any).from('n8n_workflow_progress').upsert(
      {
        workspace_id: workspaceId,
        workflow_type: 'competitor_scrape',
        status: 'complete',
        details: { message: 'No competitors to scrape', competitors_found: 0 },
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,workflow_type' },
    );
    return;
  }

  const { data: context } = (await supabase
    .from('business_context')
    .select('business_type, company_name')
    .eq('workspace_id', workspaceId)
    .maybeSingle()) as { data: { business_type?: string; company_name?: string } | null };

  await (supabase as any).from('n8n_workflow_progress').upsert(
    {
      workspace_id: workspaceId,
      workflow_type: 'competitor_scrape',
      status: 'pending',
      details: {
        message: `Queued ${competitors.length} competitors for scraping & FAQ extraction`,
        total: competitors.length,
        competitors_found: details.competitors_found || competitors.length,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,workflow_type' },
  );

  const payload = {
    workspace_id: workspaceId,
    business_type: context?.business_type || '',
    business_name: context?.company_name || '',
    competitors: competitors.map((c) => ({
      id: c.id,
      business_name: c.business_name,
      domain: c.domain,
      url: c.url,
      address: c.address,
      rating: c.rating,
      reviews_count: c.reviews_count,
      phone: c.phone,
    })),
    callback_url: callbackUrl,
  };

  try {
    const response = await fetch(FAQ_WORKFLOW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(
      `[n8n-callback] FAQ workflow triggered: status=${response.status}, competitors=${competitors.length}`,
    );
  } catch (err) {
    console.error('[n8n-callback] Failed to trigger FAQ workflow:', err);
    await (supabase as any).from('n8n_workflow_progress').upsert(
      {
        workspace_id: workspaceId,
        workflow_type: 'competitor_scrape',
        status: 'failed',
        details: { message: 'Failed to trigger FAQ generation workflow', error: String(err) },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,workflow_type' },
    );
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const n8nSecret = Deno.env.get('N8N_WEBHOOK_SECRET');

    const rawBody = await req.text();

    // If the webhook secret is configured, signature verification is mandatory.
    const signature = req.headers.get('x-n8n-signature') || '';
    if (n8nSecret) {
      if (!signature) {
        console.error('[n8n-callback] Missing webhook signature');
        return new Response(JSON.stringify({ error: 'Missing signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!(await verifyN8nSignature(rawBody, signature, n8nSecret))) {
        console.error('[n8n-callback] Invalid webhook signature');
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = JSON.parse(rawBody);
    const {
      workspace_id,
      status,
      message,
      competitors_found,
      competitors_scraped,
      verified_count,
      probable_count,
      hallucinations_caught,
      live_domains,
      dead_domains,
      scraped,
      failed,
      faq_count,
      competitor_count,
      claude_found,
      gemini_found,
      current,
      total,
      current_competitor,
      error: errorMsg,
    } = body;

    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'workspace_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Detect workflow_type from the payload or infer from status
    const explicitWorkflowType = body.workflow_type as string | undefined;
    console.log(
      `[n8n-callback] workspace=${workspace_id} status=${status} message=${message} workflow_type=${explicitWorkflowType || 'inferred'}`,
    );

    const ownWebsiteStatuses = [
      'own_website_scraping',
      'own_website_complete',
      'own_website_extracting',
    ];
    const scrapeStatuses = ['scraping', 'extracting', 'scrape_processing', 'scrape_complete'];

    let workflowType: string;
    if (explicitWorkflowType) {
      workflowType = explicitWorkflowType;
    } else if (ownWebsiteStatuses.includes(status) || body.is_own_website === true) {
      workflowType = 'own_website_scrape';
    } else if (scrapeStatuses.includes(status)) {
      workflowType = 'competitor_scrape';
    } else {
      workflowType = 'competitor_discovery';
    }

    const details: Record<string, unknown> = {
      message,
      updated_at: new Date().toISOString(),
    };

    if (competitors_found !== undefined) details.competitors_found = competitors_found;
    if (competitors_scraped !== undefined) details.competitors_scraped = competitors_scraped;
    if (verified_count !== undefined) details.verified_count = verified_count;
    if (probable_count !== undefined) details.probable_count = probable_count;
    if (hallucinations_caught !== undefined) details.hallucinations_caught = hallucinations_caught;
    if (live_domains !== undefined) details.live_domains = live_domains;
    if (dead_domains !== undefined) details.dead_domains = dead_domains;
    if (scraped !== undefined) details.competitors_scraped = scraped;
    if (failed !== undefined) details.scrape_failed = failed;
    if (faq_count !== undefined) details.faqs_generated = faq_count;
    if (competitor_count !== undefined) details.competitor_count = competitor_count;
    if (claude_found !== undefined) details.claude_found = claude_found;
    if (gemini_found !== undefined) details.gemini_found = gemini_found;
    if (current !== undefined) details.current = current;
    if (total !== undefined) details.total = total;
    if (current_competitor !== undefined) details.current_competitor = current_competitor;
    if (errorMsg) details.error = errorMsg;

    const isComplete =
      status === 'discovery_complete' || status === 'complete' || status === 'scrape_complete';
    const dbStatus = isComplete ? 'complete' : status || 'in_progress';

    const { error: upsertError } = await (supabase as any).from('n8n_workflow_progress').upsert(
      {
        workspace_id,
        workflow_type: workflowType,
        status: dbStatus,
        details,
        updated_at: new Date().toISOString(),
        completed_at: isComplete ? new Date().toISOString() : null,
      },
      {
        onConflict: 'workspace_id,workflow_type',
      },
    );

    if (upsertError) {
      console.error('[n8n-callback] Upsert error:', upsertError);
      return new Response(JSON.stringify({ error: 'Failed to update progress' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update scraping_jobs for own-website-scrape callbacks
    if (status === 'scraping' || status === 'scrape_complete') {
      const jobUpdate: Record<string, unknown> = {};

      if (status === 'scraping') {
        jobUpdate.status = 'scraping';
      } else if (status === 'scrape_complete') {
        jobUpdate.status = 'complete';
        jobUpdate.completed_at = new Date().toISOString();
        if (body.faqs_extracted !== undefined) {
          jobUpdate.faqs_found = body.faqs_extracted;
          jobUpdate.faqs_stored = body.faqs_extracted;
        }
      }

      const { error: jobUpdateError } = await (supabase as any)
        .from('scraping_jobs')
        .update(jobUpdate)
        .eq('workspace_id', workspace_id)
        .eq('job_type', 'own_website')
        .order('created_at', { ascending: false })
        .limit(1);

      if (jobUpdateError) {
        console.error('[n8n-callback] Failed to update scraping_jobs:', jobUpdateError);
      }
    }

    // When discovery completes, validate competitors (health check, relevance, scoring)
    if (status === 'discovery_complete') {
      await (supabase as any).from('n8n_workflow_progress').upsert(
        {
          workspace_id,
          workflow_type: 'competitor_scrape',
          status: 'validating',
          details: {
            message: `Validating ${details.competitors_found || 0} competitors...`,
            competitors_found: details.competitors_found || 0,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,workflow_type' },
      );
      const { data: bizContext } = await supabase
        .from('business_context')
        .select('business_type')
        .eq('workspace_id', workspace_id)
        .maybeSingle();
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      fetch(`${supabaseUrl}/functions/v1/validate-competitors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          workspace_id,
          business_type: bizContext?.business_type || '',
        }),
      }).catch((err) =>
        console.error('[n8n-callback] Failed to invoke validate-competitors:', err),
      );
    }

    // FAQ consolidation handled by n8n workflow directly
    if (status === 'scrape_complete') {
      console.log('[n8n-callback] FAQ scraping complete for workspace:', workspace_id);
    }

    // Handle own website scrape: if n8n sends FAQs in the payload, write them directly
    if (workflowType === 'own_website_scrape' && body.faqs && Array.isArray(body.faqs)) {
      console.log(`[n8n-callback] Writing ${body.faqs.length} FAQs from own website scrape`);
      for (const faq of body.faqs) {
        const { error: faqError } = await supabase.from('faq_database').insert({
          workspace_id,
          category: faq.category || 'General',
          question: faq.question,
          answer: faq.answer,
          keywords: faq.keywords || [],
          is_active: true,
          enabled: true,
          is_own_content: true,
          generation_source: faq.source_url || body.website_url || 'own_website',
        });
        if (faqError) {
          console.error('[n8n-callback] Error inserting FAQ:', faqError);
        }
      }

      // Update scraping_jobs with final count
      await supabase
        .from('scraping_jobs')
        .update({
          status: 'complete',
          faqs_found: body.faqs.length,
          faqs_stored: body.faqs.length,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspace_id)
        .eq('job_type', 'own_website')
        .is('completed_at', null);

      // Update workflow progress
      await supabase.from('n8n_workflow_progress').upsert(
        {
          workspace_id,
          workflow_type: 'own_website_scrape',
          status: 'complete',
          details: {
            message: `Extracted ${body.faqs.length} FAQs from your website`,
            faqs_count: body.faqs.length,
          },
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,workflow_type' },
      );
    }

    // If status is complete/scrape_complete for own website, also update progress
    if (
      workflowType === 'own_website_scrape' &&
      (status === 'complete' || status === 'scrape_complete' || status === 'own_website_complete')
    ) {
      await supabase.from('n8n_workflow_progress').upsert(
        {
          workspace_id,
          workflow_type: 'own_website_scrape',
          status: 'complete',
          details: {
            message: message || 'Website scrape complete',
            faqs_count: body.faqs_extracted || body.faq_count || 0,
          },
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,workflow_type' },
      );

      // Also update scraping_jobs
      await supabase
        .from('scraping_jobs')
        .update({
          status: 'completed',
          faqs_found: body.faqs_extracted || body.faq_count || 0,
          completed_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspace_id)
        .eq('job_type', 'own_website')
        .is('completed_at', null);
    }

    return new Response(
      JSON.stringify({ success: true, status, workspace_id, workflow_type: workflowType }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[n8n-callback] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
