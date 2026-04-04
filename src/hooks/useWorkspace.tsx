/**
 * Re-exports useWorkspace from WorkspaceContext.
 * The workspace is fetched once at app level via WorkspaceProvider
 * and shared via React Context — no per-component fetching.
 */
export { useWorkspace } from '@/contexts/WorkspaceContext';
