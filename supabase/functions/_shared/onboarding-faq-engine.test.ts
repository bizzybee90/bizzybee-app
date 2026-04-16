import { describe, expect, it, vi } from 'vitest';

// Stub the esm.sh Supabase import so vitest/Node can load this module graph.
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.57.2', () => ({}));

// Dynamic import so vi.mock calls are hoisted before module resolution.
const { dedupeAggregatedFaqs, fingerprintFaqQuestion } = await import('./onboarding-faq-engine.ts');

type FaqCandidate = {
  question: string;
  answer?: string;
  source_url?: string;
  evidence_quote?: string;
  quality_score?: number;
  source_business?: string;
};

function makeFaq(
  question: string,
  qualityScore = 0.5,
  extras: Partial<FaqCandidate> = {},
): FaqCandidate {
  return {
    question,
    answer: extras.answer ?? 'Answer text',
    source_url: extras.source_url ?? 'https://example.com/',
    evidence_quote: extras.evidence_quote ?? 'Evidence quote.',
    quality_score: qualityScore,
    source_business: extras.source_business ?? 'Example',
  };
}

describe('fingerprintFaqQuestion', () => {
  it('produces the same fingerprint for brand-reference + word-order variants', () => {
    // Same intent, different wording the per-batch Claude extraction
    // routinely restates across pages.
    const a = fingerprintFaqQuestion('What services do you offer?');
    const b = fingerprintFaqQuestion('What services does MAC Cleaning offer?');
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('produces the same fingerprint for plural/inflection variants (naive stem)', () => {
    const a = fingerprintFaqQuestion('How do you clean windows?');
    const b = fingerprintFaqQuestion('How does MAC Cleaning clean the window?');
    expect(a).toBe(b);
  });

  it('keeps location-specific variants distinct (Luton vs Dunstable vs Harpenden)', () => {
    const luton = fingerprintFaqQuestion('How much does window cleaning cost in Luton?');
    const dunstable = fingerprintFaqQuestion('How much does window cleaning cost in Dunstable?');
    const harpenden = fingerprintFaqQuestion('How much does window cleaning cost in Harpenden?');
    expect(luton).not.toBe(dunstable);
    expect(luton).not.toBe(harpenden);
    expect(dunstable).not.toBe(harpenden);
  });

  it('keeps service-specific variants distinct (gutter vs fascia vs conservatory)', () => {
    const gutter = fingerprintFaqQuestion('How much does gutter clearing cost?');
    const fascia = fingerprintFaqQuestion('How much does fascia cleaning cost?');
    const conservatory = fingerprintFaqQuestion('How much does conservatory roof cleaning cost?');
    expect(gutter).not.toBe(fascia);
    expect(gutter).not.toBe(conservatory);
    expect(fascia).not.toBe(conservatory);
  });

  it('produces the same fingerprint regardless of punctuation / word order', () => {
    const a = fingerprintFaqQuestion('How much does window cleaning cost with MAC Cleaning?');
    const b = fingerprintFaqQuestion('How much does window cleaning with MAC Cleaning cost?');
    expect(a).toBe(b);
  });
});

describe('dedupeAggregatedFaqs', () => {
  it('returns candidates unchanged when no duplicates', () => {
    const input = [
      makeFaq('How much does gutter clearing cost?', 0.8),
      makeFaq('How high can MAC Cleaning reach with water-fed poles?', 0.7),
      makeFaq('Do you cover Dunstable?', 0.6),
    ];
    const { faqs, groups_collapsed } = dedupeAggregatedFaqs(input);
    expect(faqs).toHaveLength(3);
    expect(groups_collapsed).toBe(0);
  });

  it('collapses exact-dup questions and keeps the highest quality_score', () => {
    const input = [
      makeFaq('How much does window cleaning cost in Luton?', 0.7),
      makeFaq('How much does window cleaning cost in Luton?', 0.9),
      makeFaq('How much does window cleaning cost in Luton?', 0.5),
    ];
    const { faqs, groups_collapsed } = dedupeAggregatedFaqs(input);
    expect(faqs).toHaveLength(1);
    expect(faqs[0].quality_score).toBe(0.9);
    expect(groups_collapsed).toBe(2);
  });

  it('collapses brand-reference variants to one winner (real MAC-Cleaning pattern)', () => {
    const input = [
      makeFaq('What services do you offer?', 0.75, {
        evidence_quote:
          'We offer four main services: window, gutter, fascia, conservatory cleaning.',
      }),
      makeFaq('What services does MAC Cleaning offer?', 0.65, {
        evidence_quote: 'Four services.',
      }),
      makeFaq('Do you clean gutters?', 0.85), // distinct topic — kept
    ];
    const { faqs } = dedupeAggregatedFaqs(input);
    expect(faqs).toHaveLength(2);
    const questions = faqs.map((f) => f.question).sort();
    expect(questions).toEqual(['Do you clean gutters?', 'What services do you offer?']);
  });

  it('preserves location-specific pricing variants even when the rest of the wording matches', () => {
    const input = [
      makeFaq('How much does window cleaning cost in Luton?', 0.9),
      makeFaq('How much does window cleaning cost in Dunstable?', 0.8),
      makeFaq('How much does window cleaning cost in Harpenden?', 0.85),
    ];
    const { faqs } = dedupeAggregatedFaqs(input);
    expect(faqs).toHaveLength(3);
  });

  it('uses evidence_quote + answer length as deterministic tiebreakers when quality_score ties', () => {
    const input = [
      makeFaq('Same question?', 0.8, {
        answer: 'Short.',
        evidence_quote: 'Short.',
      }),
      makeFaq('Same question?', 0.8, {
        answer:
          'A much longer, more grounded answer with concrete numbers: £15 per 3-bed semi, 4-weekly visits, no contract required.',
        evidence_quote:
          'A much longer evidence quote that shows stronger grounding in the source page content.',
      }),
    ];
    const { faqs } = dedupeAggregatedFaqs(input);
    expect(faqs).toHaveLength(1);
    expect(faqs[0].answer).toContain('concrete numbers');
  });

  it('skips candidates with empty/missing question', () => {
    const input = [
      makeFaq('Valid question?', 0.5),
      { question: '', answer: 'x', source_url: 'x' } as FaqCandidate,
      { answer: 'x', source_url: 'x' } as FaqCandidate,
      { question: '   ', answer: 'x', source_url: 'x' } as FaqCandidate,
    ];
    const { faqs } = dedupeAggregatedFaqs(input);
    expect(faqs).toHaveLength(1);
    expect(faqs[0].question).toBe('Valid question?');
  });

  it('handles pathological single-letter test stubs without dropping them via stopword-only fingerprint', () => {
    // Regression: "A" is in the stopword list, so tokenize→filter leaves
    // an empty fingerprint. Without the raw-question fallback, "A" would
    // be silently dropped. Existing persist-branch tests use single-letter
    // stubs; they must continue to flow through dedup unchanged.
    const input = [makeFaq('A', 0.5), makeFaq('B', 0.5), makeFaq('C', 0.5), makeFaq('D', 0.5)];
    const { faqs } = dedupeAggregatedFaqs(input);
    expect(faqs).toHaveLength(4);
  });

  it('returns empty list for empty input (no crash, no NaN)', () => {
    const { faqs, groups_collapsed } = dedupeAggregatedFaqs([]);
    expect(faqs).toEqual([]);
    expect(groups_collapsed).toBe(0);
  });
});
