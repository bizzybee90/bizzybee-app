-- Repair missing review/training columns on conversations for environments
-- where the original 2026-02 migrations were never applied.

ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS training_reviewed boolean NOT NULL DEFAULT false;

ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS training_reviewed_at timestamptz DEFAULT null;

CREATE INDEX IF NOT EXISTS idx_conversations_training_reviewed
ON public.conversations (training_reviewed, workspace_id)
WHERE training_reviewed = false;
