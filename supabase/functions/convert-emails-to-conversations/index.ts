import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';

/**
 * CONVERT-EMAILS-TO-CONVERSATIONS
 *
 * Bridges email_import_queue → conversations + customers + messages tables.
 * Processes classified emails that haven't been converted yet.
 * Uses relay-race self-invocation for large volumes.
 *
 * Called after classification is complete, or manually.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 50;
const MAX_ITERATIONS = 200; // Safety limit

const AUTO_HANDLED_CATEGORIES = new Set([
  'notification',
  'newsletter',
  'spam',
  'receipt',
  'marketing',
  'automated',
  'system',
  'transactional',
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspace_id, _iteration = 0 } = await req.json();

    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'workspace_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate auth — supports both user JWT and service-to-service calls
    try {
      await validateAuth(req, workspace_id);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err);
      throw err;
    }

    if (_iteration >= MAX_ITERATIONS) {
      console.log(`[convert] Hit max iterations (${MAX_ITERATIONS}), stopping`);
      return new Response(JSON.stringify({ status: 'max_iterations', iteration: _iteration }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const startTime = Date.now();

    // Update progress
    await supabase.from('email_import_progress').upsert(
      {
        workspace_id,
        current_phase: 'converting',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' },
    );

    // =========================================================================
    // STEP 1: Fetch classified but unconverted emails
    // =========================================================================
    const { data: emails, error: fetchError } = await supabase
      .from('email_import_queue')
      .select(
        'id, workspace_id, thread_id, from_email, from_name, to_emails, subject, body, body_html, direction, category, requires_reply, confidence, received_at, is_read, is_noise',
      )
      .eq('workspace_id', workspace_id)
      .not('category', 'is', null)
      .is('conversation_id', null)
      .order('received_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) throw fetchError;

    if (!emails || emails.length === 0) {
      console.log(`[convert] No unconverted emails remaining`);

      // Mark pipeline complete
      await supabase.from('email_import_progress').upsert(
        {
          workspace_id,
          current_phase: 'complete',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id' },
      );

      return new Response(
        JSON.stringify({
          status: 'complete',
          message: 'All classified emails converted',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    console.log(`[convert] Processing ${emails.length} emails (iteration ${_iteration})`);

    // =========================================================================
    // STEP 2: Group by thread_id for efficient processing
    // =========================================================================
    const threadGroups = new Map<string, typeof emails>();
    for (const email of emails) {
      const tid = email.thread_id || email.id; // fallback to email id if no thread
      if (!threadGroups.has(tid)) {
        threadGroups.set(tid, []);
      }
      threadGroups.get(tid)!.push(email);
    }

    let conversionsCreated = 0;
    let messagesCreated = 0;
    let customersCreated = 0;

    // Cache for customers we've already found/created this batch
    const customerCache = new Map<string, string>(); // email -> customer_id

    for (const [threadId, threadEmails] of threadGroups) {
      try {
        // Sort by received_at ascending within thread
        threadEmails.sort(
          (a, b) => new Date(a.received_at || 0).getTime() - new Date(b.received_at || 0).getTime(),
        );

        const latestEmail = threadEmails[threadEmails.length - 1];
        const firstInbound = threadEmails.find((e) => e.direction === 'inbound');
        const latestInbound = [...threadEmails].reverse().find((e) => e.direction === 'inbound');

        // =====================================================================
        // STEP 2a: Find or create CUSTOMER
        // =====================================================================
        // For inbound: customer is the sender. For outbound-only threads: customer is recipient.
        const customerEmail = firstInbound
          ? firstInbound.from_email
          : threadEmails[0].to_emails?.[0] || threadEmails[0].from_email;
        const customerName = firstInbound ? firstInbound.from_name : null;

        let customerId: string;

        if (customerEmail && customerCache.has(customerEmail)) {
          customerId = customerCache.get(customerEmail)!;
        } else if (customerEmail) {
          // Try to find existing customer
          const { data: existing } = await supabase
            .from('customers')
            .select('id')
            .eq('workspace_id', workspace_id)
            .eq('email', customerEmail)
            .maybeSingle();

          if (existing) {
            customerId = existing.id;
          } else {
            // Create new customer
            const { data: newCustomer, error: custError } = await supabase
              .from('customers')
              .insert({
                workspace_id,
                email: customerEmail,
                name: customerName || customerEmail.split('@')[0],
                preferred_channel: 'email',
                tier: 'regular',
                custom_fields: {},
              })
              .select('id')
              .single();

            if (custError) {
              console.error(
                `[convert] Failed to create customer ${customerEmail}:`,
                custError.message,
              );
              continue;
            }
            customerId = newCustomer.id;
            customersCreated++;
          }
          customerCache.set(customerEmail, customerId);
        } else {
          continue; // Skip if no customer email at all
        }

        // =====================================================================
        // STEP 2b: Find or create CONVERSATION
        // =====================================================================
        const externalConvId = `import_${threadId}`;
        const category = latestEmail.category;
        const isAutoHandled = AUTO_HANDLED_CATEGORIES.has(category) || latestEmail.is_noise;

        // Determine status: 'new' only if latest inbound is unread
        const latestInboundIsUnread = latestInbound && latestInbound.is_read === false;
        const convStatus = latestInboundIsUnread ? 'new' : 'open';

        const { data: existingConv } = await supabase
          .from('conversations')
          .select('id')
          .eq('workspace_id', workspace_id)
          .eq('external_conversation_id', externalConvId)
          .maybeSingle();

        let conversationId: string;

        if (existingConv) {
          conversationId = existingConv.id;

          // Update with latest email's classification
          await supabase
            .from('conversations')
            .update({
              email_classification: category,
              requires_reply: latestEmail.requires_reply,
              triage_confidence: latestEmail.confidence,
              status: latestInboundIsUnread ? 'new' : undefined,
              updated_at: new Date().toISOString(),
            })
            .eq('id', conversationId);
        } else {
          // Create new conversation
          const { data: newConv, error: convError } = await supabase
            .from('conversations')
            .insert({
              workspace_id,
              customer_id: customerId,
              external_conversation_id: externalConvId,
              title: latestEmail.subject || 'No subject',
              channel: 'email',
              email_classification: category,
              requires_reply: latestEmail.requires_reply,
              triage_confidence: latestEmail.confidence,
              decision_bucket: isAutoHandled ? 'auto_handled' : 'quick_win',
              status: convStatus,
              priority: 'medium',
              category: category,
            })
            .select('id')
            .single();

          if (convError) {
            console.error(
              `[convert] Failed to create conversation for thread ${threadId}:`,
              convError.message,
            );
            continue;
          }
          conversationId = newConv.id;
          conversionsCreated++;
        }

        // =====================================================================
        // STEP 2c: Create MESSAGES for each email in thread
        // =====================================================================
        const messagesToInsert = threadEmails.map((email) => ({
          conversation_id: conversationId,
          body: email.body || '',
          direction: email.direction,
          actor_type: email.direction === 'inbound' ? 'customer' : 'human_agent',
          actor_name: email.from_name || email.from_email,
          channel: 'email',
          is_internal: false,
          raw_payload: {
            htmlBody: email.body_html,
            from_email: email.from_email,
            to_emails: email.to_emails,
            subject: email.subject,
          },
          created_at: email.received_at || new Date().toISOString(),
        }));

        const { error: msgError, data: insertedMsgs } = await supabase
          .from('messages')
          .insert(messagesToInsert)
          .select('id');

        if (msgError) {
          console.error(
            `[convert] Failed to insert messages for thread ${threadId}:`,
            msgError.message,
          );
        } else {
          messagesCreated += insertedMsgs?.length || 0;
        }

        // =====================================================================
        // STEP 2d: Mark emails as converted
        // =====================================================================
        const emailIds = threadEmails.map((e) => e.id);
        await supabase
          .from('email_import_queue')
          .update({ conversation_id: conversationId })
          .in('id', emailIds);
      } catch (threadError) {
        console.error(`[convert] Error processing thread ${threadId}:`, threadError);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[convert] Iteration ${_iteration}: ${conversionsCreated} conversations, ${messagesCreated} messages, ${customersCreated} customers in ${elapsed}ms`,
    );

    // =========================================================================
    // STEP 3: Check if more emails remain and self-chain
    // =========================================================================
    const { count: remaining } = await supabase
      .from('email_import_queue')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)
      .not('category', 'is', null)
      .is('conversation_id', null);

    if ((remaining || 0) > 0) {
      console.log(
        `[convert] ${remaining} emails remain, self-chaining iteration ${_iteration + 1}`,
      );

      fetch(`${supabaseUrl}/functions/v1/convert-emails-to-conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          workspace_id,
          _iteration: _iteration + 1,
        }),
      }).catch((e) => console.error(`[convert] Self-chain failed:`, e));

      return new Response(
        JSON.stringify({
          status: 'continuing',
          iteration: _iteration,
          conversations_created: conversionsCreated,
          messages_created: messagesCreated,
          customers_created: customersCreated,
          remaining,
          elapsed_ms: elapsed,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // All done
    console.log(`[convert] All emails converted!`);
    await supabase.from('email_import_progress').upsert(
      {
        workspace_id,
        current_phase: 'complete',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' },
    );

    return new Response(
      JSON.stringify({
        status: 'complete',
        iteration: _iteration,
        conversations_created: conversionsCreated,
        messages_created: messagesCreated,
        customers_created: customersCreated,
        elapsed_ms: elapsed,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('[convert] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
