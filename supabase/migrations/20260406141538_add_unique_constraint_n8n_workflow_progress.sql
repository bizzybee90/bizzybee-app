
-- The upsert uses onConflict: 'workspace_id,workflow_type' but no unique constraint existed.
-- This caused every upsert to fail, breaking n8n callbacks.

-- First clean up any duplicates
DELETE FROM n8n_workflow_progress a
USING n8n_workflow_progress b
WHERE a.id < b.id
  AND a.workspace_id = b.workspace_id
  AND a.workflow_type = b.workflow_type;

-- Now add the unique constraint
ALTER TABLE n8n_workflow_progress 
  ADD CONSTRAINT n8n_workflow_progress_workspace_workflow_unique 
  UNIQUE (workspace_id, workflow_type);
;
