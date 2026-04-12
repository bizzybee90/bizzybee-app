# FAQ Managed Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the `faq_generation` managed Claude agent — BizzyBee triggers, Claude orchestrates via tool_use, eight custom tools, self-chaining for timeout resilience, full observability via agent tables, zero UI changes.

**Architecture:** Two new edge functions (`trigger-managed-agent`, `faq-agent-runner`). The trigger creates an `agent_run` and fire-and-forgets the runner. The runner calls the Claude Messages API in a tool_use loop, dispatching each tool call to a BizzyBee-owned handler that records steps/artifacts/events in the agent tables and mirrors progress to `n8n_workflow_progress` for UI compatibility.

**Tech Stack:** Supabase Edge Functions (Deno), Anthropic Messages API (REST via fetch), Apify Web Scraper API, existing `_shared/auth.ts` + `_shared/response.ts` helpers.

**Design doc:** `docs/plans/2026-04-12-faq-managed-agent-design.md`

---

## Task 1: Scaffold directory structure and register functions

**Files:**

- Create: `supabase/functions/trigger-managed-agent/index.ts` (placeholder)
- Create: `supabase/functions/faq-agent-runner/index.ts` (placeholder)
- Create: `supabase/functions/faq-agent-runner/tools/` (empty dir via gitkeep)
- Create: `supabase/functions/faq-agent-runner/lib/` (empty dir via gitkeep)
- Create: `supabase/functions/faq-agent-runner/prompts/` (empty dir via gitkeep)
- Modify: `supabase/config.toml`

**Step 1: Create placeholder edge functions**

```typescript
// supabase/functions/trigger-managed-agent/index.ts
import { corsResponse, jsonOk } from '../_shared/response.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();
  return jsonOk({ status: 'not_implemented' });
});
```

```typescript
// supabase/functions/faq-agent-runner/index.ts
import { corsResponse, jsonOk } from '../_shared/response.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();
  return jsonOk({ status: 'not_implemented' });
});
```

**Step 2: Register in config.toml**

Add to `supabase/config.toml` under the `# ── n8n ──` section or a new `# ── Managed Agents ──` section:

```toml
# ── Managed Agents ──────────────────────────────────────
[functions.trigger-managed-agent]
verify_jwt = false

[functions.faq-agent-runner]
verify_jwt = false
```

**Step 3: Create directory structure with gitkeep files**

```bash
mkdir -p supabase/functions/faq-agent-runner/tools
mkdir -p supabase/functions/faq-agent-runner/lib
mkdir -p supabase/functions/faq-agent-runner/prompts
touch supabase/functions/faq-agent-runner/tools/.gitkeep
touch supabase/functions/faq-agent-runner/lib/.gitkeep
touch supabase/functions/faq-agent-runner/prompts/.gitkeep
```

**Step 4: Commit**

```bash
git add supabase/functions/trigger-managed-agent/ supabase/functions/faq-agent-runner/ supabase/config.toml
git commit -m "feat(agents): scaffold managed agent edge functions"
```

---

## Task 2: Write the system prompt template

**Files:**

- Create: `supabase/functions/faq-agent-runner/prompts/faq-extraction.md`

**Step 1: Write the prompt file**

This is the system prompt Claude receives at runtime. Variables wrapped in `{{double_braces}}` are injected by the runner before sending to the API.

```markdown
You are the BizzyBee FAQ Agent. You run exactly once per workspace onboarding session. Your job is to produce a small, high-quality set of business-specific FAQs grounded entirely in content fetched from allowlisted URLs.

## Workspace context

- Business: {{workspace_name}}
- Industry: {{industry}}
- Service area: {{service_area}}
- Business type: {{business_type}}

## Startup — do this first, every time

Call get_run_context with run_id "{{run_id}}". If it fails or returns no allowlisted URLs, call mark_run_failed immediately with reason_code "missing_run_context" and stop.

## Execution rules

1. Only fetch URLs that appear in run_context.allowed_urls. Never fetch anything else.
2. Use fetch_source_page to retrieve each allowed URL. Call mirror_progress after completing all fetches.
3. Extract only facts explicitly stated in the fetched content: services, policies, pricing, hours, processes. Do not infer, extrapolate, or invent.
4. Call list_existing_faqs before generating candidates to avoid duplication.
5. For each candidate FAQ, you must have a source URL and a verbatim evidence quote from the fetched content that grounds it.
6. Call persist_candidate_faqs with the full candidate set and evidence before any final selection.
7. Apply quality gates: skip FAQs that are vague, duplicative, speculative, or not specific to this business.
8. Prefer 5-10 strong FAQs over 20 weak ones. Stop at 15 maximum.
9. Call persist_final_faqs with the approved set.
10. Call record_artifact with the final FAQ set as a structured payload.
11. Call mirror_progress at each major stage: context_loaded, fetch_complete, candidates_generated, quality_review_complete, finalized.

## Hard constraints

- Never write to the database directly. All persistence goes through your tools.
- Never fetch a URL not in run_context.allowed_urls.
- Never include a FAQ without a grounding evidence quote from fetched content.
- Never invent business facts, pricing, policies, services, or claims.
- If fetched content is empty or insufficient to produce at least 3 strong FAQs, call mark_run_failed with reason_code "insufficient_evidence" and stop. Do not produce weak output to fill a quota.

## Failure protocol

Call mark_run_failed with a machine-readable reason_code and a human-readable explanation whenever:

- Run context is missing or malformed (reason_code: missing_run_context)
- No allowed URLs are provided (reason_code: no_allowed_urls)
- All fetches fail or return empty content (reason_code: all_fetches_failed)
- Fewer than 3 strong FAQs can be grounded in evidence (reason_code: insufficient_evidence)
- Any required tool call fails after one retry (reason_code: tool_failure)
```

**Step 2: Commit**

```bash
git add supabase/functions/faq-agent-runner/prompts/faq-extraction.md
git commit -m "feat(agents): add FAQ extraction system prompt template"
```

---

## Task 3: Write the step recorder utility

Every tool call must be wrapped in an `agent_run_steps` record. This utility automates that.

**Files:**

- Create: `supabase/functions/faq-agent-runner/lib/step-recorder.ts`

**Step 1: Write the utility**

```typescript
// supabase/functions/faq-agent-runner/lib/step-recorder.ts
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface StepRecordInput {
  supabase: SupabaseClient;
  runId: string;
  workspaceId: string;
  stepKey: string;
  attempt?: number;
  provider?: string;
  model?: string;
  inputPayload?: Record<string, unknown>;
}

export interface StepRecord {
  id: string;
  runId: string;
  stepKey: string;
}

export async function beginStep(input: StepRecordInput): Promise<StepRecord> {
  const {
    supabase,
    runId,
    workspaceId,
    stepKey,
    attempt = 1,
    provider,
    model,
    inputPayload,
  } = input;

  const { data, error } = await supabase
    .from('agent_run_steps')
    .insert({
      run_id: runId,
      workspace_id: workspaceId,
      step_key: stepKey,
      attempt,
      status: 'running',
      provider: provider ?? null,
      model: model ?? null,
      input_payload: inputPayload ?? {},
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create step record: ${error.message}`);

  // Update current_step_key on the run
  await supabase
    .from('agent_runs')
    .update({
      current_step_key: stepKey,
      last_heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);

  return { id: data.id, runId, stepKey };
}

export async function succeedStep(
  supabase: SupabaseClient,
  stepId: string,
  outputPayload: Record<string, unknown>,
  metrics?: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from('agent_run_steps')
    .update({
      status: 'succeeded',
      output_payload: outputPayload,
      metrics: metrics ?? {},
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', stepId);
}

export async function failStep(
  supabase: SupabaseClient,
  stepId: string,
  errorMessage: string,
): Promise<void> {
  await supabase
    .from('agent_run_steps')
    .update({
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', stepId);
}
```

**Step 2: Commit**

```bash
git add supabase/functions/faq-agent-runner/lib/step-recorder.ts
git commit -m "feat(agents): add step recorder utility for agent run tracking"
```

---

## Task 4: Write the Claude API client wrapper

Calls the Anthropic Messages API via fetch (no SDK dependency). Handles the tool_use conversation loop.

**Files:**

- Create: `supabase/functions/faq-agent-runner/lib/claude-client.ts`

**Step 1: Write the client**

```typescript
// supabase/functions/faq-agent-runner/lib/claude-client.ts

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export type ContentBlock = ToolUseBlock | TextBlock;

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ClaudeResponse {
  id: string;
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: { input_tokens: number; output_tokens: number };
}

export async function callClaude(
  apiKey: string,
  systemPrompt: string,
  messages: Message[],
  tools: ToolDefinition[],
): Promise<ClaudeResponse> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
      tools,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errorText}`);
  }

  return (await response.json()) as ClaudeResponse;
}

export function extractToolUseBlocks(content: ContentBlock[]): ToolUseBlock[] {
  return content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
}

export function buildToolResultMessage(
  toolUseId: string,
  result: unknown,
  isError = false,
): Message {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result' as unknown as 'text',
        tool_use_id: toolUseId,
        content: JSON.stringify(result),
        is_error: isError,
      } as unknown as TextBlock,
    ],
  };
}
```

Note: The type casting in `buildToolResultMessage` is needed because the Anthropic API accepts `tool_result` content blocks in user messages, but we're using a minimal type system. The runtime JSON is correct.

**Step 2: Commit**

```bash
git add supabase/functions/faq-agent-runner/lib/claude-client.ts
git commit -m "feat(agents): add Claude Messages API client wrapper"
```

---

## Task 5: Write the self-chain utility

Detects when the runner is approaching its timeout budget and saves state for continuation.

**Files:**

- Create: `supabase/functions/faq-agent-runner/lib/self-chain.ts`

**Step 1: Write the utility**

```typescript
// supabase/functions/faq-agent-runner/lib/self-chain.ts
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Message } from './claude-client.ts';

const TIMEOUT_BUDGET_MS = 120_000; // 120s of a ~150s limit

export function createDeadlineTracker() {
  const startedAt = Date.now();
  return {
    isApproachingTimeout: () => Date.now() - startedAt > TIMEOUT_BUDGET_MS,
    elapsedMs: () => Date.now() - startedAt,
  };
}

export interface ContinuationState {
  messages: Message[];
  toolCallCount: number;
  chainDepth: number;
}

export async function saveContinuationState(
  supabase: SupabaseClient,
  runId: string,
  state: ContinuationState,
): Promise<void> {
  await supabase
    .from('agent_runs')
    .update({
      status: 'waiting',
      output_summary: { continuation: state },
      last_heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);
}

export async function loadContinuationState(
  supabase: SupabaseClient,
  runId: string,
): Promise<ContinuationState | null> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('output_summary')
    .eq('id', runId)
    .single();

  if (error || !data?.output_summary) return null;

  const summary = data.output_summary as Record<string, unknown>;
  if (!summary.continuation) return null;

  return summary.continuation as ContinuationState;
}

export async function fireAndForgetContinuation(
  supabaseUrl: string,
  serviceRoleKey: string,
  runId: string,
): Promise<void> {
  fetch(`${supabaseUrl}/functions/v1/faq-agent-runner`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ run_id: runId }),
  }).catch((err) => console.error('[self-chain] Failed to invoke continuation:', err));
}
```

**Step 2: Commit**

```bash
git add supabase/functions/faq-agent-runner/lib/self-chain.ts
git commit -m "feat(agents): add self-chain timeout and continuation utilities"
```

---

## Task 6: Write tool handler — get-run-context

**Files:**

- Create: `supabase/functions/faq-agent-runner/tools/get-run-context.ts`

**Step 1: Write the handler**

```typescript
// supabase/functions/faq-agent-runner/tools/get-run-context.ts
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface RunContext {
  run_id: string;
  workspace_id: string;
  workspace_name: string;
  industry: string | null;
  service_area: string | null;
  business_type: string | null;
  allowed_urls: string[];
}

export async function handleGetRunContext(
  supabase: SupabaseClient,
  input: { run_id: string },
): Promise<RunContext> {
  // Load the agent run
  const { data: run, error: runErr } = await supabase
    .from('agent_runs')
    .select('id, workspace_id, input_snapshot, status')
    .eq('id', input.run_id)
    .single();

  if (runErr || !run) {
    throw new Error(`Agent run not found: ${input.run_id}`);
  }

  const workspaceId = run.workspace_id;

  // Load workspace name
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .single();

  // Load business context
  const { data: bizCtx } = await supabase
    .from('business_context')
    .select('company_name, industry, service_area, business_type')
    .eq('workspace_id', workspaceId)
    .single();

  // Load selected competitor URLs
  const { data: competitors } = await supabase
    .from('competitor_sites')
    .select('url, domain, title')
    .eq('workspace_id', workspaceId)
    .eq('is_selected', true)
    .neq('status', 'rejected');

  const allowedUrls = (competitors ?? []).map((c) => c.url).filter((u): u is string => !!u);

  // Mark run as running
  await supabase
    .from('agent_runs')
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.run_id);

  return {
    run_id: input.run_id,
    workspace_id: workspaceId,
    workspace_name: workspace?.name ?? 'Unknown',
    industry: bizCtx?.industry ?? null,
    service_area: bizCtx?.service_area ?? null,
    business_type: bizCtx?.business_type ?? null,
    allowed_urls: allowedUrls,
  };
}
```

**Step 2: Commit**

```bash
git add supabase/functions/faq-agent-runner/tools/get-run-context.ts
git commit -m "feat(agents): add get-run-context tool handler"
```

---

## Task 7: Write tool handler — fetch-source-page

**Files:**

- Create: `supabase/functions/faq-agent-runner/tools/fetch-source-page.ts`

**Step 1: Write the handler**

Uses Apify's Web Scraper actor via the REST API. Stores content as a `source_page` artifact.

```typescript
// supabase/functions/faq-agent-runner/tools/fetch-source-page.ts
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const APIFY_RUN_URL =
  'https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items';
const APIFY_TIMEOUT_SECS = 60;
const MAX_CONTENT_LENGTH = 30_000; // chars, to stay within Claude context budget

export interface FetchResult {
  url: string;
  title: string | null;
  content: string;
  content_length: number;
  truncated: boolean;
}

export async function handleFetchSourcePage(
  supabase: SupabaseClient,
  input: { url: string; run_id: string },
  workspaceId: string,
  allowedUrls: string[],
): Promise<FetchResult> {
  // Validate URL is allowlisted
  if (!allowedUrls.includes(input.url)) {
    throw new Error(`URL not in allowed list: ${input.url}`);
  }

  const apifyKey = Deno.env.get('APIFY_API_KEY');
  if (!apifyKey) throw new Error('APIFY_API_KEY not configured');

  const response = await fetch(`${APIFY_RUN_URL}?token=${apifyKey}&timeout=${APIFY_TIMEOUT_SECS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startUrls: [{ url: input.url }],
      maxCrawlPages: 1,
      crawlerType: 'cheerio',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Apify request failed (${response.status}): ${errText}`);
  }

  const items = (await response.json()) as Array<{
    url: string;
    title?: string;
    text?: string;
    markdown?: string;
  }>;

  const page = items?.[0];
  if (!page) {
    throw new Error(`Apify returned no content for ${input.url}`);
  }

  let content = page.markdown || page.text || '';
  const truncated = content.length > MAX_CONTENT_LENGTH;
  if (truncated) content = content.slice(0, MAX_CONTENT_LENGTH);

  // Store as source_page artifact
  await supabase.from('agent_run_artifacts').insert({
    run_id: input.run_id,
    workspace_id: workspaceId,
    artifact_type: 'source_page',
    artifact_key: input.url,
    source_url: input.url,
    content: {
      title: page.title ?? null,
      text_length: content.length,
      truncated,
    },
    // Don't store full page content in artifacts — too large.
    // The content is in Claude's conversation context.
  });

  return {
    url: input.url,
    title: page.title ?? null,
    content,
    content_length: content.length,
    truncated,
  };
}
```

**Step 2: Commit**

```bash
git add supabase/functions/faq-agent-runner/tools/fetch-source-page.ts
git commit -m "feat(agents): add fetch-source-page tool handler with Apify"
```

---

## Task 8: Write tool handler — mirror-progress

**Files:**

- Create: `supabase/functions/faq-agent-runner/tools/mirror-progress.ts`

**Step 1: Write the handler**

Maps agent stages to `n8n_workflow_progress` statuses so the existing UI keeps working.

```typescript
// supabase/functions/faq-agent-runner/tools/mirror-progress.ts
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type ProgressStage =
  | 'context_loaded'
  | 'fetch_complete'
  | 'candidates_generated'
  | 'quality_review_complete'
  | 'finalized';

const STAGE_TO_N8N: Record<ProgressStage, { status: string; details: Record<string, unknown> }> = {
  context_loaded: { status: 'in_progress', details: { phase: 'loading' } },
  fetch_complete: { status: 'in_progress', details: { phase: 'extracting' } },
  candidates_generated: { status: 'in_progress', details: { phase: 'consolidating' } },
  quality_review_complete: { status: 'in_progress', details: { phase: 'reviewing' } },
  finalized: { status: 'complete', details: {} },
};

export async function handleMirrorProgress(
  supabase: SupabaseClient,
  input: {
    run_id: string;
    stage: ProgressStage;
    summary: string;
    metadata?: Record<string, unknown>;
  },
  workspaceId: string,
): Promise<{ mirrored: boolean }> {
  const mapping = STAGE_TO_N8N[input.stage];
  if (!mapping) throw new Error(`Unknown progress stage: ${input.stage}`);

  const details = {
    ...mapping.details,
    ...(input.metadata ?? {}),
    agent_summary: input.summary,
  };

  // Mirror to n8n_workflow_progress for UI compatibility
  const now = new Date().toISOString();
  await supabase.from('n8n_workflow_progress').upsert(
    {
      workspace_id: workspaceId,
      workflow_type: 'faq_generation',
      status: mapping.status,
      details,
      started_at: input.stage === 'context_loaded' ? now : undefined,
      completed_at: input.stage === 'finalized' ? now : undefined,
      updated_at: now,
    },
    { onConflict: 'workspace_id,workflow_type' },
  );

  // Also write to agent_run_events
  await supabase.from('agent_run_events').insert({
    run_id: input.run_id,
    workspace_id: workspaceId,
    level: 'info',
    event_type: `progress:${input.stage}`,
    message: input.summary,
    payload: input.metadata ?? {},
  });

  return { mirrored: true };
}
```

**Step 2: Commit**

```bash
git add supabase/functions/faq-agent-runner/tools/mirror-progress.ts
git commit -m "feat(agents): add mirror-progress tool with n8n_workflow_progress compat"
```

---

## Task 9: Write tool handler — list-existing-faqs

**Files:**

- Create: `supabase/functions/faq-agent-runner/tools/list-existing-faqs.ts`

**Step 1: Write the handler**

```typescript
// supabase/functions/faq-agent-runner/tools/list-existing-faqs.ts
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface ExistingFaq {
  id: string;
  question: string;
  answer: string;
  category: string;
  source_url: string | null;
}

export async function handleListExistingFaqs(
  supabase: SupabaseClient,
  input: { workspace_id: string },
): Promise<{ faqs: ExistingFaq[]; count: number }> {
  const { data, error } = await supabase
    .from('faq_database')
    .select('id, question, answer, category, source_url')
    .eq('workspace_id', input.workspace_id)
    .eq('is_active', true)
    .eq('enabled', true)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw new Error(`Failed to load existing FAQs: ${error.message}`);

  const faqs = (data ?? []).map((row) => ({
    id: row.id,
    question: row.question,
    answer: row.answer,
    category: row.category,
    source_url: row.source_url,
  }));

  return { faqs, count: faqs.length };
}
```

**Step 2: Commit**

```bash
git add supabase/functions/faq-agent-runner/tools/list-existing-faqs.ts
git commit -m "feat(agents): add list-existing-faqs tool handler"
```

---

## Task 10: Write tool handler — persist-candidate-faqs

**Files:**

- Create: `supabase/functions/faq-agent-runner/tools/persist-candidate-faqs.ts`

**Step 1: Write the handler**

Saves all candidates as `faq_candidate` artifacts — the pre-review checkpoint.

```typescript
// supabase/functions/faq-agent-runner/tools/persist-candidate-faqs.ts
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface CandidateFaq {
  question: string;
  answer: string;
  source_url: string;
  evidence_quote: string;
}

export async function handlePersistCandidateFaqs(
  supabase: SupabaseClient,
  input: {
    run_id: string;
    workspace_id: string;
    candidates: CandidateFaq[];
  },
): Promise<{ persisted_count: number }> {
  const artifacts = input.candidates.map((c, idx) => ({
    run_id: input.run_id,
    workspace_id: input.workspace_id,
    artifact_type: 'faq_candidate',
    artifact_key: `candidate_${idx}`,
    source_url: c.source_url,
    content: {
      question: c.question,
      answer: c.answer,
      evidence_quote: c.evidence_quote,
    },
  }));

  const { error } = await supabase.from('agent_run_artifacts').insert(artifacts);
  if (error) throw new Error(`Failed to persist candidate FAQs: ${error.message}`);

  return { persisted_count: artifacts.length };
}
```

**Step 2: Commit**

```bash
git add supabase/functions/faq-agent-runner/tools/persist-candidate-faqs.ts
git commit -m "feat(agents): add persist-candidate-faqs tool handler"
```

---

## Task 11: Write tool handler — persist-final-faqs

**Files:**

- Create: `supabase/functions/faq-agent-runner/tools/persist-final-faqs.ts`

**Step 1: Write the handler**

Writes approved FAQs to `faq_database` and links them back to the run via `persisted_row_link` artifacts.

```typescript
// supabase/functions/faq-agent-runner/tools/persist-final-faqs.ts
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface FinalFaq {
  question: string;
  answer: string;
  source_url: string;
  evidence_quote: string;
}

export async function handlePersistFinalFaqs(
  supabase: SupabaseClient,
  input: {
    run_id: string;
    workspace_id: string;
    faqs: FinalFaq[];
    faq_count: number;
  },
): Promise<{ persisted_count: number; row_ids: string[] }> {
  const rowIds: string[] = [];

  for (const faq of input.faqs) {
    const { data, error } = await supabase
      .from('faq_database')
      .insert({
        workspace_id: input.workspace_id,
        category: 'General',
        question: faq.question,
        answer: faq.answer,
        keywords: [],
        is_active: true,
        enabled: true,
        is_own_content: false,
        generation_source: 'managed_agent',
        source_url: faq.source_url,
      })
      .select('id')
      .single();

    if (error) {
      console.error(`[persist-final-faqs] Failed to insert FAQ: ${error.message}`);
      continue;
    }

    if (data?.id) {
      rowIds.push(data.id);

      // Link to run via persisted_row_link artifact
      await supabase.from('agent_run_artifacts').insert({
        run_id: input.run_id,
        workspace_id: input.workspace_id,
        artifact_type: 'persisted_row_link',
        artifact_key: `faq_${data.id}`,
        target_table: 'faq_database',
        target_row_id: data.id,
        source_url: faq.source_url,
        content: {
          question: faq.question,
          evidence_quote: faq.evidence_quote,
        },
      });
    }
  }

  return { persisted_count: rowIds.length, row_ids: rowIds };
}
```

**Step 2: Commit**

```bash
git add supabase/functions/faq-agent-runner/tools/persist-final-faqs.ts
git commit -m "feat(agents): add persist-final-faqs tool handler with domain table writes"
```

---

## Task 12: Write tool handler — record-artifact

**Files:**

- Create: `supabase/functions/faq-agent-runner/tools/record-artifact.ts`

**Step 1: Write the handler**

```typescript
// supabase/functions/faq-agent-runner/tools/record-artifact.ts
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function handleRecordArtifact(
  supabase: SupabaseClient,
  input: {
    run_id: string;
    artifact_type: string;
    label: string;
    payload: Record<string, unknown>;
  },
  workspaceId: string,
): Promise<{ artifact_id: string }> {
  const { data, error } = await supabase
    .from('agent_run_artifacts')
    .insert({
      run_id: input.run_id,
      workspace_id: workspaceId,
      artifact_type: input.artifact_type,
      artifact_key: input.label,
      content: input.payload,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to record artifact: ${error.message}`);
  return { artifact_id: data.id };
}
```

**Step 2: Commit**

```bash
git add supabase/functions/faq-agent-runner/tools/record-artifact.ts
git commit -m "feat(agents): add record-artifact tool handler"
```

---

## Task 13: Write tool handler — mark-run-failed

**Files:**

- Create: `supabase/functions/faq-agent-runner/tools/mark-run-failed.ts`

**Step 1: Write the handler**

```typescript
// supabase/functions/faq-agent-runner/tools/mark-run-failed.ts
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function handleMarkRunFailed(
  supabase: SupabaseClient,
  input: {
    run_id: string;
    reason_code: string;
    explanation: string;
  },
  workspaceId: string,
): Promise<{ marked: boolean }> {
  const now = new Date().toISOString();

  // Update agent_runs
  await supabase
    .from('agent_runs')
    .update({
      status: 'failed',
      error_summary: {
        reason_code: input.reason_code,
        explanation: input.explanation,
      },
      completed_at: now,
      updated_at: now,
    })
    .eq('id', input.run_id);

  // Write failure event
  await supabase.from('agent_run_events').insert({
    run_id: input.run_id,
    workspace_id: workspaceId,
    level: 'error',
    event_type: 'run_failed',
    message: input.explanation,
    payload: { reason_code: input.reason_code },
  });

  // Mirror failure to n8n_workflow_progress
  await supabase.from('n8n_workflow_progress').upsert(
    {
      workspace_id: workspaceId,
      workflow_type: 'faq_generation',
      status: 'failed',
      details: {
        error: input.reason_code,
        message: input.explanation,
      },
      completed_at: now,
      updated_at: now,
    },
    { onConflict: 'workspace_id,workflow_type' },
  );

  return { marked: true };
}
```

**Step 2: Commit**

```bash
git add supabase/functions/faq-agent-runner/tools/mark-run-failed.ts
git commit -m "feat(agents): add mark-run-failed tool handler"
```

---

## Task 14: Write tool definitions for Claude API

The Claude API needs tool definitions in a specific JSON Schema format. Centralise them in one file.

**Files:**

- Create: `supabase/functions/faq-agent-runner/lib/tool-definitions.ts`

**Step 1: Write the definitions**

```typescript
// supabase/functions/faq-agent-runner/lib/tool-definitions.ts
import type { ToolDefinition } from './claude-client.ts';

export const FAQ_AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'get_run_context',
    description:
      'Returns the full run context: run_id, workspace_id, workspace_name, allowed_urls (the only URLs the agent may fetch), and workspace metadata.',
    input_schema: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'The agent run ID.' },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'fetch_source_page',
    description:
      'Fetches and extracts clean text content from a single allowlisted source URL. Only call for URLs in run_context.allowed_urls.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch. Must be in allowed_urls.' },
        run_id: { type: 'string', description: 'The current agent run ID.' },
      },
      required: ['url', 'run_id'],
    },
  },
  {
    name: 'mirror_progress',
    description:
      'Records a progress checkpoint. Call at each major stage: context_loaded, fetch_complete, candidates_generated, quality_review_complete, finalized.',
    input_schema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        stage: {
          type: 'string',
          enum: [
            'context_loaded',
            'fetch_complete',
            'candidates_generated',
            'quality_review_complete',
            'finalized',
          ],
        },
        summary: { type: 'string', description: 'Human-readable summary of this stage.' },
        metadata: { type: 'object', description: 'Optional structured metadata.' },
      },
      required: ['run_id', 'stage', 'summary'],
    },
  },
  {
    name: 'list_existing_faqs',
    description: 'Returns current FAQs for this workspace to avoid generating duplicates.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
      },
      required: ['workspace_id'],
    },
  },
  {
    name: 'persist_candidate_faqs',
    description:
      'Saves the full candidate FAQ set with evidence before quality filtering. All candidates go here regardless of final selection.',
    input_schema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        workspace_id: { type: 'string' },
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              answer: { type: 'string' },
              source_url: { type: 'string' },
              evidence_quote: {
                type: 'string',
                description: 'Verbatim excerpt grounding this FAQ.',
              },
            },
            required: ['question', 'answer', 'source_url', 'evidence_quote'],
          },
        },
      },
      required: ['run_id', 'workspace_id', 'candidates'],
    },
  },
  {
    name: 'persist_final_faqs',
    description:
      'Saves the final approved FAQ set after quality review. Only call after persist_candidate_faqs.',
    input_schema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        workspace_id: { type: 'string' },
        faqs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              answer: { type: 'string' },
              source_url: { type: 'string' },
              evidence_quote: { type: 'string' },
            },
            required: ['question', 'answer', 'source_url', 'evidence_quote'],
          },
        },
        faq_count: { type: 'integer' },
      },
      required: ['run_id', 'workspace_id', 'faqs', 'faq_count'],
    },
  },
  {
    name: 'record_artifact',
    description: 'Records a named artifact for this run (e.g. the final FAQ set, a fetch summary).',
    input_schema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        artifact_type: {
          type: 'string',
          enum: ['final_faqs', 'candidate_faqs', 'fetch_summary', 'error_report'],
        },
        label: { type: 'string' },
        payload: { type: 'object', description: 'The artifact content as structured JSON.' },
      },
      required: ['run_id', 'artifact_type', 'label', 'payload'],
    },
  },
  {
    name: 'mark_run_failed',
    description:
      'Marks this run as failed. Call instead of producing weak output when quality requirements cannot be met.',
    input_schema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        reason_code: {
          type: 'string',
          enum: [
            'missing_run_context',
            'no_allowed_urls',
            'all_fetches_failed',
            'insufficient_evidence',
            'tool_failure',
            'quality_threshold_not_met',
          ],
        },
        explanation: { type: 'string', description: 'Human-readable failure explanation.' },
      },
      required: ['run_id', 'reason_code', 'explanation'],
    },
  },
];
```

**Step 2: Commit**

```bash
git add supabase/functions/faq-agent-runner/lib/tool-definitions.ts
git commit -m "feat(agents): add Claude tool definitions for FAQ agent"
```

---

## Task 15: Write the main runner — faq-agent-runner/index.ts

This is the core edge function: loads the run, calls Claude in a tool_use loop, dispatches tools, records steps, and self-chains on timeout.

**Files:**

- Modify: `supabase/functions/faq-agent-runner/index.ts`

**Step 1: Write the full runner**

```typescript
// supabase/functions/faq-agent-runner/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse, jsonOk, jsonError } from '../_shared/response.ts';
import {
  callClaude,
  extractToolUseBlocks,
  buildToolResultMessage,
  type Message,
  type ContentBlock,
} from './lib/claude-client.ts';
import { FAQ_AGENT_TOOLS } from './lib/tool-definitions.ts';
import {
  createDeadlineTracker,
  loadContinuationState,
  saveContinuationState,
  fireAndForgetContinuation,
} from './lib/self-chain.ts';
import { beginStep, succeedStep, failStep } from './lib/step-recorder.ts';
import { handleGetRunContext, type RunContext } from './tools/get-run-context.ts';
import { handleFetchSourcePage } from './tools/fetch-source-page.ts';
import { handleMirrorProgress } from './tools/mirror-progress.ts';
import { handleListExistingFaqs } from './tools/list-existing-faqs.ts';
import { handlePersistCandidateFaqs } from './tools/persist-candidate-faqs.ts';
import { handlePersistFinalFaqs } from './tools/persist-final-faqs.ts';
import { handleRecordArtifact } from './tools/record-artifact.ts';
import { handleMarkRunFailed } from './tools/mark-run-failed.ts';

const FUNCTION_NAME = 'faq-agent-runner';
const MAX_TOOL_ROUNDS = 40; // safety cap

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const { run_id } = await req.json();
    if (!run_id) return jsonError('run_id is required', 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return jsonError('ANTHROPIC_API_KEY not configured', 500);

    const supabase = createClient(supabaseUrl, serviceKey);
    const deadline = createDeadlineTracker();

    // Load run to get workspace_id
    const { data: run, error: runErr } = await supabase
      .from('agent_runs')
      .select('id, workspace_id, workflow_key, input_snapshot')
      .eq('id', run_id)
      .single();

    if (runErr || !run) return jsonError(`Run not found: ${run_id}`, 404);
    const workspaceId = run.workspace_id;

    // Check for continuation state
    const continuation = await loadContinuationState(supabase, run_id);

    // Build system prompt from template
    const promptTemplate = await Deno.readTextFile(
      new URL('./prompts/faq-extraction.md', import.meta.url),
    );

    // Inject workspace variables (from input_snapshot or defaults)
    const snapshot = (run.input_snapshot ?? {}) as Record<string, unknown>;
    const systemPrompt = promptTemplate
      .replace('{{run_id}}', run_id)
      .replace('{{workspace_name}}', (snapshot.workspace_name as string) ?? 'Unknown')
      .replace('{{industry}}', (snapshot.industry as string) ?? 'General')
      .replace('{{service_area}}', (snapshot.service_area as string) ?? 'Not specified')
      .replace('{{business_type}}', (snapshot.business_type as string) ?? 'Service business');

    // Initialise messages
    let messages: Message[];
    let toolCallCount: number;
    let chainDepth: number;

    if (continuation) {
      messages = continuation.messages;
      toolCallCount = continuation.toolCallCount;
      chainDepth = continuation.chainDepth + 1;
      console.log(`[${FUNCTION_NAME}] Resuming run ${run_id} (chain depth: ${chainDepth})`);
    } else {
      messages = [
        {
          role: 'user',
          content: `Begin FAQ generation for run_id "${run_id}". Start by calling get_run_context.`,
        },
      ];
      toolCallCount = 0;
      chainDepth = 0;
      console.log(`[${FUNCTION_NAME}] Starting fresh run ${run_id}`);
    }

    // Track allowed URLs (populated after get_run_context)
    let runContext: RunContext | null = (snapshot.run_context as RunContext) ?? null;

    // Main tool_use loop
    let runFinished = false;

    while (!runFinished && toolCallCount < MAX_TOOL_ROUNDS) {
      // Check timeout budget before making API call
      if (deadline.isApproachingTimeout()) {
        console.log(
          `[${FUNCTION_NAME}] Approaching timeout after ${deadline.elapsedMs()}ms, self-chaining`,
        );
        await saveContinuationState(supabase, run_id, { messages, toolCallCount, chainDepth });
        await fireAndForgetContinuation(supabaseUrl, serviceKey, run_id);
        return jsonOk({
          status: 'self_chained',
          tool_calls: toolCallCount,
          chain_depth: chainDepth,
        });
      }

      // Call Claude
      const response = await callClaude(anthropicKey, systemPrompt, messages, FAQ_AGENT_TOOLS);

      // Append assistant response to messages
      messages.push({ role: 'assistant', content: response.content });

      // Check stop reason
      if (response.stop_reason === 'end_turn') {
        runFinished = true;
        break;
      }

      if (response.stop_reason !== 'tool_use') {
        console.warn(`[${FUNCTION_NAME}] Unexpected stop_reason: ${response.stop_reason}`);
        runFinished = true;
        break;
      }

      // Process tool calls
      const toolCalls = extractToolUseBlocks(response.content);
      const toolResults: Message[] = [];

      for (const toolCall of toolCalls) {
        toolCallCount++;
        const input = toolCall.input as Record<string, unknown>;

        // Record step
        const step = await beginStep({
          supabase,
          runId: run_id,
          workspaceId,
          stepKey: toolCall.name,
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          inputPayload: input,
        });

        try {
          let result: unknown;

          switch (toolCall.name) {
            case 'get_run_context':
              result = await handleGetRunContext(supabase, input as { run_id: string });
              runContext = result as RunContext;
              // Save context for continuation
              await supabase
                .from('agent_runs')
                .update({
                  input_snapshot: { ...snapshot, run_context: runContext },
                  updated_at: new Date().toISOString(),
                })
                .eq('id', run_id);
              break;

            case 'fetch_source_page':
              result = await handleFetchSourcePage(
                supabase,
                input as { url: string; run_id: string },
                workspaceId,
                runContext?.allowed_urls ?? [],
              );
              break;

            case 'mirror_progress':
              result = await handleMirrorProgress(
                supabase,
                input as {
                  run_id: string;
                  stage: string;
                  summary: string;
                  metadata?: Record<string, unknown>;
                },
                workspaceId,
              );
              break;

            case 'list_existing_faqs':
              result = await handleListExistingFaqs(supabase, input as { workspace_id: string });
              break;

            case 'persist_candidate_faqs':
              result = await handlePersistCandidateFaqs(
                supabase,
                input as {
                  run_id: string;
                  workspace_id: string;
                  candidates: Array<{
                    question: string;
                    answer: string;
                    source_url: string;
                    evidence_quote: string;
                  }>;
                },
              );
              break;

            case 'persist_final_faqs':
              result = await handlePersistFinalFaqs(
                supabase,
                input as {
                  run_id: string;
                  workspace_id: string;
                  faqs: Array<{
                    question: string;
                    answer: string;
                    source_url: string;
                    evidence_quote: string;
                  }>;
                  faq_count: number;
                },
              );
              break;

            case 'record_artifact':
              result = await handleRecordArtifact(
                supabase,
                input as {
                  run_id: string;
                  artifact_type: string;
                  label: string;
                  payload: Record<string, unknown>;
                },
                workspaceId,
              );
              break;

            case 'mark_run_failed':
              result = await handleMarkRunFailed(
                supabase,
                input as { run_id: string; reason_code: string; explanation: string },
                workspaceId,
              );
              runFinished = true;
              break;

            default:
              result = { error: `Unknown tool: ${toolCall.name}` };
          }

          await succeedStep(supabase, step.id, result as Record<string, unknown>);
          toolResults.push(buildToolResultMessage(toolCall.id, result));
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[${FUNCTION_NAME}] Tool ${toolCall.name} failed:`, errorMsg);
          await failStep(supabase, step.id, errorMsg);
          toolResults.push(buildToolResultMessage(toolCall.id, { error: errorMsg }, true));
        }
      }

      // Append all tool results to messages
      for (const result of toolResults) {
        messages.push(result);
      }
    }

    // If run finished normally (not via mark_run_failed), mark succeeded
    if (runFinished) {
      const { data: finalRun } = await supabase
        .from('agent_runs')
        .select('status')
        .eq('id', run_id)
        .single();

      if (finalRun?.status === 'running') {
        await supabase
          .from('agent_runs')
          .update({
            status: 'succeeded',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', run_id);
      }
    }

    if (toolCallCount >= MAX_TOOL_ROUNDS) {
      console.warn(`[${FUNCTION_NAME}] Hit max tool rounds (${MAX_TOOL_ROUNDS})`);
      await handleMarkRunFailed(
        supabase,
        { run_id, reason_code: 'tool_failure', explanation: 'Max tool rounds exceeded' },
        workspaceId,
      );
    }

    return jsonOk({
      status: 'completed',
      run_id,
      tool_calls: toolCallCount,
      chain_depth: chainDepth,
    });
  } catch (err) {
    console.error(`[${FUNCTION_NAME}] Fatal error:`, err);
    return jsonError(err instanceof Error ? err.message : 'Internal error', 500);
  }
});
```

**Step 2: Remove placeholder gitkeep files**

```bash
rm -f supabase/functions/faq-agent-runner/tools/.gitkeep
rm -f supabase/functions/faq-agent-runner/lib/.gitkeep
rm -f supabase/functions/faq-agent-runner/prompts/.gitkeep
```

**Step 3: Commit**

```bash
git add supabase/functions/faq-agent-runner/
git commit -m "feat(agents): implement faq-agent-runner with Claude tool_use loop"
```

---

## Task 16: Write the trigger — trigger-managed-agent/index.ts

**Files:**

- Modify: `supabase/functions/trigger-managed-agent/index.ts`

**Step 1: Write the full trigger**

```typescript
// supabase/functions/trigger-managed-agent/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';
import { corsResponse, jsonOk, jsonError } from '../_shared/response.ts';

const FUNCTION_NAME = 'trigger-managed-agent';
const SUPPORTED_WORKFLOWS = ['faq_generation'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const body = await req.json();
    const { workspace_id, workflow_key } = body;

    if (!workspace_id) return jsonError('workspace_id is required', 400);
    if (!workflow_key) return jsonError('workflow_key is required', 400);
    if (!SUPPORTED_WORKFLOWS.includes(workflow_key)) {
      return jsonError(`Unsupported workflow: ${workflow_key}`, 400);
    }

    // Auth
    let auth;
    try {
      auth = await validateAuth(req, workspace_id);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err);
      throw err;
    }

    // Rollout gating
    const allowedWorkspaces = (Deno.env.get('MANAGED_AGENT_WORKSPACE_IDS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (allowedWorkspaces.length > 0 && !allowedWorkspaces.includes(workspace_id)) {
      return jsonError('Workspace not enabled for managed agents', 403);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Load workspace context for input_snapshot
    const { data: bizCtx } = await supabase
      .from('business_context')
      .select('company_name, industry, service_area, business_type')
      .eq('workspace_id', workspace_id)
      .single();

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('name')
      .eq('id', workspace_id)
      .single();

    // Load allowed URLs
    const { data: competitors } = await supabase
      .from('competitor_sites')
      .select('url')
      .eq('workspace_id', workspace_id)
      .eq('is_selected', true)
      .neq('status', 'rejected');

    const allowedUrls = (competitors ?? []).map((c) => c.url).filter(Boolean);

    if (allowedUrls.length === 0) {
      return jsonError('No selected competitor sites found for this workspace', 400);
    }

    // Create agent_run
    const { data: agentRun, error: runErr } = await supabase
      .from('agent_runs')
      .insert({
        workspace_id,
        workflow_key,
        status: 'queued',
        rollout_mode: 'soft',
        trigger_source: FUNCTION_NAME,
        legacy_progress_workflow_type: 'faq_generation',
        initiated_by: auth.userId,
        input_snapshot: {
          workspace_name: workspace?.name ?? bizCtx?.company_name ?? 'Unknown',
          industry: bizCtx?.industry ?? null,
          service_area: bizCtx?.service_area ?? null,
          business_type: bizCtx?.business_type ?? null,
          allowed_urls: allowedUrls,
          competitor_count: allowedUrls.length,
        },
      })
      .select('id')
      .single();

    if (runErr || !agentRun) {
      return jsonError(`Failed to create agent run: ${runErr?.message}`, 500);
    }

    // Mirror initial progress to n8n_workflow_progress
    const now = new Date().toISOString();
    await supabase.from('n8n_workflow_progress').upsert(
      {
        workspace_id,
        workflow_type: 'faq_generation',
        status: 'pending',
        details: {
          agent_run_id: agentRun.id,
          message: 'Managed agent run queued',
        },
        started_at: now,
        updated_at: now,
      },
      { onConflict: 'workspace_id,workflow_type' },
    );

    // Write queued event
    await supabase.from('agent_run_events').insert({
      run_id: agentRun.id,
      workspace_id,
      level: 'info',
      event_type: 'run_queued',
      message: `FAQ generation agent queued for workspace ${workspace_id}`,
      payload: { competitor_count: allowedUrls.length },
    });

    // Fire-and-forget the runner
    console.log(`[${FUNCTION_NAME}] Firing faq-agent-runner for run ${agentRun.id}`);
    fetch(`${supabaseUrl}/functions/v1/faq-agent-runner`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ run_id: agentRun.id }),
    }).catch((err) => console.error(`[${FUNCTION_NAME}] Failed to invoke runner:`, err));

    return jsonOk({
      success: true,
      run_id: agentRun.id,
      workflow_key,
      workspace_id,
    });
  } catch (err) {
    console.error(`[${FUNCTION_NAME}] Error:`, err);
    return jsonError(err instanceof Error ? err.message : 'Internal error', 500);
  }
});
```

**Step 2: Commit**

```bash
git add supabase/functions/trigger-managed-agent/index.ts
git commit -m "feat(agents): implement trigger-managed-agent with rollout gating"
```

---

## Task 17: Update agent contracts with trigger metadata

**Files:**

- Modify: `src/lib/agents/contracts.ts`

**Step 1: Add trigger function name and supported workflow validation**

Add after the existing `managedWorkflowDefinitions` export:

```typescript
/** Edge function name for managed agent triggering */
export const MANAGED_AGENT_TRIGGER_FUNCTION = 'trigger-managed-agent';

/** Validate a workflow key is managed (not deferred) */
export function isManagedWorkflow(key: string): key is ManagedWorkflowKey {
  return managedWorkflowKeys.includes(key as ManagedWorkflowKey);
}
```

**Step 2: Commit**

```bash
git add src/lib/agents/contracts.ts
git commit -m "feat(agents): add trigger function reference and workflow validation helper"
```

---

## Task 18: Apply agent tables migration to remote Supabase

The migration `20260411235500_add_managed_agent_run_tables.sql` exists locally but has not been applied to the remote Supabase project (`atukvssploxwyqpwjmrc`).

**Step 1: Verify migration file exists**

```bash
ls -la supabase/migrations/20260411235500_add_managed_agent_run_tables.sql
```

Expected: file exists with the 4 table definitions + RLS policies.

**Step 2: Apply migration to remote**

Use the Supabase MCP tool `apply_migration` with:

- `project_id`: `atukvssploxwyqpwjmrc`
- `name`: `add_managed_agent_run_tables`
- `query`: contents of the migration file

**Step 3: Verify tables exist**

Use the Supabase MCP tool `list_tables` to confirm `agent_runs`, `agent_run_steps`, `agent_run_artifacts`, `agent_run_events` appear in the public schema.

**Step 4: No commit needed** (migration file already committed)

---

## Task 19: Deploy edge functions and set environment variables

**Step 1: Set required environment variables on remote Supabase**

Via the Supabase dashboard or CLI, add:

- `ANTHROPIC_API_KEY` — Claude API key
- `APIFY_API_KEY` — Apify API key
- `MANAGED_AGENT_WORKSPACE_IDS` — comma-separated list of test workspace UUIDs

**Step 2: Deploy the new edge functions**

```bash
supabase functions deploy trigger-managed-agent --project-ref atukvssploxwyqpwjmrc
supabase functions deploy faq-agent-runner --project-ref atukvssploxwyqpwjmrc
```

**Step 3: Verify deployment**

```bash
supabase functions list --project-ref atukvssploxwyqpwjmrc
```

Expected: both `trigger-managed-agent` and `faq-agent-runner` appear in the list.

---

## Task 20: Smoke test with a test workspace

**Step 1: Identify a test workspace**

Query for a workspace with selected competitor sites:

```sql
SELECT cs.workspace_id, COUNT(*) as sites
FROM competitor_sites cs
WHERE cs.is_selected = true AND cs.status != 'rejected'
GROUP BY cs.workspace_id
LIMIT 5;
```

**Step 2: Add workspace to rollout env var**

Update `MANAGED_AGENT_WORKSPACE_IDS` to include the test workspace UUID.

**Step 3: Trigger a test run**

```bash
curl -X POST \
  https://atukvssploxwyqpwjmrc.supabase.co/functions/v1/trigger-managed-agent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -d '{"workspace_id": "<TEST_WORKSPACE_ID>", "workflow_key": "faq_generation"}'
```

Expected response: `{ "success": true, "run_id": "...", ... }`

**Step 4: Monitor the run**

```sql
-- Check run status
SELECT id, status, current_step_key, error_summary, started_at, completed_at
FROM agent_runs WHERE id = '<RUN_ID>';

-- Check steps
SELECT step_key, status, error_message, started_at, completed_at
FROM agent_run_steps WHERE run_id = '<RUN_ID>' ORDER BY created_at;

-- Check artifacts
SELECT artifact_type, artifact_key, source_url
FROM agent_run_artifacts WHERE run_id = '<RUN_ID>';

-- Check n8n progress compat
SELECT status, details FROM n8n_workflow_progress
WHERE workspace_id = '<WORKSPACE_ID>' AND workflow_type = 'faq_generation';

-- Check generated FAQs
SELECT question, answer, source_url, generation_source
FROM faq_database
WHERE workspace_id = '<WORKSPACE_ID>' AND generation_source = 'managed_agent';
```

**Step 5: Commit any fixes from smoke testing**

---

## Summary

| Task | Deliverable                         | Est.   |
| ---- | ----------------------------------- | ------ |
| 1    | Scaffold + config.toml registration | 5 min  |
| 2    | System prompt template              | 5 min  |
| 3    | Step recorder utility               | 5 min  |
| 4    | Claude API client wrapper           | 10 min |
| 5    | Self-chain utility                  | 5 min  |
| 6    | get-run-context handler             | 10 min |
| 7    | fetch-source-page handler (Apify)   | 10 min |
| 8    | mirror-progress handler             | 10 min |
| 9    | list-existing-faqs handler          | 5 min  |
| 10   | persist-candidate-faqs handler      | 5 min  |
| 11   | persist-final-faqs handler          | 10 min |
| 12   | record-artifact handler             | 5 min  |
| 13   | mark-run-failed handler             | 5 min  |
| 14   | Tool definitions for Claude API     | 10 min |
| 15   | Main runner (faq-agent-runner)      | 15 min |
| 16   | Trigger (trigger-managed-agent)     | 10 min |
| 17   | Update contracts.ts                 | 5 min  |
| 18   | Apply migration to remote           | 5 min  |
| 19   | Deploy + env vars                   | 10 min |
| 20   | Smoke test                          | 15 min |
