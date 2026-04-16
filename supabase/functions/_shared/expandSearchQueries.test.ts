import { describe, expect, it, vi } from 'vitest';

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.57.2', () => ({}));

const { expandSearchQueries, stripPrimaryTownSuffix } = await import('./expandSearchQueries.ts');

describe('stripPrimaryTownSuffix', () => {
  it('strips trailing primary town (case-insensitive)', () => {
    expect(stripPrimaryTownSuffix('window cleaning luton', 'Luton')).toBe('window cleaning');
    expect(stripPrimaryTownSuffix('gutter cleaning LUTON', 'Luton')).toBe('gutter cleaning');
  });

  it('strips multi-word primary town', () => {
    expect(stripPrimaryTownSuffix('plumber hemel hempstead', 'Hemel Hempstead')).toBe('plumber');
  });

  it('leaves terms without the town suffix unchanged', () => {
    expect(stripPrimaryTownSuffix('window cleaning services', 'Luton')).toBe(
      'window cleaning services',
    );
  });

  it('trims trailing punctuation after strip', () => {
    expect(stripPrimaryTownSuffix('best window cleaning, luton', 'Luton')).toBe(
      'best window cleaning',
    );
  });

  it('handles primary town names containing regex metacharacters', () => {
    // Hyphenated town name: "Stoke-on-Trent" would break the regex if `-`
    // leaked into a character class. Period: "St. Albans" has `.` which
    // matches any char in unescaped regex. Both must strip literally.
    expect(stripPrimaryTownSuffix('plumber stoke-on-trent', 'Stoke-on-Trent')).toBe('plumber');
    expect(stripPrimaryTownSuffix('gp surgery st. albans', 'St. Albans')).toBe('gp surgery');
  });
});

describe('expandSearchQueries', () => {
  const terms = [
    'window cleaning',
    'window cleaner',
    'gutter cleaning',
    'best rated window cleaners',
    'commercial window cleaning',
  ];

  it('primary town gets every term; nearby towns get top N', () => {
    const result = expandSearchQueries({
      searchTerms: terms,
      primaryTown: 'Luton',
      nearbyTowns: ['Dunstable', 'Harpenden'],
      termsPerNearbyTown: 3,
    });
    expect(result.queries).toHaveLength(11); // 5 primary + 3*2 nearby
    expect(result.queries).toContain('window cleaning luton');
    expect(result.queries).toContain('commercial window cleaning luton');
    expect(result.queries).toContain('window cleaning dunstable');
    expect(result.queries).toContain('gutter cleaning dunstable');
    expect(result.queries).not.toContain('commercial window cleaning dunstable');
  });

  it('strips already-city-baked terms before re-applying to each town', () => {
    const result = expandSearchQueries({
      searchTerms: ['window cleaning luton', 'gutter cleaning luton'],
      primaryTown: 'Luton',
      nearbyTowns: ['Dunstable'],
      termsPerNearbyTown: 3,
    });
    expect(result.queries).toContain('window cleaning luton');
    expect(result.queries).toContain('gutter cleaning luton');
    expect(result.queries).toContain('window cleaning dunstable');
    expect(result.queries).toContain('gutter cleaning dunstable');
    expect(result.queries.every((q) => !q.includes('luton dunstable'))).toBe(true);
  });

  it('honours maxQueries cap — trims farthest town × lowest-priority term first', () => {
    const result = expandSearchQueries({
      searchTerms: terms,
      primaryTown: 'Luton',
      nearbyTowns: ['Dunstable', 'Harpenden', 'St Albans', 'Hitchin'],
      termsPerNearbyTown: 3,
      maxQueries: 10,
    });
    expect(result.queries).toHaveLength(10);
    expect(result.queries.filter((q) => q.endsWith(' luton'))).toHaveLength(5);
    expect(result.queries.filter((q) => q.endsWith(' hitchin'))).toHaveLength(0);
  });

  it('returns structured metadata for UI', () => {
    const result = expandSearchQueries({
      searchTerms: terms,
      primaryTown: 'Luton',
      nearbyTowns: ['Dunstable'],
      termsPerNearbyTown: 3,
    });
    expect(result.townsUsed).toEqual(['Luton', 'Dunstable']);
    expect(result.primaryCoverage).toHaveLength(5);
    expect(result.expandedCoverage).toHaveLength(3);
  });

  it('no-op when nearbyTowns is empty (radius=0 pathway)', () => {
    const result = expandSearchQueries({
      searchTerms: terms,
      primaryTown: 'Luton',
      nearbyTowns: [],
      termsPerNearbyTown: 3,
    });
    expect(result.queries).toEqual([
      'window cleaning luton',
      'window cleaner luton',
      'gutter cleaning luton',
      'best rated window cleaners luton',
      'commercial window cleaning luton',
    ]);
    expect(result.townsUsed).toEqual(['Luton']);
    expect(result.expandedCoverage).toEqual([]);
  });

  it('dedupes exact-match queries', () => {
    const result = expandSearchQueries({
      searchTerms: ['window cleaning', 'window cleaning'],
      primaryTown: 'Luton',
      nearbyTowns: ['Dunstable'],
      termsPerNearbyTown: 3,
    });
    expect(new Set(result.queries).size).toBe(result.queries.length);
  });

  it('handles empty search terms safely', () => {
    const result = expandSearchQueries({
      searchTerms: [],
      primaryTown: 'Luton',
      nearbyTowns: ['Dunstable'],
      termsPerNearbyTown: 3,
    });
    expect(result.queries).toEqual([]);
  });

  it('drops terms that strip to empty (user typed just the town name)', () => {
    // Regression guard: if a user enters the primary town verbatim as a
    // "search term", stripPrimaryTownSuffix turns it into an empty stem,
    // which must be filtered out before concatenation so we don't emit
    // a ghost " luton" / " dunstable" query.
    const result = expandSearchQueries({
      searchTerms: ['luton', 'window cleaning'],
      primaryTown: 'Luton',
      nearbyTowns: ['Dunstable'],
      termsPerNearbyTown: 3,
    });
    // Only 'window cleaning' survives as a stem → 1 primary + 1 nearby = 2.
    expect(result.queries).toEqual(['window cleaning luton', 'window cleaning dunstable']);
    expect(result.queries.every((q) => q.trim().length > 0 && !q.startsWith(' '))).toBe(true);
  });
});
