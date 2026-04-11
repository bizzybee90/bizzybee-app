-- Add CHECK constraints with the full set of supported channels.
-- Previously validation was only at the app level (unified-ingest).
-- Adding DB-level constraints catches any edge function that bypasses
-- the app validation layer.

ALTER TABLE public.workspace_channels ADD CONSTRAINT workspace_channels_channel_check
  CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','google_business','webchat','phone'));

-- Only add to conversations/messages if the column exists and has no constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'channel'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.conversations'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%channel%'
  ) THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_channel_check
      CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','google_business','webchat','phone'));
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'channel'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.messages'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%channel%'
  ) THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_channel_check
      CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','google_business','webchat','phone'));
  END IF;
END $$;;
