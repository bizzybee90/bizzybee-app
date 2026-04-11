# 2026-04-11 Email Import Queue Live Drift

## Scope

Investigate the live/frontend `email_import_queue` `400` only:

- identify the exact failing live query
- identify the offending select columns
- determine whether the issue is frontend drift, schema drift, or both
- recommend the safest remediation path

No code behavior was changed in this lane.

## Confirmed Live Failure

The live app at `https://bizzybee-app.pages.dev` is still issuing a Home/dashboard query against `email_import_queue` with this effective shape:

```text
select=id,from_name,from_email,subject,body,received_at,category,direction
workspace_id=eq.<workspace>
direction=eq.inbound
or=(is_noise.is.null,is_noise.eq.false)
from_email=not.ilike.%25maccleaning%25
order=received_at.desc
limit=5
```

Confirmed live REST error response:

```json
{
  "code": "42703",
  "details": null,
  "hint": null,
  "message": "column email_import_queue.category does not exist"
}
```

## Exact Frontend Source Of The Live Home 400

The currently checked-out `ActivityFeed` no longer issues that query:

- [src/components/dashboard/ActivityFeed.tsx](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/src/components/dashboard/ActivityFeed.tsx:94)

It now loads recent inbox activity from `conversations`, not `email_import_queue`.

The pre-fix version of the same file matches the deployed request shape:

- [src/components/dashboard/ActivityFeed.tsx](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/src/components/dashboard/ActivityFeed.tsx:94)
- historical pre-`f04b983` content:
  - `from('email_import_queue')`
  - `.select('id, from_name, from_email, subject, body, received_at, category, direction')`
  - `.eq('direction', 'inbound')`
  - `.or('is_noise.is.null,is_noise.eq.false')`
  - `.not('from_email', 'ilike', '%maccleaning%')`

That means the live Home 400 is frontend drift in the deployed bundle: production is still serving a build older than `f04b983`.

## Broader Queue Drift Still Present In Current Frontend

Even after the Home/dashboard fix, the current branch still contains other frontend reads/writes that assume later `email_import_queue` columns exist:

- [src/components/onboarding/report/AILearningReport.tsx](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/src/components/onboarding/report/AILearningReport.tsx:58)
  - filters on `category`
- [src/components/onboarding/report/ClassificationBreakdown.tsx](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/src/components/onboarding/report/ClassificationBreakdown.tsx:53)
  - selects `category`
- [src/components/onboarding/report/ClassificationBreakdown.tsx](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/src/components/onboarding/report/ClassificationBreakdown.tsx:99)
  - filters by `category`
- [src/hooks/useInboxEmails.tsx](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/src/hooks/useInboxEmails.tsx:283)
  - fallback thread query selects `category` and `confidence`
- [src/components/inbox/QuickActionsBar.tsx](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/src/components/inbox/QuickActionsBar.tsx:38)
  - fallback queue updates still assume the queue row is writable for legacy handling state

So this is not only a stale deployed Home query. There is still current frontend coupling to later queue columns.

## Schema Drift Confirmed Against Local Migrations

Local migrations expect `email_import_queue` to have later enrichment columns:

- [20260129142546_5f78672b-8189-4b89-906e-2d2edecf03f6.sql](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/supabase/migrations/20260129142546_5f78672b-8189-4b89-906e-2d2edecf03f6.sql:1)
  - adds `category`, `requires_reply`, `classified_at`
- [20260129163917_c8f69e60-95d2-468d-8767-4b967d3b7d56.sql](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/supabase/migrations/20260129163917_c8f69e60-95d2-468d-8767-4b967d3b7d56.sql:1)
  - adds `body_clean`
- [20260215001608_da01821d-362c-4f40-98f0-96546fbd184d.sql](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/supabase/migrations/20260215001608_da01821d-362c-4f40-98f0-96546fbd184d.sql:2)
  - adds `confidence`, `needs_review`, `entities`
- [20260220223325_e9896781-a5b5-4dc1-bae6-1c1a453834cf.sql](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/supabase/migrations/20260220223325_e9896781-a5b5-4dc1-bae6-1c1a453834cf.sql:2)
  - adds `conversation_id`, `is_read`

Direct live REST checks already confirmed the linked live schema is missing at least:

- `category`
- `confidence`
- `requires_reply`
- `classified_at`
- `needs_review`
- `entities`
- `conversation_id`
- `is_read`
- `body_clean`

This is schema drift, not just a bad select list.

## Generated Types Drift

The checked-in generated types for `email_import_queue` are also behind the local migrations:

- [src/integrations/supabase/types.ts](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/src/integrations/supabase/types.ts:3063)

The `Row`, `Insert`, and `Update` types there still only expose the earlier base columns and do not include the later enrichment fields listed above.

That creates a second-order drift problem:

- local migrations say the columns should exist
- current frontend still uses some of them
- generated types do not reflect them
- live schema also does not reflect them

## Classification

This issue is **both frontend drift and schema drift**.

1. **Frontend drift**
   - the live deployed Home/dashboard bundle is older than the local `ActivityFeed` fix and is still querying `email_import_queue.category`

2. **Schema drift**
   - the linked live database does not have the later `email_import_queue` columns that local migrations and some current frontend code still assume exist

3. **Type drift**
   - local generated Supabase types are stale relative to the local migrations

## Safest Remediation Path

1. **Stop the visible Home 400 first**
   - deploy a frontend build that includes the `ActivityFeed` change in `f04b983` or later
   - this removes the live dashboard dependency on `email_import_queue.category`

2. **Restore live schema parity for `email_import_queue`**
   - reconcile the live Supabase schema to match the local migrations that add:
     - `category`
     - `requires_reply`
     - `classified_at`
     - `body_clean`
     - `confidence`
     - `needs_review`
     - `entities`
     - `conversation_id`
     - `is_read`

3. **Regenerate Supabase types from the linked project after parity is restored**
   - current checked-in types are not authoritative for this table

4. **Only if schema repair must be delayed**
   - add a temporary frontend guard pass that removes queue selects/filters on later enrichment columns and relies on `conversations` wherever available
   - this should be treated as a temporary compatibility layer, not the real fix

## Residual Risk

Even if the Home/dashboard query is removed, the app can still hit `email_import_queue` failures in onboarding and legacy inbox fallback paths until the schema is repaired or those callers are also migrated away from queue-column assumptions.
