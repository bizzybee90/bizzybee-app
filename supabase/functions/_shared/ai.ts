import { extractJsonFromText, fetchWithTimeout, getOptionalEnv, getRequiredEnv } from "./pipeline.ts";
import type { ClassificationResult } from "./types.ts";

export interface ClassifyItemInput {
  item_id: string;
  conversation_id: string;
  target_message_id: string;
  channel: string;
  sender_identifier: string;
  subject: string;
  body: string;
  recent_messages: Array<{ direction: string; body: string }>;
}

export interface WorkspaceAiContext {
  business_context: Record<string, unknown> | null;
  faq_entries: Array<Record<string, unknown>>;
  corrections: Array<Record<string, unknown>>;
}

const DEFAULT_CLASSIFICATION: ClassificationResult = {
  category: "general",
  requires_reply: true,
  confidence: 0.55,
  entities: {},
};

const DEFAULT_MODEL = "claude-sonnet-4-6-20250514";

function normalizeClassification(value: unknown): ClassificationResult {
  const candidate = (value || {}) as Partial<ClassificationResult>;
  return {
    category: typeof candidate.category === "string" && candidate.category.trim()
      ? candidate.category.trim().toLowerCase()
      : DEFAULT_CLASSIFICATION.category,
    requires_reply: typeof candidate.requires_reply === "boolean"
      ? candidate.requires_reply
      : DEFAULT_CLASSIFICATION.requires_reply,
    confidence: typeof candidate.confidence === "number"
      ? Math.max(0, Math.min(1, candidate.confidence))
      : DEFAULT_CLASSIFICATION.confidence,
    entities: typeof candidate.entities === "object" && candidate.entities
      ? candidate.entities as Record<string, unknown>
      : {},
  };
}

function formatCorrections(corrections: Array<Record<string, unknown>>): string {
  if (!corrections || corrections.length === 0) {
    return "";
  }

  const lines = corrections.slice(0, 20).map((c) => {
    const sender = c.sender_email || c.from_identifier || "unknown sender";
    const subject = c.subject || c.email_subject || "unknown subject";
    const original = c.original_category || c.ai_category || "unknown";
    const corrected = c.corrected_category || c.human_category || "unknown";
    if (original === corrected) {
      return `- Email from "${sender}" about "${subject}" was correctly confirmed as "${corrected}"`;
    }
    return `- Email from "${sender}" about "${subject}" was incorrectly classified as "${original}" — correct category is "${corrected}"`;
  });

  return [
    "",
    "## Previous Corrections (learn from these)",
    ...lines,
  ].join("\n");
}

function classificationSystemPrompt(context: WorkspaceAiContext): string {
  const parts = [
    "You are a customer service triage engine for UK SMB support inboxes.",
    "Return strictly JSON with shape: {\"results\":[{\"item_id\":string,\"category\":string,\"requires_reply\":boolean,\"confidence\":number,\"entities\":object}]}",
    "Confidence must be in [0,1].",
    "Categories should be concise labels such as billing, complaint, booking, refund, order_update, spam, newsletter, notification, sales, general.",
    "Use the provided business context, FAQ snippets, and historical correction examples to improve consistency.",
    `Business context: ${JSON.stringify(context.business_context || {})}`,
    `FAQ snippets: ${JSON.stringify(context.faq_entries.slice(0, 30))}`,
  ];

  const correctionsSection = formatCorrections(context.corrections);
  if (correctionsSection) {
    parts.push(correctionsSection);
  }

  return parts.join("\n");
}

export async function classifyBatch(params: {
  items: ClassifyItemInput[];
  context: WorkspaceAiContext;
}): Promise<Map<string, ClassificationResult>> {
  if (params.items.length === 0) {
    return new Map();
  }

  const apiKey = getRequiredEnv("ANTHROPIC_API_KEY");
  const model = getOptionalEnv("ANTHROPIC_CLASSIFY_MODEL", DEFAULT_MODEL);
  const endpoint = getOptionalEnv("ANTHROPIC_API_URL", "https://api.anthropic.com/v1/messages");

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0,
      system: classificationSystemPrompt(params.context),
      messages: [
        {
          role: "user",
          content: JSON.stringify({ items: params.items }),
        },
      ],
    }),
  }, 30_000);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic classify request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const content = Array.isArray(data?.content) ? data.content : [];
  const contentText = content
    .map((part: { type?: string; text?: string }) => part?.type === "text" ? part.text || "" : "")
    .join("\n")
    .trim();

  const parsed = extractJsonFromText(contentText) as { results?: unknown[] } | null;
  const results = Array.isArray(parsed?.results) ? parsed.results : [];

  const mapped = new Map<string, ClassificationResult>();
  for (const item of params.items) {
    mapped.set(item.item_id, DEFAULT_CLASSIFICATION);
  }

  for (const row of results) {
    const typed = row as { item_id?: string };
    if (!typed.item_id || !mapped.has(typed.item_id)) {
      continue;
    }

    mapped.set(typed.item_id, normalizeClassification(row));
  }

  return mapped;
}

export async function generateDraftWithAnthropic(params: {
  conversationId: string;
  subject: string;
  latestInboundBody: string;
  recentMessages: Array<{ direction: string; body: string }>;
  businessContext: Record<string, unknown> | null;
  faqEntries: Array<Record<string, unknown>>;
}): Promise<string> {
  const apiKey = getRequiredEnv("ANTHROPIC_API_KEY");
  const model = getOptionalEnv("ANTHROPIC_MODEL", DEFAULT_MODEL);
  const endpoint = getOptionalEnv("ANTHROPIC_API_URL", "https://api.anthropic.com/v1/messages");

  const systemPrompt = [
    "You write concise, professional customer support replies for UK SMBs.",
    "Follow UK English spelling and tone.",
    "Do not invent policy details. If uncertain, ask a clear clarifying question.",
    "Use context and FAQ when relevant.",
  ].join("\n");

  const userPrompt = JSON.stringify({
    conversation_id: params.conversationId,
    subject: params.subject,
    latest_inbound: params.latestInboundBody,
    recent_messages: params.recentMessages,
    business_context: params.businessContext || {},
    faq_entries: params.faqEntries.slice(0, 40),
    output_instructions: {
      format: "plain text",
      max_paragraphs: 3,
      include_signoff: true,
    },
  });

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  }, 25_000);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic draft request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const content = Array.isArray(data?.content) ? data.content : [];
  const text = content
    .map((part: { type?: string; text?: string }) => part?.type === "text" ? part.text || "" : "")
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Anthropic draft response was empty");
  }

  return text;
}
