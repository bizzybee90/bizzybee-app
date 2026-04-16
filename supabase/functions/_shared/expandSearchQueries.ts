/**
 * Strip a trailing primary-town suffix from a search term if present.
 * Case-insensitive. Preserves everything before the town.
 *   "window cleaning luton" + "Luton" → "window cleaning"
 *   "gutter cleaning"       + "Luton" → "gutter cleaning" (unchanged)
 *   "best window cleaning, luton" + "Luton" → "best window cleaning"
 *
 * The trimming step absorbs any trailing whitespace or punctuation
 * (commas, periods, semicolons, colons, hyphens) that sat between the
 * stem and the baked-in town name.
 */
export function stripPrimaryTownSuffix(term: string, primaryTown: string): string {
  const lowerTerm = term.toLowerCase();
  const lowerTown = primaryTown.toLowerCase();
  if (!lowerTown) return term.trim();

  // Match the town at end-of-string, optionally after punctuation/whitespace.
  // `-` is only special inside a character class, and the escaped string is
  // used in the body of the regex (never inside `[...]`) below — but escape
  // it anyway so this invariant isn't implicit. A future refactor that wraps
  // `${escaped}` in a character class (e.g. a case-folded alternation) won't
  // silently break on hyphenated town names like "Stoke-on-Trent".
  const escaped = lowerTown.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const pattern = new RegExp(`[\\s,.;:-]*${escaped}$`);
  const match = lowerTerm.match(pattern);
  if (!match) return term.trim();

  return term.slice(0, term.length - match[0].length).trim();
}

export interface ExpandSearchQueriesParams {
  searchTerms: string[]; // ordered by priority, highest first
  primaryTown: string; // resolved from service_area, e.g. "Luton"
  nearbyTowns: string[]; // pre-sorted nearest-first (from findNearbyTowns)
  termsPerNearbyTown?: number; // default 3
  maxQueries?: number; // default 30
}

export interface ExpandSearchQueriesResult {
  queries: string[];
  townsUsed: string[];
  primaryCoverage: string[]; // stems applied to primary town
  expandedCoverage: string[]; // stems applied to nearby towns (top N)
}

/**
 * Build a deterministic list of `{term} {town}` search queries for
 * radius-expanded competitor discovery.
 *
 * Allocation rules (in order of precedence):
 *   1. Strip primary-town suffix from every input term → clean stems
 *      (empty stems after stripping are filtered out).
 *   2. Primary town receives ALL stems (full coverage).
 *   3. Each nearby town receives the top `termsPerNearbyTown` stems.
 *   4. Combined list is deduped (exact match).
 *   5. If total > maxQueries, trim expanded candidates first — sorted by
 *      (townRank ascending, then termRank ascending) so that the farthest
 *      town's lowest-priority term drops out first. Primary coverage is
 *      never trimmed (the caller is expected to keep searchTerms bounded).
 *
 * All queries are emitted lowercase. `townsUsed` reports the primary first,
 * then any nearby towns for which at least one query survived trimming,
 * in their original nearest-first order.
 */
export function expandSearchQueries(params: ExpandSearchQueriesParams): ExpandSearchQueriesResult {
  const termsPerNearbyTown = params.termsPerNearbyTown ?? 3;
  const maxQueries = params.maxQueries ?? 30;

  if (params.searchTerms.length === 0) {
    return { queries: [], townsUsed: [], primaryCoverage: [], expandedCoverage: [] };
  }

  const stems = params.searchTerms
    .map((t) => stripPrimaryTownSuffix(t, params.primaryTown))
    .filter((t) => t.length > 0);

  const primaryTownLower = params.primaryTown.toLowerCase();
  const primaryQueries = stems.map((stem) => `${stem} ${primaryTownLower}`.toLowerCase());
  // `expandedCoverage` is empty when no nearby towns are in play — there are
  // no expanded searches to cover. Otherwise it's the top N stems that each
  // nearby town will attempt.
  const expandedStems = params.nearbyTowns.length === 0 ? [] : stems.slice(0, termsPerNearbyTown);

  // Build candidate expanded queries with metadata for the trimming step.
  type Candidate = { query: string; termRank: number; townRank: number };
  const expandedCandidates: Candidate[] = [];
  for (let townRank = 0; townRank < params.nearbyTowns.length; townRank++) {
    const town = params.nearbyTowns[townRank];
    for (let termRank = 0; termRank < expandedStems.length; termRank++) {
      const stem = expandedStems[termRank];
      expandedCandidates.push({
        query: `${stem} ${town}`.toLowerCase(),
        termRank,
        townRank,
      });
    }
  }

  // Trim if over budget. Primary is never trimmed (assume <= maxQueries).
  // Sort keeps nearer towns + higher-priority terms; trailing slice drops
  // farther towns × lower-priority terms first.
  const budget = Math.max(0, maxQueries - primaryQueries.length);
  const expandedSorted = [...expandedCandidates].sort((a, b) => {
    if (a.townRank !== b.townRank) return a.townRank - b.townRank;
    return a.termRank - b.termRank;
  });
  const expandedKept = expandedSorted.slice(0, budget);

  // Dedupe exact matches across primary + expanded.
  const seen = new Set<string>();
  const combined: string[] = [];
  for (const q of [...primaryQueries, ...expandedKept.map((c) => c.query)]) {
    if (seen.has(q)) continue;
    seen.add(q);
    combined.push(q);
  }

  const townsUsed = [params.primaryTown];
  for (const town of params.nearbyTowns) {
    const townLower = town.toLowerCase();
    if (expandedKept.some((c) => c.query.endsWith(` ${townLower}`))) {
      townsUsed.push(town);
    }
  }

  return {
    queries: combined,
    townsUsed,
    primaryCoverage: stems,
    expandedCoverage: expandedStems,
  };
}
