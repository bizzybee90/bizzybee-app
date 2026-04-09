export type Channel =
  | 'email'
  | 'whatsapp'
  | 'sms'
  | 'facebook'
  | 'instagram'
  | 'google_business'
  | 'voice';
export type Direction = 'inbound' | 'outbound';

export interface UnifiedMessage {
  external_id: string;
  thread_id: string;
  channel: Channel;
  direction: Direction;
  from_identifier: string;
  from_name?: string | null;
  to_identifier: string;
  body: string;
  body_html?: string | null;
  subject?: string | null;
  timestamp: string;
  is_read: boolean;
  metadata: Record<string, unknown>;
  raw_payload?: Record<string, unknown> | null;
}

export interface QueueRecord<T> {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: T;
}

export interface ImportFetchJob {
  job_type: 'IMPORT_FETCH';
  workspace_id: string;
  run_id: string;
  config_id: string;
  folder: 'SENT' | 'INBOX';
  pageToken?: string | null;
  cap?: number;
  fetched_so_far?: number;
  pages?: number;
  rate_limit_count?: number;
}

export interface MaterializeJob {
  job_type: 'MATERIALIZE';
  event_id: string;
  workspace_id: string;
  run_id?: string | null;
  channel: Channel;
  config_id: string;
}

export interface ClassifyJob {
  job_type: 'CLASSIFY';
  workspace_id: string;
  run_id?: string | null;
  config_id: string;
  channel: Channel;
  event_id: string;
  conversation_id: string;
  target_message_id: string;
}

export interface DraftJob {
  job_type: 'DRAFT';
  workspace_id: string;
  run_id?: string | null;
  conversation_id: string;
  target_message_id: string;
  event_id?: string | null;
}

export interface ClassificationResult {
  category: string;
  requires_reply: boolean;
  confidence: number;
  entities: Record<string, unknown>;
  reasoning?: string | null;
  sentiment?: string | null;
  why_this_needs_you?: string | null;
  summary_for_human?: string | null;
}
