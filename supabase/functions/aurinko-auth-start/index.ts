import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspaceId, provider, importMode, origin } = await req.json();
    
    console.log('Starting Aurinko auth for:', { workspaceId, provider, importMode });

    const AURINKO_CLIENT_ID = Deno.env.get('AURINKO_CLIENT_ID');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    
    if (!AURINKO_CLIENT_ID) {
      throw new Error('AURINKO_CLIENT_ID not configured');
    }

    // Map provider names to Aurinko service types
    const serviceTypeMap: Record<string, string> = {
      'gmail': 'Google',
      'outlook': 'Office365',
      'icloud': 'iCloud',
      'imap': 'IMAP',
    };

    const serviceType = serviceTypeMap[provider.toLowerCase()] || 'Google';

    // Build callback URL
    const callbackUrl = `${SUPABASE_URL}/functions/v1/aurinko-auth-callback`;
    
    // State contains workspaceId, importMode, and origin for callback redirect
    const APP_URL = Deno.env.get('APP_URL') || origin || 'https://bizzybee.app';
    const state = btoa(JSON.stringify({
      workspaceId,
      importMode: importMode || 'new_only',
      provider: serviceType,
      origin: APP_URL
    }));

    // Aurinko OAuth authorize URL
    // Use Aurinko's unified scopes - they handle provider-specific translation
    // For Google: these map to Gmail API scopes internally
    const scopes = serviceType === 'Google' 
      ? 'Mail.Read Mail.ReadWrite Mail.Send' 
      : 'Mail.Read Mail.Send Mail.ReadWrite';
    
    const authUrl = new URL('https://api.aurinko.io/v1/auth/authorize');
    authUrl.searchParams.set('clientId', AURINKO_CLIENT_ID);
    authUrl.searchParams.set('serviceType', serviceType);
    authUrl.searchParams.set('scopes', scopes);
    authUrl.searchParams.set('responseType', 'code');
    authUrl.searchParams.set('returnUrl', callbackUrl);
    authUrl.searchParams.set('state', state);

    console.log('Generated Aurinko auth URL for service:', serviceType);

    return new Response(
      JSON.stringify({ authUrl: authUrl.toString() }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in aurinko-auth-start:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
