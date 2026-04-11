-- Seed all 6 channels for existing workspaces
INSERT INTO workspace_channels (workspace_id, channel, enabled, automation_level)
SELECT w.id, c.channel, c.enabled, c.automation_level
FROM workspaces w
CROSS JOIN (VALUES
  ('email', true, 'draft_only'),
  ('sms', false, 'draft_only'),
  ('whatsapp', false, 'draft_only'),
  ('facebook', false, 'draft_only'),
  ('instagram', false, 'draft_only'),
  ('google_business', false, 'draft_only')
) AS c(channel, enabled, automation_level)
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_channels wc
  WHERE wc.workspace_id = w.id AND wc.channel = c.channel
);

-- Create trigger to auto-seed channels for new workspaces
CREATE OR REPLACE FUNCTION seed_workspace_channels()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO workspace_channels (workspace_id, channel, enabled, automation_level)
  VALUES
    (NEW.id, 'email', true, 'draft_only'),
    (NEW.id, 'sms', false, 'draft_only'),
    (NEW.id, 'whatsapp', false, 'draft_only'),
    (NEW.id, 'facebook', false, 'draft_only'),
    (NEW.id, 'instagram', false, 'draft_only'),
    (NEW.id, 'google_business', false, 'draft_only');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_workspace_channels ON workspaces;
CREATE TRIGGER trg_seed_workspace_channels
  AFTER INSERT ON workspaces
  FOR EACH ROW
  EXECUTE FUNCTION seed_workspace_channels();;
