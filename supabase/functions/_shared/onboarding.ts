import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

export const ONBOARDING_DEFAULT_MODEL = 'claude-sonnet-4-6';
export const ONBOARDING_REASONING_PROVIDER = 'claude';
export const ONBOARDING_ACQUISITION_PROVIDER = 'apify';

export const ONBOARDING_DISCOVERY_QUEUE = 'bb_onboarding_discovery_jobs';
export const ONBOARDING_WEBSITE_QUEUE = 'bb_onboarding_website_jobs';
export const ONBOARDING_FAQ_QUEUE = 'bb_onboarding_faq_jobs';
export const ONBOARDING_SUPERVISOR_QUEUE = 'bb_onboarding_supervisor_jobs';

export type OnboardingWorkflowKey =
  | 'competitor_discovery'
  | 'own_website_scrape'
  | 'faq_generation'
  | 'email_import';

export interface ModelPolicy {
  default_model: string;
  per_step: Record<string, string>;
}

export interface ProviderPolicy {
  acquisition: 'apify';
  reasoning: 'claude';
}

export interface OnboardingRunSnapshot {
  workspace_id: string;
  trigger_source: string;
  target_count?: number;
  search_queries?: string[];
  website_url?: string;
  selected_competitor_ids?: string[];
  model_policy: ModelPolicy;
  provider_policy: ProviderPolicy;
  [key: string]: unknown;
}

export interface OnboardingDiscoveryJob {
  run_id: string;
  workspace_id: string;
  step: 'acquire' | 'qualify' | 'persist';
  attempt: number;
}

export interface OnboardingWebsiteJob {
  run_id: string;
  workspace_id: string;
  step: 'fetch' | 'extract' | 'persist';
  attempt: number;
}

export interface OnboardingFaqJob {
  run_id: string;
  workspace_id: string;
  step: 'load_context' | 'fetch_pages' | 'generate_candidates' | 'dedupe' | 'finalize' | 'persist';
  attempt: number;
}

export interface OnboardingSupervisorJob {
  run_id: string;
  workflow_key: OnboardingWorkflowKey;
  action: 'heartbeat_check' | 'retry_stalled' | 'fail_stalled';
}

export function normalizeWebsiteUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    return parsed.toString();
  } catch {
    return null;
  }
}

export function domainFromUrl(value: string | null | undefined): string | null {
  const normalized = normalizeWebsiteUrl(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

export function normalizePrimaryServiceLocation(location: string | null | undefined): string {
  if (!location) return '';

  return location
    .split('|')[0]
    .replace(/\s*\(\d+\s*miles?\)/i, '')
    .replace(/\s*&\s*surrounding areas?$/i, '')
    .replace(/\bsurrounding areas?\b/gi, '')
    .split(',')[0]
    .trim();
}

export function buildDefaultSearchQueries(
  businessType: string | null | undefined,
  serviceArea: string | null | undefined,
): string[] {
  const normalizedBusinessType = String(businessType || '').trim();
  const normalizedLocation = normalizePrimaryServiceLocation(serviceArea);
  if (!normalizedBusinessType) return [];

  const queries = [
    normalizedLocation ? `${normalizedBusinessType} ${normalizedLocation}` : normalizedBusinessType,
    normalizedLocation ? `${normalizedBusinessType} near ${normalizedLocation}` : '',
    normalizedLocation ? `best ${normalizedBusinessType} ${normalizedLocation}` : '',
    normalizedLocation ? `${normalizedBusinessType} company ${normalizedLocation}` : '',
  ];

  const seen = new Set<string>();
  return queries
    .map((query) => query.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((query) => {
      if (seen.has(query.toLowerCase())) return false;
      seen.add(query.toLowerCase());
      return true;
    });
}

export function defaultModelPolicy(): ModelPolicy {
  return {
    default_model: ONBOARDING_DEFAULT_MODEL,
    per_step: {},
  };
}

export function defaultProviderPolicy(): ProviderPolicy {
  return {
    acquisition: ONBOARDING_ACQUISITION_PROVIDER,
    reasoning: ONBOARDING_REASONING_PROVIDER,
  };
}

export function normalizeModelPolicy(value: unknown): ModelPolicy {
  if (!value || typeof value !== 'object') {
    return defaultModelPolicy();
  }

  const candidate = value as Record<string, unknown>;
  const perStep = candidate.per_step;
  const normalizedPerStep =
    perStep && typeof perStep === 'object'
      ? Object.fromEntries(
          Object.entries(perStep as Record<string, unknown>).filter(
            ([, model]) => typeof model === 'string' && model.trim().length > 0,
          ),
        )
      : {};

  return {
    default_model:
      typeof candidate.default_model === 'string' && candidate.default_model.trim().length > 0
        ? candidate.default_model.trim()
        : ONBOARDING_DEFAULT_MODEL,
    per_step: normalizedPerStep,
  };
}

export function normalizeProviderPolicy(value: unknown): ProviderPolicy {
  if (!value || typeof value !== 'object') {
    return defaultProviderPolicy();
  }

  const candidate = value as Record<string, unknown>;
  return {
    acquisition:
      candidate.acquisition === 'apify' ? candidate.acquisition : ONBOARDING_ACQUISITION_PROVIDER,
    reasoning:
      candidate.reasoning === 'claude' ? candidate.reasoning : ONBOARDING_REASONING_PROVIDER,
  };
}

export function resolveStepModel(
  inputSnapshot: Record<string, unknown> | null | undefined,
  stepKey: string,
): string {
  const modelPolicy = normalizeModelPolicy(inputSnapshot?.model_policy);
  return modelPolicy.per_step[stepKey] || modelPolicy.default_model;
}

export async function createOnboardingRun(
  supabase: SupabaseClient,
  params: {
    workspaceId: string;
    workflowKey: OnboardingWorkflowKey;
    triggerSource: string;
    initiatedBy?: string | null;
    legacyProgressWorkflowType?: string | null;
    sourceJobId?: string | null;
    rolloutMode?: 'legacy' | 'shadow' | 'soft' | 'hard';
    inputSnapshot: Omit<
      OnboardingRunSnapshot,
      'workspace_id' | 'trigger_source' | 'model_policy' | 'provider_policy'
    > & {
      workspace_id?: string;
      trigger_source?: string;
      model_policy?: unknown;
      provider_policy?: unknown;
    };
  },
): Promise<{ id: string; input_snapshot: OnboardingRunSnapshot }> {
  const inputSnapshot: OnboardingRunSnapshot = {
    workspace_id: params.workspaceId,
    trigger_source: params.triggerSource,
    model_policy: normalizeModelPolicy(params.inputSnapshot.model_policy),
    provider_policy: normalizeProviderPolicy(params.inputSnapshot.provider_policy),
    ...params.inputSnapshot,
  };

  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      workspace_id: params.workspaceId,
      workflow_key: params.workflowKey,
      status: 'queued',
      rollout_mode: params.rolloutMode || 'hard',
      trigger_source: params.triggerSource,
      legacy_progress_workflow_type: params.legacyProgressWorkflowType || null,
      source_job_id: params.sourceJobId || null,
      initiated_by: params.initiatedBy || null,
      input_snapshot: inputSnapshot,
      last_heartbeat_at: new Date().toISOString(),
    })
    .select('id, input_snapshot')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create onboarding run: ${error?.message || 'unknown error'}`);
  }

  return {
    id: data.id,
    input_snapshot: data.input_snapshot as OnboardingRunSnapshot,
  };
}

export async function touchAgentRun(
  supabase: SupabaseClient,
  params: {
    runId: string;
    status?: 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'canceled';
    currentStepKey?: string | null;
    completed?: boolean;
    outputSummaryPatch?: Record<string, unknown>;
    errorSummary?: Record<string, unknown> | null;
  },
): Promise<void> {
  const { data: existing, error: fetchError } = await supabase
    .from('agent_runs')
    .select('output_summary')
    .eq('id', params.runId)
    .single();

  if (fetchError) {
    throw new Error(`Failed to load agent run ${params.runId}: ${fetchError.message}`);
  }

  const mergedOutputSummary = {
    ...((existing?.output_summary as Record<string, unknown> | null) || {}),
    ...(params.outputSummaryPatch || {}),
  };

  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    updated_at: now,
    last_heartbeat_at: now,
    output_summary: mergedOutputSummary,
  };

  if (params.status) updatePayload.status = params.status;
  if (params.currentStepKey !== undefined) updatePayload.current_step_key = params.currentStepKey;
  if (params.completed) updatePayload.completed_at = now;
  if (params.errorSummary !== undefined) updatePayload.error_summary = params.errorSummary;
  if (params.status === 'running') updatePayload.started_at = now;

  const { error } = await supabase.from('agent_runs').update(updatePayload).eq('id', params.runId);
  if (error) {
    throw new Error(`Failed to update agent run ${params.runId}: ${error.message}`);
  }
}

export async function recordRunEvent(
  supabase: SupabaseClient,
  params: {
    runId: string;
    workspaceId: string;
    level?: 'debug' | 'info' | 'warning' | 'error';
    eventType: string;
    message?: string | null;
    payload?: Record<string, unknown>;
    stepId?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from('agent_run_events').insert({
    run_id: params.runId,
    step_id: params.stepId || null,
    workspace_id: params.workspaceId,
    level: params.level || 'info',
    event_type: params.eventType,
    message: params.message || null,
    payload: params.payload || {},
  });

  if (error) {
    throw new Error(`Failed to record agent event: ${error.message}`);
  }
}

export async function recordRunArtifact(
  supabase: SupabaseClient,
  params: {
    runId: string;
    workspaceId: string;
    artifactType: string;
    content: Record<string, unknown>;
    artifactKey?: string | null;
    sourceUrl?: string | null;
    stepId?: string | null;
    targetTable?: string | null;
    targetRowId?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from('agent_run_artifacts').insert({
    run_id: params.runId,
    step_id: params.stepId || null,
    workspace_id: params.workspaceId,
    artifact_type: params.artifactType,
    artifact_key: params.artifactKey || null,
    source_url: params.sourceUrl || null,
    content: params.content,
    target_table: params.targetTable || null,
    target_row_id: params.targetRowId || null,
  });

  if (error) {
    throw new Error(`Failed to record agent artifact: ${error.message}`);
  }
}

export async function failRun(
  supabase: SupabaseClient,
  params: {
    runId: string;
    workspaceId: string;
    workflowKey: OnboardingWorkflowKey;
    reason: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await touchAgentRun(supabase, {
    runId: params.runId,
    status: 'failed',
    completed: true,
    errorSummary: {
      reason: params.reason,
      ...(params.details || {}),
    },
  });

  await recordRunEvent(supabase, {
    runId: params.runId,
    workspaceId: params.workspaceId,
    level: 'error',
    eventType: `${params.workflowKey}:failed`,
    message: params.reason,
    payload: params.details || {},
  });
}

export async function succeedRun(
  supabase: SupabaseClient,
  params: {
    runId: string;
    workspaceId: string;
    workflowKey: OnboardingWorkflowKey;
    outputSummaryPatch?: Record<string, unknown>;
  },
): Promise<void> {
  await touchAgentRun(supabase, {
    runId: params.runId,
    status: 'succeeded',
    completed: true,
    currentStepKey: null,
    outputSummaryPatch: params.outputSummaryPatch,
  });

  await recordRunEvent(supabase, {
    runId: params.runId,
    workspaceId: params.workspaceId,
    level: 'info',
    eventType: `${params.workflowKey}:completed`,
    message: 'Onboarding workflow completed',
    payload: params.outputSummaryPatch || {},
  });
}
