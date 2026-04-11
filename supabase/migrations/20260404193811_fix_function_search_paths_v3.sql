
ALTER FUNCTION public.seed_workspace_channels() SET search_path = public;
ALTER FUNCTION public.update_updated_at() SET search_path = public;
ALTER FUNCTION public.upsert_ai_phone_usage(uuid, date, integer, numeric, integer) SET search_path = public;
ALTER FUNCTION public.bb_norm_identifier(text, text) SET search_path = public;
ALTER FUNCTION public.bb_try_timestamptz(text) SET search_path = public;
ALTER FUNCTION public.match_faqs(vector, uuid, double precision, integer) SET search_path = public;
;
