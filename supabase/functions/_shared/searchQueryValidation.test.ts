import { describe, expect, it } from 'vitest';
import {
  normalizeSearchQueries,
  MAX_SEARCH_QUERIES,
  MAX_SEARCH_QUERY_LENGTH,
} from './searchQueryValidation';

// Regression: start-onboarding-discovery accepts arbitrary search_queries arrays
// with no cap on count or length. That leaves Apify search spend unbounded if a
// user submits 50 terms, and can push the discovery step past its wall-clock
// budget. This helper normalises input into a safe, deduped, capped list, with
// a structured rejection record so the edge function can return actionable
// errors rather than silently truncating.

describe('normalizeSearchQueries', () => {
  it('trims strings, drops empty entries, preserves order', () => {
    const result = normalizeSearchQueries(['  window cleaning luton  ', '', '   ', 'gutter luton']);
    expect(result.queries).toEqual(['window cleaning luton', 'gutter luton']);
    expect(result.rejections).toHaveLength(2);
  });

  it('dedupes case-insensitively, keeping the first occurrence', () => {
    const result = normalizeSearchQueries([
      'Window Cleaning Luton',
      'window cleaning luton',
      'WINDOW CLEANING LUTON',
    ]);
    expect(result.queries).toEqual(['Window Cleaning Luton']);
    expect(result.rejections.filter((r) => r.reason === 'duplicate')).toHaveLength(2);
  });

  it(`caps at MAX_SEARCH_QUERIES (${MAX_SEARCH_QUERIES})`, () => {
    const raw = Array.from({ length: MAX_SEARCH_QUERIES + 4 }, (_, i) => `term ${i}`);
    const result = normalizeSearchQueries(raw);
    expect(result.queries).toHaveLength(MAX_SEARCH_QUERIES);
    expect(result.rejections.filter((r) => r.reason === 'cap_exceeded')).toHaveLength(4);
  });

  it(`truncates individual queries to MAX_SEARCH_QUERY_LENGTH (${MAX_SEARCH_QUERY_LENGTH})`, () => {
    const long = 'a'.repeat(MAX_SEARCH_QUERY_LENGTH + 50);
    const result = normalizeSearchQueries([long]);
    expect(result.queries[0]).toHaveLength(MAX_SEARCH_QUERY_LENGTH);
    expect(result.rejections.some((r) => r.reason === 'truncated')).toBe(true);
  });

  it('rejects non-strings without throwing', () => {
    const result = normalizeSearchQueries([
      'valid',
      42,
      null,
      undefined,
      { nope: 1 },
      ['nested'],
    ] as unknown[]);
    expect(result.queries).toEqual(['valid']);
    expect(result.rejections.filter((r) => r.reason === 'not_a_string')).toHaveLength(5);
  });

  it('returns empty + rejection when input is not an array', () => {
    const result = normalizeSearchQueries('window cleaning luton' as unknown);
    expect(result.queries).toEqual([]);
    expect(result.rejections).toEqual([{ reason: 'not_an_array', value: 'window cleaning luton' }]);
  });

  it('returns empty + no rejections when input is an empty array', () => {
    const result = normalizeSearchQueries([]);
    expect(result.queries).toEqual([]);
    expect(result.rejections).toEqual([]);
  });

  it('collapses internal whitespace to single spaces', () => {
    const result = normalizeSearchQueries(['window    cleaning\tluton']);
    expect(result.queries).toEqual(['window cleaning luton']);
  });
});
