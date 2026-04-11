import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Verify HMAC signature
async function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const data = encoder.encode(payload);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const expectedSignature = await crypto.subtle.sign('HMAC', key, data);
  const expectedSignatureHex = Array.from(new Uint8Array(expectedSignature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expectedSignatureHex.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignatureHex.charCodeAt(i);
  }
  return result === 0;
}

// Verify and decode signed token
async function verifySignedToken(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 2) {
    console.error('Invalid token format - expected payload.signature');
    return null;
  }

  const [payload, signature] = parts;

  const isValid = await verifyHmacSignature(payload, signature, secret);
  if (!isValid) {
    console.error('Invalid token signature - possible tampering detected');
    return null;
  }

  try {
    return JSON.parse(atob(payload));
  } catch {
    console.error('Failed to decode token payload');
    return null;
  }
}

interface CustomerRecord {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  workspace_id: string | null;
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const postmarkApiKey = Deno.env.get('POSTMARK_API_KEY');
    const gdprSecret = Deno.env.get('GDPR_TOKEN_SECRET');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!gdprSecret) {
      console.error('GDPR_TOKEN_SECRET not configured');
      return new Response(JSON.stringify({ error: 'GDPR service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { token, action } = await req.json();

    if (!token || !action) {
      return new Response(JSON.stringify({ error: 'Token and action are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action !== 'export' && action !== 'deletion') {
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify and decode the signed token
    const requestData = await verifySignedToken(token, gdprSecret);

    if (!requestData) {
      console.error('Token verification failed - rejecting request');
      return new Response(JSON.stringify({ error: 'Invalid or tampered token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check expiration
    if (new Date(requestData.expires_at as string) < new Date()) {
      return new Response(JSON.stringify({ error: 'Token has expired' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify action matches
    if (requestData.request_type !== action) {
      return new Response(JSON.stringify({ error: 'Action mismatch' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tokenVersionRaw = Number(requestData.token_version ?? 1);
    const tokenVersion = Number.isFinite(tokenVersionRaw) ? tokenVersionRaw : 1;
    const tokenEmail = normalizeEmail(requestData.email);
    const tokenCustomerId = normalizeOptionalString(requestData.customer_id);
    const tokenWorkspaceId = normalizeOptionalString(requestData.workspace_id);
    const tokenBindingState = normalizeOptionalString(requestData.binding_state);
    const tokenReason = normalizeOptionalString(requestData.reason);

    if (!tokenEmail) {
      return new Response(JSON.stringify({ error: 'Invalid token payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Verified GDPR request:', {
      email: tokenEmail,
      action,
      tokenVersion,
      bindingState: tokenBindingState,
      workspaceBound: !!tokenWorkspaceId,
      customerBound: !!tokenCustomerId,
    });

    let customer: CustomerRecord | null = null;

    if (tokenCustomerId) {
      let boundCustomerQuery = supabase
        .from('customers')
        .select('id, name, email, phone, workspace_id')
        .eq('id', tokenCustomerId)
        .eq('email', tokenEmail);

      if (tokenWorkspaceId) {
        boundCustomerQuery = boundCustomerQuery.eq('workspace_id', tokenWorkspaceId);
      }

      const { data: boundCustomer, error: boundCustomerError } =
        await boundCustomerQuery.maybeSingle();
      if (boundCustomerError || !boundCustomer) {
        return new Response(JSON.stringify({ error: 'Invalid or stale token binding' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      customer = boundCustomer as CustomerRecord;
    } else if (tokenVersion >= 2) {
      // For v2 tokens, never do an unscoped global email lookup when identity was ambiguous.
      if (tokenBindingState === 'ambiguous' && !tokenWorkspaceId) {
        return new Response(
          JSON.stringify({
            error:
              'Multiple accounts found for this email. Please restart from your workspace GDPR portal link.',
          }),
          {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      if (tokenWorkspaceId) {
        const { data: scopedCustomers, error: scopedCustomersError } = await supabase
          .from('customers')
          .select('id, name, email, phone, workspace_id')
          .eq('email', tokenEmail)
          .eq('workspace_id', tokenWorkspaceId)
          .limit(2);

        if (scopedCustomersError) {
          throw scopedCustomersError;
        }

        if ((scopedCustomers || []).length > 1) {
          return new Response(
            JSON.stringify({
              error:
                'Multiple records matched this request in the selected workspace. Please contact support.',
            }),
            {
              status: 409,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          );
        }

        customer = ((scopedCustomers || [])[0] as CustomerRecord | undefined) || null;
      }
    } else {
      // Legacy token fallback: keep compatibility but block ambiguous duplicate-email matches.
      let legacyCustomerQuery = supabase
        .from('customers')
        .select('id, name, email, phone, workspace_id')
        .eq('email', tokenEmail)
        .limit(2);

      if (tokenWorkspaceId) {
        legacyCustomerQuery = legacyCustomerQuery.eq('workspace_id', tokenWorkspaceId);
      }

      const { data: legacyCustomers, error: legacyCustomersError } = await legacyCustomerQuery;
      if (legacyCustomersError) {
        throw legacyCustomersError;
      }

      if ((legacyCustomers || []).length > 1) {
        return new Response(
          JSON.stringify({
            error:
              'Multiple records matched this request. Please restart from your workspace GDPR portal link.',
          }),
          {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      customer = ((legacyCustomers || [])[0] as CustomerRecord | undefined) || null;
    }

    if (action === 'export') {
      // Process data export
      if (customer) {
        // Invoke the existing export function
        const { data: exportData, error: exportError } = await supabase.functions.invoke(
          'export-customer-data',
          {
            body: {
              customer_identifier: tokenEmail,
              delivery_method: 'email',
            },
          },
        );

        if (exportError) {
          console.error('Export error:', exportError);
          throw new Error('Failed to generate export');
        }

        // Send export via email
        if (postmarkApiKey && exportData?.data) {
          const exportJson = JSON.stringify(exportData.data, null, 2);

          await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-Postmark-Server-Token': postmarkApiKey,
            },
            body: JSON.stringify({
              From: 'noreply@bizzybee.ai',
              To: tokenEmail,
              Subject: 'Your Data Export',
              HtmlBody: `
                <h2>Your Data Export</h2>
                <p>Hello${customer.name ? ` ${customer.name}` : ''},</p>
                <p>As requested, here is a copy of all your personal data we have on file.</p>
                <p>Your data is attached as a JSON file for portability.</p>
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;" />
                <h3>Your Rights</h3>
                <ul>
                  <li><strong>Right to Access:</strong> You can request your data at any time</li>
                  <li><strong>Right to Erasure:</strong> You can request deletion of your data</li>
                  <li><strong>Right to Rectification:</strong> You can request corrections to your data</li>
                  <li><strong>Right to Portability:</strong> This export is in JSON format for portability</li>
                </ul>
              `,
              Attachments: [
                {
                  Name: 'my-data-export.json',
                  Content: btoa(exportJson),
                  ContentType: 'application/json',
                },
              ],
              MessageStream: 'outbound',
            }),
          });
        }

        // Log the completed export
        await supabase.from('data_access_logs').insert({
          action: 'gdpr_export_completed',
          customer_id: customer.id,
          metadata: {
            email: tokenEmail,
            export_size: JSON.stringify(exportData?.data || {}).length,
          },
        });
      } else {
        // No customer found - send email saying no data
        if (postmarkApiKey) {
          await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-Postmark-Server-Token': postmarkApiKey,
            },
            body: JSON.stringify({
              From: 'noreply@bizzybee.ai',
              To: tokenEmail,
              Subject: 'Your Data Export Request',
              HtmlBody: `
                <h2>Data Export Request</h2>
                <p>We received your data export request for this email address.</p>
                <p>After searching our records, we did not find any personal data associated with this email address.</p>
                <p>If you believe this is an error, please contact us.</p>
              `,
              MessageStream: 'outbound',
            }),
          });
        }
      }
    } else if (action === 'deletion') {
      // Process deletion request
      if (customer) {
        // Create deletion request
        const { error: insertError } = await supabase.from('data_deletion_requests').insert({
          customer_id: customer.id,
          reason: tokenReason || 'Customer portal request',
          deletion_type: 'full',
          status: 'pending',
        });

        if (insertError) {
          console.error('Error creating deletion request:', insertError);
          throw new Error('Failed to create deletion request');
        }

        // Send confirmation email
        if (postmarkApiKey) {
          const estimatedDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

          await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-Postmark-Server-Token': postmarkApiKey,
            },
            body: JSON.stringify({
              From: 'noreply@bizzybee.ai',
              To: tokenEmail,
              Subject: 'Data Deletion Request Confirmed',
              HtmlBody: `
                <h2>Data Deletion Request Confirmed</h2>
                <p>Hello${customer.name ? ` ${customer.name}` : ''},</p>
                <p>Your request to delete your personal data has been confirmed and queued for processing.</p>
                <p><strong>Estimated completion:</strong> ${estimatedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                <p>Under GDPR, we have 30 days to complete your request. You will receive a confirmation email once the deletion is complete.</p>
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;" />
                <p style="color: #6b7280; font-size: 12px;">
                  If you did not make this request, please contact us immediately.
                </p>
              `,
              MessageStream: 'outbound',
            }),
          });
        }

        // Log the deletion request
        await supabase.from('data_access_logs').insert({
          action: 'gdpr_deletion_requested',
          customer_id: customer.id,
          metadata: {
            email: tokenEmail,
            reason: tokenReason,
          },
        });
      } else {
        // No customer found
        if (postmarkApiKey) {
          await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-Postmark-Server-Token': postmarkApiKey,
            },
            body: JSON.stringify({
              From: 'noreply@bizzybee.ai',
              To: tokenEmail,
              Subject: 'Data Deletion Request',
              HtmlBody: `
                <h2>Data Deletion Request</h2>
                <p>We received your data deletion request for this email address.</p>
                <p>After searching our records, we did not find any personal data associated with this email address.</p>
                <p>No further action is required on your part.</p>
              `,
              MessageStream: 'outbound',
            }),
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        action,
        customer_found: !!customer,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error verifying GDPR request:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
