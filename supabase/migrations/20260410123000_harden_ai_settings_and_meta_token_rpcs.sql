-- Add workspace-level AI model preference for the code-owned email pipeline
-- and tighten a few high-value security surfaces without relying on repo-root
-- migration state being perfectly canonical.

ALTER TABLE IF EXISTS public.automation_settings
  ADD COLUMN IF NOT EXISTS email_model text;

COMMENT ON COLUMN public.automation_settings.email_model IS
  'Optional workspace override for the email classification/drafting Anthropic model. NULL uses the default Sonnet model.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname = 'automation_settings'
  ) THEN
    DROP POLICY IF EXISTS "Users can view their workspace automation settings" ON public.automation_settings;
    DROP POLICY IF EXISTS "Users can insert their workspace automation settings" ON public.automation_settings;
    DROP POLICY IF EXISTS "Users can update their workspace automation settings" ON public.automation_settings;

    CREATE POLICY "Users can view their workspace automation settings"
      ON public.automation_settings
      FOR SELECT
      TO authenticated
      USING (public.user_has_workspace_access(workspace_id));

    CREATE POLICY "Users can insert their workspace automation settings"
      ON public.automation_settings
      FOR INSERT
      TO authenticated
      WITH CHECK (public.user_has_workspace_access(workspace_id));

    CREATE POLICY "Users can update their workspace automation settings"
      ON public.automation_settings
      FOR UPDATE
      TO authenticated
      USING (public.user_has_workspace_access(workspace_id))
      WITH CHECK (public.user_has_workspace_access(workspace_id));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname = 'system_prompts'
  ) THEN
    DROP POLICY IF EXISTS "Users can view prompts in their workspace" ON public.system_prompts;
    DROP POLICY IF EXISTS "Users can view workspace prompts only" ON public.system_prompts;

    CREATE POLICY "Users can view workspace prompts only"
      ON public.system_prompts
      FOR SELECT
      TO authenticated
      USING (
        (
          workspace_id IS NOT NULL
          AND public.user_has_workspace_access(workspace_id)
        )
        OR (
          workspace_id IS NULL
          AND public.has_role(auth.uid(), 'admin'::public.app_role)
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'store_meta_encrypted_token'
      AND oidvectortypes(proargtypes) = 'uuid, text'
  ) THEN
    EXECUTE $sql$
      CREATE OR REPLACE FUNCTION public.store_meta_encrypted_token(
        p_config_id uuid,
        p_page_access_token text
      ) RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = 'public', 'extensions'
      AS $fn$
      DECLARE
        v_token_secret text;
      BEGIN
        v_token_secret := current_setting('app.settings.token_encryption_secret', true);

        IF v_token_secret IS NULL OR v_token_secret = '' THEN
          UPDATE public.meta_provider_configs
          SET encrypted_page_access_token = p_page_access_token
          WHERE id = p_config_id;
        ELSE
          UPDATE public.meta_provider_configs
          SET encrypted_page_access_token = extensions.pgp_sym_encrypt(p_page_access_token, v_token_secret)::text
          WHERE id = p_config_id;
        END IF;
      END;
      $fn$;
    $sql$;
    REVOKE ALL ON FUNCTION public.store_meta_encrypted_token(uuid, text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.store_meta_encrypted_token(uuid, text) FROM anon;
    REVOKE ALL ON FUNCTION public.store_meta_encrypted_token(uuid, text) FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.store_meta_encrypted_token(uuid, text) TO service_role;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'get_meta_decrypted_token'
      AND oidvectortypes(proargtypes) = 'uuid'
  ) THEN
    EXECUTE $sql$
      CREATE OR REPLACE FUNCTION public.get_meta_decrypted_token(
        p_config_id uuid
      ) RETURNS text
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = 'public', 'extensions'
      AS $fn$
      DECLARE
        v_token_secret text;
        v_encrypted text;
      BEGIN
        v_token_secret := current_setting('app.settings.token_encryption_secret', true);

        SELECT encrypted_page_access_token INTO v_encrypted
        FROM public.meta_provider_configs
        WHERE id = p_config_id;

        IF v_encrypted IS NULL THEN
          RETURN NULL;
        END IF;

        IF v_token_secret IS NULL OR v_token_secret = '' THEN
          RETURN v_encrypted;
        END IF;

        RETURN extensions.pgp_sym_decrypt(v_encrypted::bytea, v_token_secret);
      END;
      $fn$;
    $sql$;
    REVOKE ALL ON FUNCTION public.get_meta_decrypted_token(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.get_meta_decrypted_token(uuid) FROM anon;
    REVOKE ALL ON FUNCTION public.get_meta_decrypted_token(uuid) FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.get_meta_decrypted_token(uuid) TO service_role;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname = 'meta_provider_configs'
  ) THEN
    DROP POLICY IF EXISTS "Workspace members can read their meta provider configs" ON public.meta_provider_configs;

    CREATE POLICY "Workspace members can read their meta provider configs"
      ON public.meta_provider_configs
      FOR SELECT
      TO authenticated
      USING (public.bb_user_in_workspace(workspace_id));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname = 'website_scrape_jobs'
  ) THEN
    DROP POLICY IF EXISTS "Anyone can view website scrape jobs" ON public.website_scrape_jobs;
    DROP POLICY IF EXISTS "Users can view workspace website scrape jobs" ON public.website_scrape_jobs;

    CREATE POLICY "Users can view workspace website scrape jobs"
      ON public.website_scrape_jobs
      FOR SELECT
      TO authenticated
      USING (public.bb_user_in_workspace(workspace_id));

    REVOKE ALL ON public.website_scrape_jobs FROM anon;
    GRANT SELECT ON public.website_scrape_jobs TO authenticated;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname = 'users'
  ) THEN
    REVOKE INSERT ON public.users FROM authenticated;
    GRANT SELECT, UPDATE ON public.users TO authenticated;

    DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
    CREATE POLICY "Users can update their own profile"
      ON public.users
      FOR UPDATE
      TO authenticated
      USING (id = auth.uid())
      WITH CHECK (
        id = auth.uid()
        AND workspace_id IS NOT DISTINCT FROM public.get_my_workspace_id()
      );
  END IF;
END $$;
