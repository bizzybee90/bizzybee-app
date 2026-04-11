import { createContext } from 'react';
import type { Workspace } from '@/lib/types';
import type { WorkspaceEntitlements } from '@/lib/billing/entitlements';

export interface WorkspaceContextValue {
  workspace: Workspace | null;
  loading: boolean;
  onboardingStep: string | null;
  onboardingComplete: boolean;
  needsOnboarding: boolean;
  entitlements: WorkspaceEntitlements | null;
  entitlementsLoading: boolean;
  refreshWorkspace: () => Promise<void>;
}

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: null,
  loading: true,
  onboardingStep: null,
  onboardingComplete: false,
  needsOnboarding: true,
  entitlements: null,
  entitlementsLoading: true,
  refreshWorkspace: async () => undefined,
});
