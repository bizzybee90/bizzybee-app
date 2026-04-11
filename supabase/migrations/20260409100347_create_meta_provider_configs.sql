-- Per-workspace Meta credentials for Facebook Messenger + Instagram DMs.
-- One row per Facebook Page. If the Page has a linked Instagram Business
-- account, both channels share the same row and the same Page Access Token.

CREATE TABLE public.meta_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  page_name text,
  instagram_account_id text,
  instagram_username text,
  encrypted_page_access_token text NOT NULL,
  token_expires_at timestamptz,
  meta_user_id text,
  status text NOT NULL DEFAULT 'active',
  connected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, page_id)
);

ALTER TABLE public.meta_provider_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to meta_provider_configs"
  ON public.meta_provider_configs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Workspace members can read their meta provider configs"
  ON public.meta_provider_configs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = meta_provider_configs.workspace_id
      AND wm.user_id = auth.uid()
  ));

GRANT SELECT ON public.meta_provider_configs TO authenticated;

-- RPC to encrypt and store a Meta Page Access Token.
CREATE OR REPLACE FUNCTION public.store_meta_encrypted_token(
  p_config_id uuid,
  p_page_access_token text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_secret text;
BEGIN
  v_secret := current_setting('app.settings.token_encryption_secret', true);
  IF v_secret IS NOT NULL AND v_secret != '' THEN
    UPDATE public.meta_provider_configs
    SET encrypted_page_access_token = pgp_sym_encrypt(p_page_access_token, v_secret)
    WHERE id = p_config_id;
  ELSE
    UPDATE public.meta_provider_configs
    SET encrypted_page_access_token = p_page_access_token
    WHERE id = p_config_id;
  END IF;
END;
$$;

-- RPC to decrypt a Meta Page Access Token (called by edge functions via service role).
CREATE OR REPLACE FUNCTION public.get_meta_decrypted_token(
  p_config_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_secret text;
  v_encrypted text;
BEGIN
  v_secret := current_setting('app.settings.token_encryption_secret', true);

  SELECT encrypted_page_access_token INTO v_encrypted
  FROM public.meta_provider_configs
  WHERE id = p_config_id;

  IF v_encrypted IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_secret IS NOT NULL AND v_secret != '' THEN
    RETURN pgp_sym_decrypt(v_encrypted::bytea, v_secret);
  ELSE
    RETURN v_encrypted;
  END IF;
END;
$$;;
