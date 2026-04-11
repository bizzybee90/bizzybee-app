
-- n8n_workflow_progress: workspace members can read their progress
CREATE POLICY "Workspace members can read their workflow progress"
ON public.n8n_workflow_progress
FOR SELECT
TO public
USING (
  workspace_id IN (
    SELECT wm.workspace_id FROM workspace_members wm WHERE wm.user_id = auth.uid()
  )
);

-- competitor_research_jobs: workspace members can read their research jobs
CREATE POLICY "Workspace members can read their research jobs"
ON public.competitor_research_jobs
FOR SELECT
TO public
USING (
  workspace_id IN (
    SELECT wm.workspace_id FROM workspace_members wm WHERE wm.user_id = auth.uid()
  )
);

-- competitor_sites: workspace members can read their competitor sites
CREATE POLICY "Workspace members can read their competitor sites"
ON public.competitor_sites
FOR SELECT
TO public
USING (
  workspace_id IN (
    SELECT wm.workspace_id FROM workspace_members wm WHERE wm.user_id = auth.uid()
  )
);
;
