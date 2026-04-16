const DISCOVERY_TRIGGER_STORAGE_PREFIX = 'bizzybee:onboarding-discovery-trigger:';
export const DISCOVERY_TRIGGER_GRACE_MS = 8000;

function getStorageKey(workspaceId: string) {
  return `${DISCOVERY_TRIGGER_STORAGE_PREFIX}${workspaceId}`;
}

function hasSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function markPendingOnboardingDiscoveryTrigger(workspaceId: string) {
  if (!workspaceId || !hasSessionStorage()) return;

  try {
    window.sessionStorage.setItem(getStorageKey(workspaceId), String(Date.now()));
  } catch {
    // Ignore storage failures. The auto-trigger hook will fall back to firing immediately.
  }
}

export function clearPendingOnboardingDiscoveryTrigger(workspaceId: string) {
  if (!workspaceId || !hasSessionStorage()) return;

  try {
    window.sessionStorage.removeItem(getStorageKey(workspaceId));
  } catch {
    // Ignore storage failures.
  }
}

export function getPendingOnboardingDiscoveryTriggerRemainingMs(workspaceId: string) {
  if (!workspaceId || !hasSessionStorage()) return 0;

  try {
    const raw = window.sessionStorage.getItem(getStorageKey(workspaceId));
    if (!raw) return 0;

    const startedAt = Number(raw);
    if (!Number.isFinite(startedAt) || startedAt <= 0) {
      window.sessionStorage.removeItem(getStorageKey(workspaceId));
      return 0;
    }

    return Math.max(0, startedAt + DISCOVERY_TRIGGER_GRACE_MS - Date.now());
  } catch {
    return 0;
  }
}
