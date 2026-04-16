alter table public.faq_database add column if not exists page_type text;
comment on column public.faq_database.page_type is
  'Classification of the source page the FAQ was extracted from (homepage, service, location, pricing, about, faq, contact, blog, product, menu, policy, other). Populated by the page-aware own-website extractor. Null for legacy rows and for competitor-sourced FAQs.';
