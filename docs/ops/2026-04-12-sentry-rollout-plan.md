# BizzyBee Sentry Rollout Plan

## Current state

- Frontend React app reports to `bizzybee-web` via `VITE_SENTRY_DSN`.
- Frontend source maps/releases are wired through the Vite build when these environment variables are present:
  - `SENTRY_ORG`
  - `SENTRY_PROJECT`
  - `SENTRY_URL`
  - `SENTRY_AUTH_TOKEN`
  - `SENTRY_RELEASE` (optional fallback to `CF_PAGES_COMMIT_SHA` or `GITHUB_SHA`)
- Uploaded source maps are removed from `dist` after upload so Pages does not serve them publicly.

## Recommended project split

- `bizzybee-web`
  - Vite/React frontend only
  - Browser issues, route errors, release health, source maps
- `bizzybee-edge`
  - Supabase Edge Functions / webhook and queue runtime
  - Function exceptions, external provider failures, queue-worker regressions
  - Reads `SENTRY_EDGE_DSN` (and optional `SENTRY_EDGE_ENVIRONMENT`) from Edge Function env

## Why split projects

- Frontend and edge failures have different owners and different triage paths.
- Browser noise should not drown out webhook/worker incidents.
- Release/source-map workflows differ between static frontend bundles and server-side edge code.

## Backend progress

- `bizzybee-edge` now exists as the dedicated backend Sentry project.
- A shared edge helper reads `SENTRY_EDGE_DSN` and optional `SENTRY_EDGE_ENVIRONMENT`.
- First-pass instrumentation is live for:
  - `elevenlabs-webhook`
  - `twilio-sms-webhook`
  - `twilio-whatsapp-webhook`
  - `pipeline-supervisor-onboarding`
- Frontend and backend DSNs stay separate by design.

## Next backend step

1. Extend the shared helper to the next highest-value worker/webhook surfaces:
   - email import / classify workers
   - Meta inbound messaging webhooks
   - Google Business inbound webhook
2. Add one deliberate smoke-test path for edge/runtime verification in non-production.
3. Add alert routing for backend regressions and queue failures.

## Operational follow-up

- Resolve or ignore the initial frontend smoke-test issue after confirming the project is receiving events.
- Add release alerts and regression alerts in `bizzybee-web`.
- Add source-map upload secrets to the deployment environment, not to the browser env.
