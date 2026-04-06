# BizzyBee Session Handoff — 2026-04-06

## What This Session Did

This was a marathon session covering production readiness, engineering hardening, design system, deployment, and live debugging. Here's everything in order.

---

## Phase 0: Production Readiness Audit (from handoff doc)

**Auth:**

- Removed dev auth bypass from AuthGuard — real Supabase auth only
- No more `import.meta.env.DEV` references in src/

**Security:**

- Fixed workspace isolation on ConversationView, ConversationList, ConversationCard, GDPRDashboard
- Added auth validation to 3 unprotected edge functions (classify-emails-dispatcher, convert-emails-to-conversations, trigger-n8n-workflow)
- Fixed 3 SECURITY DEFINER views with `security_invoker = true`
- Fixed 6 mutable search_path functions
- Fixed retell-call-stats column name bug (start_time → created_at)

**Data:**

- Seeded test data: 10 customers, 15 conversations, 18 messages, 5 call logs, 10 FAQs, 1 business context, 1 AI phone agent

**Styling:**

- Converted 64 inline CSS variable styles to Tailwind utility classes across all pages

**Functional:**

- Added error handling to KnowledgeBase, ActivityPage, ChannelsDashboard
- Fixed dead edit button in KnowledgeBase
- Fixed duplicate FAQ grouping logic

---

## Phase 1-7: Engineering Hardening

### Phase 1: Foundation

- Installed vitest + @testing-library/react (18 tests passing)
- Created WorkspaceContext provider — workspace fetched once, shared via Context (was 37 components each making 2 API calls)
- Lazy-loaded all 24 routes (bundle 2,220KB → ~320KB initial)
- Added GitHub Actions CI: lint → typecheck → test → build → audit

### Phase 2: Type Safety

- Created structured logger (src/lib/logger.ts), migrated 130+ console statements
- Added pre-commit hooks (husky + lint-staged + prettier)
- Removed 55 `as any` casts across 25 files
- Enabled TypeScript strict mode (zero errors)

### Phase 3: Data Access Layer

- Created src/lib/api/ with 6 domain modules: conversations, customers, messages, knowledge-base, call-logs, workspace
- Barrel export at src/lib/api/index.ts

### Phase 4: Testing

- 18 tests across 9 files, all passing
- API layer tests, smoke tests, Supabase mock factory
- renderWithProviders test helper

### Phase 5: Edge Function Hardening

- Standardized all 51 edge functions to Deno.serve()
- Created shared modules: \_shared/validate.ts, \_shared/response.ts, \_shared/logging.ts

### Phase 6: App Store (Capacitor)

- Capacitor initialized with iOS + Android platforms
- Native capability wrapper (src/lib/native.ts): push notifications, haptics, status bar
- PWA manifest + Apple mobile web app meta tags

### Phase 7: Observability

- Sentry integration (src/lib/sentry.ts)
- RouteErrorBoundary for per-route error isolation
- Vendor chunk splitting (react, query, supabase vendors)

---

## Design System: BizzyBee Visual Language

**Created:**

- `src/styles/tokens.css` — all bb-\* CSS custom properties (espresso, gold, linen, cream, warm grays)
- `tailwind.config.ts` — extended with bb-\* colour tokens
- `src/lib/theme.ts` — JS constants for non-CSS contexts

**14 Design System Components:**

- AppSidebar, PageShell, StatCard, BBBadge, BBToggle, BBButton, BBInput
- ConversationRow, RuleRow, SuggestionCard
- Barrel export at src/components/ui/bb-index.ts

**App Shell Themed:**

- Sidebar: espresso dark with gold active states
- ThreeColumnLayout, MobilePageLayout, PowerModeLayout: linen bg, white content, warm borders
- Mobile sidebar drawer: espresso dark

**Pages Updated:**

- Auth (fixed doubled heading), Home, Settings, AI Phone, Inbox, ConversationView, ConversationList/Card, Analytics, KnowledgeBase, Activity, Channels

**Design Rules Enforced:**

- Gold is signal only, never wallpaper
- Font-weight never exceeds 500
- Borders are 0.5px warm (bb-border)
- Text on gold buttons is always bb-espresso

---

## QA Route Sweep

Swept every route in the app. Fixed:

- `/channels` crash in preview mode → shows setup-required notice
- `/reviews` misleading "Refresh page" → shows "Finish workspace setup first"
- Home draft fetch errors in preview mode → skips fetch
- All preview mode guards added to useChannelSetup hook

---

## Onboarding Hardening

- Added IMAP/Fastmail as email provider option in EmailConnectionStep
- Extracted 150+ business types to `src/lib/constants/business-types.ts` (single source of truth)
- Preview-hardened all 6 onboarding steps (BusinessContextStep, KnowledgeBaseStep, SearchTermsStep, EmailConnectionStep, ChannelsSetupStep, ProgressScreen)
- Deleted 9 unused onboarding components (-2,955 lines): CompetitorResearchStep, CompetitorDiscovery, CompetitorMiningLoop, CompetitorScrape, AutomationLevelStep, InitialTriageStep, InboxLearningStep, VoiceLearning, SenderRecognitionStep
- Fixed exhaustive-deps warnings (14 isPreview dependency arrays)

---

## Deployment

- Deployed to Cloudflare Pages at https://bizzybee-app.pages.dev
- Added `public/_redirects` for SPA routing
- Supabase redirect URLs configured for both localhost:8080 and bizzybee-app.pages.dev

---

## Critical RLS Fix (the big one)

**Problem:** Authenticated users could not read their own row in the `users` table. The WorkspaceContext query chain failed silently, causing "Workspace not found" on every page.

**Root Cause:** Circular RLS policies.

- `users` table had a policy "Users read workspace members" that sub-queried `workspace_members`
- `workspace_members` had a policy "Users view workspace memberships" that sub-queried itself
- `workspace_members` had a policy "Owners/admins manage memberships" that called `user_is_workspace_admin()` which queried back into `workspace_members`
- This created `infinite recursion detected in policy for relation "workspace_members"`

**Also missing:** The `authenticated` role had NO SELECT grant on the `users` table. Only `anon` had INSERT/UPDATE and `postgres` had everything. RLS policies don't matter without base GRANTs.

**Fix (migration: fix_circular_rls_policies + grant_authenticated_users_access):**

1. Dropped 3 circular policies: "Users read workspace members" on users, "Users view workspace memberships" on workspace_members, "Owners/admins manage memberships" on workspace_members
2. Granted SELECT/INSERT/UPDATE on `users` to `authenticated`
3. Granted SELECT on `workspaces`, `workspace_members`, and all core data tables to `authenticated`
4. Added `workspace_members` row for the existing user (was empty)
5. Added non-circular workspace SELECT policy via workspace_members table

**Remaining safe policies:**

- users: "Users read own profile" `(id = auth.uid())` — direct, no recursion
- users: "Users update own profile" `(id = auth.uid())` — direct
- workspace_members: "Users view own memberships" `(user_id = auth.uid())` — direct
- workspaces: "Users can view their workspace" via users sub-query (now works because users policy is non-circular)
- workspaces: "Members can view workspace" via workspace_members sub-query

---

## Onboarding Page Simplification

**Problem:** Onboarding.tsx was 325 lines of complex auth initialization logic that duplicated what WorkspaceContext and AuthGuard already handle. It had its own auth listeners, workspace creation, safety timeouts, and error states. When minified, a variable hoisting issue caused `ReferenceError: Cannot access 'f' before initialization`.

**Fix:** Rewrote to 75 lines. Now just:

1. Calls `useWorkspace()` to get workspace from shared context
2. Shows loading spinner while workspace loads
3. Shows "Workspace not found" if no workspace (shouldn't happen normally)
4. Renders `<OnboardingWizard>` with the workspace ID

**Skip button:** Changed redirect from `/settings` to `/` (Home). Skip was crashing because Settings page had its own initialization issues when navigated to via full page reload.

---

## Current State

### What Works

- Auth (sign in, sign out, session persistence)
- Home page with stats (shows 0s because seeded data queries workspace-scoped)
- Settings page with modular layout
- Sidebar with espresso theme and gold active states
- Knowledge Base with health checks
- AI Phone with empty state
- Reviews with setup-required state
- All 18 tests passing, CI green, TypeScript strict

### What's Being Tested Right Now

- Onboarding wizard flow (user is walking through it live)
- The business context step, knowledge base step, email connection (Fastmail/IMAP)

### Known Remaining Issues

- Seeded test data shows 0 counts on Home — this is because the seeded data was inserted via service role (bypasses RLS) but the conversations table RLS policies may still need workspace_members-based policies that aren't circular
- The `user_is_workspace_admin()` function was referenced by a now-dropped policy — check if it's used elsewhere and clean up if orphaned
- Some tables may still be missing authenticated role GRANTs — any new "permission denied" errors should be fixed by granting SELECT to authenticated
- The skip onboarding → home transition was crashing (fixed by redirecting to `/` instead of `/settings`, but the underlying Settings page crash needs investigation)

### Files Changed This Session

- 220+ files in the main engineering commit
- 78 files in the hardening pass
- 34 files in the design system commit
- 15 files in onboarding hardening
- 7 files in exhaustive-deps fixes
- 4 files in RLS/onboarding simplification
- Multiple Supabase migrations applied

### Key Architectural Decisions

- WorkspaceContext is the single source of truth for workspace — no component should query users/workspaces directly
- Preview mode uses workspace ID 'preview-workspace' — all hooks/pages must detect this and skip Supabase queries
- Design system uses bb-\* CSS custom properties, not shadcn's HSL variables — both coexist
- Onboarding page is thin — just a wrapper around OnboardingWizard that gets workspace from context
- RLS policies must be non-circular — only use direct `auth.uid()` checks, never cross-table sub-queries that reference each other
