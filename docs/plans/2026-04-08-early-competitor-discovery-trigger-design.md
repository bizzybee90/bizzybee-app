# Early Competitor Discovery Trigger — Design

**Date:** 2026-04-08
**Status:** Approved
**Author:** Michael + Claude

## Problem

Today, competitor discovery only fires at the **ProgressScreen** step — the second-to-last step of onboarding (welcome → business → knowledge → search_terms → email → channels → **progress** → complete).

This means a user who has just configured search terms must wait through the entire onboarding sequence (email + channels) before discovery even starts, then wait an additional 3-5 minutes for the n8n workflow to complete. The discovery is sequential to the user's UX work instead of running in parallel.

## Goal

Trigger the competitor discovery workflow **immediately** when the user clicks Continue on the Configure Competitor Search step. The discovery runs in the background while the user proceeds through email and channels setup, so by the time they reach the ProgressScreen the discovery is either complete or near-complete.

## Non-goals

- Changing the n8n workflow itself
- Changing the ProgressScreen UI
- Restructuring the onboarding step order
- Adding idempotency tracking beyond what already exists

## Architecture

**Files touched:** 1

- `src/components/onboarding/SearchTermsStep.tsx`

**Files unchanged but relied on:**

- `src/components/onboarding/ProgressScreen.tsx` — keeps its existing safety-net trigger
- `supabase/functions/trigger-n8n-workflow/index.ts` — already handles the `competitor_discovery` workflow type

The change is a single addition inside `SearchTermsStep.handleSave()`:

```
[existing] upsert search terms config to n8n_workflow_progress
       ↓
[NEW]    fire-and-forget invoke('trigger-n8n-workflow', { workflow_type: 'competitor_discovery' })
       ↓
[existing] toast success
[existing] onNext()
```

## Implementation detail

After the existing successful upsert and before `onNext()` is called, add ~6 lines:

```ts
supabase.functions
  .invoke('trigger-n8n-workflow', {
    body: { workspace_id: workspaceId, workflow_type: 'competitor_discovery' },
  })
  .catch((err) => console.error('competitor_discovery trigger failed:', err));
```

Notes:

- **Fire-and-forget**: no `await`. The user is not blocked by the trigger latency.
- **Silent failure**: `.catch()` logs to console only. ProgressScreen's existing trigger acts as a safety net.
- **No idempotency check needed**: the existing trigger-n8n-workflow edge function creates a new `competitor_research_jobs` row each call. Re-clicking Continue is treated as the user's intent to re-run discovery, which is acceptable.

## Data flow

1. User enables search terms → clicks Continue
2. `handleSave()` upserts `search_terms_config` to `n8n_workflow_progress`
3. `handleSave()` fires `trigger-n8n-workflow` (no await)
4. Edge function reads search terms from `n8n_workflow_progress`, creates a `competitor_research_jobs` row, POSTs to the n8n webhook
5. `handleSave()` toasts success and calls `onNext()` → user lands on email step
6. n8n's Discovery Agent runs in parallel with the user's email + channels setup
7. ~3-5 minutes later, n8n callback writes competitors to `competitor_sites` and sets `competitor_discovery` status to `complete`
8. User reaches ProgressScreen — sees discovery is already complete (or near-complete) and skips its safety-net trigger

## Error handling

| Failure mode                          | Behaviour                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `trigger-n8n-workflow` returns 5xx    | Caught by `.catch()`, logged to console, user proceeds                                                |
| Network error to edge function        | Same as above                                                                                         |
| n8n webhook itself fails              | The edge function would have already returned 500 and been caught above                               |
| User goes back and re-clicks Continue | Edge function creates a fresh `competitor_research_jobs` row. Acceptable — extra rows aren't harmful. |
| `n8n_workflow_progress` upsert fails  | Existing behaviour: toast error, do not advance. The new trigger code never runs.                     |

## Safety net

`ProgressScreen.tsx` has an existing `autoTrigger` effect (lines 430-497) that checks:

```ts
if (!discoveryRecord || discoveryRecord.status === 'pending') {
  // trigger competitor_discovery
}
```

This means if the SearchTermsStep trigger somehow failed silently (network blip, edge function down), the ProgressScreen will still kick off the discovery as a fallback. No code changes needed there.

## Testing

Manual verification:

1. Clear `n8n_workflow_progress`, `competitor_research_jobs`, and `competitor_sites` for the test workspace
2. Navigate to Configure Competitor Search step
3. Enable search terms and click Continue
4. Within ~2 seconds, verify a new row appears in `competitor_research_jobs`
5. Verify n8n Executions tab shows the BizzyBee Competitor Discovery workflow running
6. Continue through email + channels steps (skip if needed)
7. Verify ProgressScreen does NOT trigger discovery again (the in-progress/complete check should prevent it)
8. Verify competitors appear in `competitor_sites` within ~5 minutes

## Trade-offs considered

- **Approach A (chosen)**: Trigger inside `SearchTermsStep.handleSave()`. Smallest change, logical cohesion with the data being saved.
- **Approach B**: Trigger inside `OnboardingWizard.handleNext()` on `search_terms → email` transition. Cleaner SoC but spreads logic away from where the data lives.
- **Approach C**: Extract a `useTriggerCompetitorDiscovery` hook. Premature abstraction with a single caller.

Approach A wins on simplicity and cohesion; the minor SoC concern (a save handler with a side effect) is outweighed by the fact that the side effect _depends on the data being saved_.
