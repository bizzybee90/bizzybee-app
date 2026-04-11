# GDPR Portal Identity-Binding Hardening (2026-04-11)

## Scope

- `supabase/functions/gdpr-portal-request/index.ts`
- `supabase/functions/gdpr-portal-verify/index.ts`

## What Was Hardened

- Replaced global `customers.email -> maybeSingle()` identity resolution with deterministic candidate handling.
- Added explicit token binding metadata (`token_version`, `customer_id`, `workspace_id`, `binding_state`, `binding_candidates`) in signed GDPR tokens.
- Enforced verify-time identity checks against token-bound identifiers first (`customer_id` + `email` + optional `workspace_id`).
- Blocked ambiguous duplicate-email verification for multi-tenant/global matches (returns `409` instead of guessing a tenant/customer).
- Added scoped fallback behavior for v2 tokens with workspace binding but no customer binding.
- Kept legacy token compatibility path, but still rejects ambiguous matches.

## Security Outcome

- Eliminates silent cross-workspace customer selection for duplicate emails.
- Prevents verification endpoint from performing unsafe global email lookups for v2 ambiguous tokens.
- Makes token claims the canonical source for GDPR request identity context.

## Residual Risks / Follow-Ups

- Export path still invokes `export-customer-data` using email identifier only; consider passing and enforcing `customer_id` + `workspace_id` end-to-end.
- No single-use token replay protection yet; add server-side nonce/jti tracking for one-time verification links.
- If duplicate customer rows exist within one workspace for the same email, verify now fails closed (`409`) and requires support cleanup.
