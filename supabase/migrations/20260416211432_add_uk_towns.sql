-- uk_towns: static reference table for competitor-discovery radius expansion.
-- See docs/plans/2026-04-16-competitor-discovery-radius-expansion-design.md
-- and the companion implementation plan for context.
--
-- Schema deviation from the plan: no `population` or `county` columns —
-- the upstream dataset (joelacus/world-cities GB subset) doesn't carry
-- them and neither was load-bearing for the feature (population was a
-- tiebreak that never fired; county was documentation-only).
--
-- Seeded separately via the companion migration that loads from
-- supabase/migrations/seeds/uk_towns_seed.csv. Read-only to authenticated
-- users; admin-seeded only.

create table public.uk_towns (
  id serial primary key,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  canonical_slug text unique not null,
  created_at timestamptz not null default now()
);

comment on table public.uk_towns is
  'Static UK towns/cities for competitor-discovery radius expansion. '
  'Sourced from joelacus/world-cities (GB subset, population >= 5000) '
  'plus a manual Houghton Regis row. See '
  'docs/plans/2026-04-16-competitor-discovery-radius-expansion-design.md';
comment on column public.uk_towns.canonical_slug is
  'Lowercase hyphenated slug for fuzzy user-input matching (e.g. "st-albans").';

create index uk_towns_canonical_slug_idx on public.uk_towns (canonical_slug);
create index uk_towns_latlng_idx on public.uk_towns (latitude, longitude);

alter table public.uk_towns enable row level security;
create policy "uk_towns_readable"
  on public.uk_towns
  for select
  to authenticated
  using (true);
-- No insert/update/delete policies: seeded via migration only.
