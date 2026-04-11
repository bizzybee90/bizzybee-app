-- Restore the store_encrypted_token RPC that was dropped from the live DB.
-- The function was originally created in migration 20260121171834 but is
-- missing from the live DB, causing both aurinko-auth-callback and
-- aurinko-create-imap-account to silently drop access tokens.
--
-- This recreates the original behaviour: read app.settings.token_encryption_secret
-- as a Postgres GUC, encrypt with pgp_sym_encrypt, fall back to plaintext if
-- no secret is configured (for development).
--
-- Also adds the unique index on (workspace_id, email_address) that the
-- onConflict upserts depend on.

-- Restore the function
CREATE OR REPLACE FUNCTION public.store_encrypted_token(
  p_config_id uuid,
  p_access_token text,
  p_refresh_token text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $$
DECLARE
  v_token_secret text;
BEGIN
  v_token_secret := current_setting('app.settings.token_encryption_secret', true);

  IF v_token_secret IS NULL OR v_token_secret = '' THEN
    -- No secret configured: store plaintext (dev/test environments only)
    UPDATE public.email_provider_configs
    SET
      access_token = p_access_token,
      refresh_token = p_refresh_token,
      updated_at = NOW()
    WHERE id = p_config_id;
  ELSE
    -- Production: encrypt with pgp_sym_encrypt and store as bytea in
    -- access_token_encrypted (note: the legacy text columns stay null)
    UPDATE public.email_provider_configs
    SET
      access_token_encrypted = extensions.pgp_sym_encrypt(p_access_token, v_token_secret),
      access_token = NULL,
      refresh_token = CASE
        WHEN p_refresh_token IS NOT NULL
        THEN extensions.pgp_sym_encrypt(p_refresh_token, v_token_secret)::text
        ELSE NULL
      END,
      encryption_key_id = 'app.settings.token_encryption_secret',
      updated_at = NOW()
    WHERE id = p_config_id;
  END IF;
END;
$$;

-- Lock down — only service role should call this directly
REVOKE EXECUTE ON FUNCTION public.store_encrypted_token(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.store_encrypted_token(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.store_encrypted_token(uuid, text, text) FROM authenticated;

-- Add the unique index that the onConflict upserts in aurinko-auth-callback
-- and aurinko-create-imap-account depend on.
CREATE UNIQUE INDEX IF NOT EXISTS email_provider_configs_workspace_email_unique
  ON public.email_provider_configs (workspace_id, email_address);;
