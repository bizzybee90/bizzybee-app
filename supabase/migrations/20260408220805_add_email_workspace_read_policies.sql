
-- Workspace members can read their email provider configs
CREATE POLICY "Workspace members can read their email provider configs"
ON public.email_provider_configs
FOR SELECT
TO public
USING (
  workspace_id IN (
    SELECT wm.workspace_id FROM workspace_members wm WHERE wm.user_id = auth.uid()
  )
);

-- Workspace members can read their email import progress
CREATE POLICY "Workspace members can read their email import progress"
ON public.email_import_progress
FOR SELECT
TO public
USING (
  workspace_id IN (
    SELECT wm.workspace_id FROM workspace_members wm WHERE wm.user_id = auth.uid()
  )
);

-- Workspace members can DELETE their email provider configs (for the disconnect flow)
CREATE POLICY "Workspace members can delete their email provider configs"
ON public.email_provider_configs
FOR DELETE
TO public
USING (
  workspace_id IN (
    SELECT wm.workspace_id FROM workspace_members wm WHERE wm.user_id = auth.uid()
  )
);

-- Workspace members can DELETE their email import progress (for retry/disconnect)
CREATE POLICY "Workspace members can delete their email import progress"
ON public.email_import_progress
FOR DELETE
TO public
USING (
  workspace_id IN (
    SELECT wm.workspace_id FROM workspace_members wm WHERE wm.user_id = auth.uid()
  )
);
;
