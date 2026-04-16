-- expand_search_queries: server-side twin of
-- supabase/functions/_shared/expandSearchQueries.ts.
-- Reproduces the radius-aware competitor-discovery query fan-out so
-- SearchTermsStep.tsx can call a single RPC instead of round-tripping
-- multiple queries against uk_towns. See
-- docs/plans/2026-04-16-competitor-discovery-radius-expansion-design.md.
--
-- Algorithm (mirrors the TS twin):
--   1. Slug primary town. Empty slug OR empty search_terms → empty result.
--   2. Strip primary-town suffix from each term (case-insensitive,
--      preceded by optional whitespace/punctuation).
--   3. Filter empty stems (users who typed just the primary town).
--   4. Primary queries = every stem + ' ' + lower(primary_town).
--   5. Resolve primary town's lat/lng via canonical_slug.
--   6. If primary resolved AND radius > 0: bounding-box prefilter uk_towns
--      (latDelta = r/69 * 1.15, lngDelta = r/(cos(lat)*69) * 1.15),
--      exclude primary slug, compute haversine (Earth radius 3959 mi),
--      keep miles <= radius, sort ascending, take max_nearby_towns.
--   7. Expanded stems = first terms_per_nearby_town stems.
--   8. Candidates = every (nearby town, expanded stem) combination with
--      (town_rank, term_rank) both ascending.
--   9. Budget = max(0, max_queries - len(primary_queries)). Keep first
--      `budget` candidates in sort order (farthest town × lowest-priority
--      term drops first).
--  10. Dedupe (primary first) preserving insertion order.
--  11. towns_used: primary first; then nearby towns that had at least one
--      query survive the trim, in original nearest-first order.

create or replace function public.expand_search_queries(
  p_search_terms text[],
  p_primary_town text,
  p_radius_miles numeric,
  p_terms_per_nearby_town integer default 3,
  p_max_queries integer default 30,
  p_max_nearby_towns integer default 6
)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  v_slug text;
  v_primary_lat double precision;
  v_primary_lng double precision;
  v_lower_town text;
  v_escaped_town text;
  v_strip_pattern text;
  v_lat_delta double precision;
  v_lng_delta double precision;
  v_stems text[];
  v_primary_queries text[];
  v_expanded_stems text[];
  v_nearby_towns text[];
  v_expanded_kept jsonb;
  v_kept_queries text[];
  v_kept_towns_lower text[];
  v_combined_queries text[];
  v_towns_used text[];
  v_budget integer;
begin
  -- 1. Slug the primary town (same rules as canonicalTownSlug in TS).
  v_slug := regexp_replace(
    regexp_replace(lower(coalesce(p_primary_town, '')), '[^a-z0-9]+', '-', 'g'),
    '(^-+|-+$)', '', 'g'
  );

  -- 2. Guard: empty slug OR empty/null input array → empty shape.
  if v_slug = '' or p_search_terms is null or coalesce(array_length(p_search_terms, 1), 0) = 0 then
    return jsonb_build_object(
      'queries', '[]'::jsonb,
      'towns_used', '[]'::jsonb,
      'primary_coverage', '[]'::jsonb,
      'expanded_coverage', '[]'::jsonb
    );
  end if;

  v_lower_town := lower(p_primary_town);

  -- 3. Build the strip pattern. Escape regex metachars in the primary
  -- town the same way the TS twin does, so hyphenated names like
  -- "Stoke-on-Trent" round-trip unchanged. The preceding class
  -- `[[:space:],.;:\-]*` absorbs trailing punctuation/whitespace.
  v_escaped_town := regexp_replace(v_lower_town, '([.\*\+\?\^\$\{\}\(\)\|\[\]\\\-])', '\\\1', 'g');
  v_strip_pattern := '[[:space:],.;:\-]*' || v_escaped_town || '$';

  -- 4. Strip → trim → filter empty, preserving input order via WITH ORDINALITY.
  with raw as (
    select term, ord
    from unnest(p_search_terms) with ordinality as t(term, ord)
  ),
  stripped as (
    select
      ord,
      btrim(regexp_replace(term, v_strip_pattern, '', 'i')) as stem
    from raw
  )
  select array_agg(stem order by ord)
    into v_stems
  from stripped
  where stem is not null and stem <> '';

  -- No non-empty stems → empty shape (towns_used is also empty per TS).
  if v_stems is null or array_length(v_stems, 1) is null then
    return jsonb_build_object(
      'queries', '[]'::jsonb,
      'towns_used', '[]'::jsonb,
      'primary_coverage', '[]'::jsonb,
      'expanded_coverage', '[]'::jsonb
    );
  end if;

  -- 5. Primary queries = stem + ' ' + lower(primary town).
  select array_agg(lower(stem || ' ' || v_lower_town) order by ord)
    into v_primary_queries
  from unnest(v_stems) with ordinality as s(stem, ord);

  -- 6. Resolve primary lat/lng (may be null if the user's primary town
  -- isn't in uk_towns — primary queries still fire but no nearby towns).
  select latitude, longitude
    into v_primary_lat, v_primary_lng
  from public.uk_towns
  where canonical_slug = v_slug
  limit 1;

  -- 7. Nearby towns (only if primary resolved AND radius > 0).
  v_nearby_towns := array[]::text[];
  if v_primary_lat is not null and p_radius_miles > 0 then
    v_lat_delta := (p_radius_miles::double precision / 69.0) * 1.15;
    v_lng_delta := (p_radius_miles::double precision / (cos(radians(v_primary_lat)) * 69.0)) * 1.15;

    with box as (
      select name, canonical_slug, latitude, longitude
      from public.uk_towns
      where canonical_slug <> v_slug
        and latitude  between v_primary_lat - v_lat_delta and v_primary_lat + v_lat_delta
        and longitude between v_primary_lng - v_lng_delta and v_primary_lng + v_lng_delta
    ),
    -- Haversine miles with Earth radius 3959 (matches TS).
    measured as (
      select
        name,
        3959.0 * 2.0 * asin(
          least(
            1.0,
            sqrt(
              power(sin(radians(latitude - v_primary_lat) / 2.0), 2)
              + cos(radians(v_primary_lat)) * cos(radians(latitude))
                * power(sin(radians(longitude - v_primary_lng) / 2.0), 2)
            )
          )
        ) as miles
      from box
    )
    select array_agg(name order by miles asc, name asc)
      into v_nearby_towns
    from (
      select name, miles
      from measured
      where miles <= p_radius_miles::double precision
      order by miles asc, name asc
      limit greatest(p_max_nearby_towns, 0)
    ) picked;

    v_nearby_towns := coalesce(v_nearby_towns, array[]::text[]);
  end if;

  -- 8. Expanded stems = first N stems (empty if no nearby towns).
  if array_length(v_nearby_towns, 1) is null then
    v_expanded_stems := array[]::text[];
  else
    select array_agg(stem order by ord)
      into v_expanded_stems
    from (
      select stem, ord
      from unnest(v_stems) with ordinality as s(stem, ord)
      order by ord
      limit greatest(p_terms_per_nearby_town, 0)
    ) picked;
    v_expanded_stems := coalesce(v_expanded_stems, array[]::text[]);
  end if;

  -- 9. Build candidates (town_rank, term_rank) then trim to budget.
  v_budget := greatest(0, p_max_queries - coalesce(array_length(v_primary_queries, 1), 0));

  with town_ranks as (
    select name, ord - 1 as town_rank
    from unnest(v_nearby_towns) with ordinality as t(name, ord)
  ),
  term_ranks as (
    select stem, ord - 1 as term_rank
    from unnest(v_expanded_stems) with ordinality as s(stem, ord)
  ),
  candidates as (
    select
      lower(term_ranks.stem || ' ' || town_ranks.name) as query,
      lower(town_ranks.name) as town_lower,
      town_ranks.name as town_name,
      town_ranks.town_rank,
      term_ranks.term_rank
    from town_ranks cross join term_ranks
  ),
  kept as (
    select query, town_lower, town_name, town_rank, term_rank
    from candidates
    order by town_rank asc, term_rank asc
    limit v_budget
  )
  select
    coalesce(array_agg(query order by town_rank asc, term_rank asc), array[]::text[]),
    coalesce(array_agg(distinct town_lower), array[]::text[])
    into v_kept_queries, v_kept_towns_lower
  from kept;

  -- 10. Dedupe combined (primary ++ kept) preserving first-seen order.
  with seq as (
    select q, kind, pos
    from (
      select q, 0 as kind, ord as pos
      from unnest(v_primary_queries) with ordinality as pq(q, ord)
      union all
      select q, 1 as kind, ord as pos
      from unnest(v_kept_queries) with ordinality as kq(q, ord)
    ) u
  ),
  ranked as (
    select distinct on (q) q, kind, pos
    from seq
    order by q, kind, pos
  )
  select array_agg(q order by kind, pos)
    into v_combined_queries
  from ranked;

  v_combined_queries := coalesce(v_combined_queries, array[]::text[]);

  -- 11. towns_used: primary first, then nearby towns whose (lowercased)
  -- name appears in at least one kept query's tail. Preserve the nearest-
  -- first order from v_nearby_towns.
  v_towns_used := array[p_primary_town]::text[];
  if array_length(v_nearby_towns, 1) is not null then
    select array_cat(v_towns_used, coalesce(array_agg(name order by ord), array[]::text[]))
      into v_towns_used
    from (
      select name, ord
      from unnest(v_nearby_towns) with ordinality as t(name, ord)
      where lower(name) = any(v_kept_towns_lower)
    ) surviving;
  end if;

  return jsonb_build_object(
    'queries', to_jsonb(v_combined_queries),
    'towns_used', to_jsonb(v_towns_used),
    'primary_coverage', to_jsonb(v_stems),
    'expanded_coverage', to_jsonb(v_expanded_stems)
  );
end;
$$;

comment on function public.expand_search_queries is
  'Radius-aware competitor-discovery query fan-out. See '
  'docs/plans/2026-04-16-competitor-discovery-radius-expansion-design.md '
  'and the pure TS twin at supabase/functions/_shared/expandSearchQueries.ts.';

grant execute on function public.expand_search_queries(text[], text, numeric, integer, integer, integer) to authenticated;
