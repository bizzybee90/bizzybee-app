# Early Competitor Discovery Trigger Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move competitor discovery trigger from ProgressScreen (step 6) to SearchTermsStep (step 4), so the n8n workflow runs in the background while the user continues onboarding.

**Architecture:** Add a fire-and-forget `supabase.functions.invoke('trigger-n8n-workflow', ...)` call inside `SearchTermsStep.handleSave()` after the existing `n8n_workflow_progress` upsert succeeds and before `onNext()`. ProgressScreen's existing trigger logic stays in place as a safety net (it won't double-fire because it checks `if status is pending or no record exists`).

**Tech Stack:** React + TypeScript, Vitest + React Testing Library, Supabase JS client.

**Design doc:** `docs/plans/2026-04-08-early-competitor-discovery-trigger-design.md`

---

## Task 1: Write the failing test

**Files:**

- Create: `src/components/onboarding/__tests__/SearchTermsStep.test.tsx`

**Step 1.1: Create the test file**

Create `src/components/onboarding/__tests__/SearchTermsStep.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchTermsStep } from '../SearchTermsStep';

// Mock Supabase client
const mockUpsert = vi.fn();
const mockMaybeSingle = vi.fn();
const mockInvoke = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
      upsert: mockUpsert,
    }),
    functions: {
      invoke: mockInvoke,
    },
  },
}));

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock preview mode helper
vi.mock('@/lib/previewMode', () => ({
  isPreviewModeEnabled: () => false,
}));

describe('SearchTermsStep — early competitor discovery trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: business context loaded successfully
    mockMaybeSingle.mockResolvedValue({
      data: {
        company_name: 'Test Co',
        business_type: 'window_cleaning',
        service_area: 'Luton',
        website_url: 'https://example.com',
      },
      error: null,
    });
    // Default: upsert succeeds
    mockUpsert.mockResolvedValue({ error: null });
    // Default: trigger invoke succeeds
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });
  });

  it('fires competitor_discovery trigger after successful save', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onBack = vi.fn();

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={onNext} onBack={onBack} />);

    // Wait for business context to load and search terms to populate
    await waitFor(() => {
      expect(screen.getByText(/Configure/i)).toBeInTheDocument();
    });

    // Click Continue button
    const continueButton = await screen.findByRole('button', { name: /continue/i });
    await user.click(continueButton);

    // Verify the trigger-n8n-workflow function was invoked with the right body
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('trigger-n8n-workflow', {
        body: {
          workspace_id: 'test-workspace-id',
          workflow_type: 'competitor_discovery',
        },
      });
    });

    // onNext should still be called (user advances even before trigger resolves)
    expect(onNext).toHaveBeenCalled();
  });

  it('still advances if trigger invoke fails (silent failure)', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onBack = vi.fn();

    // Make the trigger fail
    mockInvoke.mockRejectedValue(new Error('Network error'));

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={onNext} onBack={onBack} />);

    await waitFor(() => {
      expect(screen.getByText(/Configure/i)).toBeInTheDocument();
    });

    const continueButton = await screen.findByRole('button', { name: /continue/i });
    await user.click(continueButton);

    // onNext should be called even though the trigger failed
    await waitFor(() => {
      expect(onNext).toHaveBeenCalled();
    });
  });

  it('does NOT trigger competitor_discovery if upsert fails', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onBack = vi.fn();

    // Make the upsert fail
    mockUpsert.mockResolvedValue({ error: new Error('DB error') });

    render(<SearchTermsStep workspaceId="test-workspace-id" onNext={onNext} onBack={onBack} />);

    await waitFor(() => {
      expect(screen.getByText(/Configure/i)).toBeInTheDocument();
    });

    const continueButton = await screen.findByRole('button', { name: /continue/i });
    await user.click(continueButton);

    // Wait a tick for promises to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Trigger should NOT have been called because upsert failed
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });
});
```

**Step 1.2: Run the test to verify it fails**

Run:

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && npx vitest run src/components/onboarding/__tests__/SearchTermsStep.test.tsx
```

Expected: First test (`fires competitor_discovery trigger after successful save`) should FAIL because the trigger is not yet called from `SearchTermsStep.handleSave()`. The third test (does NOT trigger if upsert fails) should PASS already since no trigger code exists yet.

If the tests fail to even run (import errors, mock setup issues, missing button text), fix those before moving on. The test file must be runnable and produce a clear "trigger not called" failure on the first test.

**Step 1.3: Commit the failing test**

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app
git add src/components/onboarding/__tests__/SearchTermsStep.test.tsx
git commit -m "test: add failing tests for early competitor discovery trigger"
```

---

## Task 2: Implement the trigger

**Files:**

- Modify: `src/components/onboarding/SearchTermsStep.tsx` (around line 162-165, between the upsert success check and the toast/onNext)

**Step 2.1: Read the current handleSave**

Read lines 125-172 of `src/components/onboarding/SearchTermsStep.tsx` to see the exact structure of `handleSave()` before modifying it.

**Step 2.2: Add the trigger call**

In `SearchTermsStep.tsx`, find this block (around line 162):

```ts
if (error) throw error;

toast.success('Search terms saved');
onNext();
```

Replace it with:

```ts
if (error) throw error;

// Fire-and-forget: kick off competitor discovery in the background
// so it runs in parallel with the user's email + channels setup.
// Errors are silently logged; ProgressScreen has a safety-net retry.
// See: docs/plans/2026-04-08-early-competitor-discovery-trigger-design.md
supabase.functions
  .invoke('trigger-n8n-workflow', {
    body: { workspace_id: workspaceId, workflow_type: 'competitor_discovery' },
  })
  .catch((err) => console.error('competitor_discovery trigger failed:', err));

toast.success('Search terms saved');
onNext();
```

**Step 2.3: Run the test to verify it now passes**

Run:

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && npx vitest run src/components/onboarding/__tests__/SearchTermsStep.test.tsx
```

Expected: All 3 tests PASS.

If a test still fails, do NOT add more code. Re-read the test expectations and adjust the implementation minimally to match.

**Step 2.4: Run the wider test suite to check nothing else broke**

Run:

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && npx vitest run
```

Expected: All previously passing tests still pass. No regressions.

**Step 2.5: Type-check**

Run:

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && npx tsc --noEmit
```

Expected: No type errors related to the change. (The codebase may have pre-existing type warnings — only worry about new ones from this file.)

**Step 2.6: Commit the implementation**

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app
git add src/components/onboarding/SearchTermsStep.tsx
git commit -m "feat: trigger competitor discovery early from search terms step

Move the competitor_discovery workflow trigger from ProgressScreen
(step 6) to SearchTermsStep (step 4). The trigger now fires
fire-and-forget when the user clicks Continue on Configure
Competitor Search, so the n8n workflow runs in the background
while the user completes email and channels setup.

ProgressScreen's existing trigger logic remains as a safety net
(it checks for in-progress/complete records before firing).

See docs/plans/2026-04-08-early-competitor-discovery-trigger-design.md"
```

---

## Task 3: Build and deploy

**Step 3.1: Run the production build**

Run:

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx vite build
```

Expected: Build completes with `✓ built in Xs`. No errors.

**Step 3.2: Push to GitHub (triggers Cloudflare Pages auto-deploy)**

Run:

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && git push origin main
```

Expected: Push succeeds. Cloudflare Pages picks up the commit and starts a build.

**Step 3.3: Optional — manually deploy to Cloudflare Pages for instant verification**

If the user wants to skip waiting for Cloudflare Pages auto-build:

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app && PATH="/usr/local/bin:$PATH" /usr/local/bin/node /usr/local/bin/npx wrangler pages deploy dist/ --project-name=bizzybee-app --commit-dirty=true
```

Expected: `✨ Deployment complete!` with a preview URL.

---

## Task 4: Manual end-to-end verification

**Step 4.1: Reset test workspace state**

Run via Supabase MCP:

```sql
-- Clear progress + research jobs + competitors for the test workspace
DELETE FROM competitor_sites WHERE workspace_id = 'acdf92d1-9da7-4c71-8216-04d476d31bb0';
DELETE FROM competitor_research_jobs WHERE workspace_id = 'acdf92d1-9da7-4c71-8216-04d476d31bb0';
DELETE FROM n8n_workflow_progress
  WHERE workspace_id = 'acdf92d1-9da7-4c71-8216-04d476d31bb0'
  AND workflow_type IN ('competitor_discovery', 'competitor_scrape');
```

**Step 4.2: Have user trigger the flow in the app**

Ask the user to:

1. Hard-refresh `bizzybee-app.pages.dev` (Cmd+Shift+R)
2. Navigate back to the Configure Competitor Search step
3. Confirm search terms are populated
4. Click Continue
5. Confirm they land on the email step

**Step 4.3: Verify the trigger fired**

Within 10 seconds of the user clicking Continue, query:

```sql
SELECT id, status, niche_query, created_at
FROM competitor_research_jobs
WHERE workspace_id = 'acdf92d1-9da7-4c71-8216-04d476d31bb0'
ORDER BY created_at DESC
LIMIT 1;
```

Expected: One new row with `status = 'discovering'`, created within the last few seconds.

Also check Supabase edge function logs for a recent `POST 200 /trigger-n8n-workflow` call.

**Step 4.4: Verify discovery completes successfully**

Wait 3-5 minutes, then check:

```sql
SELECT COUNT(*) AS competitors_saved FROM competitor_sites
WHERE workspace_id = 'acdf92d1-9da7-4c71-8216-04d476d31bb0';

SELECT status, details FROM n8n_workflow_progress
WHERE workspace_id = 'acdf92d1-9da7-4c71-8216-04d476d31bb0'
  AND workflow_type = 'competitor_discovery';
```

Expected:

- `competitors_saved` > 0 (ideally close to 15)
- `n8n_workflow_progress.status` = `'complete'`
- `details.competitors_found` matches the saved count

**Step 4.5: Verify ProgressScreen does not double-trigger**

Have the user continue through email and channels and reach ProgressScreen. Check that:

```sql
SELECT COUNT(*) FROM competitor_research_jobs
WHERE workspace_id = 'acdf92d1-9da7-4c71-8216-04d476d31bb0';
```

Expected: still 1 row (not 2). The ProgressScreen safety-net check should see the discovery is already in-progress or complete and skip its trigger.

If a second row appears, debug ProgressScreen's `autoTrigger` logic — its check for `discoveryRecord.status === 'pending'` may be too narrow.

---

## Task 5: Wrap up

**Step 5.1: Update the design doc with results**

Append to `docs/plans/2026-04-08-early-competitor-discovery-trigger-design.md`:

```markdown
---

## Implementation Notes

**Status:** Implemented and verified end-to-end on YYYY-MM-DD

- Test file: `src/components/onboarding/__tests__/SearchTermsStep.test.tsx` (3 tests)
- Implementation: `src/components/onboarding/SearchTermsStep.tsx` lines 164-170
- Verified: trigger fires within 1-2s of Continue click, discovery completes in N minutes, no double-trigger from ProgressScreen
```

**Step 5.2: Commit the doc update**

```bash
cd /Users/michaelcarbon/bizzybee-workspace/bizzybee-app
git add docs/plans/2026-04-08-early-competitor-discovery-trigger-design.md
git commit -m "docs: mark early competitor discovery trigger as implemented"
git push origin main
```

---

## Done criteria

- [x] Failing test written and committed
- [x] Implementation passes the new tests
- [x] Wider test suite still passes
- [x] Build succeeds
- [x] Deployed to Cloudflare Pages
- [x] Manual E2E confirms: trigger fires within seconds, competitors save, ProgressScreen does not double-trigger
- [x] Design doc updated with implementation notes
