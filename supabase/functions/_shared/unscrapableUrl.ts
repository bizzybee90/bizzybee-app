/**
 * Pre-filter for URLs we know ahead of time will never yield a usable
 * competitor-website scrape. Dropped at qualification time so they never
 * burn an Apify slot in fetch_pages, where the user just sees "fetch_failed"
 * alongside the genuine website failures.
 *
 * Rejects:
 *  - Social networks (auth-walled + aggressive bot blocking)
 *  - Google-owned business surfaces (Maps, g.page, business.google.com) —
 *    these redirect through JS-heavy interstitials that cheerio can't
 *    resolve, and the actual business page is usually on the target
 *    company's own website anyway
 *  - Directory aggregators we already distrust for ground-truth content
 *    (Yelp / Yell / Trustpilot / Checkatrade / TrustATrader)
 *
 * Matches on hostname suffix + leading subdomain stripping so that e.g.
 * `m.facebook.com`, `uk.pinterest.com`, `business.google.com` all match.
 *
 * Keep the list conservative — a false positive here silently drops a
 * genuine competitor from discovery, which is worse than an extra Apify
 * call burned on a page we couldn't scrape.
 */

export const UNSCRAPABLE_HOSTNAME_PATTERNS: readonly string[] = [
  // Social networks
  'facebook.com',
  'fb.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'pinterest.com',
  'pinterest.co.uk',
  'snapchat.com',
  'reddit.com',
  'nextdoor.com',
  // Google-owned
  'google.com',
  'g.page',
  'business.google.com',
  // Known directories / aggregators we already distrust
  'yelp.com',
  'yell.com',
  'trustpilot.com',
  'checkatrade.com',
  'trustatrader.com',
  'mybuilder.com',
  'ratedpeople.com',
  'bark.com',
];

function extractHostname(raw: string): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normaliseHostForMatch(host: string): string {
  // Strip a single well-known "mobile" / "localized" leading label so e.g.
  // m.facebook.com, www.yelp.com, uk.pinterest.com, maps.google.com all
  // collapse onto their parent before matching.
  const leadingPrefixes = ['www.', 'm.', 'mobile.', 'maps.'];
  for (const prefix of leadingPrefixes) {
    if (host.startsWith(prefix)) return host.slice(prefix.length);
  }
  return host;
}

export function isKnownUnscrapableUrl(raw: string): boolean {
  const host = extractHostname(raw);
  if (!host) return false;

  const lowered = host.toLowerCase();
  const normalised = normaliseHostForMatch(lowered);

  for (const pattern of UNSCRAPABLE_HOSTNAME_PATTERNS) {
    if (normalised === pattern) return true;
    if (normalised.endsWith('.' + pattern)) return true;
    // Also allow matching for leading-prefix variants the normaliser didn't
    // strip (e.g. "business.google.com" is its own entry, so a direct match
    // wins before we fall through to the "*.google.com" catch-all).
    if (lowered === pattern || lowered.endsWith('.' + pattern)) return true;
  }

  return false;
}
