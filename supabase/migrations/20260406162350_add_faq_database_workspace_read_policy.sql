
CREATE POLICY "Workspace members can read their FAQs"
ON public.faq_database
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
