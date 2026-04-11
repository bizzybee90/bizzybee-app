import { describe, expect, it } from 'vitest';

import {
  BIZZYBEE_ADDONS,
  BIZZYBEE_PLANS,
  getEmailHistoryImportLimit,
  planAllowsAddon,
  planIncludesFeature,
} from '../plans';

describe('BIZZYBEE_PLANS', () => {
  it('marks Growth as the hero tier', () => {
    expect(BIZZYBEE_PLANS.growth.hero).toBe(true);
  });

  it('keeps Connect as unified inbox only without AI inbox access', () => {
    expect(planIncludesFeature('connect', 'unified_inbox')).toBe(true);
    expect(planIncludesFeature('connect', 'ai_inbox')).toBe(false);
  });

  it('sets the expected email import limits', () => {
    expect(getEmailHistoryImportLimit('connect')).toBe(0);
    expect(getEmailHistoryImportLimit('starter')).toBe(1_000);
    expect(getEmailHistoryImportLimit('growth')).toBe(10_000);
    expect(getEmailHistoryImportLimit('pro')).toBe(30_000);
  });

  it('allows only routing add-ons on Connect', () => {
    expect(planAllowsAddon('connect', 'whatsapp_routing')).toBe(true);
    expect(planAllowsAddon('connect', 'sms_routing')).toBe(true);
    expect(planAllowsAddon('connect', 'whatsapp_ai')).toBe(false);
    expect(planAllowsAddon('connect', 'ai_phone')).toBe(false);
  });

  it('keeps AI Phone add-on priced with included minutes and overage', () => {
    expect(BIZZYBEE_ADDONS.ai_phone.monthlyPriceGbp).toBe(99);
    expect(BIZZYBEE_ADDONS.ai_phone.includedUnits).toBe(100);
    expect(BIZZYBEE_ADDONS.ai_phone.overagePriceGbp).toBe(0.3);
  });
});
