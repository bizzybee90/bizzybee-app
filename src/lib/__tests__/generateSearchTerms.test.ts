import { describe, expect, it } from 'vitest';
import { generateSearchTerms, normalizePrimaryServiceLocation } from '../generateSearchTerms';

describe('normalizePrimaryServiceLocation', () => {
  it('reduces a broad coverage string to the primary town', () => {
    expect(
      normalizePrimaryServiceLocation(
        'Luton, Dunstable, Harpenden, St Albans, Hitchin, Hemel Hempstead & surrounding areas',
      ),
    ).toBe('Luton');
  });

  it('prefers the first pipe-separated area and strips the radius suffix', () => {
    expect(normalizePrimaryServiceLocation('Luton (20 miles) | Dunstable (15 miles)')).toBe(
      'Luton',
    );
  });
});

describe('generateSearchTerms', () => {
  it('generates compact search terms from a broad service area string', () => {
    expect(
      generateSearchTerms(
        'window_cleaning',
        'Luton, Dunstable, Harpenden, St Albans & surrounding areas',
      ),
    ).toEqual([
      'window cleaning luton',
      'window cleaner luton',
      'gutter cleaning luton',
      'best rated window cleaners luton',
      'commercial window cleaning luton',
    ]);
  });
});
