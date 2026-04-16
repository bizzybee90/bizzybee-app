import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

// Stub the esm.sh Supabase import so Node/vitest can load the module graph.
// Same workaround pattern used by onboarding-faq-engine.test.ts and
// onboarding-website-runner.test.ts.
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.57.2', () => ({}));

const { canonicalTownSlug, haversineMiles, findNearbyTowns } = await import('./uk-towns.ts');

describe('canonicalTownSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(canonicalTownSlug('Luton')).toBe('luton');
    expect(canonicalTownSlug('St Albans')).toBe('st-albans');
    expect(canonicalTownSlug('Hemel Hempstead')).toBe('hemel-hempstead');
  });

  it('strips punctuation and trims hyphens', () => {
    expect(canonicalTownSlug('St. Albans')).toBe('st-albans');
    expect(canonicalTownSlug('  Luton  ')).toBe('luton');
    expect(canonicalTownSlug('Luton-')).toBe('luton');
    expect(canonicalTownSlug('Stoke-on-Trent')).toBe('stoke-on-trent');
  });

  it('handles empty / pathological input', () => {
    expect(canonicalTownSlug('')).toBe('');
    expect(canonicalTownSlug('   ')).toBe('');
    expect(canonicalTownSlug('!!!')).toBe('');
  });
});

describe('haversineMiles', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineMiles(51.5, -0.1, 51.5, -0.1)).toBeCloseTo(0, 2);
  });

  it('computes Luton→Dunstable as ~4-5 miles', () => {
    // Luton ≈ 51.8787, -0.4200  Dunstable ≈ 51.8860, -0.5211
    const miles = haversineMiles(51.8787, -0.42, 51.886, -0.5211);
    expect(miles).toBeGreaterThan(4);
    expect(miles).toBeLessThan(5);
  });

  it('computes Luton→central London as ~30 miles', () => {
    // London ≈ 51.5074, -0.1278
    const miles = haversineMiles(51.8787, -0.42, 51.5074, -0.1278);
    expect(miles).toBeGreaterThan(28);
    expect(miles).toBeLessThan(32);
  });
});

// Minimal Supabase mock supporting both call shapes used by findNearbyTowns:
//   .from('uk_towns').select(...).eq('canonical_slug', slug).maybeSingle()
// and
//   .from('uk_towns').select(...).gte().lte().gte().lte()
//
// Filter logic is asserted in the helper itself; the mock just returns
// `allTowns` for the bounding-box pass and lets the helper's haversine
// filter do the narrowing.
type TownRow = {
  name: string;
  canonical_slug: string;
  latitude: number;
  longitude: number;
};

function mockSupabase(config: { primary: TownRow | null; allTowns: TownRow[] }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: config.primary, error: null }),
        }),
        gte: () => ({
          lte: () => ({
            gte: () => ({
              lte: () => Promise.resolve({ data: config.allTowns, error: null }),
            }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('findNearbyTowns', () => {
  const luton: TownRow = {
    name: 'Luton',
    canonical_slug: 'luton',
    latitude: 51.8787,
    longitude: -0.42,
  };
  const dunstable: TownRow = {
    name: 'Dunstable',
    canonical_slug: 'dunstable',
    latitude: 51.886,
    longitude: -0.5211,
  };
  const harpenden: TownRow = {
    name: 'Harpenden',
    canonical_slug: 'harpenden',
    latitude: 51.8173,
    longitude: -0.3479,
  };
  const stAlbans: TownRow = {
    name: 'St Albans',
    canonical_slug: 'st-albans',
    latitude: 51.7527,
    longitude: -0.3413,
  };
  const london: TownRow = {
    name: 'London',
    canonical_slug: 'london',
    latitude: 51.5074,
    longitude: -0.1278,
  };

  it('returns empty array when primary town not found', async () => {
    const supabase = mockSupabase({ primary: null, allTowns: [] });
    const result = await findNearbyTowns(supabase, 'Atlantis', 20);
    expect(result).toEqual([]);
  });

  it('returns nearby towns sorted by distance, excluding primary', async () => {
    const supabase = mockSupabase({
      primary: luton,
      allTowns: [luton, dunstable, harpenden, stAlbans, london],
    });
    const result = await findNearbyTowns(supabase, 'Luton', 20);
    const names = result.map((t) => t.name);
    expect(names).not.toContain('Luton');
    expect(names).toEqual(['Dunstable', 'Harpenden', 'St Albans']);
    expect(result[0].miles).toBeLessThan(result[1].miles);
    expect(result[1].miles).toBeLessThan(result[2].miles);
  });

  it('respects maxResults cap', async () => {
    const supabase = mockSupabase({
      primary: luton,
      allTowns: [luton, dunstable, harpenden, stAlbans],
    });
    const result = await findNearbyTowns(supabase, 'Luton', 20, 2);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toEqual(['Dunstable', 'Harpenden']);
  });

  it('returns empty array when radius is 0', async () => {
    const supabase = mockSupabase({
      primary: luton,
      allTowns: [luton, dunstable, harpenden],
    });
    const result = await findNearbyTowns(supabase, 'Luton', 0);
    expect(result).toEqual([]);
  });

  it('is case-insensitive on primary name', async () => {
    const supabase = mockSupabase({
      primary: luton,
      allTowns: [luton, dunstable],
    });
    const result = await findNearbyTowns(supabase, 'LUTON', 20);
    expect(result.map((t) => t.name)).toEqual(['Dunstable']);
  });
});
