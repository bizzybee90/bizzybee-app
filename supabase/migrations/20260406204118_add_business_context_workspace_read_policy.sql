
CREATE POLICY "Workspace members can read their business context"
ON public.business_context
FOR SELECT
TO public
USING (
  workspace_id IN (
    SELECT workspace_members.workspace_id
    FROM workspace_members
    WHERE workspace_members.user_id = auth.uid()
  )
);
;
