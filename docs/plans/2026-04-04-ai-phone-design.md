# AI Phone Design Document

**Date:** 2026-04-04
**Status:** Approved
**Author:** Claude + Michael

---

## Overview

AI Phone is a voice AI receptionist add-on for BizzyBee, powered by Retell AI (telephony + orchestration), Claude (LLM brain), and ElevenLabs Flash v2.5 (voice synthesis via Retell). It lets BizzyBee customers give their end-customers a phone number answered 24/7 by an AI that sounds human, answers questions, books appointments, takes messages, and hands off to humans when needed.

## Architecture

```
Caller -> Retell (telephony + STT) -> Retell LLM (Claude) -> ElevenLabs TTS (via Retell) -> Caller
                  |                                |
            Retell Webhooks                  Retell Custom Functions (future)
                  |                                |
         Supabase Edge Function             n8n Post-Call Workflows
                  |
          ai_phone_call_logs table
                  |
         BizzyBee Dashboard (Supabase Realtime)
```

## Key Adaptations from Spec

### workspace_id (not organization_id)
All tables use `workspace_id` referencing `workspaces(id)`, matching the existing BizzyBee multi-tenant model.

### UK Phone Numbers via BYOC
Retell's `create-phone-number` only supports US/CA. For UK numbers:
- **Phase 1:** Import existing number via `import-phone-number` API (user provides SIP trunk details)
- **Phase 2:** Automated Twilio number purchase + SIP trunk provisioning within the wizard

### Response Engine
Using `retell-llm` type — create a Retell LLM resource with our dynamic system prompt. Retell manages the Claude integration internally. This avoids needing a custom LLM websocket server.

### Frontend Structure
- Single `/ai-phone` route with tab navigation (Dashboard / Setup / Knowledge Base)
- Uses `ThreeColumnLayout` + `Sidebar` (new Phone icon in sidebar nav)
- React Query for data, Supabase Realtime for live call updates

## Database Schema

### ai_phone_configs
One per workspace. Stores Retell agent ID, phone number, business config, voice selection.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| workspace_id | UUID FK -> workspaces | Unique constraint |
| retell_agent_id | TEXT | After provisioning |
| retell_llm_id | TEXT | Retell LLM resource ID |
| retell_phone_number | TEXT | E.164 format |
| retell_phone_number_id | TEXT | Retell resource ID |
| phone_provider | TEXT | 'retell' or 'twilio_sip' |
| twilio_sip_uri | TEXT | For BYOC imports |
| business_name | TEXT NOT NULL | |
| business_description | TEXT | |
| services | JSONB | Array of service objects |
| opening_hours | JSONB | 7-day schedule |
| booking_rules | JSONB | Booking config |
| custom_instructions | TEXT | Free-text rules |
| greeting_message | TEXT | Default provided |
| voice_id | TEXT | ElevenLabs voice ID |
| voice_name | TEXT | Display name |
| max_call_duration_seconds | INT | Default 300 |
| transfer_number | TEXT | Human fallback |
| is_active | BOOLEAN | Default false |
| data_retention_days | INT | Default 30 (GDPR) |
| created_at / updated_at | TIMESTAMPTZ | |

### ai_phone_knowledge_base
FAQ/knowledge entries linked to a config.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| config_id | UUID FK -> ai_phone_configs | CASCADE delete |
| title | TEXT NOT NULL | |
| content | TEXT NOT NULL | |
| category | TEXT | faq/pricing/services/policies/general |
| is_active | BOOLEAN | Default true |
| created_at / updated_at | TIMESTAMPTZ | |

### ai_phone_call_logs
Every call with transcript, analysis, outcome.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| workspace_id | UUID FK -> workspaces | |
| config_id | UUID FK -> ai_phone_configs | |
| retell_call_id | TEXT UNIQUE NOT NULL | |
| direction | TEXT | inbound/outbound |
| caller_number | TEXT | |
| called_number | TEXT | |
| status | TEXT | in_progress/completed/transferred/error/voicemail |
| start_time | TIMESTAMPTZ NOT NULL | |
| end_time | TIMESTAMPTZ | |
| duration_seconds | INT | |
| transcript | TEXT | Plain text |
| transcript_object | JSONB | Structured from Retell |
| summary | TEXT | AI-generated |
| sentiment | TEXT | positive/neutral/negative |
| outcome | TEXT | resolved/booking_made/message_taken/transferred/abandoned/error |
| outcome_details | JSONB | |
| cost_cents | INT | For billing |
| requires_followup | BOOLEAN | |
| followup_notes | TEXT | |
| call_analysis | JSONB | Full Retell analysis |
| disconnection_reason | TEXT | |
| created_at | TIMESTAMPTZ | |

### ai_phone_usage
Monthly aggregates for billing.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| workspace_id | UUID FK -> workspaces | |
| month | DATE | First of month |
| total_calls | INT | |
| total_minutes | DECIMAL(10,2) | |
| total_cost_cents | INT | |
| included_minutes | INT | From plan |
| overage_minutes | DECIMAL(10,2) | |
| overage_cost_cents | INT | |
| UNIQUE(workspace_id, month) | | |

## Edge Functions

### retell-webhook
- Receives call_started, call_ended, call_analyzed events
- Verifies Retell API key in header
- Writes/updates ai_phone_call_logs
- Triggers n8n post-call workflow async
- Updates ai_phone_usage monthly counters
- Must respond < 5 seconds

### retell-provision
- Creates Retell LLM with dynamic system prompt
- Creates Retell Agent with voice + LLM config
- Phase 1: Imports phone number via SIP (user provides details)
- Phase 2: Purchases Twilio UK number, creates SIP trunk, imports to Retell
- Stores all IDs in ai_phone_configs

### retell-update-agent
- Rebuilds system prompt from updated config
- Updates Retell LLM and Agent via API
- Called when user saves config changes

### retell-call-stats
- Aggregates stats for dashboard
- Returns: calls today, this week, avg duration, resolution rate, minutes used/remaining

### delete-caller-data
- GDPR right-to-erasure
- Accepts phone number, deletes all matching call logs

## System Prompt Construction

```
You are {business_name}'s AI phone receptionist. You answer calls professionally, warmly, and concisely.

ABOUT THE BUSINESS:
{business_description}

SERVICES OFFERED:
{formatted services with prices}

OPENING HOURS:
{formatted 7-day schedule}

KNOWLEDGE BASE:
{all active KB entries}

BOOKING RULES:
{booking_rules config}

RULES:
- Keep responses to 1-3 sentences. You are on a phone call, not writing an essay.
- Always ask for the caller's name early in the conversation.
- If asked about pricing, give the ranges provided. Never make up prices.
- If unsure, say "I can take a message and have someone get back to you."
- {custom_instructions}
- Current date/time: {injected at call time}
- This call may be recorded for quality purposes.
```

## Frontend Components

### Sidebar
Add Phone icon to nav, positioned after Inbox.

### AI Phone Page (/ai-phone)
Three tabs:
1. **Dashboard** — Stats bar (4 cards) + call log table with expandable transcript rows
2. **Setup** — Onboarding wizard (if no config) or editable settings accordion
3. **Knowledge Base** — CRUD for FAQ entries with categories

### Key Components
- StatsBar (4 metric cards)
- CallLogTable (filterable, expandable, real-time)
- CallTranscript (chat-bubble format)
- OnboardingWizard (6 steps)
- VoiceSelector (grid with audio preview)
- ServiceEditor (inline table editing)
- OpeningHoursGrid (7-day schedule)
- KnowledgeBaseEditor (CRUD with categories)
- PhoneNumberDisplay (large, monospace, copy button)

## n8n Workflows

### Post-Call Processing
Triggered by retell-webhook after call_ended:
- If booking_made -> create calendar event
- If message_taken -> notify BizzyBee inbox + email
- If requires_followup -> create prioritised task
- Update ai_phone_usage counters

### GDPR Auto-Delete
Daily cron at 02:00 UTC:
- Delete call logs older than config's data_retention_days
- Log deletion count for audit

## Billing
- Growth plan: 100 included minutes
- Pro plan: 500 included minutes
- Starter: Not available (upsell)
- Overage: 20p/minute
- Phone number: £5/month
- Usage tracked in ai_phone_usage, exposed via retell-call-stats

## GDPR Compliance
- Auto-delete call data after configurable retention period
- Consent disclosure in greeting message
- ElevenLabs training opt-out (account setting)
- Right-to-erasure via delete-caller-data edge function
- data_storage_setting on Retell agent set to "everything_except_pii"
