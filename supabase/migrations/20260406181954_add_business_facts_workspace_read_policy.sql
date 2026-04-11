
CREATE POLICY "Workspace members can read their business facts"
ON public.business_facts
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
