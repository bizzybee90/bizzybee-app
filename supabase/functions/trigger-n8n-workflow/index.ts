import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const n8nWebhookBaseUrl = Deno.env.get('N8N_WEBHOOK_URL');

    if (!n8nWebhookBaseUrl) {
      return new Response(JSON.stringify({ error: 'N8N_WEBHOOK_URL not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { workspace_id, workflow_type } = body;

    if (!workspace_id || !workflow_type) {
      return new Response(
        JSON.stringify({ error: 'workspace_id and workflow_type are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Validate auth — supports both user JWT and service-to-service calls
    try {
      await validateAuth(req, workspace_id);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err);
      throw err;
    }

    console.log(`[trigger-n8n] workspace=${workspace_id} type=${workflow_type}`);

    // Get business context
    const { data: businessContext, error: bcError } = await supabase
      .from('business_context')
      .select('*')
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    if (bcError) {
      console.error('[trigger-n8n] Error fetching business context:', bcError);
    }

    // Get search terms from n8n_workflow_progress (saved by SearchTermsStep)
    const { data: searchTermsProgress } = await supabase
      .from('n8n_workflow_progress')
      .select('details')
      .eq('workspace_id', workspace_id)
      .eq('workflow_type', 'search_terms_config')
      .maybeSingle();

    const searchConfig = (searchTermsProgress?.details as Record<string, unknown>) || {};

    // Callback URL for n8n to POST status updates
    const callbackUrl = `${supabaseUrl}/functions/v1/n8n-competitor-callback`;
    const emailCallbackUrl = `${supabaseUrl}/functions/v1/n8n-email-callback`;

    if (workflow_type === 'competitor_discovery') {
      // Extract domain from website URL for exclusion
      let excludeDomains: string[] = [];
      if (businessContext?.website_url) {
        try {
          const url = new URL(
            businessContext.website_url.startsWith('http')
              ? businessContext.website_url
              : `https://${businessContext.website_url}`,
          );
          excludeDomains = [url.hostname.replace(/^www\./, '')];
        } catch (e) {
          console.warn('[trigger-n8n] Could not parse website URL:', e);
        }
      }

      // Create a research job record so competitor_sites can reference it
      const { data: researchJob, error: jobError } = await supabase
        .from('competitor_research_jobs')
        .insert({
          workspace_id,
          status: 'discovering',
          niche_query: `${businessContext?.business_type || 'business'} near ${businessContext?.service_area || 'local area'}`,
          industry: businessContext?.business_type || null,
          location: businessContext?.service_area || null,
          target_count: (searchConfig.target_count as number) || 50,
        })
        .select('id')
        .single();

      if (jobError || !researchJob) {
        console.error('[trigger-n8n] Failed to create research job:', jobError);
        return new Response(JSON.stringify({ error: 'Failed to create research job' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Build payload for n8n competitor discovery
      const competitorPayload = {
        workspace_id,
        job_id: researchJob.id,
        business_name: businessContext?.company_name || 'Unknown Business',
        business_type: businessContext?.business_type || '',
        website_url: businessContext?.website_url || '',
        location: businessContext?.service_area || '',
        radius_miles: 20,
        search_queries: (searchConfig.search_queries as string[]) || [],
        target_count: (searchConfig.target_count as number) || 50,
        exclude_domains: excludeDomains,
        callback_url: callbackUrl,
      };

      console.log(
        '[trigger-n8n] Sending to competitor-discovery:',
        JSON.stringify(competitorPayload),
      );

      // Call n8n webhook
      const response = await fetch(`${n8nWebhookBaseUrl}/competitor-discovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(competitorPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[trigger-n8n] n8n error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to trigger n8n workflow', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Initialize progress record
      await supabase.from('n8n_workflow_progress').upsert(
        {
          workspace_id,
          workflow_type: 'competitor_discovery',
          status: 'pending',
          details: { message: 'Workflow triggered, waiting for n8n...' },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,workflow_type' },
      );

      return new Response(JSON.stringify({ success: true, workflow: 'competitor_discovery' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else if (workflow_type === 'email_classification') {
      // n8n email classification workflow reads emails directly from DB
      // No need for Aurinko credentials — just workspace_id and callback
      const emailPayload = {
        workspace_id,
        callback_url: emailCallbackUrl,
      };

      console.log('[trigger-n8n] Sending to email-classification');

      const response = await fetch(`${n8nWebhookBaseUrl}/email-classification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[trigger-n8n] n8n email error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to trigger email import workflow', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Initialize progress record
      await supabase.from('n8n_workflow_progress').upsert(
        {
          workspace_id,
          workflow_type: 'email_import',
          status: 'pending',
          details: { message: 'Email classification triggered, waiting for n8n...' },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,workflow_type' },
      );

      return new Response(JSON.stringify({ success: true, workflow: 'email_classification' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else if (workflow_type === 'own_website_scrape') {
      const websiteUrl = body.websiteUrl || body.website_url || businessContext?.website_url;

      if (!websiteUrl) {
        return new Response(JSON.stringify({ error: 'No website URL provided' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const websitePayload = {
        workspace_id,
        website_url: websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`,
        business_name: businessContext?.company_name || 'Own Website',
        business_type: businessContext?.business_type || '',
        callback_url: callbackUrl,
      };

      // Create scraping_jobs row so the frontend can track progress
      const { data: job, error: jobError } = await supabase
        .from('scraping_jobs')
        .insert({
          workspace_id,
          job_type: 'own_website',
          website_url: websitePayload.website_url,
          status: 'pending',
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (jobError) {
        console.error('[trigger-n8n] Failed to create scraping job:', jobError);
        return new Response(JSON.stringify({ error: 'Failed to create scraping job' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('[trigger-n8n] Sending to own-website-scrape:', JSON.stringify(websitePayload));

      const response = await fetch(`${n8nWebhookBaseUrl}/own-website-scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(websitePayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[trigger-n8n] n8n website scrape error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to trigger website scrape', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      await supabase.from('n8n_workflow_progress').upsert(
        {
          workspace_id,
          workflow_type: 'own_website_scrape',
          status: 'pending',
          details: { message: 'Website scrape triggered, waiting for n8n...' },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,workflow_type' },
      );

      return new Response(
        JSON.stringify({ success: true, workflow: 'own_website_scrape', jobId: job.id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    } else if (workflow_type === 'faq_generation') {
      // FAQ generation scrapes competitor websites and extracts FAQs
      // Called after competitor_discovery finds competitors

      // Get competitors from the database for this workspace
      // Use is_selected OR is_valid (fallback) — 'is_active' does not exist in schema
      const { data: competitors } = await supabase
        .from('competitor_sites')
        .select('id, domain, business_name, url')
        .eq('workspace_id', workspace_id)
        .eq('is_selected', true)
        .not('status', 'eq', 'rejected')
        .limit(30);

      if (!competitors || competitors.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No competitors found. Run competitor discovery first.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const faqPayload = {
        workspace_id,
        competitors: competitors.map((c) => ({
          id: c.id,
          domain: c.domain,
          business_name: c.business_name,
          url: c.url || `https://${c.domain}`,
        })),
        callback_url: callbackUrl,
      };

      console.log('[trigger-n8n] Sending to faq-generation:', competitors.length, 'competitors');

      const response = await fetch(`${n8nWebhookBaseUrl}/faq-generation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(faqPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[trigger-n8n] n8n faq generation error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to trigger FAQ generation', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      await supabase.from('n8n_workflow_progress').upsert(
        {
          workspace_id,
          workflow_type: 'faq_generation',
          status: 'pending',
          details: { message: `Scraping ${competitors.length} competitor websites for FAQs...` },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,workflow_type' },
      );

      return new Response(
        JSON.stringify({
          success: true,
          workflow: 'faq_generation',
          competitors_count: competitors.length,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    } else {
      return new Response(JSON.stringify({ error: `Unknown workflow_type: ${workflow_type}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    console.error('[trigger-n8n] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
