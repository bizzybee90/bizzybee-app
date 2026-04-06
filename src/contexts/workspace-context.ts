import { createContext } from 'react';
import type { Workspace } from '@/lib/types';

export interface WorkspaceContextValue {
  workspace: Workspace | null;
  loading: boolean;
  onboardingStep: string | null;
  onboardingComplete: boolean;
  needsOnboarding: boolean;
}

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: null,
  loading: true,
  onboardingStep: null,
  onboardingComplete: false,
  needsOnboarding: true,
});
