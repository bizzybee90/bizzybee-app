import { generateDraftWithAnthropic } from "../_shared/ai.ts";
import {
  assertWorkerToken,
  auditJob,
  createServiceClient,
  deadletterJob,
  DEFAULT_TIME_BUDGET_MS,
  HttpError,
  jsonResponse,
  queueDelete,
  readQueue,
  touchPipelineRun,
  withinBudget,
} from "../_shared/pipeline.ts";
import type { DraftJob } from "../_shared/types.ts";

const QUEUE_NAME = "bb_draft_jobs";
const VT_SECONDS = 180;
const MAX_ATTEMPTS = 6;

async function loadDraftContext(workspaceId: string): Promise<{
  businessContext: Record<string, unknown> | null;
  faqEntries: Array<Record<string, unknown>>;
}> {
  const supabase = createServiceClient();

  let businessContext: Record<string, unknown> | null = null;
  let faqEntries: Array<Record<string, unknown>> = [];

  try {
    const res = await supabase
      .from("business_context")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (!res.error) {
      businessContext = res.data?.[0] || null;
    } else {
      console.warn("business_context query failed (table may not exist):", res.error.message);
    }
  } catch (e) {
    console.warn("business_context load error:", e);
  }

  try {
    const res = await supabase
      .from("faq_database")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(60);
    if (!res.error) {
      faqEntries = (res.data || []) as Array<Record<string, unknown>>;
    } else {
      console.warn("faq_database query failed (table may not exist):", res.error.message);
    }
  } catch (e) {
    console.warn("faq_database load error:", e);
  }

  return { businessContext, faqEntries };
}

Deno.serve(async (req) => {
  const startMs = Date.now();
  try {
    if (req.method !== "POST") {
      throw new HttpError(405, "Method not allowed");
    }

    assertWorkerToken(req);
    const supabase = createServiceClient();
    const batchSize = Number(Deno.env.get("BB_DRAFT_BATCH_SIZE") || "20");

    const records = await readQueue<DraftJob>(
      supabase,
      QUEUE_NAME,
      VT_SECONDS,
      Math.max(1, Math.min(40, batchSize)),
    );

    let processed = 0;
    for (const record of records) {
      if (!withinBudget(startMs, DEFAULT_TIME_BUDGET_MS)) {
        break;
      }

      const job = record.message;
      try {
        if (!job || job.job_type !== "DRAFT") {
          await queueDelete(supabase, QUEUE_NAME, record.msg_id);
          await auditJob(supabase, {
            workspaceId: job?.workspace_id,
            runId: job?.run_id,
            queueName: QUEUE_NAME,
            jobPayload: (job || {}) as unknown as Record<string, unknown>,
            outcome: "discarded",
            error: "Invalid DRAFT job",
            attempts: record.read_ct,
          });
          continue;
        }

        const { data: conversation, error: conversationError } = await supabase
          .from("conversations")
          .select("id, workspace_id, title, status, channel, last_inbound_message_id, last_draft_message_id")
          .eq("id", job.conversation_id)
          .single();

        if (conversationError || !conversation) {
          throw new Error(`Conversation lookup failed: ${conversationError?.message || "not found"}`);
        }

        if (conversation.last_inbound_message_id !== job.target_message_id) {
          await queueDelete(supabase, QUEUE_NAME, record.msg_id);
          await auditJob(supabase, {
            workspaceId: job.workspace_id,
            runId: job.run_id,
            queueName: QUEUE_NAME,
            jobPayload: job as unknown as Record<string, unknown>,
            outcome: "discarded",
            error: "Stale draft job (target no longer latest inbound)",
            attempts: record.read_ct,
          });
          processed += 1;
          continue;
        }

        if (conversation.last_draft_message_id === job.target_message_id) {
          await queueDelete(supabase, QUEUE_NAME, record.msg_id);
          await auditJob(supabase, {
            workspaceId: job.workspace_id,
            runId: job.run_id,
            queueName: QUEUE_NAME,
            jobPayload: job as unknown as Record<string, unknown>,
            outcome: "discarded",
            error: "Draft already exists for target message",
            attempts: record.read_ct,
          });
          processed += 1;
          continue;
        }

        const [{ data: targetMessage, error: targetMessageError }, { data: recentMessages, error: recentMessagesError }] = await Promise.all([
          supabase
            .from("messages")
            .select("id, body, created_at")
            .eq("id", job.target_message_id)
            .single(),
          supabase
            .from("messages")
            .select("direction, body")
            .eq("conversation_id", job.conversation_id)
            .order("created_at", { ascending: false })
            .limit(12),
        ]);

        if (targetMessageError || !targetMessage) {
          throw new Error(`Target message lookup failed: ${targetMessageError?.message || "not found"}`);
        }

        if (recentMessagesError) {
          throw new Error(`Recent messages load failed: ${recentMessagesError.message}`);
        }

        // 7-day draft cutoff: skip drafting for old messages to avoid
        // bulk imports firing hundreds of Claude calls for stale emails
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        if (targetMessage.created_at && new Date(targetMessage.created_at).getTime() < sevenDaysAgo) {
          await queueDelete(supabase, QUEUE_NAME, record.msg_id);
          await auditJob(supabase, {
            workspaceId: job.workspace_id,
            runId: job.run_id,
            queueName: QUEUE_NAME,
            jobPayload: job as unknown as Record<string, unknown>,
            outcome: "discarded",
            error: "Skipped: message older than 7 days",
            attempts: record.read_ct,
          });
          processed += 1;
          continue;
        }

        const draftContext = await loadDraftContext(job.workspace_id);
        const draftText = await generateDraftWithAnthropic({
          conversationId: job.conversation_id,
          subject: conversation.title || "",
          latestInboundBody: targetMessage.body || "",
          recentMessages: (recentMessages || []) as Array<{ direction: string; body: string }>,
          businessContext: draftContext.businessContext,
          faqEntries: draftContext.faqEntries,
        });

        const { error: updateConversationError } = await supabase
          .from("conversations")
          .update({
            ai_draft_response: draftText,
            last_draft_message_id: job.target_message_id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.conversation_id)
          .eq("last_inbound_message_id", job.target_message_id)
          .neq("last_draft_message_id", job.target_message_id);

        if (updateConversationError) {
          throw new Error(`Conversation draft update failed: ${updateConversationError.message}`);
        }

        if (job.event_id) {
          const { error: eventError } = await supabase
            .from("message_events")
            .update({ status: "drafted", last_error: null, updated_at: new Date().toISOString() })
            .eq("id", job.event_id);

          if (eventError) {
            throw new Error(`message_events draft status update failed: ${eventError.message}`);
          }
        }

        await queueDelete(supabase, QUEUE_NAME, record.msg_id);
        await auditJob(supabase, {
          workspaceId: job.workspace_id,
          runId: job.run_id,
          queueName: QUEUE_NAME,
          jobPayload: job as unknown as Record<string, unknown>,
          outcome: "processed",
          attempts: record.read_ct,
        });

        await touchPipelineRun(supabase, {
          runId: job.run_id,
          metricsPatch: {
            last_draft_message_id: job.target_message_id,
            last_drafted_at: new Date().toISOString(),
          },
        });

        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("pipeline-worker-draft job error", {
          msg_id: record.msg_id,
          attempts: record.read_ct,
          error: message,
        });

        if (record.read_ct >= MAX_ATTEMPTS && job?.workspace_id) {
          await deadletterJob(supabase, {
            fromQueue: QUEUE_NAME,
            msgId: record.msg_id,
            attempts: record.read_ct,
            workspaceId: job.workspace_id,
            runId: job.run_id,
            jobPayload: (job || {}) as unknown as Record<string, unknown>,
            error: message,
            scope: "pipeline-worker-draft",
          });

          if (job.event_id) {
            await supabase
              .from("message_events")
              .update({ status: "failed", last_error: message, updated_at: new Date().toISOString() })
              .eq("id", job.event_id)
              .neq("status", "drafted");
          }
        } else {
          await auditJob(supabase, {
            workspaceId: job?.workspace_id,
            runId: job?.run_id,
            queueName: QUEUE_NAME,
            jobPayload: (job || {}) as unknown as Record<string, unknown>,
            outcome: "failed",
            error: message,
            attempts: record.read_ct,
          });

          if (job?.event_id) {
            await supabase
              .from("message_events")
              .update({ last_error: message, updated_at: new Date().toISOString() })
              .eq("id", job.event_id)
              .neq("status", "drafted");
          }
        }
      }
    }

    return jsonResponse({
      ok: true,
      queue: QUEUE_NAME,
      fetched_jobs: records.length,
      processed,
      elapsed_ms: Date.now() - startMs,
    });
  } catch (error) {
    console.error("pipeline-worker-draft fatal", error);
    if (error instanceof HttpError) {
      return jsonResponse({ ok: false, error: error.message }, error.status);
    }

    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected error",
      elapsed_ms: Date.now() - startMs,
    }, 500);
  }
});
