import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // --- DUAL AUTH CHECK (user JWT or service role) ---
  const authHeader = req.headers.get('Authorization');
  const isServiceRole = authHeader?.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if (!isServiceRole) {
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
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
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }
  // --- END DUAL AUTH CHECK ---

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const AURINKO_CLIENT_ID = Deno.env.get('AURINKO_CLIENT_ID');
  const AURINKO_CLIENT_SECRET = Deno.env.get('AURINKO_CLIENT_SECRET');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Parse optional body for single config refresh
    let specificConfigId: string | null = null;
    try {
      const body = await req.json();
      specificConfigId = body?.configId || null;
    } catch {
      // No body or invalid JSON, refresh all
    }

    console.log('🔄 Starting Aurinko subscription refresh...', { specificConfigId });

    // Fetch all active email configs (or specific one)
    let query = supabase
      .from('email_provider_configs')
      .select('id, email_address, account_id, subscription_id')
      .not('access_token', 'is', null);

    if (specificConfigId) {
      query = query.eq('id', specificConfigId);
    }

    const { data: configs, error: configError } = await query;

    if (configError) {
      console.error('❌ Error fetching email configs:', configError);
      return new Response(JSON.stringify({ error: configError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!configs || configs.length === 0) {
      console.log('ℹ️ No email configs found to refresh');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No email configs found',
          refreshed: 0,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    console.log(`📧 Found ${configs.length} email config(s) to refresh`);

    const results: { configId: string; email: string; success: boolean; error?: string }[] = [];
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const webhookUrl = `${SUPABASE_URL}/functions/v1/aurinko-webhook?apikey=${SUPABASE_ANON_KEY}`;

    for (const config of configs) {
      try {
        console.log(`🔧 Refreshing subscription for: ${config.email_address}`);

        // Get decrypted access token securely
        const { data: accessToken, error: tokenError } = await supabase.rpc(
          'get_decrypted_access_token',
          { p_config_id: config.id },
        );

        if (tokenError || !accessToken) {
          console.error(`❌ Failed to get access token for ${config.email_address}:`, tokenError);
          results.push({
            configId: config.id,
            email: config.email_address,
            success: false,
            error: 'Failed to retrieve access token',
          });
          continue;
        }

        // First, delete any existing subscriptions to avoid duplicates
        const deleteResponse = await fetch(`https://api.aurinko.io/v1/subscriptions`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (deleteResponse.ok) {
          const existingSubs = await deleteResponse.json();
          console.log(`📋 Found ${existingSubs.records?.length || 0} existing subscriptions`);

          // Delete each existing subscription
          for (const sub of existingSubs.records || []) {
            await fetch(`https://api.aurinko.io/v1/subscriptions/${sub.id}`, {
              method: 'DELETE',
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            });
            console.log(`🗑️ Deleted old subscription: ${sub.id}`);
          }
        }

        // Create new subscription for email messages (created + updated events)
        const createResponse = await fetch('https://api.aurinko.io/v1/subscriptions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            resource: '/email/messages',
            notificationUrl: webhookUrl,
            events: ['message.created', 'message.updated'],
          }),
        });

        if (!createResponse.ok) {
          const errorText = await createResponse.text();
          console.error(`❌ Failed to create subscription for ${config.email_address}:`, errorText);
          results.push({
            configId: config.id,
            email: config.email_address,
            success: false,
            error: errorText,
          });
          continue;
        }

        const subscription = await createResponse.json();
        console.log(`✅ Created subscription for ${config.email_address}:`, subscription.id);

        // Calculate expiry (Aurinko subscriptions typically last 7 days)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        // Update config with subscription details
        await supabase
          .from('email_provider_configs')
          .update({
            subscription_id: subscription.id,
            subscription_expires_at: expiresAt.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', config.id);

        results.push({
          configId: config.id,
          email: config.email_address,
          success: true,
        });
      } catch (error: any) {
        console.error(`❌ Error refreshing ${config.email_address}:`, error);
        results.push({
          configId: config.id,
          email: config.email_address,
          success: false,
          error: error.message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    console.log(`🏁 Refresh complete: ${successCount} success, ${failCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        refreshed: successCount,
        failed: failCount,
        results,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    console.error('❌ Error in refresh-aurinko-subscriptions:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
