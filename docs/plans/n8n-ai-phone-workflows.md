# n8n AI Phone Workflows — Setup Guide

Create these 2 workflows in n8n at https://bizzybee.app.n8n.cloud

---

## Workflow 1: BizzyBee AI Phone — Post-Call Processing

**Trigger:** Webhook (POST)
**Path:** `ai-phone-post-call`
**Production URL:** `https://bizzybee.app.n8n.cloud/webhook/ai-phone-post-call`

### Flow

```
Webhook → Switch (Route by Outcome) → Format Notification (per branch)
```

### Nodes

**1. Webhook** (trigger)
- Method: POST
- Path: `ai-phone-post-call`
- Response: Respond immediately

**2. Switch — "Route by Outcome"**
- Mode: Rules
- Rule 1: `{{ $json.body.outcome }}` equals `booking_made` → Output "Booking"
- Rule 2: `{{ $json.body.outcome }}` equals `message_taken` → Output "Message"
- Rule 3: `{{ $json.body.requires_followup }}` equals `true` → Output "Followup"
- Rule 4: `{{ $json.body.outcome }}` equals `transferred` → Output "Transfer"
- Fallback: "Other" (no action)

**3a. Set — "Format Booking"** (from Booking output)
- subject: `New Booking via AI Phone`
- caller_name: `{{ $('Webhook').first().json.body.caller_name || 'Unknown' }}`
- caller_phone: `{{ $('Webhook').first().json.body.caller_phone || 'N/A' }}`
- summary: `{{ $('Webhook').first().json.body.summary || '-' }}`
- workspace_id: `{{ $('Webhook').first().json.body.workspace_id }}`

**3b. Set — "Format Message"** (from Message output)
- Same fields, subject: `Message Taken via AI Phone`

**3c. Set — "Format Followup"** (from Followup output)
- Same fields, subject: `FOLLOWUP NEEDED — AI Phone`
- priority: `high`
- sentiment: `{{ $('Webhook').first().json.body.sentiment || '?' }}`

**3d. Set — "Log Transfer"** (from Transfer output)
- subject: `Call Transferred`
- Same caller fields

**3e. No Op — "No Action"** (fallback, resolved calls)

### Webhook Payload (sent by retell-webhook edge function)

```json
{
  "workspace_id": "uuid",
  "config_id": "uuid",
  "retell_call_id": "call_xxx",
  "caller_name": "John Smith",
  "caller_phone": "+447700900000",
  "duration_seconds": 120,
  "summary": "Customer called about booking a window clean...",
  "sentiment": "positive",
  "outcome": "booking_made",
  "requires_followup": false,
  "outcome_details": { "booking_date": "2026-04-10" }
}
```

### After Setup
1. Publish the workflow (make it active)
2. Copy the production webhook URL
3. The retell-webhook edge function will POST to this URL after each call_ended event

---

## Workflow 2: BizzyBee AI Phone — GDPR Auto-Delete

**Trigger:** Schedule (daily at 02:00 UTC)

### Flow

```
Schedule → Supabase: Get Configs → Code: Calculate Cutoff → Supabase: Delete Old Logs → Set: Log Result
```

### Nodes

**1. Schedule Trigger**
- Interval: Days
- Days Interval: 1
- Trigger at Hour: 2
- Trigger at Minute: 0

**2. Supabase — "Get All Configs"**
- Operation: Get Many
- Table: `ai_phone_configs`
- Return All: true
- Filter: none (get all configs to check retention per workspace)

**3. Code — "Calculate Cutoff Dates"**
- Mode: Run Once for All Items
```javascript
const configs = $input.all();
const results = [];

for (const config of configs) {
  const retentionDays = config.json.data_retention_days || 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  results.push({
    json: {
      workspace_id: config.json.workspace_id,
      config_id: config.json.id,
      data_retention_days: retentionDays,
      cutoff_date: cutoffDate.toISOString(),
      cutoff_date_formatted: cutoffDate.toISOString().split('T')[0]
    }
  });
}

return results;
```

**4. Supabase — "Delete Old Call Logs"**
- Operation: Delete
- Table: `ai_phone_call_logs`
- Filter:
  - `config_id` equals `{{ $json.config_id }}`
  - `created_at` less than `{{ $json.cutoff_date }}`

**5. Set — "Log Deletion"**
- deleted_for_workspace: `{{ $json.workspace_id }}`
- cutoff_date: `{{ $json.cutoff_date_formatted }}`
- retention_days: `{{ $json.data_retention_days }}`

### After Setup
1. Publish the workflow (make it active)
2. It will run automatically every day at 02:00 UTC
3. Each workspace's call logs older than their configured retention period will be deleted

---

## Notes

- Both workflows use the existing Supabase credentials already configured in n8n
- The Post-Call Processing webhook URL needs to be added to the `retell-webhook` edge function's fire-and-forget call (already wired up but the n8n URL needs to be set)
- The GDPR workflow uses service-role access to query across all workspaces
