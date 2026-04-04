import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized', predictions: [] }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized', predictions: [] }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { input } = await req.json();

    if (!input || input.trim().length < 2) {
      return new Response(JSON.stringify({ predictions: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      console.error('GOOGLE_MAPS_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'API key not configured', predictions: [] }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
    url.searchParams.set('input', input);
    url.searchParams.set('types', 'geocode');
    url.searchParams.set('key', apiKey);

    console.log(`Fetching places for input: "${input}"`);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error('Google Places API error:', data.status, data.error_message);
      return new Response(
        JSON.stringify({
          error: data.error_message || 'Failed to fetch places',
          predictions: [],
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const countryPattern =
      /, (UK|United Kingdom|USA|United States|Australia|Canada|Ireland|Germany|France|Italy|Spain|Netherlands|New Zealand|India|Poland|Czechia|South Korea|Malaysia|Belarus|England|Scotland|Wales|Northern Ireland)$/i;

    const predictions = (data.predictions || []).map((p: any) => {
      const cleanDescription = p.description.replace(countryPattern, '');
      return {
        description: cleanDescription,
        place_id: p.place_id,
        original: p.description,
      };
    });

    console.log(`Returning ${predictions.length} predictions`);

    return new Response(JSON.stringify({ predictions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Error in google-places-autocomplete:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', predictions: [] }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
