import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';
import { calculateQualityScore } from '../_shared/quality-scorer.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'validate-competitors';

// Businesses that are NEVER competitors regardless of industry
const UNIVERSAL_REJECT_KEYWORDS = [
  'skip hire',
  'waste removal',
  'rubbish collection',
  'dog walking',
  'pet grooming',
  'pet sitting',
  'recruitment',
  'staffing agency',
  'temp agency',
  'web design',
  'marketing agency',
  'seo agency',
];

interface Competitor {
  id: string;
  domain: string;
  url: string;
  business_name: string;
  rating: number | null;
  review_count: number | null;
  distance_miles: number | null;
  status: string;
}

async function checkSiteHealth(url: string): Promise<{ alive: boolean; reason?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    const finalUrl = response.url?.toLowerCase() || '';
    if (
      finalUrl.includes('suspendedpage') ||
      finalUrl.includes('parked') ||
      finalUrl.includes('expired') ||
      finalUrl.includes('coming-soon') ||
      finalUrl.includes('underconstruction')
    ) {
      return { alive: false, reason: 'suspended_or_parked' };
    }

    if (response.status >= 400) {
      return { alive: false, reason: `http_${response.status}` };
    }

    return { alive: true };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { alive: false, reason: 'timeout' };
    }
    return { alive: false, reason: 'connection_failed' };
  }
}

function checkRelevance(
  businessName: string,
  domain: string,
  businessType: string,
): { relevance: 'strong' | 'partial' | 'weak'; reason?: string } {
  const nameLower = businessName.toLowerCase();
  const domainLower = domain.toLowerCase();
  const combined = `${nameLower} ${domainLower}`;

  // Check universal reject keywords
  for (const keyword of UNIVERSAL_REJECT_KEYWORDS) {
    if (combined.includes(keyword)) {
      return { relevance: 'weak', reason: `Matches reject keyword: ${keyword}` };
    }
  }

  // Extract meaningful words from business_type (e.g. "window cleaning" -> ["window", "cleaning"])
  const typeWords = businessType
    .toLowerCase()
    .split(/[\s,&/]+/)
    .filter((w) => w.length > 2)
    .filter(
      (w) => !['and', 'the', 'for', 'service', 'services', 'ltd', 'limited', 'company'].includes(w),
    );

  if (typeWords.length === 0) {
    return { relevance: 'partial', reason: 'No business type provided for matching' };
  }

  // Strong match: name or domain contains any of the business type keywords
  const strongMatch = typeWords.some((kw) => combined.includes(kw));
  if (strongMatch) {
    return { relevance: 'strong' };
  }

  // Partial match: contains generic service-adjacent words
  const genericServiceWords = ['service', 'pro', 'expert', 'specialist', 'local', 'professional'];
  const partialMatch = genericServiceWords.some((w) => combined.includes(w));
  if (partialMatch) {
    return { relevance: 'partial', reason: 'Generic service term — may not be primary service' };
  }

  // Weak match: no relevant keywords found
  return { relevance: 'weak', reason: 'No service keywords found in name or domain' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { workspace_id, business_type } = await req.json();
    console.log(
      `[${FUNCTION_NAME}] Starting validation for workspace=${workspace_id}, type=${business_type}`,
    );

    if (!workspace_id) {
      throw new Error('workspace_id is required');
    }

    const auth = await validateAuth(req, workspace_id);
    const workspaceId = auth.workspaceId;

    const { data: competitors, error: fetchError } = await supabase
      .from('competitor_sites')
      .select('id, domain, url, business_name, rating, review_count, distance_miles, status')
      .eq('workspace_id', workspaceId)
      .in('status', ['discovered', 'validated']);

    if (fetchError) throw fetchError;

    if (!competitors || competitors.length === 0) {
      console.log(`[${FUNCTION_NAME}] No competitors to validate`);
      await setReviewReady(supabase, workspaceId, 0, 0, 0);
      return respond({ success: true, validated: 0, rejected: 0, total: 0 });
    }

    console.log(`[${FUNCTION_NAME}] Validating ${competitors.length} competitors`);

    let rejected = 0;
    let deselected = 0;
    let validated = 0;

    const BATCH_SIZE = 5;
    for (let i = 0; i < competitors.length; i += BATCH_SIZE) {
      const batch = competitors.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (comp: Competitor) => {
          // 1. Health check
          const health = await checkSiteHealth(comp.url);

          if (!health.alive) {
            console.log(`[${FUNCTION_NAME}] DEAD: ${comp.domain} — ${health.reason}`);
            await supabase
              .from('competitor_sites')
              .update({
                status: 'rejected',
                is_selected: false,
                is_valid: false,
                validation_status: 'REJECTED',
                validation_notes: `Site unreachable: ${health.reason}`,
              })
              .eq('id', comp.id);
            rejected++;
            return;
          }

          // 2. Relevance check
          const relevance = checkRelevance(comp.business_name, comp.domain, business_type || '');

          // 3. Quality score
          const quality = calculateQualityScore({
            distance_miles: comp.distance_miles,
            rating: comp.rating,
            reviews_count: comp.review_count,
            domain: comp.domain,
          });

          // 4. Decide: deselect or validate
          if (relevance.relevance === 'weak') {
            console.log(`[${FUNCTION_NAME}] WEAK: ${comp.domain} — ${relevance.reason}`);
            await supabase
              .from('competitor_sites')
              .update({
                status: 'discovered',
                is_selected: false,
                is_valid: true,
                validation_status: 'WEAK_MATCH',
                validation_notes: relevance.reason || 'Low relevance to target service',
                quality_score: quality.quality_score,
                priority_tier: quality.priority_tier,
                relevance_score: 20,
              })
              .eq('id', comp.id);
            deselected++;
          } else if (relevance.relevance === 'partial') {
            console.log(`[${FUNCTION_NAME}] PARTIAL: ${comp.domain} — ${relevance.reason}`);
            await supabase
              .from('competitor_sites')
              .update({
                status: 'validated',
                is_selected: true,
                is_valid: true,
                validation_status: 'PARTIAL_MATCH',
                validation_notes: relevance.reason || 'Partial service match',
                quality_score: quality.quality_score,
                priority_tier: quality.priority_tier,
                relevance_score: 60,
              })
              .eq('id', comp.id);
            validated++;
          } else {
            console.log(`[${FUNCTION_NAME}] STRONG: ${comp.domain}`);
            await supabase
              .from('competitor_sites')
              .update({
                status: 'validated',
                is_selected: true,
                is_valid: true,
                validation_status: 'VERIFIED',
                validation_notes: null,
                quality_score: quality.quality_score,
                priority_tier: quality.priority_tier,
                relevance_score: 100,
              })
              .eq('id', comp.id);
            validated++;
          }
        }),
      );
    }

    await setReviewReady(supabase, workspaceId, competitors.length, validated, rejected);

    const duration = Date.now() - startTime;
    console.log(
      `[${FUNCTION_NAME}] Done in ${duration}ms: ${validated} validated, ${deselected} deselected, ${rejected} rejected`,
    );

    return respond({
      success: true,
      total: competitors.length,
      validated,
      deselected,
      rejected,
      duration_ms: duration,
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    console.error(`[${FUNCTION_NAME}] Error:`, error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function setReviewReady(
  supabase: any,
  workspaceId: string,
  total: number,
  validated: number,
  rejected: number,
) {
  await supabase.from('n8n_workflow_progress').upsert(
    {
      workspace_id: workspaceId,
      workflow_type: 'competitor_scrape',
      status: 'review_ready',
      details: {
        message: `${validated} competitors validated, ${rejected} filtered out`,
        competitors_found: total,
        validated,
        rejected,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,workflow_type' },
  );
}

function respond(data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
