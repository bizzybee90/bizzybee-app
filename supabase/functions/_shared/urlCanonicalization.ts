/**
 * Canonicalise a URL into a stable key for dedup purposes.
 *
 * Collapses common variants that point at the same logical resource:
 *  - scheme (http vs https) ignored
 *  - leading `www.` / `m.` stripped from hostname
 *  - hostname lowercased
 *  - trailing slash on pathname stripped
 *  - hash fragments stripped
 *
 * Preserves things that genuinely distinguish pages:
 *  - path case (some servers are case-sensitive)
 *  - query string (different ?params = different page)
 *
 * Returns `null` for inputs that aren't parseable URLs OR that use a scheme
 * we don't want in the candidate pool (anything non-http(s) — mailto, ftp,
 * javascript, etc.). Callers dedup by the returned key and skip `null`s.
 */

const MOBILE_SUBDOMAIN_PREFIXES = ['www.', 'm.'];

export function canonicalizeUrl(raw: string): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  let host = parsed.hostname.toLowerCase();
  for (const prefix of MOBILE_SUBDOMAIN_PREFIXES) {
    if (host.startsWith(prefix)) {
      host = host.slice(prefix.length);
      break;
    }
  }

  let path = parsed.pathname || '/';
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  if (path === '') {
    path = '/';
  }

  const search = parsed.search || '';
  return `${host}${path}${search}`;
}
