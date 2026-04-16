/**
 * Primary service area parsed from the raw `business_context.service_area`
 * string. The raw column is a user-editable free-form field that typically
 * looks like `"Luton (20 miles)"` or `"Luton (20 miles) | Watford (10 miles)"`
 * but may also be a plain town name without a radius.
 *
 * Consumers (SearchTermsStep → expand_search_queries RPC) need the FIRST
 * entry only: the canonical "home" town + its declared search radius. This
 * helper normalizes both formats into a structured `{ town, radiusMiles }`.
 */
export interface ServiceAreaPrimary {
  town: string;
  radiusMiles: number;
}

/**
 * Parse the first entry of a `service_area` string into its town + radius.
 *
 * Supported shapes:
 *   "Luton (20 miles)"                      → { town: "Luton", radiusMiles: 20 }
 *   "Luton"                                  → { town: "Luton", radiusMiles: 0 }
 *   "Luton (20 miles) | Watford (10 miles)" → first entry only
 *   "Luton (20 miles), Watford"             → first comma-separated entry
 *   "Luton (1 mile)"                         → singular "mile" also accepted
 *
 * Returns `null` for empty / nullish / whitespace-only input.
 *
 * Pipe (`|`) separators are preferred; legacy comma-separated strings are
 * still parsed when there's no pipe. When a parenthetical radius is absent,
 * `radiusMiles` is `0` — which the RPC treats as the "no expansion" signal.
 */
export function parsePrimaryServiceArea(raw: string | null | undefined): ServiceAreaPrimary | null {
  if (!raw) return null;
  const first = (raw.includes(' | ') ? raw.split(' | ') : raw.split(','))[0]?.trim();
  if (!first) return null;
  const match = first.match(/^(.+?)\s*\((\d+)\s*miles?\)$/i);
  if (match) {
    return { town: match[1].trim(), radiusMiles: parseInt(match[2], 10) };
  }
  return { town: first, radiusMiles: 0 };
}
