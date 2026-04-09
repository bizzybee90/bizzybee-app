import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ResetBody {
  workspaceId: string;
  configId: string;
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 20000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as ResetBody;
    const { workspaceId, configId } = body;

    if (!workspaceId || !configId) {
      return jsonResponse(
        {
          success: false,
          error: 'INVALID_REQUEST',
          message: 'workspaceId and configId are required',
        },
        400,
      );
    }

    try {
      await validateAuth(req, workspaceId);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err);
      throw err;
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const AURINKO_CLIENT_ID = Deno.env.get('AURINKO_CLIENT_ID');
    const AURINKO_CLIENT_SECRET = Deno.env.get('AURINKO_CLIENT_SECRET');

    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !AURINKO_CLIENT_ID ||
      !AURINKO_CLIENT_SECRET
    ) {
      return jsonResponse(
        {
          success: false,
          error: 'INTERNAL_ERROR',
          message: 'Server configuration missing',
        },
        500,
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: config, error: configError } = await supabase
      .from('email_provider_configs')
      .select('id, workspace_id, email_address, provider, account_id, subscription_id')
      .eq('id', configId)
      .eq('workspace_id', workspaceId)
      .single();

    if (configError || !config) {
      return jsonResponse(
        {
          success: false,
          error: 'NOT_FOUND',
          message: 'Email connection not found',
        },
        404,
      );
    }

    let decryptedToken: string | null = null;
    const warnings: string[] = [];
    let deletedSubscriptionCount = 0;
    let remoteAccountDeleted = false;

    const { data: accessToken, error: tokenError } = await supabase.rpc(
      'get_decrypted_access_token',
      { p_config_id: config.id },
    );

    if (tokenError) {
      warnings.push('BizzyBee could not decrypt the Aurinko access token for this inbox.');
    } else if (typeof accessToken === 'string' && accessToken.length > 0) {
      decryptedToken = accessToken;
    }

    if (decryptedToken) {
      try {
        const listResponse = await fetchWithTimeout('https://api.aurinko.io/v1/subscriptions', {
          method: 'GET',
          headers: { Authorization: `Bearer ${decryptedToken}` },
        });

        if (listResponse.ok) {
          const subscriptions = await listResponse.json();
          for (const subscription of subscriptions.records || []) {
            const deleteResponse = await fetchWithTimeout(
              `https://api.aurinko.io/v1/subscriptions/${subscription.id}`,
              {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${decryptedToken}` },
              },
            );

            if (deleteResponse.ok || deleteResponse.status === 404) {
              deletedSubscriptionCount += 1;
            }
          }
        } else {
          warnings.push('BizzyBee could not list existing Aurinko subscriptions for this inbox.');
        }
      } catch (error) {
        console.error('[aurinko-reset-account] Subscription cleanup failed:', error);
        warnings.push('BizzyBee could not remove all remote Aurinko subscriptions automatically.');
      }
    }

    try {
      const deleteResponse = await fetchWithTimeout(
        `https://api.aurinko.io/v1/am/accounts/${encodeURIComponent(config.account_id)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: 'Basic ' + btoa(`${AURINKO_CLIENT_ID}:${AURINKO_CLIENT_SECRET}`),
          },
        },
      );

      if (deleteResponse.ok || deleteResponse.status === 404) {
        remoteAccountDeleted = true;
      } else {
        const deleteText = await deleteResponse.text();
        console.warn('[aurinko-reset-account] Remote account delete failed:', deleteText);
        warnings.push(
          `Aurinko did not confirm remote account deletion (${deleteResponse.status}).`,
        );
      }
    } catch (error) {
      console.error('[aurinko-reset-account] Remote account delete request failed:', error);
      warnings.push('BizzyBee could not confirm remote Aurinko account deletion.');
    }

    const { error: deleteConfigError } = await supabase
      .from('email_provider_configs')
      .delete()
      .eq('id', config.id);

    if (deleteConfigError) {
      return jsonResponse(
        {
          success: false,
          error: 'LOCAL_DELETE_FAILED',
          message: 'BizzyBee could not remove the local email configuration.',
          details: deleteConfigError.message,
        },
        500,
      );
    }

    const { count: remainingConfigsCount, error: remainingConfigsError } = await supabase
      .from('email_provider_configs')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);

    if (remainingConfigsError) {
      console.error(
        '[aurinko-reset-account] Remaining config count failed:',
        remainingConfigsError,
      );
    }

    if ((remainingConfigsCount ?? 0) === 0) {
      const { error: progressDeleteError } = await supabase
        .from('email_import_progress')
        .delete()
        .eq('workspace_id', workspaceId);

      if (progressDeleteError) {
        console.error('[aurinko-reset-account] Progress cleanup failed:', progressDeleteError);
        warnings.push('BizzyBee could not clear old import progress for this workspace.');
      }
    }

    const message =
      warnings.length === 0
        ? 'Email connection reset. You can reconnect this inbox from scratch now.'
        : 'Email connection reset locally. Review the warning before reconnecting.';

    return jsonResponse({
      success: true,
      email: config.email_address,
      deletedSubscriptionCount,
      remoteAccountDeleted,
      warnings,
      message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[aurinko-reset-account] Error:', message);
    return jsonResponse(
      {
        success: false,
        error: 'INTERNAL_ERROR',
        message,
      },
      500,
    );
  }
});
