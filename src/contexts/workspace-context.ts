import { createContext } from 'react';
import type { Workspace } from '@/lib/types';

export interface WorkspaceContextValue {
  workspace: Workspace | null;
  loading: boolean;
  refreshWorkspace: () => Promise<void>;
}

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: null,
  loading: true,
  refreshWorkspace: async () => {},
});
