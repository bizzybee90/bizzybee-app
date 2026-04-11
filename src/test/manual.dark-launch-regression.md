# Dark-Launch Entitlements Manual Regression

## Personas

- connect
- starter
- growth
- pro
- starter + ai_phone
- starter + sms_ai
- connect + sms_routing

## Route Matrix

- `/`
- `/onboarding`
- `/settings`
- `/knowledge-base`
- `/analytics`
- `/ai-phone`
- channel management surfaces in settings

## What to Verify

- route visibility in sidebar matches plan and add-on state
- locked modules render clear copy and upgrade path
- setup-locked modules route to onboarding when workspace is missing
- entitlement-unavailable state remains non-blocking during dark launch
- channel management shows routing-only copy when AI automation is not included
- AI Phone route is available only with AI Phone add-on when entitlements are present

## Known QA Seams Requiring Production Contracts

- no explicit frontend `rolloutMode`/`wouldBlock` signal is exposed yet; tests infer shadow behavior from `entitlements === null`
- route guards are component-level only right now; no single route-level entitlement contract in `ProtectedRoute`
- backend guard contract tests are pending until shared guard helpers and structured responses are merged
