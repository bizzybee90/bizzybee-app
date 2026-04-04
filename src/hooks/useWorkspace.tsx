import { useContext } from 'react';
import { WorkspaceContext } from '@/contexts/workspace-context';

/**
 * Returns the current workspace. Fetched once at app level and shared via Context.
 * Replaces the old useWorkspace() hook which re-fetched on every component mount.
 */
export function useWorkspace() {
  return useContext(WorkspaceContext);
}
