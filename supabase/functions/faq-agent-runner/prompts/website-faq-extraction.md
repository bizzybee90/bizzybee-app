You are extracting FAQs from the business's OWN website — one page at a time. These are the most authoritative answers because they come directly from the business owner.

BUSINESS CONTEXT

- Business name: {{business_name}}
- Business type: {{business_type}}
- Domain: {{domain}}
- Page URL: {{page_url}}
- Single-page site: {{single_page_site}}

PAGE CONTENT
{{page_content}}

---

## STEP 1 — CLASSIFY THE PAGE

Classify this page from the URL and content into ONE of:
homepage | service | location | pricing | about | faq | contact | blog | product | menu | policy | other

Return this classification as `page_type` on every FAQ you extract from this page.

Rules of thumb:

- `/`, `/home`, `/index` → homepage
- `/services/window-cleaning`, `/gutter-cleaning` → service
- `/window-cleaning-hitchin`, `/areas/harpenden` → location
- `/pricing`, `/prices` → pricing
- `/about`, `/why-us`, `/our-story` → about
- `/faq`, `/faqs`, `/questions` → faq
- `/contact`, `/get-in-touch` → contact
- `/blog/*`, `/news/*` → blog
- `/products/*`, `/shop/*` → product
- `/menu`, `/food`, `/drinks` → menu
- `/returns`, `/shipping`, `/privacy`, `/terms` → policy
- Anything else → other

---

## STEP 2 — APPLY THE DEDUPLICATION RULE

If single_page_site = true:
→ Extract everything useful. There are no other pages to worry about. Skip to Step 3.

If single_page_site = false:
→ You are extracting from ONE page out of many. Other pages are extracted separately. Only extract what is DISTINCTIVE to THIS page.
→ Before extracting any fact, ask: "Is THIS page the natural home for this fact?" If no, skip it — another page will capture it.
→ Page-type guidance: - homepage: core USP, high-level service overview, coverage summary. Skip detail belonging on dedicated pages. - service: questions specific to THAT service only. Do NOT restate brand-level facts (insurance, guarantee, company experience). - location: ONLY location-specific facts (streets/areas covered within that town, location-specific pricing if different, local testimonials). DO NOT restate generic service facts that appear on every location page. Most location pages should produce 0–2 FAQs, not 6. Zero is fine. - pricing: pricing, packages, minimums, billing, discounts. - about: insurance, guarantees, experience, accreditations, reviews, company trust signals. - faq: extract every relevant question without exception. This page IS the natural home for generic facts. - contact: usually nothing. Skip unless it contains genuine FAQs. - blog: only the specific question the post answers, if any. - product: product-specific details, variants, what's included, specifications. - menu: dish/item specifics, pricing, dietary info. - policy: only the specific policy content (returns, shipping, privacy, etc.). - other: extract conservatively — only facts clearly tied to this page's specific content.

---

## STEP 3 — QUESTION PHRASING (CRITICAL FOR DEDUPE)

Write questions in a GENERIC, customer-voice form. Never embed the business name or a specific location in the question text. The same fact must produce the same question wording regardless of which page it came from.

Bad: "How high can MAC Cleaning reach with their water-fed poles?"
Good: "How high can you reach?"

Bad: "Do you clean windows in Hitchin?"
Good: "Do you cover my area?" (list towns in the answer)

Bad: "What does a window clean cost in Harpenden?"
Good: "How much does a window clean cost?"

ONE FACT = ONE QUESTION. ONE PHRASING ONLY. If you're tempted to write "How high can you reach?" AND "What's the maximum pole height?" — stop. They're the same question. Pick one.

Never produce two questions that resolve to the same underlying answer. If an answer could serve two questions, merge them.

---

## STEP 4 — ANSWER RULES

- First person, as the business owner. "We", "our", "us". Never the business name in third person.
- 1–3 sentences. Direct. Specific. No fluff, no "we pride ourselves on".
- Only state facts that appear on THIS page. If a detail isn't there, leave it out. Missing > wrong.
- Use the exact words from the page for product names, prices, and specific terminology. No synonyms.

---

## OUTPUT FORMAT

Return valid JSON only. Do not wrap the JSON in markdown fences.

{
"faqs": [
{
"question": "Natural, generic, one phrasing only",
"answer": "1-3 sentences in first person",
"category": "Services | Pricing | Policies | Process | Coverage | Trust | General",
"source_url": "the page URL",
"page_type": "classification from Step 1",
"evidence_quote": "verbatim quote from the page that grounds this FAQ",
"quality_score": 0.0
}
]
}

Expected volume per page type (multi-page sites):

- homepage: 3–6
- service: 3–8
- location: 0–2
- pricing: 3–8
- about: 3–6
- faq: 10–25 (extract everything)
- contact/blog: 0–3
- product: 2–6 per product
- menu: 3–8
- policy: 2–5
- other: 0–5

Zero is valid. If a page only restates facts covered elsewhere, extract nothing and move on.

quality_score must be between 0 and 1. Skip any FAQ that is not clearly grounded in the page.
