import { supabase } from '@/integrations/supabase/client';

export type ManagedCompetitor = {
  id: string;
  business_name: string | null;
  domain: string;
  url: string;
  rating?: number | null;
  reviews_count?: number | null;
  is_selected: boolean;
  discovery_source?: string | null;
  validation_status?: string | null;
  location_data?: unknown;
  distance_miles?: number | null;
  match_reason?: string | null;
  relevance_score?: number | null;
  scrape_status?: string | null;
  temporary?: boolean;
};

type ManageCompetitorsAction =
  | 'list'
  | 'toggle_selection'
  | 'bulk_set_selected'
  | 'delete'
  | 'rescrape';

type ManageCompetitorsRequest = {
  workspace_id: string;
  job_id?: string | null;
  run_id?: string | null;
  competitor_id?: string;
  competitor_ids?: string[];
  is_selected?: boolean;
};

type ManageCompetitorsResponse = {
  ok: boolean;
  job_id?: string | null;
  competitors?: ManagedCompetitor[];
  selected_count?: number;
  persisted_count?: number;
  loaded_from?: 'persisted' | 'qualified_candidates' | 'acquired_candidates';
  error?: string;
};

function dedupeCompetitors(competitors: ManagedCompetitor[] | undefined): ManagedCompetitor[] {
  if (!competitors?.length) return [];

  const byStableKey = new Map<string, ManagedCompetitor>();

  for (const competitor of competitors) {
    const key = competitor.temporary
      ? `temp:${competitor.domain || competitor.url || competitor.id}`
      : competitor.id || competitor.domain || competitor.url;
    const existing = byStableKey.get(key);

    if (!existing) {
      byStableKey.set(key, competitor);
      continue;
    }

    const existingIsTemporary = existing.temporary === true;
    const nextIsTemporary = competitor.temporary === true;

    if (existingIsTemporary && !nextIsTemporary) {
      byStableKey.set(key, competitor);
      continue;
    }

    const existingSelected = existing.is_selected === true;
    const nextSelected = competitor.is_selected === true;
    if (!existingSelected && nextSelected) {
      byStableKey.set(key, competitor);
    }
  }

  return Array.from(byStableKey.values());
}

async function invokeManageCompetitors(
  action: ManageCompetitorsAction,
  payload: ManageCompetitorsRequest,
): Promise<ManageCompetitorsResponse> {
  const { data, error } = await supabase.functions.invoke('onboarding-competitors', {
    body: {
      action,
      ...payload,
    },
  });

  if (error || data?.ok === false) {
    throw error || new Error(data?.error || 'Competitor action failed');
  }

  const typed = data as ManageCompetitorsResponse;
  return {
    ...typed,
    competitors: dedupeCompetitors(typed.competitors),
  };
}

export async function listOnboardingCompetitors(
  workspaceId: string,
  jobId?: string | null,
  runId?: string | null,
) {
  return invokeManageCompetitors('list', {
    workspace_id: workspaceId,
    job_id: jobId,
    run_id: runId,
  });
}

export async function toggleOnboardingCompetitorSelection(
  workspaceId: string,
  competitorId: string,
  isSelected: boolean,
) {
  return invokeManageCompetitors('toggle_selection', {
    workspace_id: workspaceId,
    competitor_id: competitorId,
    is_selected: isSelected,
  });
}

export async function bulkSetOnboardingCompetitorSelection(
  workspaceId: string,
  competitorIds: string[],
  isSelected: boolean,
) {
  return invokeManageCompetitors('bulk_set_selected', {
    workspace_id: workspaceId,
    competitor_ids: competitorIds,
    is_selected: isSelected,
  });
}

export async function deleteOnboardingCompetitor(workspaceId: string, competitorId: string) {
  return invokeManageCompetitors('delete', {
    workspace_id: workspaceId,
    competitor_id: competitorId,
  });
}

export async function rescrapeOnboardingCompetitor(workspaceId: string, competitorId: string) {
  return invokeManageCompetitors('rescrape', {
    workspace_id: workspaceId,
    competitor_id: competitorId,
  });
}
