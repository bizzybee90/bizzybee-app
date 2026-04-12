import { classifyBatch, type ClassifyItemInput, type WorkspaceAiContext } from '../_shared/ai.ts';
import {
  applyClassification,
  classifyFromSenderRule,
  decisionForClassification,
  loadWorkspaceContext,
} from '../_shared/classification.ts';
import {
  assertWorkerToken,
  auditJob,
  createServiceClient,
  deadletterJob,
  DEFAULT_TIME_BUDGET_MS,
  HttpError,
  jsonResponse,
  queueDelete,
  queueSend,
  readQueue,
  touchPipelineRun,
  withinBudget,
} from '../_shared/pipeline.ts';
import type { ClassificationResult, ClassifyJob } from '../_shared/types.ts';

const QUEUE_NAME = 'bb_classify_jobs';
const VT_SECONDS = 180;
const MAX_ATTEMPTS = 6;

interface PendingAiJob {
  record: {
    msg_id: number;
    read_ct: number;
    message: ClassifyJob;
  };
  event: {
    id: string;
    from_identifier: string;
    subject: string | null;
    body: string | null;
    channel: string;
  };
  conversation: {
    id: string;
    status: string;
    channel: string;
    metadata: Record<string, unknown> | null;
    last_inbound_message_id: string | null;
    last_classified_message_id: string | null;
    last_draft_enqueued_message_id: string | null;
  };
  recentMessages: Array<{ direction: string; body: string }>;
}

interface SenderRuleMatch {
  classification: ClassificationResult;
  forcedDecisionBucket?: 'auto_handled' | 'needs_human' | 'act_now' | 'quick_win';
  forcedStatus?: string;
}

Deno.serve(async (req) => {
  const startMs = Date.now();
  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }

    assertWorkerToken(req);
    const supabase = createServiceClient();
    const batchSize = Number(Deno.env.get('BB_CLASSIFY_BATCH_SIZE') || '40');

    const queueRecords = await readQueue<ClassifyJob>(
      supabase,
      QUEUE_NAME,
      VT_SECONDS,
      Math.max(1, Math.min(80, batchSize)),
    );

    let processed = 0;
    const aiCandidates: PendingAiJob[] = [];
    const senderRulesByWorkspace = new Map<string, Array<Record<string, unknown>>>();

    for (const record of queueRecords) {
      if (!withinBudget(startMs, DEFAULT_TIME_BUDGET_MS)) {
        break;
      }

      const job = record.message;
      try {
        if (!job || job.job_type !== 'CLASSIFY') {
          await queueDelete(supabase, QUEUE_NAME, record.msg_id);
          await auditJob(supabase, {
            workspaceId: job?.workspace_id,
            runId: job?.run_id,
            queueName: QUEUE_NAME,
            jobPayload: (job || {}) as unknown as Record<string, unknown>,
            outcome: 'discarded',
            error: 'Invalid CLASSIFY job',
            attempts: record.read_ct,
          });
          continue;
        }

        const { data: conversation, error: conversationError } = await supabase
          .from('conversations')
          .select(
            'id, status, channel, metadata, last_inbound_message_id, last_classified_message_id, last_draft_enqueued_message_id',
          )
          .eq('id', job.conversation_id)
          .single();

        if (conversationError || !conversation) {
          throw new Error(
            `Conversation fetch failed for ${job.conversation_id}: ${conversationError?.message || 'not found'}`,
          );
        }

        if (conversation.last_inbound_message_id !== job.target_message_id) {
          await queueDelete(supabase, QUEUE_NAME, record.msg_id);
          await auditJob(supabase, {
            workspaceId: job.workspace_id,
            runId: job.run_id,
            queueName: QUEUE_NAME,
            jobPayload: job as unknown as Record<string, unknown>,
            outcome: 'discarded',
            error: 'Stale classify job (target no longer latest inbound)',
            attempts: record.read_ct,
          });
          processed += 1;
          continue;
        }

        if (conversation.last_classified_message_id === job.target_message_id) {
          await queueDelete(supabase, QUEUE_NAME, record.msg_id);
          await auditJob(supabase, {
            workspaceId: job.workspace_id,
            runId: job.run_id,
            queueName: QUEUE_NAME,
            jobPayload: job as unknown as Record<string, unknown>,
            outcome: 'discarded',
            error: 'Already classified target message',
            attempts: record.read_ct,
          });
          processed += 1;
          continue;
        }

        const { data: event, error: eventError } = await supabase
          .from('message_events')
          .select('id, from_identifier, subject, body, channel')
          .eq('id', job.event_id)
          .single();

        if (eventError || !event) {
          throw new Error(
            `message_events fetch failed for ${job.event_id}: ${eventError?.message || 'not found'}`,
          );
        }

        if (!senderRulesByWorkspace.has(job.workspace_id)) {
          const { data: senderRules, error: senderRulesError } = await supabase
            .from('sender_rules')
            .select('*')
            .eq('workspace_id', job.workspace_id);

          if (senderRulesError) {
            console.warn(
              'sender_rules load failed (table may not exist):',
              senderRulesError.message,
            );
          }

          senderRulesByWorkspace.set(
            job.workspace_id,
            (senderRules || []) as Array<Record<string, unknown>>,
          );
        }

        const senderRules = senderRulesByWorkspace.get(job.workspace_id) || [];
        const senderMatch = classifyFromSenderRule({
          senderRules,
          sender: event.from_identifier || '',
          subject: event.subject || '',
          body: event.body || '',
        });

        if (senderMatch) {
          await applyClassification({
            job,
            result: senderMatch.classification,
            forcedDecisionBucket: senderMatch.forcedDecisionBucket,
            forcedStatus: senderMatch.forcedStatus,
          });

          await queueDelete(supabase, QUEUE_NAME, record.msg_id);
          await auditJob(supabase, {
            workspaceId: job.workspace_id,
            runId: job.run_id,
            queueName: QUEUE_NAME,
            jobPayload: job as unknown as Record<string, unknown>,
            outcome: 'processed',
            attempts: record.read_ct,
          });

          await touchPipelineRun(supabase, {
            runId: job.run_id,
            metricsPatch: {
              last_classified_event_id: job.event_id,
              last_classified_at: new Date().toISOString(),
              classify_source: 'sender_rule',
            },
          });

          processed += 1;
          continue;
        }

        const { data: recentMessages, error: recentMessagesError } = await supabase
          .from('messages')
          .select('direction, body')
          .eq('conversation_id', job.conversation_id)
          .order('created_at', { ascending: false })
          .limit(6);

        if (recentMessagesError) {
          throw new Error(`Failed to load recent messages: ${recentMessagesError.message}`);
        }

        aiCandidates.push({
          record,
          event: {
            id: event.id,
            from_identifier: event.from_identifier || '',
            subject: event.subject || null,
            body: event.body || null,
            channel: event.channel || 'email',
          },
          conversation: {
            id: conversation.id,
            status: conversation.status,
            channel: conversation.channel,
            metadata: (conversation.metadata || {}) as Record<string, unknown>,
            last_inbound_message_id: conversation.last_inbound_message_id,
            last_classified_message_id: conversation.last_classified_message_id,
            last_draft_enqueued_message_id: conversation.last_draft_enqueued_message_id,
          },
          recentMessages: (recentMessages || []) as Array<{ direction: string; body: string }>,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('pipeline-worker-classify prep error', {
          msg_id: record.msg_id,
          attempts: record.read_ct,
          error: message,
        });

        if (job?.workspace_id && record.read_ct >= MAX_ATTEMPTS) {
          await deadletterJob(supabase, {
            fromQueue: QUEUE_NAME,
            msgId: record.msg_id,
            attempts: record.read_ct,
            workspaceId: job.workspace_id,
            runId: job.run_id,
            jobPayload: (job || {}) as unknown as Record<string, unknown>,
            error: message,
            scope: 'pipeline-worker-classify',
          });
        } else {
          await auditJob(supabase, {
            workspaceId: job?.workspace_id,
            runId: job?.run_id,
            queueName: QUEUE_NAME,
            jobPayload: (job || {}) as unknown as Record<string, unknown>,
            outcome: 'failed',
            error: message,
            attempts: record.read_ct,
          });
        }
      }
    }

    const grouped = new Map<string, PendingAiJob[]>();
    for (const item of aiCandidates) {
      const key = item.record.message.workspace_id;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(item);
    }

    for (const [workspaceId, group] of grouped.entries()) {
      if (!withinBudget(startMs, DEFAULT_TIME_BUDGET_MS - 3_000)) {
        break;
      }

      try {
        const context = await loadWorkspaceContext(workspaceId);
        const items: ClassifyItemInput[] = group.map((row) => ({
          item_id: row.record.message.event_id,
          conversation_id: row.record.message.conversation_id,
          target_message_id: row.record.message.target_message_id,
          channel: row.event.channel,
          sender_identifier: row.event.from_identifier,
          subject: row.event.subject || '',
          body: row.event.body || '',
          recent_messages: row.recentMessages,
        }));

        const classifications = await classifyBatch({ items, context });

        for (const row of group) {
          const job = row.record.message;
          try {
            const result = classifications.get(job.event_id) || {
              category: 'general',
              requires_reply: true,
              confidence: 0.55,
              entities: {},
            };

            await applyClassification({ job, result });
            await queueDelete(supabase, QUEUE_NAME, row.record.msg_id);
            await auditJob(supabase, {
              workspaceId: job.workspace_id,
              runId: job.run_id,
              queueName: QUEUE_NAME,
              jobPayload: job as unknown as Record<string, unknown>,
              outcome: 'processed',
              attempts: row.record.read_ct,
            });

            await touchPipelineRun(supabase, {
              runId: job.run_id,
              metricsPatch: {
                last_classified_event_id: job.event_id,
                last_classified_at: new Date().toISOString(),
                classify_source: 'ai',
              },
            });

            processed += 1;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (row.record.read_ct >= MAX_ATTEMPTS) {
              await deadletterJob(supabase, {
                fromQueue: QUEUE_NAME,
                msgId: row.record.msg_id,
                attempts: row.record.read_ct,
                workspaceId: job.workspace_id,
                runId: job.run_id,
                jobPayload: job as unknown as Record<string, unknown>,
                error: message,
                scope: 'pipeline-worker-classify',
              });
            } else {
              await auditJob(supabase, {
                workspaceId: job.workspace_id,
                runId: job.run_id,
                queueName: QUEUE_NAME,
                jobPayload: job as unknown as Record<string, unknown>,
                outcome: 'failed',
                error: message,
                attempts: row.record.read_ct,
              });

              await supabase
                .from('message_events')
                .update({ last_error: message, updated_at: new Date().toISOString() })
                .eq('id', job.event_id)
                .neq('status', 'drafted');
            }
          }
        }
      } catch (error) {
        const groupError = error instanceof Error ? error.message : String(error);
        console.error('pipeline-worker-classify batch error', { workspaceId, error: groupError });

        for (const row of group) {
          const job = row.record.message;
          if (row.record.read_ct >= MAX_ATTEMPTS) {
            await deadletterJob(supabase, {
              fromQueue: QUEUE_NAME,
              msgId: row.record.msg_id,
              attempts: row.record.read_ct,
              workspaceId: job.workspace_id,
              runId: job.run_id,
              jobPayload: job as unknown as Record<string, unknown>,
              error: groupError,
              scope: 'pipeline-worker-classify',
            });
          } else {
            await auditJob(supabase, {
              workspaceId: job.workspace_id,
              runId: job.run_id,
              queueName: QUEUE_NAME,
              jobPayload: job as unknown as Record<string, unknown>,
              outcome: 'failed',
              error: groupError,
              attempts: row.record.read_ct,
            });
          }
        }
      }
    }

    return jsonResponse({
      ok: true,
      queue: QUEUE_NAME,
      fetched_jobs: queueRecords.length,
      ai_candidates: aiCandidates.length,
      processed,
      elapsed_ms: Date.now() - startMs,
    });
  } catch (error) {
    console.error('pipeline-worker-classify fatal', error);
    if (error instanceof HttpError) {
      return jsonResponse({ ok: false, error: error.message }, error.status);
    }

    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected error',
        elapsed_ms: Date.now() - startMs,
      },
      500,
    );
  }
});
