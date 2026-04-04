# AI Phone Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete AI Phone add-on for BizzyBee — voice AI receptionist powered by Retell AI + Claude + ElevenLabs, with automated UK phone number provisioning via Twilio SIP trunking.

**Architecture:** Retell AI handles telephony/STT/TTS orchestration, Claude is the LLM brain (via Retell's retell-llm integration), ElevenLabs Flash v2.5 provides voice synthesis (via Retell). Supabase stores configs/call logs, edge functions handle webhooks/provisioning, React frontend provides dashboard/setup/KB management. Twilio provides UK phone numbers via SIP trunk imported into Retell.

**Tech Stack:** React + TypeScript + Tailwind + shadcn/ui, Supabase (Postgres + Edge Functions + Realtime), Retell AI API, Twilio API (for UK numbers), n8n workflows, React Query, lucide-react icons.

**Supabase Project:** `atukvssploxwyqpwjmrc` (EU London)

---

## Task 1: Database Migration — AI Phone Tables

**Files:**
- Create migration via Supabase MCP `apply_migration`

**Step 1: Apply the migration**

Use Supabase MCP `apply_migration` with name `ai_phone_tables` and this SQL:

```sql
-- AI Phone Configs (one per workspace)
CREATE TABLE ai_phone_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  retell_agent_id TEXT,
  retell_llm_id TEXT,
  retell_phone_number TEXT,
  retell_phone_number_id TEXT,
  phone_provider TEXT DEFAULT 'twilio_sip' CHECK (phone_provider IN ('retell', 'twilio_sip')),
  twilio_number_sid TEXT,
  twilio_trunk_sid TEXT,
  twilio_sip_uri TEXT,
  business_name TEXT NOT NULL,
  business_description TEXT,
  services JSONB DEFAULT '[]'::jsonb,
  opening_hours JSONB DEFAULT '{}'::jsonb,
  booking_rules JSONB DEFAULT '{}'::jsonb,
  custom_instructions TEXT,
  greeting_message TEXT DEFAULT 'Hello, thank you for calling. This call may be recorded for quality purposes. How can I help you today?',
  voice_id TEXT DEFAULT '21m00Tcm4TlvDq8ikWAM',
  voice_name TEXT DEFAULT 'Rachel',
  max_call_duration_seconds INT DEFAULT 300,
  transfer_number TEXT,
  is_active BOOLEAN DEFAULT false,
  data_retention_days INT DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id)
);

CREATE INDEX idx_ai_phone_configs_workspace ON ai_phone_configs(workspace_id);

-- AI Phone Knowledge Base
CREATE TABLE ai_phone_knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES ai_phone_configs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'general' CHECK (category IN ('faq', 'pricing', 'services', 'policies', 'general')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ai_phone_kb_config ON ai_phone_knowledge_base(config_id);

-- AI Phone Call Logs
CREATE TABLE ai_phone_call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES ai_phone_configs(id),
  retell_call_id TEXT UNIQUE NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  caller_number TEXT,
  called_number TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'transferred', 'error', 'voicemail')),
  start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time TIMESTAMPTZ,
  duration_seconds INT,
  transcript TEXT,
  transcript_object JSONB,
  summary TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  outcome TEXT CHECK (outcome IN ('resolved', 'booking_made', 'message_taken', 'transferred', 'abandoned', 'error')),
  outcome_details JSONB DEFAULT '{}'::jsonb,
  cost_cents INT DEFAULT 0,
  requires_followup BOOLEAN DEFAULT false,
  followup_notes TEXT,
  call_analysis JSONB DEFAULT '{}'::jsonb,
  disconnection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_call_logs_workspace ON ai_phone_call_logs(workspace_id);
CREATE INDEX idx_call_logs_config ON ai_phone_call_logs(config_id);
CREATE INDEX idx_call_logs_time ON ai_phone_call_logs(start_time DESC);
CREATE INDEX idx_call_logs_retell ON ai_phone_call_logs(retell_call_id);

-- AI Phone Usage (monthly billing)
CREATE TABLE ai_phone_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  total_calls INT DEFAULT 0,
  total_minutes DECIMAL(10,2) DEFAULT 0,
  total_cost_cents INT DEFAULT 0,
  included_minutes INT DEFAULT 0,
  overage_minutes DECIMAL(10,2) DEFAULT 0,
  overage_cost_cents INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, month)
);

-- RLS Policies
ALTER TABLE ai_phone_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_phone_knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_phone_call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_phone_usage ENABLE ROW LEVEL SECURITY;

-- ai_phone_configs: workspace members can read/write their own
CREATE POLICY "Users can manage their workspace phone config"
  ON ai_phone_configs FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

-- Service role full access for edge functions
CREATE POLICY "Service role full access to phone configs"
  ON ai_phone_configs FOR ALL
  USING (auth.role() = 'service_role');

-- ai_phone_knowledge_base: via config's workspace
CREATE POLICY "Users can manage their KB entries"
  ON ai_phone_knowledge_base FOR ALL
  USING (config_id IN (
    SELECT id FROM ai_phone_configs
    WHERE workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid())
  ))
  WITH CHECK (config_id IN (
    SELECT id FROM ai_phone_configs
    WHERE workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid())
  ));

CREATE POLICY "Service role full access to phone KB"
  ON ai_phone_knowledge_base FOR ALL
  USING (auth.role() = 'service_role');

-- ai_phone_call_logs: workspace scoped
CREATE POLICY "Users can view their workspace call logs"
  ON ai_phone_call_logs FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role full access to call logs"
  ON ai_phone_call_logs FOR ALL
  USING (auth.role() = 'service_role');

-- ai_phone_usage: workspace scoped
CREATE POLICY "Users can view their workspace usage"
  ON ai_phone_usage FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role full access to usage"
  ON ai_phone_usage FOR ALL
  USING (auth.role() = 'service_role');

-- Enable Realtime for call logs (live dashboard updates)
ALTER PUBLICATION supabase_realtime ADD TABLE ai_phone_call_logs;
```

**Step 2: Verify migration applied**

Use Supabase MCP `list_tables` with schemas `["public"]` and verbose `true` to confirm all 4 tables exist.

**Step 3: Run security advisors**

Use Supabase MCP `get_advisors` with type `security` to verify RLS is correctly configured.

---

## Task 2: Store Retell API Key as Supabase Secret

**Step 1: Set the secret**

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app
npx supabase secrets set RETELL_API_KEY="<your-retell-api-key>" --project-ref atukvssploxwyqpwjmrc
```

**Step 2: Also set Twilio credentials (needed for Phase 2 UK number provisioning)**

Ask user for Twilio Account SID, Auth Token, and SIP domain. Set:

```bash
npx supabase secrets set TWILIO_ACCOUNT_SID="..." TWILIO_AUTH_TOKEN="..." --project-ref atukvssploxwyqpwjmrc
```

---

## Task 3: Edge Function — `retell-provision`

**Files:**
- Create: `supabase/functions/retell-provision/index.ts`

This function handles the complete provisioning flow:
1. Saves config to `ai_phone_configs`
2. Creates a Retell LLM with the dynamic system prompt
3. Creates a Retell Agent with voice + LLM
4. Phase 2: Purchases a Twilio UK number, creates SIP trunk, imports number into Retell
5. Updates config with all Retell/Twilio IDs

**Key implementation details:**

- Auth: `validateAuth(req)` from `_shared/auth.ts`
- Retell API base: `https://api.retellai.com`
- Create LLM: `POST /create-retell-llm` with `general_prompt` built from config
- Create Agent: `POST /create-agent` with `response_engine: { type: "retell-llm", llm_id }`, `voice_id`, `voice_model: "eleven_flash_v2_5"`, `language: "en-GB"`, `webhook_url`, `post_call_analysis_data`, `data_storage_setting: "everything_except_pii"`
- Twilio: `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/IncomingPhoneNumbers.json` for UK number, then create SIP trunk + origination URI
- Import number: `POST /import-phone-number` with `phone_number`, `termination_uri`, `inbound_agents: [{ agent_id, weight: 1 }]`

**System prompt builder** should construct the prompt from config fields (business_name, business_description, services, opening_hours, booking_rules, custom_instructions) + all active KB entries.

Deploy via Supabase MCP `deploy_edge_function`.

---

## Task 4: Edge Function — `retell-webhook`

**Files:**
- Create: `supabase/functions/retell-webhook/index.ts`

Handles Retell webhook events. **No JWT auth** — verified by Retell API key in request body or header.

**Events handled:**
- `call_started` → Insert row into `ai_phone_call_logs` with status `in_progress`
- `call_ended` → Update with transcript, duration, disconnection_reason, status `completed`
- `call_analyzed` → Update with summary, sentiment, outcome from `call_analysis`

**Verification:** Check `x-retell-signature` header. Retell signs webhooks with HMAC-SHA256 using the API key.

**After call_ended:** Update `ai_phone_usage` monthly counters (upsert on workspace_id + month). Calculate cost_cents based on duration.

**Must respond < 5 seconds.** Do the DB write synchronously, trigger n8n post-call webhook async via `fetch().catch()`.

Deploy via Supabase MCP `deploy_edge_function` with `verify_jwt: false`.

---

## Task 5: Edge Function — `retell-update-agent`

**Files:**
- Create: `supabase/functions/retell-update-agent/index.ts`

Called when user updates their config (services, hours, KB, voice, etc.):
1. Validate auth
2. Fetch config from `ai_phone_configs`
3. Fetch all active KB entries for the config
4. Rebuild system prompt
5. `PATCH /update-retell-llm/{llm_id}` with new `general_prompt`
6. `PATCH /update-agent/{agent_id}` with updated voice_id, voice_model, etc.
7. Update `ai_phone_configs.updated_at`

Deploy via Supabase MCP `deploy_edge_function`.

---

## Task 6: Edge Function — `retell-call-stats`

**Files:**
- Create: `supabase/functions/retell-call-stats/index.ts`

GET endpoint returning dashboard stats for the authenticated user's workspace:
- Calls today (count)
- Calls this week (count)
- Average duration (seconds)
- Resolution rate (% completed without transfer)
- Minutes used this month
- Included minutes (from plan — hardcoded for now: Growth=100, Pro=500)
- Overage minutes

Auth: `validateAuth(req)`. Query `ai_phone_call_logs` and `ai_phone_usage`.

Deploy via Supabase MCP `deploy_edge_function`.

---

## Task 7: Edge Function — `delete-caller-data`

**Files:**
- Create: `supabase/functions/delete-caller-data/index.ts`

GDPR right-to-erasure. Accepts `{ phone_number: string }` in body.
1. Validate auth
2. Delete all `ai_phone_call_logs` rows where `caller_number` matches and `workspace_id` matches
3. Return count of deleted records

Deploy via Supabase MCP `deploy_edge_function`.

---

## Task 8: TypeScript Types

**Files:**
- Modify: `src/lib/types.ts` (append AI Phone types)

Add these types at the bottom of the file:

```typescript
// AI Phone types
export interface AiPhoneService {
  name: string;
  description: string;
  price_from: number | null;
  price_to: number | null;
  duration_minutes: number | null;
}

export interface AiPhoneOpeningHours {
  [day: string]: { open: string; close: string; closed?: boolean };
}

export interface AiPhoneBookingRules {
  allow_booking: boolean;
  booking_url?: string;
  booking_instructions?: string;
}

export interface AiPhoneConfig {
  id: string;
  workspace_id: string;
  retell_agent_id: string | null;
  retell_llm_id: string | null;
  retell_phone_number: string | null;
  retell_phone_number_id: string | null;
  phone_provider: 'retell' | 'twilio_sip';
  twilio_number_sid: string | null;
  twilio_trunk_sid: string | null;
  twilio_sip_uri: string | null;
  business_name: string;
  business_description: string | null;
  services: AiPhoneService[];
  opening_hours: AiPhoneOpeningHours;
  booking_rules: AiPhoneBookingRules;
  custom_instructions: string | null;
  greeting_message: string;
  voice_id: string;
  voice_name: string;
  max_call_duration_seconds: number;
  transfer_number: string | null;
  is_active: boolean;
  data_retention_days: number;
  created_at: string;
  updated_at: string;
}

export interface AiPhoneKBEntry {
  id: string;
  config_id: string;
  title: string;
  content: string;
  category: 'faq' | 'pricing' | 'services' | 'policies' | 'general';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiPhoneCallLog {
  id: string;
  workspace_id: string;
  config_id: string;
  retell_call_id: string;
  direction: 'inbound' | 'outbound';
  caller_number: string | null;
  called_number: string | null;
  status: 'in_progress' | 'completed' | 'transferred' | 'error' | 'voicemail';
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  transcript_object: unknown;
  summary: string | null;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  outcome: 'resolved' | 'booking_made' | 'message_taken' | 'transferred' | 'abandoned' | 'error' | null;
  outcome_details: Record<string, unknown>;
  cost_cents: number;
  requires_followup: boolean;
  followup_notes: string | null;
  call_analysis: Record<string, unknown>;
  disconnection_reason: string | null;
  created_at: string;
}

export interface AiPhoneUsage {
  id: string;
  workspace_id: string;
  month: string;
  total_calls: number;
  total_minutes: number;
  total_cost_cents: number;
  included_minutes: number;
  overage_minutes: number;
  overage_cost_cents: number;
}

export interface AiPhoneStats {
  calls_today: number;
  calls_this_week: number;
  avg_duration_seconds: number;
  resolution_rate: number;
  minutes_used: number;
  included_minutes: number;
  overage_minutes: number;
}
```

---

## Task 9: React Hooks

**Files:**
- Create: `src/hooks/useAiPhoneConfig.ts`
- Create: `src/hooks/useCallLogs.ts`
- Create: `src/hooks/useCallStats.ts`

### useAiPhoneConfig
- `useQuery` to fetch config from `ai_phone_configs` filtered by workspace_id (via `useWorkspace`)
- `useMutation` for creating/updating config (calls the edge functions for provisioning/updating)
- Returns: `{ config, isLoading, createConfig, updateConfig }`

### useCallLogs
- `useQuery` to fetch call logs from `ai_phone_call_logs` with pagination, filters (date range, outcome, sentiment)
- Supabase Realtime subscription for live updates (new calls appear instantly)
- Returns: `{ calls, isLoading, filters, setFilters, hasMore, loadMore }`

### useCallStats
- `useQuery` calling the `retell-call-stats` edge function
- Auto-refresh every 60 seconds
- Returns: `{ stats, isLoading }`

---

## Task 10: Sidebar Navigation Update

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`

**Step 1: Add Phone import**

Add `Phone` to the lucide-react import at line 1.

**Step 2: Add to mobile drawer nav array**

Insert after the `Sent` item (before `Channels`):
```typescript
{ to: '/ai-phone', icon: Phone, label: 'AI Phone' },
```

**Step 3: Add to desktop icon rail**

Insert after the `Sent` IconRailItem (line 189):
```tsx
<IconRailItem to="/ai-phone" icon={Phone} label="AI Phone" />
```

---

## Task 11: AI Phone Page + Route

**Files:**
- Create: `src/pages/AiPhone.tsx`
- Modify: `src/App.tsx` (add route + import)

### AiPhone.tsx
Main page with 3 tabs: Dashboard, Setup, Knowledge Base.

Uses `ThreeColumnLayout` + `Sidebar` pattern (same as Home.tsx). Tab state managed with `useState`. Each tab renders its corresponding panel component.

- **Dashboard tab:** `<StatsBar />` + `<CallLogTable />`
- **Setup tab:** If no config → `<OnboardingWizard />`, else → `<PhoneSettingsForm />`
- **Knowledge Base tab:** `<KnowledgeBaseEditor />`

### App.tsx route
Add before the catch-all comment (before line 318):
```tsx
<Route
  path="/ai-phone"
  element={
    <AuthGuard>
      <AiPhone />
    </AuthGuard>
  }
/>
```

---

## Task 12: Dashboard Components — StatsBar + CallLogTable + CallTranscript

**Files:**
- Create: `src/components/ai-phone/StatsBar.tsx`
- Create: `src/components/ai-phone/CallLogTable.tsx`
- Create: `src/components/ai-phone/CallTranscript.tsx`

### StatsBar
4 metric cards in a row: Calls Today, Minutes Used (with progress bar), Resolution Rate, Avg Duration. Uses `useCallStats` hook. Same card styling as Home.tsx stats.

### CallLogTable
- Table with columns: Time, Caller, Duration, Outcome (coloured badge), Sentiment (emoji), Summary (truncated), expand button
- Expandable row shows full `<CallTranscript />` + outcome details + cost
- Filter bar: date range picker, outcome dropdown, sentiment dropdown
- Real-time updates via Supabase Realtime
- Pagination: 25 per page
- Empty state: "No calls yet. Set up your AI Phone to get started."

### CallTranscript
Chat-bubble format. Agent messages on right (teal background), caller messages on left (grey background). Timestamps per message. Parsed from `transcript_object` JSONB.

Outcome badges:
- resolved = green
- booking_made = blue
- message_taken = yellow/amber
- transferred = grey
- abandoned = orange
- error = red

---

## Task 13: Onboarding Wizard

**Files:**
- Create: `src/components/ai-phone/OnboardingWizard.tsx`
- Create: `src/components/ai-phone/ServiceEditor.tsx`
- Create: `src/components/ai-phone/OpeningHoursGrid.tsx`
- Create: `src/components/ai-phone/VoiceSelector.tsx`
- Create: `src/components/ai-phone/PhoneNumberDisplay.tsx`

### OnboardingWizard
6-step wizard with progress indicator. Each step is a card with back/next buttons.

1. **Business Details** — business_name (input), business_description (textarea), transfer_number (phone input)
2. **Services & Pricing** — `<ServiceEditor />` inline table
3. **Opening Hours** — `<OpeningHoursGrid />`
4. **Voice Selection** — `<VoiceSelector />`
5. **Knowledge Base** — Quick KB editor (3 pre-populated example entries to fill in)
6. **Review & Go Live** — Summary of all config. "Provision My AI Phone" button. Shows `<PhoneNumberDisplay />` after success.

### ServiceEditor
Table with rows: Service Name, Description, Price From, Price To, Duration. Add/remove rows. Inline editing with shadcn inputs.

### OpeningHoursGrid
7-day grid (Mon-Sun). Each row: day name, open time (select), close time (select), "Closed" toggle (Switch). Default: Mon-Fri 9:00-17:00, Sat-Sun closed.

### VoiceSelector
Grid of 6-8 voice cards. Each card: voice name, description, play preview button (circular with pulse animation). Selected voice has amber border. Preview audio from ElevenLabs preview API or hardcoded sample URLs.

Voice options (ElevenLabs voice IDs):
- Rachel (warm British female) — default
- Domi (professional British male)
- Bella (friendly American female)
- Antoni (conversational British male)
- Elli (young energetic female)
- Josh (deep authoritative male)

### PhoneNumberDisplay
Large monospace phone number with copy-to-clipboard button. Green "Active" badge when is_active is true.

---

## Task 14: Settings Form (Post-Setup)

**Files:**
- Create: `src/components/ai-phone/PhoneSettingsForm.tsx`

Same sections as wizard but as collapsible accordion sections on a single page (using shadcn Accordion). Save button per section. Phone number displayed at top with `<PhoneNumberDisplay />`.

Sections:
1. Phone Number & Status (toggle active/inactive)
2. Business Details
3. Services & Pricing
4. Opening Hours
5. Voice
6. Advanced (max call duration, transfer number, data retention days, custom instructions)

Each section save calls `retell-update-agent` edge function to push changes to Retell.

---

## Task 15: Knowledge Base Editor

**Files:**
- Create: `src/components/ai-phone/KnowledgeBaseEditor.tsx`

Full CRUD for KB entries:
- List view with search bar
- Category filter tabs (All, FAQ, Pricing, Services, Policies, General)
- Add button → inline form (title + content textarea + category select)
- Edit/delete per entry
- Character count per entry with guidance ("Keep under 500 words")
- After any change, calls `retell-update-agent` to sync prompt to Retell

Uses direct Supabase queries to `ai_phone_knowledge_base` table (RLS handles scoping).

---

## Task 16: n8n Workflow — Post-Call Processing

**Files:**
- n8n workflow created via n8n MCP tools

### Workflow: "AI Phone — Post-Call Processing"

**Trigger:** Webhook node (receives POST from retell-webhook edge function after call_ended)

**Steps:**
1. Webhook trigger receives call data
2. IF node: check `outcome`
   - `booking_made` → HTTP Request to BizzyBee inbox API (create task)
   - `message_taken` → HTTP Request to send notification email
   - `requires_followup = true` → Create priority task in inbox
3. Set node: format notification message
4. HTTP Request: Send to Slack webhook (if configured)

---

## Task 17: n8n Workflow — GDPR Auto-Delete

**Files:**
- n8n workflow created via n8n MCP tools

### Workflow: "AI Phone — GDPR Auto-Delete"

**Trigger:** Schedule node — daily at 02:00 UTC

**Steps:**
1. Supabase node: Query all `ai_phone_configs` (get retention_days per workspace)
2. For each config: Supabase node: Delete from `ai_phone_call_logs` where `created_at < now() - retention_days` and `config_id = config.id`
3. Set node: Log deletion count

---

## Task 18: Build Verification + Visual Check

**Step 1: Run build**

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app
npx vite build
```

Expected: Clean build, no TypeScript errors.

**Step 2: Start dev server and verify**

Use preview tools to start the dev server, navigate to `/ai-phone`, and screenshot.

Verify:
- AI Phone appears in sidebar nav
- Dashboard tab shows empty state
- Setup tab shows onboarding wizard
- Knowledge Base tab shows empty state
- No console errors

---

## Task 19: Commit + Push

**Step 1: Stage all new/modified files**

```bash
git add \
  src/lib/types.ts \
  src/App.tsx \
  src/components/sidebar/Sidebar.tsx \
  src/pages/AiPhone.tsx \
  src/hooks/useAiPhoneConfig.ts \
  src/hooks/useCallLogs.ts \
  src/hooks/useCallStats.ts \
  src/components/ai-phone/StatsBar.tsx \
  src/components/ai-phone/CallLogTable.tsx \
  src/components/ai-phone/CallTranscript.tsx \
  src/components/ai-phone/OnboardingWizard.tsx \
  src/components/ai-phone/ServiceEditor.tsx \
  src/components/ai-phone/OpeningHoursGrid.tsx \
  src/components/ai-phone/VoiceSelector.tsx \
  src/components/ai-phone/PhoneNumberDisplay.tsx \
  src/components/ai-phone/PhoneSettingsForm.tsx \
  src/components/ai-phone/KnowledgeBaseEditor.tsx \
  docs/plans/
```

**Step 2: Commit**

```bash
git commit -m "feat: add AI Phone — voice AI receptionist with Retell AI + Twilio UK numbers

Complete add-on with provisioning, call logging, dashboard, onboarding wizard,
knowledge base management, and GDPR compliance. Powered by Retell AI (telephony),
Claude (LLM), and ElevenLabs Flash v2.5 (voice synthesis)."
```

**Step 3: Push**

```bash
git push
```

---

## Execution Order Summary

| # | Task | Type | Depends On |
|---|------|------|-----------|
| 1 | Database migration | Supabase MCP | — |
| 2 | Store API secrets | CLI | — |
| 3 | Edge: retell-provision | Deploy | 1, 2 |
| 4 | Edge: retell-webhook | Deploy | 1, 2 |
| 5 | Edge: retell-update-agent | Deploy | 1, 2 |
| 6 | Edge: retell-call-stats | Deploy | 1 |
| 7 | Edge: delete-caller-data | Deploy | 1 |
| 8 | TypeScript types | Code | — |
| 9 | React hooks | Code | 8 |
| 10 | Sidebar nav update | Code | — |
| 11 | AI Phone page + route | Code | 9, 10 |
| 12 | Dashboard components | Code | 9 |
| 13 | Onboarding wizard | Code | 9 |
| 14 | Settings form | Code | 9 |
| 15 | Knowledge Base editor | Code | 9 |
| 16 | n8n post-call workflow | n8n MCP | 4 |
| 17 | n8n GDPR workflow | n8n MCP | 1 |
| 18 | Build + visual verify | Test | 8-15 |
| 19 | Commit + push | Git | 18 |

**Parallelisable groups:**
- Tasks 1+2 (independent infra setup)
- Tasks 3-7 (all edge functions, after 1+2)
- Tasks 8-10 (frontend foundation, independent of edge functions)
- Tasks 11-15 (frontend components, after 8-10)
- Tasks 16-17 (n8n workflows, after edge functions)
