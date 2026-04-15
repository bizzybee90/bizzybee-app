-- Restore get_decrypted_access_token for the live email pipeline.
--
-- The migration history indicates this function should exist, but the live
-- project is missing it in the schema cache. Multiple edge functions depend on
-- it for loading encrypted Aurinko credentials, including start-email-import,
-- pipeline-worker-import, aurinko-webhook, refresh-aurinko-subscriptions, and
-- send-reply.

DROP FUNCTION IF EXISTS public.get_decrypted_access_token(uuid);
CREATE OR REPLACE FUNCTION public.get_decrypted_access_token(p_config_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token_secret text;
  v_access_token text;
  v_config_workspace_id uuid;
  v_caller_workspace_id uuid;
BEGIN
  SELECT workspace_id
  INTO v_config_workspace_id
  FROM public.email_provider_configs
  WHERE id = p_config_id;

  IF v_config_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    SELECT workspace_id
    INTO v_caller_workspace_id
    FROM public.users
    WHERE id = auth.uid();

    IF v_caller_workspace_id IS NULL OR v_caller_workspace_id <> v_config_workspace_id THEN
      RAISE EXCEPTION 'Access denied: workspace mismatch';
    END IF;
  END IF;

  v_token_secret := current_setting('app.settings.token_encryption_secret', true);

  SELECT access_token
  INTO v_access_token
  FROM public.email_provider_configs
  WHERE id = p_config_id;

  IF v_access_token IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_token_secret IS NOT NULL AND v_token_secret <> '' THEN
    BEGIN
      RETURN extensions.pgp_sym_decrypt(v_access_token::bytea, v_token_secret);
    EXCEPTION
      WHEN OTHERS THEN
        RETURN v_access_token;
    END;
  END IF;

  RETURN v_access_token;
END;
$$;
REVOKE ALL ON FUNCTION public.get_decrypted_access_token(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_decrypted_access_token(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_decrypted_access_token(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_decrypted_access_token(uuid) TO service_role;
