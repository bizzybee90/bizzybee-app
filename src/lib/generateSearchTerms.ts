/**
 * Generates high-quality, distinct search terms for competitor discovery.
 *
 * Rules:
 * 1. Include both service form AND practitioner form when naturally different
 * 2. Never generate junk: no plurals, no "near X", no "in X", no "[service] services X"
 * 3. Target 4-6 genuinely distinct terms
 */

// Maps service-form → practitioner-form where they produce different Google results
const PRACTITIONER_MAP: Record<string, string> = {
  'window cleaning': 'window cleaner',
  'carpet cleaning': 'carpet cleaner',
  'gutter cleaning': 'gutter cleaner',
  'oven cleaning': 'oven cleaner',
  'domestic cleaning': 'domestic cleaner',
  'commercial cleaning': 'commercial cleaner',
  'general cleaning': 'cleaner',
  'upholstery cleaning': 'upholstery cleaner',
  'end of tenancy cleaning': 'end of tenancy cleaner',
  'pressure washing': 'pressure washer',
  landscaping: 'landscaper',
  plumbing: 'plumber',
  roofing: 'roofer',
  flooring: 'flooring fitter',
  fencing: 'fencing contractor',
  decking: 'decking installer',
  scaffolding: 'scaffolder',
  painting: 'painter',
  decorating: 'decorator',
  'car valeting': 'car valeter',
  'car servicing': 'mechanic',
  gardening: 'gardener',
  'garden maintenance': 'gardener',
  'lawn care': 'lawn care specialist',
  'dog grooming': 'dog groomer',
  'pet grooming': 'pet groomer',
  'dog walking': 'dog walker',
  'pet sitting': 'pet sitter',
  'dog training': 'dog trainer',
  photography: 'photographer',
  videography: 'videographer',
  catering: 'caterer',
  'event planning': 'event planner',
  'wedding planning': 'wedding planner',
  bookkeeping: 'bookkeeper',
  surveying: 'surveyor',
  'it support': 'it technician',
  'computer repair': 'computer technician',
  'pest control': 'pest controller',
  removals: 'removal company',
  'skip hire': 'skip hire company',
  'waste removal': 'waste removal company',
};

// Related services that produce distinct results
const RELATED_SERVICES: Record<string, string[]> = {
  'window cleaning': ['gutter cleaning', 'conservatory cleaning', 'fascia cleaning'],
  'carpet cleaning': ['upholstery cleaning', 'rug cleaning'],
  'pressure washing': ['driveway cleaning', 'patio cleaning'],
  plumber: ['boiler repair', 'emergency plumber', 'bathroom fitter'],
  plumbing: ['boiler repair', 'emergency plumber', 'bathroom fitter'],
  electrician: ['emergency electrician', 'electrical testing'],
  roofer: ['roof repair', 'flat roofing'],
  roofing: ['roof repair', 'flat roofing'],
  builder: ['house extension', 'loft conversion'],
  'painter & decorator': ['interior decorator', 'exterior painting'],
  'painter decorator': ['interior decorator', 'exterior painting'],
  landscaping: ['garden design', 'artificial grass'],
  gardener: ['garden maintenance', 'hedge trimming'],
  handyman: ['property maintenance', 'odd jobs'],
  'mobile mechanic': ['car servicing', 'mot'],
  'car valeting': ['mobile valeting', 'car detailing'],
  'dog groomer': ['mobile dog groomer', 'pet groomer'],
  hairdresser: ['mobile hairdresser', 'hair salon'],
  barber: ['barber shop', 'mens haircut'],
  locksmith: ['emergency locksmith', '24 hour locksmith'],
  'gas engineer': ['boiler engineer', 'gas safe engineer'],
  'heating engineer': ['boiler repair', 'central heating'],
};

export function normalizePrimaryServiceLocation(location: string): string {
  const normalized = location
    .split('|')[0]
    .replace(/\s*\(\d+\s*miles?\)/i, '')
    .replace(/\s*&\s*surrounding areas?$/i, '')
    .replace(/\bsurrounding areas?\b/gi, '')
    .split(',')[0]
    .trim();

  return normalized;
}

export function generateSearchTerms(businessType: string, location: string): string[] {
  const cleanType = businessType.split(',')[0].trim().toLowerCase().replace(/_/g, ' ');

  const cleanLocation = normalizePrimaryServiceLocation(location).toLowerCase();

  if (!cleanType || !cleanLocation) return [];

  const terms: string[] = [];

  // 1. Service form + location
  terms.push(`${cleanType} ${cleanLocation}`);

  // 2. Practitioner form + location (only if naturally different)
  const practitioner = PRACTITIONER_MAP[cleanType];
  if (practitioner && practitioner !== cleanType) {
    terms.push(`${practitioner} ${cleanLocation}`);
  }

  // 3. One related service term (if available)
  const related = RELATED_SERVICES[cleanType];
  if (related && related.length > 0) {
    terms.push(`${related[0]} ${cleanLocation}`);
  }

  // 4. Review-intent term
  const pluralPractitioner = practitioner
    ? practitioner.endsWith('s')
      ? practitioner
      : practitioner + 's'
    : cleanType.endsWith('s')
      ? cleanType
      : cleanType + 's';
  terms.push(`best rated ${pluralPractitioner} ${cleanLocation}`);

  // 5. Commercial/specialty variant if applicable
  if (cleanType.includes('cleaning') && !cleanType.includes('commercial')) {
    terms.push(`commercial ${cleanType} ${cleanLocation}`);
  }

  // Deduplicate
  return [...new Set(terms)];
}
