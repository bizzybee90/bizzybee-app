import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';
import {
  fetchBusinessContext,
  fetchSenderRules,
  fetchCorrections,
  fetchFAQs,
  matchSenderRule,
  buildEnrichedPrompt,
} from './context.ts';

/**
 * BULK EMAIL CLASSIFIER - Phase 2: Context-Enriched
 *
 * Supports two modes:
 * 1. Partitioned (called by dispatcher): receives partition_id & total_partitions
 * 2. Legacy (direct call): fetches all unclassified emails sequentially
 *
 * Phase 2 additions:
 * - Sender rule pre-triage gate (skip LLM for matched emails)
 * - Business context, corrections, FAQs injected into prompt
 * - Confidence scores in output
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash';
const BATCH_SIZE = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      workspace_id,
      partition_id,
      total_partitions,
      callback_url,
      _batch_number = 0,
    } = await req.json();

    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'workspace_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const auth = await validateAuth(req, workspace_id);
    const workspaceId = auth.workspaceId;

    const isPartitioned = partition_id !== undefined && total_partitions !== undefined;
    const workerTag = isPartitioned ? `[Worker ${partition_id}/${total_partitions}]` : '[legacy]';

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const startTime = Date.now();

    console.log(`${workerTag} Starting batch ${_batch_number} for workspace ${workspaceId}`);

    // Update progress
    await supabase.from('email_import_progress').upsert(
      {
        workspace_id: workspaceId,
        current_phase: 'classifying',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' },
    );

    // ==========================================================================
    // STEP 1: Fetch context (business profile, sender rules, corrections, FAQs)
    // ==========================================================================
    const [bizCtx, senderRules, corrections, faqs] = await Promise.all([
      fetchBusinessContext(supabase, workspaceId),
      fetchSenderRules(supabase, workspaceId),
      fetchCorrections(supabase, workspaceId),
      fetchFAQs(supabase, workspaceId),
    ]);

    console.log(
      `${workerTag} Context: biz=${!!bizCtx}, rules=${senderRules.length}, corrections=${corrections.length}, faqs=${faqs.length}`,
    );

    // ==========================================================================
    // STEP 2: Fetch emails (partitioned or legacy)
    // ==========================================================================
    let emails: any[] | null = null;
    let fetchError: any = null;

    if (isPartitioned) {
      const result = await supabase.rpc('get_partitioned_unclassified_batch', {
        p_workspace_id: workspaceId,
        p_partition_id: partition_id,
        p_total_partitions: total_partitions,
        p_batch_size: BATCH_SIZE,
      });
      emails = result.data;
      fetchError = result.error;
    } else {
      const result = await supabase
        .from('email_import_queue')
        .select('id, from_email, subject, body, direction')
        .eq('workspace_id', workspaceId)
        .is('category', null)
        .order('id', { ascending: true })
        .range(0, BATCH_SIZE - 1);
      emails = result.data;
      fetchError = result.error;
    }

    if (fetchError) throw fetchError;

    if (!emails || emails.length === 0) {
      console.log(`${workerTag} No more emails in partition`);
      return await handlePartitionComplete(
        supabase,
        supabaseUrl,
        supabaseServiceKey,
        workspaceId,
        workerTag,
        callback_url,
        isPartitioned,
      );
    }

    console.log(`${workerTag} Found ${emails.length} emails in batch ${_batch_number}`);

    // ==========================================================================
    // STEP 3: Sender rule pre-triage gate
    // ==========================================================================
    const ruleMatched: Array<{ email: any; rule: any }> = [];
    const needsAI: any[] = [];

    for (const email of emails) {
      const rule = matchSenderRule(email.from_email, senderRules);
      if (rule) {
        ruleMatched.push({ email, rule });
      } else {
        needsAI.push(email);
      }
    }

    console.log(
      `${workerTag} Pre-triage: ${ruleMatched.length} rule-matched, ${needsAI.length} need AI`,
    );

    // Instantly classify rule-matched emails
    const now = new Date().toISOString();
    let updated = 0;
    let failed = 0;

    if (ruleMatched.length > 0) {
      const PARALLEL_BATCH = 50;
      for (let i = 0; i < ruleMatched.length; i += PARALLEL_BATCH) {
        const batch = ruleMatched.slice(i, i + PARALLEL_BATCH);
        const results = await Promise.all(
          batch.map(async ({ email, rule }) => {
            const { error } = await supabase
              .from('email_import_queue')
              .update({
                category: rule.default_classification,
                requires_reply: rule.default_requires_reply ?? false,
                confidence: 1.0,
                needs_review: false,
                classified_at: now,
                status: 'processed',
                processed_at: now,
              })
              .eq('id', email.id);
            return !error;
          }),
        );
        updated += results.filter(Boolean).length;
        failed += results.filter((r) => !r).length;
      }
      console.log(`${workerTag} Rule-classified: ${updated} updated, ${failed} failed`);
    }

    // ==========================================================================
    // STEP 4: AI classification for remaining emails
    // ==========================================================================
    if (needsAI.length > 0) {
      const prompt = buildEnrichedPrompt(needsAI, bizCtx, corrections, faqs);

      console.log(
        `${workerTag} Prompt: ${prompt.length} chars, ~${Math.ceil(prompt.length / 4)} tokens`,
      );

      const response = await fetch(LOVABLE_AI_GATEWAY, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${lovableApiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 65536,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`${workerTag} AI Gateway error:`, errorText);
        throw new Error(`AI Gateway error: ${response.status} - ${errorText}`);
      }

      const aiData = await response.json();
      const responseText = aiData.choices?.[0]?.message?.content || '';

      // Parse classifications - robust extraction
      let classifications: Array<{
        i: number;
        c: string;
        r: boolean;
        conf?: number;
        ent?: Record<string, string>;
      }>;
      try {
        // Strip markdown fences
        const cleaned = responseText
          .replace(/```(?:json)?\s*/gi, '')
          .replace(/```/g, '')
          .trim();
        // Try greedy array match first
        const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          classifications = JSON.parse(jsonMatch[0]);
        } else {
          // Fallback: collect individual objects via bracket matching
          const objects: any[] = [];
          let idx = 0;
          while (idx < cleaned.length) {
            const start = cleaned.indexOf('{', idx);
            if (start === -1) break;
            let depth = 0;
            let end = start;
            for (let j = start; j < cleaned.length; j++) {
              if (cleaned[j] === '{') depth++;
              if (cleaned[j] === '}') depth--;
              if (depth === 0) {
                end = j;
                break;
              }
            }
            try {
              objects.push(JSON.parse(cleaned.substring(start, end + 1)));
            } catch {
              /* skip */
            }
            idx = end + 1;
          }
          if (objects.length === 0) throw new Error('No JSON found');
          classifications = objects;
        }
      } catch (e) {
        console.error(`${workerTag} Failed to parse AI response:`, responseText.substring(0, 500));
        throw new Error(
          `Failed to parse AI response: ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }

      console.log(`${workerTag} Parsed ${classifications.length} AI classifications`);

      // Build map and update
      const classMap = new Map<
        number,
        { c: string; r: boolean; conf: number; ent?: Record<string, string> }
      >();
      for (const cl of classifications) {
        classMap.set(cl.i, { c: cl.c, r: cl.r, conf: cl.conf ?? 0.5, ent: cl.ent });
      }

      const PARALLEL_BATCH = 50;
      for (let i = 0; i < needsAI.length; i += PARALLEL_BATCH) {
        const batch = needsAI.slice(i, i + PARALLEL_BATCH);
        const results = await Promise.all(
          batch.map(async (email: any, batchIdx: number) => {
            const globalIdx = i + batchIdx;
            const classification = classMap.get(globalIdx);
            const conf = classification?.conf ?? 0.5;
            const entities =
              classification?.ent && Object.keys(classification.ent).length > 0
                ? classification.ent
                : null;
            const { error } = await supabase
              .from('email_import_queue')
              .update({
                category: classification?.c || 'unknown',
                requires_reply: classification?.r || false,
                confidence: conf,
                needs_review: conf < 0.6,
                entities,
                classified_at: now,
                status: 'processed',
                processed_at: now,
              })
              .eq('id', email.id);
            return !error;
          }),
        );
        updated += results.filter(Boolean).length;
        failed += results.filter((r) => !r).length;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `${workerTag} Batch ${_batch_number}: ${updated} updated, ${failed} failed in ${elapsed}ms`,
    );

    // ==========================================================================
    // STEP 5: Self-chain if more emails in partition
    // ==========================================================================
    let moreInPartition = false;
    if (isPartitioned) {
      const { data: nextBatch } = await supabase.rpc('get_partitioned_unclassified_batch', {
        p_workspace_id: workspaceId,
        p_partition_id: partition_id,
        p_total_partitions: total_partitions,
        p_batch_size: 1,
      });
      moreInPartition = nextBatch && nextBatch.length > 0;
    } else {
      const { count } = await supabase
        .from('email_import_queue')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .is('category', null);
      moreInPartition = (count || 0) > 0;
    }

    if (moreInPartition) {
      console.log(`${workerTag} More emails remain, self-chaining batch ${_batch_number + 1}`);

      const { count: totalClassified } = await supabase
        .from('email_import_queue')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .not('category', 'is', null);

      await supabase.from('email_import_progress').upsert(
        {
          workspace_id: workspaceId,
          current_phase: 'classifying',
          emails_classified: totalClassified || 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id' },
      );

      fetch(`${supabaseUrl}/functions/v1/email-classify-bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          partition_id: isPartitioned ? partition_id : undefined,
          total_partitions: isPartitioned ? total_partitions : undefined,
          callback_url,
          _batch_number: _batch_number + 1,
        }),
      }).catch((e) => console.error(`${workerTag} Self-chain failed:`, e));

      return new Response(
        JSON.stringify({
          success: true,
          status: 'continuing',
          worker: workerTag,
          batch: _batch_number,
          emails_classified: updated,
          rule_matched: ruleMatched.length,
          ai_classified: needsAI.length,
          elapsed_ms: elapsed,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // ==========================================================================
    // STEP 6: Partition empty → check global remaining
    // ==========================================================================
    return await handlePartitionComplete(
      supabase,
      supabaseUrl,
      supabaseServiceKey,
      workspaceId,
      workerTag,
      callback_url,
      isPartitioned,
    );
  } catch (error) {
    console.error('[email-classify-bulk] Error:', error);

    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      const body = await req
        .clone()
        .json()
        .catch(() => ({}));
      if (body.workspace_id) {
        await supabase.from('email_import_progress').upsert(
          {
            workspace_id: body.workspace_id,
            current_phase: 'error',
            last_error: error instanceof Error ? error.message : 'Classification failed',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id' },
        );
      }
    } catch {
      // Ignore
    }

    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }

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

/**
 * Called when a worker's partition is empty.
 * Checks global remaining count - only the LAST worker triggers voice-learning and callback.
 */
async function handlePartitionComplete(
  supabase: any,
  supabaseUrl: string,
  supabaseServiceKey: string,
  workspace_id: string,
  workerTag: string,
  callback_url: string | null,
  isPartitioned: boolean,
) {
  const { data: globalRemaining } = await supabase.rpc('count_unclassified_emails', {
    p_workspace_id: workspace_id,
  });

  const remaining = Number(globalRemaining) || 0;

  if (remaining > 0 && isPartitioned) {
    console.log(
      `${workerTag} Partition empty but ${remaining} emails remain globally (other workers still running)`,
    );
    return new Response(
      JSON.stringify({
        success: true,
        status: 'partition_complete',
        worker: workerTag,
        global_remaining: remaining,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  console.log(`${workerTag} ALL DONE - triggering voice-learning + conversion`);

  const { count: totalClassified } = await supabase
    .from('email_import_queue')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspace_id)
    .not('category', 'is', null);

  await supabase.from('email_import_progress').upsert(
    {
      workspace_id,
      current_phase: 'learning',
      emails_classified: totalClassified || 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  );

  // Mark email_import as complete in n8n_workflow_progress
  await supabase.from('n8n_workflow_progress').upsert(
    {
      workspace_id,
      workflow_type: 'email_import',
      status: 'complete',
      details: { total_classified: totalClassified || 0 },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,workflow_type' },
  );

  // Trigger voice learning
  await triggerVoiceLearning(supabaseUrl, supabaseServiceKey, workspace_id);

  // Trigger email-to-conversation conversion (fire and forget)
  fetch(`${supabaseUrl}/functions/v1/convert-emails-to-conversations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseServiceKey}`,
    },
    body: JSON.stringify({ workspace_id }),
  }).catch((e) => console.error(`${workerTag} Failed to trigger conversion:`, e));
  console.log(`${workerTag} Triggered convert-emails-to-conversations`);

  // Send callback to n8n if provided
  if (callback_url) {
    try {
      await fetch(callback_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id,
          status: 'classification_complete',
          total_classified: totalClassified || 0,
          message: 'All emails classified, voice learning triggered',
        }),
      });
      console.log(`${workerTag} Sent completion callback to ${callback_url}`);
    } catch (e) {
      console.error(`${workerTag} Callback failed:`, e);
    }
  }

  // Check if backfill is pending and update progress
  const { data: backfillProgress } = await supabase
    .from('email_import_progress')
    .select('backfill_status')
    .eq('workspace_id', workspace_id)
    .maybeSingle();

  if (backfillProgress?.backfill_status === 'running') {
    await supabase
      .from('email_import_progress')
      .update({
        backfill_status: 'complete',
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspace_id);
    console.log(
      `${workerTag} Backfill classification complete, marked backfill_status = 'complete'`,
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      status: 'complete',
      worker: workerTag,
      total_classified: totalClassified,
      chained_to: 'voice-learning',
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
}

async function triggerVoiceLearning(
  supabaseUrl: string,
  supabaseServiceKey: string,
  workspace_id: string,
): Promise<void> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/voice-learning`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ workspace_id }),
    });

    if (!response.ok) {
      console.error(`Failed to trigger voice-learning: ${response.status}`);
    } else {
      console.log(`Triggered voice-learning for workspace ${workspace_id}`);
    }
  } catch (e) {
    console.error(`Error triggering voice-learning:`, e);
  }
}
