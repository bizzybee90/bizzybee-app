import { describe, expect, it } from 'vitest';
import { canonicalizeUrl } from './urlCanonicalization';

// Regression: searchCompetitorCandidates dedupes by raw URL string. Apify
// returns variants like https://example.com/, http://example.com,
// https://www.example.com/ as separate results, and our dedup treats them as
// distinct competitors. This produced duplicate rows in the review screen.
// canonicalizeUrl collapses common URL variants to a single key per logical
// site so dedup works correctly.

describe('canonicalizeUrl', () => {
  it('strips leading www. from hostname', () => {
    expect(canonicalizeUrl('https://www.example.com/path')).toBe(
      canonicalizeUrl('https://example.com/path'),
    );
  });

  it('ignores scheme differences (http vs https)', () => {
    expect(canonicalizeUrl('http://example.com/')).toBe(canonicalizeUrl('https://example.com/'));
  });

  it('ignores trailing slash on path', () => {
    expect(canonicalizeUrl('https://example.com/about')).toBe(
      canonicalizeUrl('https://example.com/about/'),
    );
  });

  it('lowercases the hostname', () => {
    expect(canonicalizeUrl('https://Example.COM/About')).toBe(
      canonicalizeUrl('https://example.com/About'),
    );
  });

  it('preserves path case (paths are case-sensitive)', () => {
    // Different paths should NOT collapse even if they only differ in case
    expect(canonicalizeUrl('https://example.com/About')).not.toBe(
      canonicalizeUrl('https://example.com/about'),
    );
  });

  it('preserves query string (different queries = different pages)', () => {
    expect(canonicalizeUrl('https://example.com/?a=1')).not.toBe(
      canonicalizeUrl('https://example.com/?a=2'),
    );
  });

  it('strips hash fragments', () => {
    expect(canonicalizeUrl('https://example.com/page#section')).toBe(
      canonicalizeUrl('https://example.com/page'),
    );
  });

  it('returns null for non-URL strings', () => {
    expect(canonicalizeUrl('not a url')).toBeNull();
    expect(canonicalizeUrl('')).toBeNull();
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('returns null for non-http(s) schemes', () => {
    expect(canonicalizeUrl('ftp://example.com/')).toBeNull();
    expect(canonicalizeUrl('mailto:a@b.com')).toBeNull();
  });

  it('treats root path consistently (/ and empty)', () => {
    expect(canonicalizeUrl('https://example.com')).toBe(canonicalizeUrl('https://example.com/'));
  });

  it('collapses m. mobile subdomain too', () => {
    expect(canonicalizeUrl('https://m.example.com/path')).toBe(
      canonicalizeUrl('https://example.com/path'),
    );
  });
});
