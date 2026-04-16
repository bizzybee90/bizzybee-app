/**
 * Normalises and validates user-supplied search_queries for onboarding
 * competitor discovery. Upstream (start-onboarding-discovery) used to filter
 * non-strings and empties only — no cap on count or length — so a user
 * submitting 50 terms triggered 50 Apify calls and risked exceeding the
 * edge-function wall-clock budget. This helper returns a safe, deduped,
 * capped list plus a structured rejections record so the edge function can
 * surface actionable errors.
 */

export const MAX_SEARCH_QUERIES = 8;
export const MAX_SEARCH_QUERY_LENGTH = 100;

export type SearchQueryRejectionReason =
  | 'not_an_array'
  | 'not_a_string'
  | 'empty'
  | 'duplicate'
  | 'truncated'
  | 'cap_exceeded';

export interface SearchQueryRejection {
  reason: SearchQueryRejectionReason;
  value: unknown;
}

export interface NormalizedSearchQueries {
  queries: string[];
  rejections: SearchQueryRejection[];
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeSearchQueries(raw: unknown): NormalizedSearchQueries {
  const rejections: SearchQueryRejection[] = [];

  if (!Array.isArray(raw)) {
    return { queries: [], rejections: [{ reason: 'not_an_array', value: raw }] };
  }

  const queries: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== 'string') {
      rejections.push({ reason: 'not_a_string', value: entry });
      continue;
    }

    const collapsed = collapseWhitespace(entry);
    if (!collapsed) {
      rejections.push({ reason: 'empty', value: entry });
      continue;
    }

    let normalised = collapsed;
    if (normalised.length > MAX_SEARCH_QUERY_LENGTH) {
      normalised = normalised.slice(0, MAX_SEARCH_QUERY_LENGTH);
      rejections.push({ reason: 'truncated', value: entry });
    }

    const key = normalised.toLowerCase();
    if (seen.has(key)) {
      rejections.push({ reason: 'duplicate', value: entry });
      continue;
    }

    if (queries.length >= MAX_SEARCH_QUERIES) {
      rejections.push({ reason: 'cap_exceeded', value: entry });
      continue;
    }

    seen.add(key);
    queries.push(normalised);
  }

  return { queries, rejections };
}
