import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import {
  extractCompetitorFaqCandidates,
  extractWebsiteFaqsInChunks,
  finalizeFaqCandidates,
  type FaqCandidate,
  type FetchedPage,
} from '../faq-agent-runner/lib/onboarding-ai.ts';
import { handleListExistingFaqs } from '../faq-agent-runner/tools/list-existing-faqs.ts';

export type SharedFaqSourceKind = 'own_site' | 'competitor';

export interface SharedFaqPromptContext {
  workspace_name: string;
  industry: string | null;
  service_area: string | null;
  business_type: string | null;
}

export type SharedFaqSourcePage = FetchedPage & {
  source_business?: string | null;
  source_kind?: SharedFaqSourceKind;
};

export async function loadRunArtifact<T>(
  supabase: SupabaseClient,
  runId: string,
  workspaceId: string,
  artifactKey: string,
): Promise<T> {
  const { data, error } = await supabase
    .from('agent_run_artifacts')
    .select('content')
    .eq('run_id', runId)
    .eq('workspace_id', workspaceId)
    .eq('artifact_key', artifactKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Missing onboarding artifact: ${artifactKey}`);
  }

  return data.content as T;
}

export async function hasRunArtifact(
  supabase: SupabaseClient,
  runId: string,
  workspaceId: string,
  artifactKey: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('agent_run_artifacts')
    .select('id')
    .eq('run_id', runId)
    .eq('workspace_id', workspaceId)
    .eq('artifact_key', artifactKey)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check onboarding artifact ${artifactKey}: ${error.message}`);
  }

  return Boolean(data?.id);
}

export function normalizeFaqQuestion(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function extractFaqCandidatesFromPages(params: {
  apiKey: string;
  model: string;
  context: SharedFaqPromptContext;
  pages: SharedFaqSourcePage[];
  sourceKind: SharedFaqSourceKind;
  onWebsiteProgress?: (progress: {
    batchIndex: number;
    batchCount: number;
    pagesInBatch: number;
    candidateCount: number;
    totalCandidateCount: number;
  }) => Promise<void> | void;
}): Promise<{ faqs: FaqCandidate[]; batchCount: number }> {
  if (params.sourceKind === 'own_site') {
    return extractWebsiteFaqsInChunks(
      params.apiKey,
      params.model,
      params.context,
      params.pages,
      params.onWebsiteProgress,
    );
  }

  const extracted = await extractCompetitorFaqCandidates(
    params.apiKey,
    params.model,
    params.context,
    params.pages,
  );

  return {
    faqs: extracted.candidates,
    batchCount: 1,
  };
}

export async function loadExistingFaqQuestions(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Set<string>> {
  const existing = await handleListExistingFaqs(supabase, { workspace_id: workspaceId });
  return new Set(existing.faqs.map((faq) => normalizeFaqQuestion(faq.question)));
}

export function dedupeFaqCandidatesAgainstQuestions(
  candidates: FaqCandidate[],
  existingQuestions: Set<string>,
): FaqCandidate[] {
  const seenQuestions = new Set(existingQuestions);
  const deduped: FaqCandidate[] = [];

  for (const candidate of candidates
    .filter((item) => item.question && item.answer && item.source_url && item.evidence_quote)
    .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0))) {
    const key = normalizeFaqQuestion(candidate.question);
    if (!key || seenQuestions.has(key)) continue;
    seenQuestions.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

export async function finalizeSharedFaqCandidates(params: {
  apiKey: string;
  model: string;
  context: SharedFaqPromptContext;
  candidates: FaqCandidate[];
  existingQuestions: string[];
}): Promise<{ faqs: FaqCandidate[] }> {
  return finalizeFaqCandidates(
    params.apiKey,
    params.model,
    params.context,
    params.candidates,
    params.existingQuestions,
  );
}

export function buildFaqRows(params: {
  workspaceId: string;
  faqs: FaqCandidate[];
  category: string;
  isOwnContent: boolean;
}): Array<Record<string, unknown>> {
  return params.faqs.map((faq) => ({
    workspace_id: params.workspaceId,
    question: faq.question,
    answer: faq.answer,
    category: params.category,
    enabled: true,
    is_active: true,
    is_own_content: params.isOwnContent,
    source_url: faq.source_url,
    generation_source: faq.source_url,
    source_business: faq.source_business || null,
    source_company: faq.source_business || null,
    relevance_score: Math.round((faq.quality_score || 0) * 100),
  }));
}
