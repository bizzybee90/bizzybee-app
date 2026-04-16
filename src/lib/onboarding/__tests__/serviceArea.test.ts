import { describe, expect, it } from 'vitest';
import { parsePrimaryServiceArea } from '../serviceArea';

describe('parsePrimaryServiceArea', () => {
  it('parses town + radius', () => {
    expect(parsePrimaryServiceArea('Luton (20 miles)')).toEqual({ town: 'Luton', radiusMiles: 20 });
  });

  it('radius=0 when no parenthetical', () => {
    expect(parsePrimaryServiceArea('Luton')).toEqual({ town: 'Luton', radiusMiles: 0 });
  });

  it('takes the first entry in a pipe-separated list', () => {
    expect(parsePrimaryServiceArea('Luton (20 miles) | Watford (10 miles)')).toEqual({
      town: 'Luton',
      radiusMiles: 20,
    });
  });

  it('handles comma-separated legacy format', () => {
    expect(parsePrimaryServiceArea('Luton (20 miles), Watford')).toEqual({
      town: 'Luton',
      radiusMiles: 20,
    });
  });

  it('null for empty input', () => {
    expect(parsePrimaryServiceArea('')).toBeNull();
    expect(parsePrimaryServiceArea(null)).toBeNull();
    expect(parsePrimaryServiceArea(undefined)).toBeNull();
  });

  it('singular "mile" also works', () => {
    expect(parsePrimaryServiceArea('Luton (1 mile)')).toEqual({ town: 'Luton', radiusMiles: 1 });
  });
});
