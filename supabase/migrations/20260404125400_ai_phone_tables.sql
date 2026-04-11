-- AI Phone Configs (one per workspace)
CREATE TABLE ai_phone_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  retell_agent_id TEXT,
  retell_llm_id TEXT,
  retell_phone_number TEXT,
  retell_phone_number_id TEXT,
  phone_provider TEXT DEFAULT 'twilio_sip' CHECK (phone_provider IN ('retell', 'twilio_sip')),
  twilio_number_sid TEXT,
  twilio_trunk_sid TEXT,
  twilio_sip_uri TEXT,
  business_name TEXT NOT NULL,
  business_description TEXT,
  services JSONB DEFAULT '[]'::jsonb,
  opening_hours JSONB DEFAULT '{}'::jsonb,
  booking_rules JSONB DEFAULT '{}'::jsonb,
  custom_instructions TEXT,
  greeting_message TEXT DEFAULT 'Hello, thank you for calling. This call may be recorded for quality purposes. How can I help you today?',
  voice_id TEXT DEFAULT '21m00Tcm4TlvDq8ikWAM',
  voice_name TEXT DEFAULT 'Rachel',
  max_call_duration_seconds INT DEFAULT 300,
  transfer_number TEXT,
  is_active BOOLEAN DEFAULT false,
  data_retention_days INT DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id)
);

CREATE INDEX idx_ai_phone_configs_workspace ON ai_phone_configs(workspace_id);

-- AI Phone Knowledge Base
CREATE TABLE ai_phone_knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES ai_phone_configs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'general' CHECK (category IN ('faq', 'pricing', 'services', 'policies', 'general')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ai_phone_kb_config ON ai_phone_knowledge_base(config_id);

-- AI Phone Call Logs
CREATE TABLE ai_phone_call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES ai_phone_configs(id),
  retell_call_id TEXT UNIQUE NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  caller_number TEXT,
  called_number TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'transferred', 'error', 'voicemail')),
  start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time TIMESTAMPTZ,
  duration_seconds INT,
  transcript TEXT,
  transcript_object JSONB,
  summary TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  outcome TEXT CHECK (outcome IN ('resolved', 'booking_made', 'message_taken', 'transferred', 'abandoned', 'error')),
  outcome_details JSONB DEFAULT '{}'::jsonb,
  cost_cents INT DEFAULT 0,
  requires_followup BOOLEAN DEFAULT false,
  followup_notes TEXT,
  call_analysis JSONB DEFAULT '{}'::jsonb,
  disconnection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_call_logs_workspace ON ai_phone_call_logs(workspace_id);
CREATE INDEX idx_call_logs_config ON ai_phone_call_logs(config_id);
CREATE INDEX idx_call_logs_time ON ai_phone_call_logs(start_time DESC);
CREATE INDEX idx_call_logs_retell ON ai_phone_call_logs(retell_call_id);

-- AI Phone Usage (monthly billing)
CREATE TABLE ai_phone_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  total_calls INT DEFAULT 0,
  total_minutes DECIMAL(10,2) DEFAULT 0,
  total_cost_cents INT DEFAULT 0,
  included_minutes INT DEFAULT 0,
  overage_minutes DECIMAL(10,2) DEFAULT 0,
  overage_cost_cents INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, month)
);

-- RLS Policies
ALTER TABLE ai_phone_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_phone_knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_phone_call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_phone_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their workspace phone config"
  ON ai_phone_configs FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role full access to phone configs"
  ON ai_phone_configs FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users can manage their KB entries"
  ON ai_phone_knowledge_base FOR ALL
  USING (config_id IN (
    SELECT id FROM ai_phone_configs
    WHERE workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid())
  ))
  WITH CHECK (config_id IN (
    SELECT id FROM ai_phone_configs
    WHERE workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid())
  ));

CREATE POLICY "Service role full access to phone KB"
  ON ai_phone_knowledge_base FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users can view their workspace call logs"
  ON ai_phone_call_logs FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role full access to call logs"
  ON ai_phone_call_logs FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users can view their workspace usage"
  ON ai_phone_usage FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role full access to usage"
  ON ai_phone_usage FOR ALL
  USING (auth.role() = 'service_role');

-- Enable Realtime for call logs (live dashboard updates)
ALTER PUBLICATION supabase_realtime ADD TABLE ai_phone_call_logs;;
