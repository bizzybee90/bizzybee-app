const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      ok: false,
      retired: true,
      error: 'Legacy workflow router has been retired',
      replacements: {
        competitor_discovery: 'start-onboarding-discovery',
        own_website_scrape: 'start-own-website-analysis',
        faq_generation: 'start-faq-generation',
        email_import: 'start-email-import',
        email_classification: 'classify-conversation',
      },
    }),
    {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
