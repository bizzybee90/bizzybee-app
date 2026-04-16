import { describe, expect, it } from 'vitest';
import { isKnownUnscrapableUrl, UNSCRAPABLE_HOSTNAME_PATTERNS } from './unscrapableUrl';

// Regression 2026-04-16: https://www.facebook.com/wcandm/ got approved by
// Claude qualification and landed in allowed_urls for fetch_pages. Apify will
// never scrape Facebook (auth-walled + aggressive bot blocking), so the URL
// burned a slot that would otherwise have gone to a genuine competitor site
// and contributed to the 10/16 fetch_failed rate. This helper rejects URLs
// we know ahead of time are unscrapable — social networks, Google-owned
// surfaces, existing directory aggregators we already distrust.

describe('isKnownUnscrapableUrl', () => {
  it('rejects Facebook URLs', () => {
    expect(isKnownUnscrapableUrl('https://www.facebook.com/wcandm/')).toBe(true);
    expect(isKnownUnscrapableUrl('https://fb.com/some-page')).toBe(true);
    expect(isKnownUnscrapableUrl('https://m.facebook.com/biz')).toBe(true);
  });

  it('rejects Instagram, Twitter/X, LinkedIn, YouTube, TikTok, Pinterest', () => {
    expect(isKnownUnscrapableUrl('https://instagram.com/bizname')).toBe(true);
    expect(isKnownUnscrapableUrl('https://www.instagram.com/bizname/')).toBe(true);
    expect(isKnownUnscrapableUrl('https://twitter.com/bizname')).toBe(true);
    expect(isKnownUnscrapableUrl('https://x.com/bizname')).toBe(true);
    expect(isKnownUnscrapableUrl('https://www.linkedin.com/company/bizname')).toBe(true);
    expect(isKnownUnscrapableUrl('https://youtube.com/@biz')).toBe(true);
    expect(isKnownUnscrapableUrl('https://youtu.be/xyz')).toBe(true);
    expect(isKnownUnscrapableUrl('https://www.tiktok.com/@biz')).toBe(true);
    expect(isKnownUnscrapableUrl('https://pinterest.co.uk/biz')).toBe(true);
    expect(isKnownUnscrapableUrl('https://uk.pinterest.com/biz')).toBe(true);
  });

  it('rejects Google-owned surfaces that never render full business sites', () => {
    expect(isKnownUnscrapableUrl('https://www.google.com/maps/place/foo')).toBe(true);
    expect(isKnownUnscrapableUrl('https://maps.google.com/?cid=123')).toBe(true);
    expect(isKnownUnscrapableUrl('https://g.page/biz')).toBe(true);
    expect(isKnownUnscrapableUrl('https://business.google.com/reviews')).toBe(true);
  });

  it('rejects Yelp and Yell and common UK directory aggregators', () => {
    expect(isKnownUnscrapableUrl('https://www.yelp.com/biz/foo')).toBe(true);
    expect(isKnownUnscrapableUrl('https://www.yell.com/biz/foo')).toBe(true);
    expect(isKnownUnscrapableUrl('https://uk.trustpilot.com/review/foo.com')).toBe(true);
    expect(isKnownUnscrapableUrl('https://www.checkatrade.com/trades/foo')).toBe(true);
    expect(isKnownUnscrapableUrl('https://www.trustatrader.com/traders/foo')).toBe(true);
  });

  it('accepts genuine small-business websites (the happy path)', () => {
    expect(isKnownUnscrapableUrl('https://www.scrubadubdub.co.uk/')).toBe(false);
    expect(isKnownUnscrapableUrl('https://crose.cleaning')).toBe(false);
    expect(isKnownUnscrapableUrl('https://www.mcbobwindowcleaning.co.uk/')).toBe(false);
    expect(isKnownUnscrapableUrl('https://example.com/some/deep/path')).toBe(false);
  });

  it('returns false for unparseable inputs rather than throwing', () => {
    expect(isKnownUnscrapableUrl('')).toBe(false);
    expect(isKnownUnscrapableUrl('not a url')).toBe(false);
    expect(isKnownUnscrapableUrl('javascript:alert(1)')).toBe(false);
  });

  it('ignores case on hostname (URLs have case-insensitive hostnames)', () => {
    expect(isKnownUnscrapableUrl('https://FACEBOOK.com/foo')).toBe(true);
    expect(isKnownUnscrapableUrl('https://WWW.Yelp.COM/biz/foo')).toBe(true);
  });

  it('exports the pattern list so operators can see what gets rejected', () => {
    expect(Array.isArray(UNSCRAPABLE_HOSTNAME_PATTERNS)).toBe(true);
    expect(UNSCRAPABLE_HOSTNAME_PATTERNS.length).toBeGreaterThan(5);
  });
});
