import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import {
  dedupeOwnWebsiteFaqsAcrossBatches,
  extractCompetitorFaqCandidates,
  extractWebsiteFaqsInChunks,
  finalizeFaqCandidates,
  type FaqCandidate,
  type FetchedPage,
} from '../faq-agent-runner/lib/onboarding-ai.ts';
import { handleListExistingFaqs } from '../faq-agent-runner/tools/list-existing-faqs.ts';

export type SharedFaqSourceKind = 'own_site' | 'competitor';

export interface SharedFaqPromptContext {
  workspace_name: string;
  industry: string | null;
  service_area: string | null;
  business_type: string | null;
}

export type SharedFaqSourcePage = FetchedPage & {
  source_business?: string | null;
  source_kind?: SharedFaqSourceKind;
};

export async function loadRunArtifact<T>(
  supabase: SupabaseClient,
  runId: string,
  workspaceId: string,
  artifactKey: string,
): Promise<T> {
  const { data, error } = await supabase
    .from('agent_run_artifacts')
    .select('content')
    .eq('run_id', runId)
    .eq('workspace_id', workspaceId)
    .eq('artifact_key', artifactKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Missing onboarding artifact: ${artifactKey}`);
  }

  return data.content as T;
}

export async function hasRunArtifact(
  supabase: SupabaseClient,
  runId: string,
  workspaceId: string,
  artifactKey: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('agent_run_artifacts')
    .select('id')
    .eq('run_id', runId)
    .eq('workspace_id', workspaceId)
    .eq('artifact_key', artifactKey)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check onboarding artifact ${artifactKey}: ${error.message}`);
  }

  return Boolean(data?.id);
}

export function normalizeFaqQuestion(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Tokens stripped during fingerprinting. Three categories:
 *
 *   1. Generic English stopwords (articles, auxiliaries, pronouns, etc.)
 *   2. Brand / self-reference ("Does MAC Cleaning X?" ≡ "Do you X?")
 *   3. Location-and-area tokens. Most service businesses do NOT price
 *      differently per town (a window clean is the same £ in Luton, Dunstable,
 *      Harpenden, etc. for MAC Cleaning), and the per-page extraction commonly
 *      produces "How much does X cost in {City}?" and "Which areas of {City}
 *      do you cover?" for every location page. Stripping these merges the
 *      redundant per-location questions into a single generic winner.
 *      Service names (gutter, fascia, window, conservatory) stay — they
 *      carry real topic info and should stay distinct.
 *
 * Known trade-off: this collapses location-specific questions even for
 * businesses that genuinely DO price differently per area. If a future
 * workspace needs location-distinct pricing, the fix is to make this list
 * configurable per workspace rather than hard-coded.
 */
const FAQ_FINGERPRINT_STOPWORDS = new Set([
  // Articles / auxiliaries / copulas
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'done',
  'doing',
  'have',
  'has',
  'had',
  'having',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  'can',
  'could',
  'able',
  // Pronouns
  'i',
  'me',
  'my',
  'mine',
  'you',
  'your',
  'yours',
  'we',
  'us',
  'our',
  'ours',
  'they',
  'them',
  'their',
  'theirs',
  'he',
  'she',
  'it',
  'its',
  // Wh-words (the interrogative itself carries little info once stemmed)
  'what',
  'when',
  'where',
  'why',
  'how',
  'who',
  'whom',
  'which',
  'whose',
  // Connectives
  'and',
  'or',
  'but',
  'not',
  'nor',
  'yet',
  'so',
  'if',
  'then',
  'than',
  'because',
  'though',
  // Prepositions (position/direction, low-signal for topic matching)
  'of',
  'in',
  'on',
  'at',
  'to',
  'from',
  'for',
  'with',
  'without',
  'by',
  'as',
  'into',
  'about',
  'over',
  'under',
  'between',
  'through',
  // Demonstratives / pro-forms
  'this',
  'that',
  'these',
  'those',
  'there',
  'here',
  'well',
  // Intensifiers / fillers
  'too',
  'very',
  'just',
  'also',
  'only',
  'even',
  'still',
  'any',
  'some',
  'one',
  'ones',
  // Synonym-ish quantifiers that often swap in variant phrasings ("every
  // window clean" vs "standard window clean"). Dropping them groups more
  // semantically-equivalent variants; keeping locations/services means
  // we still don't over-merge across topics.
  'every',
  'each',
  'all',
  'another',
  // Brand / self-reference
  'mac',
  'cleaning',
  'maccleaning',
  'bizzybee',
  // UK service-area tokens. Per the 2026-04-16 user feedback ("no area is
  // more expensive than another, so we don't need per-city pricing FAQs"),
  // these collapse "cost in Luton?" / "cost in Harpenden?" / "cost in
  // Dunstable?" etc. into a single generic "cost" group.
  // Cities / towns this workspace operates in:
  'luton',
  'dunstable',
  'harpenden',
  'hemel',
  'hempstead',
  'albans',
  'st',
  'houghton',
  'regis',
  'wheathampstead',
  'redbourn',
  // County-level / region-level — safe to strip globally since "in the UK"
  // / "in Bedfordshire" etc. aren't topic-distinguishing.
  'bedfordshire',
  'hertfordshire',
  'uk',
  // Area modifiers that often accompany location-scoped questions
  // ("postcodes and areas" / "surrounding villages" / "regional coverage")
  'area',
  'areas',
  'local',
  'locally',
  'locality',
  'nearby',
  'near',
  'around',
  'postcode',
  'postcodes',
  'village',
  'villages',
  'town',
  'towns',
  'city',
  'cities',
  'regional',
  'region',
  'surrounding',
]);

/**
 * Regex for detecting location-tagged questions. Matches any of the tokens
 * the fingerprint strips from the "location" bucket. Used by
 * scoreFaqForDedup to PREFER location-free phrasing when two questions
 * fingerprint the same — e.g. "How much does window cleaning cost?" beats
 * "How much does window cleaning cost in Dunstable?" so the surviving FAQ
 * text reads generically even though both point to the same underlying
 * pricing topic.
 */
const LOCATION_OR_BRAND_PATTERN = new RegExp(
  [
    'mac\\s+cleaning',
    'maccleaning',
    'bizzybee',
    'luton',
    'dunstable',
    'harpenden',
    'hemel\\s+hempstead',
    'hemel',
    'hempstead',
    'st\\.?\\s+albans',
    'albans',
    'houghton\\s+regis',
    'houghton',
    'wheathampstead',
    'redbourn',
    'bedfordshire',
    'hertfordshire',
    'postcode',
    'postcodes',
  ].join('|'),
  'i',
);

function tokenizeForFingerprint(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Naive stemmer — folds simple English plurals/inflections so "cleans",
 * "cleaning", and "cleaned" all map to "clean". Deliberately shallow: we want
 * collisions on obvious variants without accidentally merging distinct words
 * (e.g. "basis" shouldn't stem to "ba").
 */
function simpleStem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (
    token.length > 3 &&
    token.endsWith('s') &&
    !token.endsWith('ss') &&
    !token.endsWith('us') &&
    !token.endsWith('is')
  ) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Deterministic fingerprint for grouping near-duplicate questions.
 *
 * Design choices, all to catch cross-batch restatements of the same intent:
 *
 * - lowercase + punctuation-stripped: "What is the cost?" and "What's the
 *   cost" bucket together.
 * - stopwords + brand tokens removed: "Do I need to be home when MAC
 *   Cleaning cleans my windows?" and "Do I need to be home for my window
 *   clean?" both reduce to {home, need, window, clean}.
 * - naive stemming: "cleans"/"cleaning"/"cleaned" → "clean".
 * - set + sorted: word order doesn't matter, duplicate tokens collapse.
 *
 * Returns empty string if every token was a stopword (rare — caller skips).
 */
export function fingerprintFaqQuestion(question: string): string {
  const tokens = tokenizeForFingerprint(question)
    .filter((t) => !FAQ_FINGERPRINT_STOPWORDS.has(t))
    .map(simpleStem);
  return Array.from(new Set(tokens)).sort().join(' ');
}

function scoreFaqForDedup(faq: FaqCandidate): number {
  const qualityScore = typeof faq.quality_score === 'number' ? faq.quality_score : 0;
  const evidenceLength = typeof faq.evidence_quote === 'string' ? faq.evidence_quote.length : 0;
  const answerLength = typeof faq.answer === 'string' ? faq.answer.length : 0;
  const question = typeof faq.question === 'string' ? faq.question : '';
  // Penalise location-/brand-tagged phrasing so the generic variant of a
  // fingerprint group wins. Example: fingerprint "cost window" has winners
  // "How much does window cleaning cost in Dunstable?" and "How much does
  // window cleaning cost?" — without this penalty the former may win on
  // quality_score alone, leaving a city-specific question title for a
  // workspace that doesn't price per-city. The penalty (-250) is smaller
  // than the quality_score signal's typical scale (0.5 quality_score ≈ 500
  // points) so a significantly better-grounded location-tagged FAQ can
  // still win over a weakly-grounded generic one.
  const locationPenalty = LOCATION_OR_BRAND_PATTERN.test(question) ? -250 : 0;
  // quality_score is the dominant signal (0..1). Evidence + answer length
  // break ties deterministically — longer, better-grounded wins.
  return (
    qualityScore * 1000 +
    Math.min(evidenceLength, 500) +
    Math.min(answerLength, 500) +
    locationPenalty
  );
}

/**
 * Fast, deterministic, in-process dedup of aggregated per-batch FAQ
 * candidates. Replaces the earlier Claude-powered dedup pass: runs in
 * milliseconds for ~100 candidates, no Anthropic call, no pgmq VT concerns,
 * no wall-clock risk.
 *
 * Groups candidates by `fingerprintFaqQuestion` and keeps the highest-scoring
 * (by quality_score + evidence/answer length) FAQ per group.
 */
export function dedupeAggregatedFaqs(faqs: FaqCandidate[]): {
  faqs: FaqCandidate[];
  groups_collapsed: number;
} {
  const byFingerprint = new Map<string, FaqCandidate>();
  let considered = 0;

  for (const faq of faqs) {
    // Only `question` is structurally required here — we fingerprint on it.
    // Downstream buildFaqRows/faq_database insert will handle missing
    // answer/source_url (the pre-refactor behaviour was to pass these through
    // to insert and let the caller decide whether incomplete FAQs matter).
    const question = typeof faq?.question === 'string' ? faq.question.trim() : '';
    if (!question) continue;

    // Fallback: pathological questions where every token is a stopword
    // (e.g. very short questions, or single letters like "A" used in tests)
    // collapse to an empty fingerprint. Rather than silently drop, bucket
    // by the raw normalized question so each distinct surface form keeps
    // its own slot.
    const fp = fingerprintFaqQuestion(question) || normalizeFaqQuestion(question);
    if (!fp) continue;

    considered += 1;
    const existing = byFingerprint.get(fp);
    if (!existing || scoreFaqForDedup(faq) > scoreFaqForDedup(existing)) {
      byFingerprint.set(fp, faq);
    }
  }

  return {
    faqs: Array.from(byFingerprint.values()),
    groups_collapsed: Math.max(0, considered - byFingerprint.size),
  };
}

export async function extractFaqCandidatesFromPages(params: {
  apiKey: string;
  model: string;
  context: SharedFaqPromptContext;
  pages: SharedFaqSourcePage[];
  sourceKind: SharedFaqSourceKind;
  onWebsiteProgress?: (progress: {
    batchIndex: number;
    batchCount: number;
    pagesInBatch: number;
    candidateCount: number;
    totalCandidateCount: number;
  }) => Promise<void> | void;
}): Promise<{ faqs: FaqCandidate[]; batchCount: number }> {
  if (params.sourceKind === 'own_site') {
    return extractWebsiteFaqsInChunks(
      params.apiKey,
      params.model,
      params.context,
      params.pages,
      params.onWebsiteProgress,
    );
  }

  const extracted = await extractCompetitorFaqCandidates(
    params.apiKey,
    params.model,
    params.context,
    params.pages,
  );

  return {
    faqs: extracted.candidates,
    batchCount: 1,
  };
}

export async function loadExistingFaqQuestions(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Set<string>> {
  const existing = await handleListExistingFaqs(supabase, { workspace_id: workspaceId });
  return new Set(existing.faqs.map((faq) => normalizeFaqQuestion(faq.question)));
}

export function dedupeFaqCandidatesAgainstQuestions(
  candidates: FaqCandidate[],
  existingQuestions: Set<string>,
): FaqCandidate[] {
  const seenQuestions = new Set(existingQuestions);
  const deduped: FaqCandidate[] = [];

  for (const candidate of candidates
    .filter((item) => item.question && item.answer && item.source_url && item.evidence_quote)
    .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0))) {
    const key = normalizeFaqQuestion(candidate.question);
    if (!key || seenQuestions.has(key)) continue;
    seenQuestions.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

export async function finalizeSharedFaqCandidates(params: {
  apiKey: string;
  model: string;
  context: SharedFaqPromptContext;
  candidates: FaqCandidate[];
  existingQuestions: string[];
}): Promise<{ faqs: FaqCandidate[] }> {
  return finalizeFaqCandidates(
    params.apiKey,
    params.model,
    params.context,
    params.candidates,
    params.existingQuestions,
  );
}

export async function dedupeSharedOwnWebsiteFaqs(params: {
  apiKey: string;
  model: string;
  context: SharedFaqPromptContext;
  candidates: FaqCandidate[];
}): Promise<{ faqs: FaqCandidate[] }> {
  return dedupeOwnWebsiteFaqsAcrossBatches(
    params.apiKey,
    params.model,
    params.context,
    params.candidates,
  );
}

export function buildFaqRows(params: {
  workspaceId: string;
  faqs: FaqCandidate[];
  category: string;
  isOwnContent: boolean;
}): Array<Record<string, unknown>> {
  return params.faqs.map((faq) => ({
    workspace_id: params.workspaceId,
    question: faq.question,
    answer: faq.answer,
    category: params.category,
    enabled: true,
    is_active: true,
    is_own_content: params.isOwnContent,
    source_url: faq.source_url,
    generation_source: faq.source_url,
    source_business: faq.source_business || null,
    source_company: faq.source_business || null,
    relevance_score: Math.round((faq.quality_score || 0) * 100),
  }));
}
