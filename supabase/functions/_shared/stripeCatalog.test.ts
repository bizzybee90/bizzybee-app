import { getAddonLookupKey, getPlanLookupKey, resolveStripeCatalogEntry } from './stripeCatalog';

describe('stripeCatalog', () => {
  it('resolves a plan from metadata', () => {
    expect(
      resolveStripeCatalogEntry({
        metadata: {
          bizzybee_object_type: 'plan',
          plan_key: 'starter',
        },
      }),
    ).toEqual({
      objectType: 'plan',
      planKey: 'starter',
      addonKey: null,
      lookupKey: getPlanLookupKey('starter'),
    });
  });

  it('resolves an addon from metadata', () => {
    expect(
      resolveStripeCatalogEntry({
        metadata: {
          bizzybee_object_type: 'addon',
          addon_key: 'ai_phone',
        },
      }),
    ).toEqual({
      objectType: 'addon',
      planKey: null,
      addonKey: 'ai_phone',
      lookupKey: getAddonLookupKey('ai_phone'),
    });
  });

  it('falls back to lookup keys when metadata is absent', () => {
    expect(
      resolveStripeCatalogEntry({
        lookupKey: 'bizzybee_plan_growth_monthly',
      }),
    ).toEqual({
      objectType: 'plan',
      planKey: 'growth',
      addonKey: null,
      lookupKey: 'bizzybee_plan_growth_monthly',
    });
  });

  it('returns null for unknown objects', () => {
    expect(
      resolveStripeCatalogEntry({
        lookupKey: 'unknown_lookup_key',
        metadata: {
          bizzybee_object_type: 'plan',
          plan_key: 'enterprise',
        },
      }),
    ).toBeNull();
  });
});
