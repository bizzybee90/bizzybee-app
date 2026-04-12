# FAQ Generation Managed Agent — Design

Date: 2026-04-12
Status: Approved
Repo: `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control`

## Objective

Replace the n8n-based `faq_generation` workflow with a fully managed Claude agent. BizzyBee triggers the run, creates the `agent_run`, Claude orchestrates via constrained tool_use, and BizzyBee records every step, artifact, and result. n8n is not called anywhere in the execution path.

This is the first pilot in a selective migration. Only workflows that benefit from adaptive reasoning are migrated. Deterministic plumbing stays deterministic.

---

## Architecture Overview

Two new edge functions:

1. **`trigger-managed-agent`** — Entry point. Validates auth, checks rollout eligibility, creates the `agent_run`, and fire-and-forgets the runner.

2. **`faq-agent-runner`** — The agent. Loads the run, calls Claude API with tool_use, executes each tool call against BizzyBee-owned handlers, records steps/artifacts/events, and self-chains if approaching timeout.

### Execution Flow

```
UI (CompetitorReviewScreen / ProgressScreen / KnowledgeBaseStep)
  → trigger-managed-agent
    → creates agent_run (status: queued)
    → mirrors to n8n_workflow_progress (status: pending)
    → fire-and-forget: faq-agent-runner(run_id)

faq-agent-runner(run_id)
  → loads agent_run
  → calls Claude API with system prompt + tools
  → Claude tool_use loop:
      get_run_context → load allowed URLs + workspace metadata
      fetch_source_page (per URL) → Apify scrape, store artifact
      mirror_progress(fetch_complete)
      list_existing_faqs → dedup check
      persist_candidate_faqs → save all candidates with evidence
      mirror_progress(candidates_generated)
      [Claude consolidates: dedup, rank, quality filter]
      persist_final_faqs → write to faq_database
      record_artifact(final_faqs)
      mirror_progress(finalized)
  → run completes or self-chains if timeout approaching
```

### Key Principle

Claude is the runtime decision-maker. BizzyBee tools are the guardrails. The agent can only act through its defined tools — no raw DB access, no arbitrary URL fetching, no file system access.

---

## Agent Specification

```yaml
name: BizzyBee FAQ Agent
model: claude-opus-4-6
```

### System Prompt

Stored as a version-controlled file at `supabase/functions/faq-agent-runner/prompts/faq-extraction.md`. Injected with workspace-specific variables from `business_context` at runtime.

Core instructions:

- Run exactly once per workspace onboarding session
- Only fetch URLs from `run_context.allowed_urls`
- Extract only facts explicitly stated in fetched content
- Every FAQ requires a verbatim evidence quote from source
- Check existing FAQs before generating to avoid duplication
- Two-phase persistence: candidates first, then final approved set
- Prefer 5-10 strong FAQs over 20 weak ones, max 15
- If fewer than 3 strong FAQs can be grounded, fail the run

### All Default Tools Disabled

```yaml
tools:
  - type: agent_toolset_20260401
    default_config:
      enabled: false
    configs:
      - name: bash
        enabled: false
      - name: web_search
        enabled: false
      - name: web_fetch
        enabled: false
      - name: read
        enabled: false
      - name: write
        enabled: false
      - name: edit
        enabled: false
      - name: glob
        enabled: false
      - name: grep
        enabled: false
```

---

## Custom Tools

Eight BizzyBee-owned tools. Each tool handler lives inside `faq-agent-runner/tools/` and operates against Supabase with the service role. Every handler automatically creates an `agent_run_steps` row before execution and updates it on completion or failure.

### get_run_context

- **Purpose:** Returns run_id, workspace_id, workspace_name, allowed_urls, and workspace metadata.
- **Handler:** Query `agent_runs` by run_id, join `business_context` + `competitor_sites` (selected, not rejected). Build allowed_urls from competitor site URLs.
- **Input:** `{ run_id }`
- **Failure:** If missing or malformed, Claude must call `mark_run_failed` with `missing_run_context`.

### fetch_source_page

- **Purpose:** Fetch and extract clean text from a single allowlisted URL.
- **Handler:** Validate URL is in allowed list. Call Apify web scraper actor API directly (`APIFY_API_KEY` env var). Store raw content as `source_page` artifact in `agent_run_artifacts`. Return cleaned text.
- **Input:** `{ url, run_id }`
- **Constraint:** URL must be present in `run_context.allowed_urls`.

### mirror_progress

- **Purpose:** Record progress checkpoint and maintain UI compatibility.
- **Handler:** Upsert `n8n_workflow_progress` with mapped status. Write `agent_run_events` row.
- **Input:** `{ run_id, stage, summary, metadata? }`
- **Stages:** `context_loaded`, `fetch_complete`, `candidates_generated`, `quality_review_complete`, `finalized`

### list_existing_faqs

- **Purpose:** Return current FAQs for this workspace to avoid generating duplicates.
- **Handler:** Query `faq_database` for workspace_id. Return Q&A pairs.
- **Input:** `{ workspace_id }`

### persist_candidate_faqs

- **Purpose:** Save the full candidate FAQ set with evidence before quality filtering.
- **Handler:** Write each candidate as `faq_candidate` artifact in `agent_run_artifacts` with evidence quote and source URL.
- **Input:** `{ run_id, workspace_id, candidates[] }` where each candidate has `{ question, answer, source_url, evidence_quote }`

### persist_final_faqs

- **Purpose:** Write the final approved FAQ set to the domain table.
- **Handler:** Insert approved FAQs into `faq_database`. Write `persisted_row_link` artifacts linking run to new rows.
- **Input:** `{ run_id, workspace_id, faqs[], faq_count }`

### record_artifact

- **Purpose:** Record a named artifact for the run.
- **Handler:** Insert into `agent_run_artifacts` with type, label, and payload.
- **Input:** `{ run_id, artifact_type, label, payload }`
- **Types:** `final_faqs`, `candidate_faqs`, `fetch_summary`, `error_report`

### mark_run_failed

- **Purpose:** Fail the run with a machine-readable reason and human-readable explanation.
- **Handler:** Update `agent_runs` status to `failed`, write `error_summary`. Mirror failure to `n8n_workflow_progress`.
- **Input:** `{ run_id, reason_code, explanation }`
- **Reason codes:** `missing_run_context`, `no_allowed_urls`, `all_fetches_failed`, `insufficient_evidence`, `tool_failure`, `quality_threshold_not_met`

---

## Runner Lifecycle and Self-Chaining

### Startup

1. Load `agent_run` by run_id
2. Check if fresh start or continuation (resumed from self-chain)
3. If fresh: build initial messages (system prompt from repo template + user message with run_id)
4. If continuation: load saved conversation state from `agent_runs.output_summary`

### Main Loop

1. Call Claude API with messages + tool definitions
2. If Claude returns tool_use → execute handler, record step, append result to messages
3. If Claude returns end_turn → run complete
4. After each tool round-trip, check elapsed time against budget (120s of 150s limit)
5. If approaching timeout → save conversation state + continuation metadata to `agent_runs`, update status to `waiting`, fire-and-forget new invocation

### Completion

- Claude calls `complete_run` (implicit via `mirror_progress(finalized)`) or `mark_run_failed`
- Handler updates `agent_runs` status to `succeeded` or `failed`
- Final state mirrored to `n8n_workflow_progress`

### Error Handling

- Tool handler throws → catch, record as failed step, feed error back to Claude for decision (retry or fail)
- Claude API call fails → retry once, then mark run failed
- Self-chain invocation fails → run stays in `waiting` status, can be retried manually

---

## Data Flow and Compatibility

### Source of Truth

`agent_runs` and its child tables (`agent_run_steps`, `agent_run_artifacts`, `agent_run_events`) are the canonical record of what happened.

### Compatibility Writes

The agent mirrors progress to `n8n_workflow_progress` at each stage so existing UI components (`ProgressScreen`, `CompetitorPipelineProgress`) continue working with zero changes.

Stage mapping:

| Agent Stage               | n8n_workflow_progress Status | details                                     |
| ------------------------- | ---------------------------- | ------------------------------------------- |
| `context_loaded`          | `in_progress`                | `{ phase: 'loading' }`                      |
| `fetch_complete`          | `in_progress`                | `{ phase: 'extracting', urls_fetched: N }`  |
| `candidates_generated`    | `in_progress`                | `{ phase: 'consolidating', candidates: N }` |
| `quality_review_complete` | `in_progress`                | `{ phase: 'reviewing', approved: N }`       |
| `finalized`               | `complete`                   | `{ faqs_generated: N }`                     |
| (failure)                 | `failed`                     | `{ error: reason_code }`                    |

### Domain Table Writes

Final FAQs are written to `faq_database` — the same table the existing n8n workflow writes to. The UI reads from this table for the knowledge base. No change needed.

---

## Trigger Surface

### trigger-managed-agent

New edge function. The UI calls it directly for opted-in workspaces.

1. Validate auth + workspace via `_shared/auth.ts`
2. Check rollout eligibility (`MANAGED_AGENT_WORKSPACE_IDS` env var)
3. Validate workflow_key is a managed workflow
4. Load selected competitors from `competitor_sites`, build allowed_urls
5. Create `agent_runs` row (status: `queued`, rollout_mode, input_snapshot with allowed_urls)
6. Mirror initial progress to `n8n_workflow_progress` (status: `pending`)
7. Fire-and-forget invoke `faq-agent-runner` with run_id
8. Return run_id to UI immediately

### UI Integration

Existing onboarding components subscribe to `n8n_workflow_progress` via Supabase realtime. Because the agent mirrors progress there, no UI changes are needed for v1.

---

## Rollout Mechanism

Matches the existing billing bypass pattern.

- **Env var:** `MANAGED_AGENT_WORKSPACE_IDS` — comma-separated workspace UUIDs
- **Gate:** `trigger-managed-agent` checks membership before creating the run
- **Negative gate:** `trigger-n8n-workflow` skips n8n dispatch if workspace is agent-managed (optional safeguard)

### Rollout Modes

| Mode     | Behavior                                                                        |
| -------- | ------------------------------------------------------------------------------- |
| `legacy` | Existing n8n path only. Agent tables exist but unused.                          |
| `shadow` | Trigger both paths. Agent results recorded but n8n output is canonical.         |
| `soft`   | Agent path is primary for listed workspaces. n8n disabled for those workspaces. |
| `hard`   | Agent path for all workspaces. Future state.                                    |

Pilot starts with `soft` for test workspaces only.

---

## File Layout

```
supabase/functions/
├── trigger-managed-agent/
│   └── index.ts                    # Entry point: auth, rollout check, create run, fire runner
├── faq-agent-runner/
│   ├── index.ts                    # Main loop: Claude API conversation + tool dispatch
│   ├── tools/
│   │   ├── get-run-context.ts
│   │   ├── fetch-source-page.ts
│   │   ├── mirror-progress.ts
│   │   ├── list-existing-faqs.ts
│   │   ├── persist-candidate-faqs.ts
│   │   ├── persist-final-faqs.ts
│   │   ├── record-artifact.ts
│   │   └── mark-run-failed.ts
│   ├── prompts/
│   │   └── faq-extraction.md       # System prompt template (version-controlled)
│   └── lib/
│       ├── claude-client.ts        # Claude API wrapper with tool_use loop
│       ├── self-chain.ts           # Timeout detection + continuation state
│       └── step-recorder.ts        # Automatic agent_run_steps logging wrapper
src/lib/agents/
├── contracts.ts                    # Already exists: types and definitions
└── hooks.ts                        # useAgentRun hook (future, not v1)
```

---

## Environment Variables Required

| Variable                      | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `ANTHROPIC_API_KEY`           | Claude API access for the agent runner             |
| `APIFY_API_KEY`               | Direct Apify web scraper API access                |
| `MANAGED_AGENT_WORKSPACE_IDS` | Comma-separated workspace UUIDs for rollout gating |

---

## Non-Goals

- Do not remove n8n globally
- Do not replace `email_classification` or any deterministic workflow
- Do not couple this to Stripe or billing rollout
- Do not change the existing onboarding UI
- Do not introduce hard rollout mode in the first pass
- Do not build an admin UI for prompt editing in v1

---

## Success Criteria

1. A test workspace can trigger FAQ generation and receive results entirely through the managed agent path
2. The onboarding progress UI works identically (realtime updates, stage display)
3. FAQs appear in `faq_database` and are visible in the knowledge base
4. Every step, artifact, and event is recorded in the agent tables
5. A failed run (bad URLs, empty content) produces a clear failure record, not garbage FAQs
6. The n8n path continues working for all non-opted-in workspaces

---

## Future Extensions

After the FAQ pilot is proven:

1. `own_website_scrape` — reuses the fetch + extract + persist pattern
2. `competitor_discovery` — adds search + ranking, highest orchestration complexity
3. Database-stored prompts — editable without redeployment
4. `useAgentRun` frontend hook — richer progress UI reading from `agent_runs` directly
5. Shadow mode comparison — run both paths and compare output quality
