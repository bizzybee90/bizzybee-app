import { classifyBatch, type ClassifyItemInput, type WorkspaceAiContext } from './ai.ts';
import { createServiceClient } from './pipeline.ts';
import type { ClassificationResult } from './types.ts';

export interface SenderRuleMatch {
  classification: ClassificationResult;
  forcedDecisionBucket?: 'auto_handled' | 'needs_human' | 'act_now' | 'quick_win';
  forcedStatus?: string;
}

export interface ClassificationTarget {
  workspace_id: string;
  run_id?: string | null;
  conversation_id: string;
  target_message_id: string;
  event_id: string;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') {
      return true;
    }
    if (lowered === 'false') {
      return false;
    }
  }
  return fallback;
}

export function classifyFromSenderRule(params: {
  senderRules: Array<Record<string, unknown>>;
  sender: string;
  subject: string;
  body: string;
}): SenderRuleMatch | null {
  const haystack = `${params.sender}\n${params.subject}\n${params.body}`.toLowerCase();

  for (const rule of params.senderRules) {
    const pattern = String(rule.pattern || rule.match_pattern || '').trim();
    if (!pattern) {
      continue;
    }

    const type = String(rule.pattern_type || rule.match_type || 'contains').toLowerCase();
    let matched = false;

    try {
      if (type === 'regex') {
        matched = new RegExp(pattern, 'i').test(haystack);
      } else {
        matched = haystack.includes(pattern.toLowerCase());
      }
    } catch {
      continue;
    }

    if (!matched) {
      continue;
    }

    const forcedDecisionBucket = normalizeText(rule.decision_bucket || '').toLowerCase();
    const forcedStatus = normalizeText(rule.status || '');

    return {
      classification: {
        category: normalizeText(rule.category || 'general').toLowerCase(),
        requires_reply: toBool(rule.requires_reply, false),
        confidence: 1,
        entities: {
          sender_rule_id: rule.id || null,
          sender_rule_pattern: pattern,
        },
      },
      forcedDecisionBucket: ['auto_handled', 'needs_human', 'act_now', 'quick_win'].includes(
        forcedDecisionBucket,
      )
        ? (forcedDecisionBucket as 'auto_handled' | 'needs_human' | 'act_now' | 'quick_win')
        : undefined,
      forcedStatus: forcedStatus || undefined,
    };
  }

  return null;
}

export function decisionForClassification(
  result: ClassificationResult,
  forcedDecisionBucket?: 'auto_handled' | 'needs_human' | 'act_now' | 'quick_win',
  forcedStatus?: string,
): {
  decisionBucket: 'auto_handled' | 'needs_human' | 'act_now' | 'quick_win';
  status: string;
} {
  if (forcedDecisionBucket) {
    const statusByBucket: Record<'auto_handled' | 'needs_human' | 'act_now' | 'quick_win', string> =
      {
        auto_handled: 'resolved',
        needs_human: 'escalated',
        act_now: 'ai_handling',
        quick_win: 'open',
      };

    return {
      decisionBucket: forcedDecisionBucket,
      status: forcedStatus || statusByBucket[forcedDecisionBucket],
    };
  }

  const noiseCategories = new Set(['notification', 'newsletter', 'spam']);
  const category = (result.category || '').toLowerCase();

  if (noiseCategories.has(category)) {
    return { decisionBucket: 'auto_handled', status: 'resolved' };
  }

  if (result.confidence < 0.7) {
    return { decisionBucket: 'needs_human', status: 'escalated' };
  }

  if (result.requires_reply) {
    return { decisionBucket: 'act_now', status: 'ai_handling' };
  }

  return { decisionBucket: 'quick_win', status: 'open' };
}

export async function loadWorkspaceContext(workspaceId: string): Promise<WorkspaceAiContext> {
  const supabase = createServiceClient();

  let businessContext: Record<string, unknown> | null = null;
  let faqEntries: Array<Record<string, unknown>> = [];
  let corrections: Array<Record<string, unknown>> = [];

  try {
    const res = await supabase
      .from('business_context')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (!res.error) {
      businessContext = res.data?.[0] || null;
    } else {
      console.warn('business_context query failed (table may not exist):', res.error.message);
    }
  } catch (e) {
    console.warn('business_context load error:', e);
  }

  try {
    const res = await supabase
      .from('faq_database')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(60);
    if (!res.error) {
      faqEntries = (res.data || []) as Array<Record<string, unknown>>;
    } else {
      console.warn('faq_database query failed (table may not exist):', res.error.message);
    }
  } catch (e) {
    console.warn('faq_database load error:', e);
  }

  try {
    const res = await supabase
      .from('classification_corrections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(60);
    if (!res.error) {
      corrections = (res.data || []) as Array<Record<string, unknown>>;
    } else {
      console.warn(
        'classification_corrections query failed (table may not exist):',
        res.error.message,
      );
    }
  } catch (e) {
    console.warn('classification_corrections load error:', e);
  }

  let houseRules: Array<{ rule_text: string }> = [];
  try {
    const res = await supabase
      .from('house_rules')
      .select('rule_text')
      .eq('workspace_id', workspaceId)
      .eq('active', true)
      .order('created_at', { ascending: true });
    if (!res.error) {
      houseRules = (res.data || []) as Array<{ rule_text: string }>;
    }
  } catch (e) {
    console.warn('house_rules load error:', e);
  }

  return {
    business_context: businessContext,
    faq_entries: faqEntries,
    corrections,
    house_rules: houseRules,
  };
}

export async function applyClassification(params: {
  job: ClassificationTarget;
  result: ClassificationResult;
  forcedDecisionBucket?: 'auto_handled' | 'needs_human' | 'act_now' | 'quick_win';
  forcedStatus?: string;
  forceReclassify?: boolean;
}): Promise<void> {
  const supabase = createServiceClient();

  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select(
      'id, channel, status, metadata, last_inbound_message_id, last_classified_message_id, last_draft_enqueued_message_id',
    )
    .eq('id', params.job.conversation_id)
    .single();

  if (conversationError || !conversation) {
    throw new Error(`Conversation lookup failed: ${conversationError?.message || 'not found'}`);
  }

  if (conversation.last_inbound_message_id !== params.job.target_message_id) {
    return;
  }

  if (
    !params.forceReclassify &&
    conversation.last_classified_message_id === params.job.target_message_id
  ) {
    return;
  }

  const decision = decisionForClassification(
    params.result,
    params.forcedDecisionBucket,
    params.forcedStatus,
  );
  const mergedMetadata = {
    ...(conversation.metadata || {}),
    entities: params.result.entities || {},
    last_decision_bucket: decision.decisionBucket,
  };

  const updatePayload: Record<string, unknown> = {
    category: params.result.category,
    requires_reply: params.result.requires_reply,
    triage_confidence: params.result.confidence,
    decision_bucket: decision.decisionBucket,
    status: decision.status,
    metadata: mergedMetadata,
    last_classified_message_id: params.job.target_message_id,
    training_reviewed: false,
    updated_at: new Date().toISOString(),
  };

  if (conversation.channel === 'email') {
    updatePayload.email_classification = params.result.category;
  }

  const { error: updateConversationError } = await supabase
    .from('conversations')
    .update(updatePayload)
    .eq('id', params.job.conversation_id)
    .eq('last_inbound_message_id', params.job.target_message_id);

  if (updateConversationError) {
    throw new Error(`Conversation update failed: ${updateConversationError.message}`);
  }

  const { error: eventError } = await supabase
    .from('message_events')
    .update({ status: 'decided', last_error: null, updated_at: new Date().toISOString() })
    .eq('id', params.job.event_id)
    .neq('status', 'drafted');

  if (eventError) {
    throw new Error(`message_events decision update failed: ${eventError.message}`);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (supabaseUrl && serviceRoleKey) {
      const { data: conv } = await supabase
        .from('conversations')
        .select('customer_id')
        .eq('id', params.job.conversation_id)
        .single();

      if (conv?.customer_id) {
        fetch(`${supabaseUrl}/functions/v1/ai-enrich-conversation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            conversation_id: params.job.conversation_id,
            customer_id: conv.customer_id,
            workspace_id: params.job.workspace_id,
          }),
        }).catch((e) => console.warn('ai-enrich fire-and-forget failed:', e));
      }
    }
  } catch (e) {
    console.warn('ai-enrich trigger error (non-fatal):', e);
  }

  if (decision.decisionBucket === 'auto_handled') {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      if (supabaseUrl && serviceRoleKey) {
        fetch(`${supabaseUrl}/functions/v1/mark-email-read`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            conversationId: params.job.conversation_id,
            markAsRead: true,
          }),
        }).catch((e) => console.warn('mark-email-read fire-and-forget failed:', e));
      }
    } catch (e) {
      console.warn('mark-email-read trigger error (non-fatal):', e);
    }
  }

  if (params.result.requires_reply && decision.decisionBucket !== 'auto_handled') {
    const { data: freshConversation, error: freshConversationError } = await supabase
      .from('conversations')
      .select('id, last_draft_enqueued_message_id')
      .eq('id', params.job.conversation_id)
      .single();

    if (freshConversationError || !freshConversation) {
      throw new Error(
        `Conversation reload failed for draft enqueue: ${freshConversationError?.message || 'not found'}`,
      );
    }

    if (freshConversation.last_draft_enqueued_message_id !== params.job.target_message_id) {
      const { error: markDraftEnqueuedError } = await supabase
        .from('conversations')
        .update({
          last_draft_enqueued_message_id: params.job.target_message_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.job.conversation_id)
        .neq('last_draft_enqueued_message_id', params.job.target_message_id);

      if (markDraftEnqueuedError) {
        throw new Error(
          `Failed to set last_draft_enqueued_message_id: ${markDraftEnqueuedError.message}`,
        );
      }

      const { error: draftQueueError } = await supabase.rpc('bb_queue_send', {
        queue_name: 'bb_draft_jobs',
        message: {
          job_type: 'DRAFT',
          workspace_id: params.job.workspace_id,
          run_id: params.job.run_id || null,
          conversation_id: params.job.conversation_id,
          target_message_id: params.job.target_message_id,
          event_id: params.job.event_id,
        },
        delay_seconds: 0,
      });

      if (draftQueueError) {
        throw new Error(`Failed to enqueue DRAFT job: ${draftQueueError.message}`);
      }
    }
  }
}

export async function classifySingleConversation(params: {
  workspaceId: string;
  conversationId: string;
  eventId: string;
  targetMessageId: string;
  runId?: string | null;
  senderRules?: Array<Record<string, unknown>>;
  recentMessages?: Array<{ direction: string; body: string }>;
}): Promise<{
  result: ClassificationResult;
  forcedDecisionBucket?: 'auto_handled' | 'needs_human' | 'act_now' | 'quick_win';
  forcedStatus?: string;
  source: 'sender_rule' | 'anthropic';
}> {
  const supabase = createServiceClient();
  const { data: event, error: eventError } = await supabase
    .from('message_events')
    .select('id, from_identifier, subject, body, channel')
    .eq('id', params.eventId)
    .single();

  if (eventError || !event) {
    throw new Error(
      `message_events fetch failed for ${params.eventId}: ${eventError?.message || 'not found'}`,
    );
  }

  let senderRules = params.senderRules;
  if (!senderRules) {
    const { data: loadedRules, error: senderRulesError } = await supabase
      .from('sender_rules')
      .select('*')
      .eq('workspace_id', params.workspaceId);

    if (senderRulesError) {
      console.warn('sender_rules load failed (table may not exist):', senderRulesError.message);
    }

    senderRules = (loadedRules || []) as Array<Record<string, unknown>>;
  }

  const senderMatch = classifyFromSenderRule({
    senderRules: senderRules || [],
    sender: event.from_identifier || '',
    subject: event.subject || '',
    body: event.body || '',
  });

  if (senderMatch) {
    return {
      result: senderMatch.classification,
      forcedDecisionBucket: senderMatch.forcedDecisionBucket,
      forcedStatus: senderMatch.forcedStatus,
      source: 'sender_rule',
    };
  }

  const recentMessages = params.recentMessages || [];
  const context = await loadWorkspaceContext(params.workspaceId);
  const items: ClassifyItemInput[] = [
    {
      item_id: params.eventId,
      conversation_id: params.conversationId,
      target_message_id: params.targetMessageId,
      channel: event.channel || 'email',
      sender_identifier: event.from_identifier || '',
      subject: event.subject || '',
      body: event.body || '',
      recent_messages: recentMessages,
    },
  ];

  const classifications = await classifyBatch({ items, context });
  const result = classifications.get(params.eventId);
  if (!result) {
    throw new Error(`No classification returned for ${params.eventId}`);
  }

  return {
    result,
    source: 'anthropic',
  };
}
