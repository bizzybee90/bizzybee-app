import { describe, expect, it, vi } from 'vitest';

// Stub the esm.sh Supabase import so vitest/Node can load this module graph.
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.57.2', () => ({}));

// Dynamic import so vi.mock calls are hoisted before module resolution.
const { buildFaqRows, dedupeAggregatedFaqs, fingerprintFaqQuestion } =
  await import('./onboarding-faq-engine.ts');

type FaqCandidate = {
  question: string;
  answer?: string;
  source_url?: string;
  evidence_quote?: string;
  quality_score?: number;
  source_business?: string;
  page_type?: string;
  category?: string;
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

  it('DEFAULT (collapseLocations=false): keeps per-city pricing variants distinct', () => {
    // Default behaviour — safe for any business. A taxi or delivery
    // service may genuinely price differently per city, so we DON'T
    // collapse these unless the workspace opts in via
    // business_context.custom_flags.faq_dedup_collapse_locations.
    const luton = fingerprintFaqQuestion('How much does window cleaning cost in Luton?');
    const dunstable = fingerprintFaqQuestion('How much does window cleaning cost in Dunstable?');
    const generic = fingerprintFaqQuestion('How much does window cleaning cost?');
    expect(luton).not.toBe(dunstable);
    expect(luton).not.toBe(generic);
    expect(dunstable).not.toBe(generic);
  });

  it('OPT-IN (collapseLocations=true): collapses location-tagged pricing variants', () => {
    // Per 2026-04-16 MAC Cleaning user feedback: "No area is more
    // expensive than another, so we don't need per-city pricing FAQs."
    // With the flag on, location tokens strip to the same generic
    // fingerprint so the 5-6 per-city pricing questions the per-batch
    // extractor produces collapse into one group at persist.
    const opts = { collapseLocations: true };
    const luton = fingerprintFaqQuestion('How much does window cleaning cost in Luton?', opts);
    const dunstable = fingerprintFaqQuestion(
      'How much does window cleaning cost in Dunstable?',
      opts,
    );
    const harpenden = fingerprintFaqQuestion(
      'How much does window cleaning cost in Harpenden?',
      opts,
    );
    const generic = fingerprintFaqQuestion('How much does window cleaning cost?', opts);
    expect(luton).toBe(dunstable);
    expect(luton).toBe(harpenden);
    expect(luton).toBe(generic);
  });

  it('OPT-IN: collapses "areas / coverage" location phrasings but keeps service-scoped coverage distinct', () => {
    const opts = { collapseLocations: true };
    const a = fingerprintFaqQuestion('Which areas does MAC Cleaning cover?', opts);
    const b = fingerprintFaqQuestion('Which areas of Luton do you cover?', opts);
    const c = fingerprintFaqQuestion('Which areas of St Albans do MAC Cleaning cover?', opts);
    const d = fingerprintFaqQuestion('Do you cover Houghton Regis and Dunstable?', opts);
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toBe(d);

    // Service-scoped coverage stays distinct from the bare "cover" group
    // because the service token (window/fascia) survives the stopword pass.
    const windowCover = fingerprintFaqQuestion(
      'What areas does MAC Cleaning cover for window cleaning?',
      opts,
    );
    const fasciaCover = fingerprintFaqQuestion(
      'What areas does MAC Cleaning serve for fascia cleaning?',
      opts,
    );
    expect(windowCover).not.toBe(a);
    expect(fasciaCover).not.toBe(windowCover);
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

  it('DEFAULT (collapseLocations=false): keeps per-city pricing variants as separate FAQs', () => {
    // Safe default. Without the opt-in, per-city pricing stays distinct —
    // the right behaviour for a taxi/delivery workspace that prices per
    // area. The only collapse is brand-variant ("What services do you
    // offer?" vs "MAC Cleaning"), which is always safe regardless of
    // location behaviour.
    const input = [
      makeFaq('How much does window cleaning cost in Luton?', 0.9),
      makeFaq('How much does window cleaning cost in Dunstable?', 0.95),
      makeFaq('How much does window cleaning cost in Harpenden?', 0.85),
      makeFaq('How much does window cleaning cost?', 0.8),
    ];
    const { faqs, groups_collapsed } = dedupeAggregatedFaqs(input);
    expect(faqs).toHaveLength(4);
    expect(groups_collapsed).toBe(0);
  });

  it('OPT-IN (collapseLocations=true): collapses location-tagged pricing variants and prefers the generic phrasing as winner', () => {
    // Matches real 2026-04-16 MAC Cleaning data: 6 per-city pricing FAQs
    // all with the same underlying answer. Dedup collapses them AND the
    // location penalty in scoreFaqForDedup tips the winner toward the
    // generic phrasing — so the surviving question reads "How much does
    // window cleaning cost?" not "...in Dunstable?" even when the city
    // variant has higher quality_score.
    const input = [
      makeFaq('How much does window cleaning cost in Luton?', 0.9),
      makeFaq('How much does window cleaning cost in Dunstable?', 0.95),
      makeFaq('How much does window cleaning cost in Harpenden?', 0.85),
      makeFaq('How much does window cleaning cost?', 0.8),
    ];
    const { faqs, groups_collapsed } = dedupeAggregatedFaqs(input, { collapseLocations: true });
    expect(faqs).toHaveLength(1);
    expect(groups_collapsed).toBe(3);
    // Generic variant wins despite lower quality_score: the -250 location
    // penalty pushes Dunstable's score below the generic's.
    expect(faqs[0].question).toBe('How much does window cleaning cost?');
  });

  it('OPT-IN: falls back to city-tagged winner when NO generic variant exists', () => {
    // If the per-batch extractor never produced the generic phrasing, the
    // best city-tagged variant still wins — we don't want dedup to produce
    // zero survivors for a valid topic.
    const input = [
      makeFaq('How much does window cleaning cost in Luton?', 0.7),
      makeFaq('How much does window cleaning cost in Dunstable?', 0.9),
      makeFaq('How much does window cleaning cost in Harpenden?', 0.6),
    ];
    const { faqs } = dedupeAggregatedFaqs(input, { collapseLocations: true });
    expect(faqs).toHaveLength(1);
    expect(faqs[0].question).toBe('How much does window cleaning cost in Dunstable?');
    expect(faqs[0].quality_score).toBe(0.9);
  });

  it('keeps service-specific variants (gutter vs fascia vs conservatory) distinct', () => {
    const input = [
      makeFaq('How much does gutter clearing cost?', 0.8),
      makeFaq('How much does fascia cleaning cost?', 0.85),
      makeFaq('How much does conservatory roof cleaning cost?', 0.75),
      makeFaq('How much does window cleaning cost?', 0.9),
    ];
    const { faqs } = dedupeAggregatedFaqs(input);
    expect(faqs).toHaveLength(4);
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

describe('buildFaqRows', () => {
  // The page-aware own-website extractor now emits `page_type` and
  // `category` per FAQ (see website-faq-extraction.md Step 1 + output
  // format). buildFaqRows is the final hop before faq_database.insert —
  // these tests guard that the new fields thread through, and that the
  // category falls back to the caller's default when Claude omits it
  // (legacy path / competitor extraction). `page_type` always writes as
  // null when absent so the DB column stays clean for legacy rows.
  it('threads page_type through and defaults to null when absent', () => {
    const rows = buildFaqRows({
      workspaceId: 'ws-1',
      category: 'knowledge_base',
      isOwnContent: true,
      faqs: [
        {
          question: 'How high can you reach?',
          answer: 'Up to 3 storeys.',
          source_url: 'https://example.com/services',
          evidence_quote: 'Our water-fed poles reach three storeys.',
          quality_score: 0.9,
          page_type: 'service',
        },
        {
          question: 'Generic question?',
          answer: 'Generic answer.',
          source_url: 'https://example.com/',
          evidence_quote: 'Evidence.',
          quality_score: 0.5,
          // No page_type — legacy or structured-FAQ path.
        },
      ] as unknown as Parameters<typeof buildFaqRows>[0]['faqs'],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].page_type).toBe('service');
    expect(rows[1].page_type).toBeNull();
  });

  it('prefers FAQ-level category when present and falls back to params.category when absent', () => {
    const rows = buildFaqRows({
      workspaceId: 'ws-1',
      category: 'knowledge_base',
      isOwnContent: true,
      faqs: [
        {
          question: 'Are you insured?',
          answer: 'Yes — £5m public liability.',
          source_url: 'https://example.com/about',
          evidence_quote: 'Covered by £5m public liability insurance.',
          quality_score: 0.9,
          category: 'Trust',
        },
        {
          question: 'How do you pay?',
          answer: 'Card or bank transfer after the visit.',
          source_url: 'https://example.com/pricing',
          evidence_quote: 'Pay by card or bank transfer.',
          quality_score: 0.8,
          // No category — falls back to params.category.
        },
      ] as unknown as Parameters<typeof buildFaqRows>[0]['faqs'],
    });

    expect(rows).toHaveLength(2);
    // FAQ-level category wins.
    expect(rows[0].category).toBe('Trust');
    // Absent category → fallback.
    expect(rows[1].category).toBe('knowledge_base');
  });
});
