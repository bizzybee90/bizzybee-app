-- RLS policy 20260416211432 enables row-level filtering on public.uk_towns
-- but relies on the base table privilege being present. Without this grant,
-- expand_search_queries (security invoker) fails with
-- "permission denied for table uk_towns" when called from the browser as an
-- authenticated user, which silently falls back to primary-town-only
-- queries in SearchTermsStep.
grant select on public.uk_towns to authenticated;
