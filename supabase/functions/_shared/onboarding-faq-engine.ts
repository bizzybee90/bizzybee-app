import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import {
  dedupeOwnWebsiteFaqsAcrossBatches,
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
 * BASE stopwords — always stripped regardless of workspace settings.
 * Generic English + brand/self-reference. Safe for every business: "Does
 * MAC Cleaning X?" ≡ "Do you X?" is true regardless of whether the
 * business prices per area.
 */
const BASE_FAQ_FINGERPRINT_STOPWORDS = new Set([
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
]);

/**
 * OPT-IN location stopwords — stripped ONLY when `collapseLocations: true` is
 * passed to fingerprintFaqQuestion / dedupeAggregatedFaqs.
 *
 * Per the 2026-04-16 MAC Cleaning user feedback: "No area is more expensive
 * than another, so we don't need per-city pricing FAQs." For businesses that
 * DON'T price per location, stripping these collapses redundant
 * "cost in Luton?" / "cost in Harpenden?" questions into a single winner.
 *
 * For businesses that DO price per area (rare in cleaning, more common in
 * taxi / delivery / last-mile services), keep collapseLocations=false and
 * these tokens stay in the fingerprint — per-city questions remain distinct.
 *
 * Current list is UK-specific (towns this project's early-access workspaces
 * operate in). Can grow as more UK/international areas are needed. A fully
 * dynamic list (e.g. pulled from a geographies table or the workspace's
 * own location pages) is a future refinement.
 */
const LOCATION_FAQ_FINGERPRINT_STOPWORDS = new Set([
  // Cities / towns
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
  // County / region
  'bedfordshire',
  'hertfordshire',
  'uk',
  // Area modifiers ("postcodes and areas", "surrounding villages", etc.)
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
 * Pre-computed combined set for the `collapseLocations: true` path — avoids
 * constructing a new Set on every fingerprint call when the flag is on.
 */
const COMBINED_FAQ_FINGERPRINT_STOPWORDS = new Set([
  ...BASE_FAQ_FINGERPRINT_STOPWORDS,
  ...LOCATION_FAQ_FINGERPRINT_STOPWORDS,
]);

/**
 * Regex for detecting location-/brand-tagged questions. Used by the
 * location-penalty branch of scoreFaqForDedup so that, within a single
 * fingerprint group, the generic phrasing wins over a city-tagged one.
 * Only applied when `collapseLocations: true`.
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

/**
 * When collapseLocations is false, we still want to prefer the generic
 * brand-stripped variant over a MAC-Cleaning-tagged duplicate within the
 * same fingerprint group — brand dedup is always safe regardless of
 * location behaviour. This is the narrower penalty regex used for the
 * collapseLocations=false path.
 */
const BRAND_ONLY_PATTERN = new RegExp(
  ['mac\\s+cleaning', 'maccleaning', 'bizzybee'].join('|'),
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
 * Options threaded through fingerprint + dedup + score so a single
 * workspace-level flag (`business_context.custom_flags.faq_dedup_collapse_locations`)
 * switches the full pipeline between "keep per-city questions distinct"
 * (default, safe for any business) and "collapse per-city questions into
 * one generic winner" (opt-in, for businesses that don't price per area).
 */
export interface FaqFingerprintOptions {
  /**
   * When true, strip UK city/area tokens in addition to the base stopwords
   * and apply a location-penalty to location-tagged candidates during
   * winner selection. Default false.
   */
  collapseLocations?: boolean;
}

/**
 * Deterministic fingerprint for grouping near-duplicate questions.
 *
 * Design choices, all to catch cross-batch restatements of the same intent:
 *
 * - lowercase + punctuation-stripped: "What is the cost?" and "What's the
 *   cost" bucket together.
 * - base stopwords + brand tokens removed: "Do I need to be home when MAC
 *   Cleaning cleans my windows?" and "Do I need to be home for my window
 *   clean?" both reduce to {home, need, window, clean}.
 * - naive stemming: "cleans"/"cleaning"/"cleaned" → "clean".
 * - set + sorted: word order doesn't matter, duplicate tokens collapse.
 * - opt-in location collapse (`collapseLocations: true`): also strips UK
 *   city/area tokens so "cost in Luton?" ≡ "cost in Dunstable?" ≡ "cost?".
 *
 * Returns empty string if every token was a stopword (rare — caller skips
 * or falls back to the raw normalized question).
 */
export function fingerprintFaqQuestion(
  question: string,
  options: FaqFingerprintOptions = {},
): string {
  const stopwords = options.collapseLocations
    ? COMBINED_FAQ_FINGERPRINT_STOPWORDS
    : BASE_FAQ_FINGERPRINT_STOPWORDS;
  const tokens = tokenizeForFingerprint(question)
    .filter((t) => !stopwords.has(t))
    .map(simpleStem);
  return Array.from(new Set(tokens)).sort().join(' ');
}

function scoreFaqForDedup(faq: FaqCandidate, options: FaqFingerprintOptions = {}): number {
  const qualityScore = typeof faq.quality_score === 'number' ? faq.quality_score : 0;
  const evidenceLength = typeof faq.evidence_quote === 'string' ? faq.evidence_quote.length : 0;
  const answerLength = typeof faq.answer === 'string' ? faq.answer.length : 0;
  const question = typeof faq.question === 'string' ? faq.question : '';
  // When collapseLocations=true, penalise ANY location-/brand-tagged phrasing
  // so the generic variant of a fingerprint group wins (surviving text reads
  // "How much does window cleaning cost?" not "...in Dunstable?"). When
  // collapseLocations=false, brand dedup is still safe — apply a narrower
  // penalty to MAC Cleaning / BizzyBee brand tokens only, so "What services
  // does MAC Cleaning offer?" loses to "What services do you offer?" even
  // when we're NOT stripping locations.
  const penaltyPattern = options.collapseLocations ? LOCATION_OR_BRAND_PATTERN : BRAND_ONLY_PATTERN;
  // Penalty magnitude (-250) is smaller than the quality_score signal's
  // typical scale (0.5 quality_score ≈ 500 points) so a significantly
  // better-grounded location-tagged FAQ can still win over a weakly-
  // grounded generic one.
  const penalty = penaltyPattern.test(question) ? -250 : 0;
  // quality_score is the dominant signal (0..1). Evidence + answer length
  // break ties deterministically — longer, better-grounded wins.
  return (
    qualityScore * 1000 + Math.min(evidenceLength, 500) + Math.min(answerLength, 500) + penalty
  );
}

/**
 * Fast, deterministic, in-process dedup of aggregated per-batch FAQ
 * candidates. Replaces the earlier Claude-powered dedup pass: runs in
 * milliseconds for ~100 candidates, no Anthropic call, no pgmq VT concerns,
 * no wall-clock risk.
 *
 * Groups candidates by `fingerprintFaqQuestion` and keeps the highest-scoring
 * (by quality_score + evidence/answer length, minus location/brand penalty)
 * FAQ per group. Pass `collapseLocations: true` to additionally fold
 * per-city variants into a single generic winner.
 */
export function dedupeAggregatedFaqs(
  faqs: FaqCandidate[],
  options: FaqFingerprintOptions = {},
): {
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
    const fp = fingerprintFaqQuestion(question, options) || normalizeFaqQuestion(question);
    if (!fp) continue;

    considered += 1;
    const existing = byFingerprint.get(fp);
    if (!existing || scoreFaqForDedup(faq, options) > scoreFaqForDedup(existing, options)) {
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
  // Both source kinds now route through the chunked per-page extractor.
  // Previously competitors used a single-shot extractCompetitorFaqCandidates
  // call that took ALL pages at once — which starved the prompt of per-page
  // focus and silently produced far fewer FAQs than own-site's per-page
  // loop. With competitors now crawling 8 pages each (handleFetchSourcePage
  // max_pages=8), the all-at-once path also blew the Claude token budget.
  // The finalizer step (finalizeSharedFaqCandidates) handles brand-name
  // stripping and source-of-truth policing that used to live in the
  // competitor-specific extraction prompt, so we no longer need a
  // competitor-dedicated extractor here.
  return extractWebsiteFaqsInChunks(
    params.apiKey,
    params.model,
    params.context,
    params.pages,
    params.onWebsiteProgress,
    { finalLimit: params.sourceKind === 'competitor' ? 60 : 15 },
  );
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
    // Page-aware own-website extractor emits a topical category per FAQ
    // (Services, Pricing, Policies, ...). Prefer it when present; fall back
    // to the caller-provided default (e.g. 'knowledge_base') otherwise so
    // legacy callers and competitor FAQs keep their existing category.
    category: faq.category || params.category,
    enabled: true,
    is_active: true,
    is_own_content: params.isOwnContent,
    source_url: faq.source_url,
    generation_source: faq.source_url,
    source_business: faq.source_business || null,
    source_company: faq.source_business || null,
    relevance_score: Math.round((faq.quality_score || 0) * 100),
    // Populated by the page-aware own-website extractor (homepage, service,
    // location, pricing, about, faq, contact, blog, product, menu, policy,
    // other). Null for competitor-sourced FAQs and legacy rows.
    page_type: faq.page_type ?? null,
  }));
}
