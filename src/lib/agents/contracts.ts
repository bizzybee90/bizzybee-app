export const managedWorkflowKeys = [
  'faq_generation',
  'own_website_scrape',
  'competitor_discovery',
] as const;

export type ManagedWorkflowKey = (typeof managedWorkflowKeys)[number];

export const deferredWorkflowKeys = [
  'email_classification',
  'gdpr_auto_delete',
  'provider_webhooks',
  'token_refresh',
] as const;

export type DeferredWorkflowKey = (typeof deferredWorkflowKeys)[number];

export const agentRunStatuses = [
  'queued',
  'running',
  'waiting',
  'succeeded',
  'failed',
  'canceled',
] as const;

export type AgentRunStatus = (typeof agentRunStatuses)[number];

export const agentStepStatuses = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'canceled',
] as const;

export type AgentStepStatus = (typeof agentStepStatuses)[number];

export const agentRolloutModes = ['legacy', 'shadow', 'soft', 'hard'] as const;

export type AgentRolloutMode = (typeof agentRolloutModes)[number];

export const agentArtifactTypes = [
  'source_page',
  'faq_candidate',
  'competitor_candidate',
  'summary',
  'persisted_row_link',
  'debug_snapshot',
] as const;

export type AgentArtifactType = (typeof agentArtifactTypes)[number];

export type ManagedWorkflowDefinition = {
  key: ManagedWorkflowKey;
  migrationPriority: 1 | 2 | 3;
  replacesWorkflowType: string | null;
  writesTo: string[];
  progressSurface: string;
  whyGoodFit: string;
};

export const managedWorkflowDefinitions: Record<ManagedWorkflowKey, ManagedWorkflowDefinition> = {
  faq_generation: {
    key: 'faq_generation',
    migrationPriority: 1,
    replacesWorkflowType: 'faq_generation',
    writesTo: ['faq_database'],
    progressSurface: 'bb_get_onboarding_progress',
    whyGoodFit:
      'Judgment-heavy extraction and consolidation over multiple competitor sources with bounded output.',
  },
  own_website_scrape: {
    key: 'own_website_scrape',
    migrationPriority: 2,
    replacesWorkflowType: 'own_website_scrape',
    writesTo: ['faq_database', 'scraping_jobs'],
    progressSurface: 'bb_get_onboarding_progress',
    whyGoodFit:
      'Reuses the FAQ extraction pattern while keeping deterministic page fetching and compatibility writes.',
  },
  competitor_discovery: {
    key: 'competitor_discovery',
    migrationPriority: 3,
    replacesWorkflowType: 'competitor_discovery',
    writesTo: ['competitor_research_jobs', 'competitor_sites'],
    progressSurface: 'bb_get_onboarding_progress',
    whyGoodFit:
      'High-upside orchestration candidate once the lower-risk FAQ and website scrape pilots are proven.',
  },
};
