-- Drop old Retell tables (empty, no data loss)
DROP TABLE IF EXISTS ai_phone_usage CASCADE;
DROP TABLE IF EXISTS ai_phone_call_logs CASCADE;
DROP TABLE IF EXISTS ai_phone_knowledge_base CASCADE;
DROP TABLE IF EXISTS ai_phone_configs CASCADE;

-- ElevenLabs agent config (one per workspace)
CREATE TABLE elevenlabs_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  elevenlabs_agent_id TEXT,
  phone_number TEXT,
  twilio_number_sid TEXT,
  voice_id TEXT DEFAULT 'cgSgspJ2msm6clMCkdW9',
  voice_name TEXT DEFAULT 'Jessica',
  knowledge_base_id TEXT,
  llm_model TEXT DEFAULT 'gemini-2.5-flash',
  status TEXT DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'active', 'error', 'inactive')),
  business_name TEXT NOT NULL,
  business_description TEXT,
  services JSONB DEFAULT '[]'::jsonb,
  opening_hours JSONB DEFAULT '{}'::jsonb,
  booking_rules JSONB DEFAULT '{}'::jsonb,
  custom_instructions TEXT,
  greeting_message TEXT DEFAULT 'Hi, you''ve reached us. This call may be recorded. How can I help you today?',
  max_call_duration_seconds INT DEFAULT 300,
  transfer_number TEXT,
  is_active BOOLEAN DEFAULT false,
  data_retention_days INT DEFAULT 90,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id)
);

CREATE INDEX idx_elevenlabs_agents_workspace ON elevenlabs_agents(workspace_id);

-- Knowledge base entries
CREATE TABLE ai_phone_knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES elevenlabs_agents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'general' CHECK (category IN ('faq', 'pricing', 'services', 'policies', 'general')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ai_phone_kb_agent ON ai_phone_knowledge_base(agent_id);

-- Call logs
CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES elevenlabs_agents(id),
  elevenlabs_conversation_id TEXT UNIQUE,
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  caller_number TEXT,
  caller_name TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('in_progress', 'completed', 'transferred', 'error')),
  duration_seconds INT,
  transcript JSONB,
  summary TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  topics TEXT[],
  success_evaluation BOOLEAN,
  call_type TEXT CHECK (call_type IN ('emergency', 'booking', 'enquiry', 'callback_request', 'general')),
  outcome TEXT CHECK (outcome IN ('resolved', 'booking_made', 'message_taken', 'transferred', 'abandoned', 'error')),
  actions_taken JSONB DEFAULT '{}'::jsonb,
  requires_followup BOOLEAN DEFAULT false,
  cost_cents INT DEFAULT 0,
  recording_url TEXT,
  disconnection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_call_logs_workspace ON call_logs(workspace_id);
CREATE INDEX idx_call_logs_agent ON call_logs(agent_id);
CREATE INDEX idx_call_logs_time ON call_logs(created_at DESC);
CREATE INDEX idx_call_logs_conversation ON call_logs(elevenlabs_conversation_id);

-- Usage tracking
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

-- RLS
ALTER TABLE elevenlabs_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_phone_knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_phone_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own workspace agents"
  ON elevenlabs_agents FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role full access agents"
  ON elevenlabs_agents FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users manage own KB"
  ON ai_phone_knowledge_base FOR ALL
  USING (agent_id IN (
    SELECT id FROM elevenlabs_agents
    WHERE workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid())
  ))
  WITH CHECK (agent_id IN (
    SELECT id FROM elevenlabs_agents
    WHERE workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid())
  ));

CREATE POLICY "Service role full access KB"
  ON ai_phone_knowledge_base FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users view own call logs"
  ON call_logs FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role full access call logs"
  ON call_logs FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users view own usage"
  ON ai_phone_usage FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role full access usage"
  ON ai_phone_usage FOR ALL
  USING (auth.role() = 'service_role');

-- Realtime for live call log updates
ALTER PUBLICATION supabase_realtime ADD TABLE call_logs;

-- Atomic usage upsert function
CREATE OR REPLACE FUNCTION upsert_ai_phone_usage(
  p_workspace_id UUID,
  p_month DATE,
  p_calls INT DEFAULT 1,
  p_minutes DECIMAL DEFAULT 0,
  p_cost_cents INT DEFAULT 0
) RETURNS void AS $$
BEGIN
  INSERT INTO ai_phone_usage (workspace_id, month, total_calls, total_minutes, total_cost_cents)
  VALUES (p_workspace_id, p_month, p_calls, p_minutes, p_cost_cents)
  ON CONFLICT (workspace_id, month)
  DO UPDATE SET
    total_calls = ai_phone_usage.total_calls + p_calls,
    total_minutes = ai_phone_usage.total_minutes + p_minutes,
    total_cost_cents = ai_phone_usage.total_cost_cents + p_cost_cents,
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;;
