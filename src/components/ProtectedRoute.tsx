/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { AuthGuard } from '@/components/AuthGuard';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface ProtectedRouteProps {
  children: ReactNode;
}

const BILLING_MODES = ['legacy', 'shadow', 'soft', 'hard'] as const;

export type BillingEnforcementMode = (typeof BILLING_MODES)[number];
export type ModuleLockState = 'available' | 'shadow-preview' | 'locked';

const TESTER_ALLOWLIST_ENV_KEYS = [
  'VITE_BILLING_TESTER_WORKSPACES',
  'VITE_BILLING_WORKSPACE_ALLOWLIST',
  'VITE_BILLING_SHADOW_ALLOWLIST',
] as const;

const readBillingMode = (): BillingEnforcementMode => {
  const value = (import.meta.env.VITE_BILLING_ENFORCEMENT_MODE ?? 'shadow')
    .toString()
    .toLowerCase();
  if (BILLING_MODES.includes(value as BillingEnforcementMode)) {
    return value as BillingEnforcementMode;
  }
  return 'shadow';
};

const parseWorkspaceAllowlist = () => {
  for (const envKey of TESTER_ALLOWLIST_ENV_KEYS) {
    const rawValue = import.meta.env[envKey];
    if (!rawValue) continue;
    return new Set(
      rawValue
        .toString()
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean),
    );
  }

  return new Set<string>();
};

const workspaceAllowlist = parseWorkspaceAllowlist();

const coerceBoolean = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return false;
};

const hasTesterBypass = (workspaceId: string | null | undefined, entitlements: unknown) => {
  const shape =
    entitlements && typeof entitlements === 'object'
      ? (entitlements as Record<string, unknown>)
      : {};
  const workspaceOverride =
    shape.workspaceOverride && typeof shape.workspaceOverride === 'object'
      ? (shape.workspaceOverride as Record<string, unknown>)
      : {};

  if (
    coerceBoolean(
      shape.testerBypass,
      shape.overrideAllowsAccess,
      workspaceOverride.testerBypass,
      workspaceOverride.allowPaidFeatures,
    )
  ) {
    return true;
  }

  return Boolean(workspaceId && workspaceAllowlist.has(workspaceId));
};

export interface ModuleLockResolution {
  rolloutMode: BillingEnforcementMode;
  state: ModuleLockState;
  wouldBlock: boolean;
  testerBypass: boolean;
}

interface ResolveModuleLockOptions {
  isAllowed: boolean;
  workspaceId?: string | null;
  entitlements?: unknown;
  rolloutMode?: BillingEnforcementMode;
}

export const resolveModuleLockState = ({
  isAllowed,
  workspaceId = null,
  entitlements,
  rolloutMode = readBillingMode(),
}: ResolveModuleLockOptions): ModuleLockResolution => {
  if (isAllowed) {
    return {
      rolloutMode,
      state: 'available',
      wouldBlock: false,
      testerBypass: false,
    };
  }

  const testerBypass = hasTesterBypass(workspaceId, entitlements);
  const shouldPreview = rolloutMode === 'legacy' || rolloutMode === 'shadow' || testerBypass;

  return {
    rolloutMode,
    state: shouldPreview ? 'shadow-preview' : 'locked',
    wouldBlock: true,
    testerBypass,
  };
};

export function ModuleLockBadge({ state }: { state: ModuleLockState }) {
  if (state === 'available') {
    return null;
  }

  if (state === 'shadow-preview') {
    return (
      <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
        Shadow preview
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
      Locked
    </Badge>
  );
}

interface ModuleGateNoticeProps {
  icon: LucideIcon;
  moduleName: string;
  lockState: ModuleLockResolution;
  lockedTitle?: string;
  shadowTitle?: string;
  lockedDescription: string;
  shadowDescription: string;
  primaryActionLabel: string;
  primaryActionTo: string;
  secondaryActionLabel?: string;
  secondaryActionTo?: string;
}

export function ModuleGateNotice({
  icon: Icon,
  moduleName,
  lockState,
  lockedTitle,
  shadowTitle,
  lockedDescription,
  shadowDescription,
  primaryActionLabel,
  primaryActionTo,
  secondaryActionLabel,
  secondaryActionTo,
}: ModuleGateNoticeProps) {
  if (lockState.state === 'available') {
    return null;
  }

  if (lockState.state === 'shadow-preview') {
    return (
      <Card className="border-[0.5px] border-bb-border bg-bb-linen/70">
        <CardContent className="flex items-start gap-3 p-4">
          <div className="mt-0.5 rounded-full bg-bb-white p-2 text-sky-700">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-bb-text">
                {shadowTitle ?? `${moduleName} in shadow preview`}
              </p>
              <ModuleLockBadge state={lockState.state} />
            </div>
            <p className="text-sm text-bb-warm-gray">{shadowDescription}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="max-w-xl border-[0.5px] border-bb-border bg-bb-white">
        <CardContent className="p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-bb-gold/10 text-bb-gold">
            <Icon className="h-5 w-5" />
          </div>
          <h1 className="mt-4 text-2xl font-medium text-bb-text">
            {lockedTitle ?? `${moduleName} is locked`}
          </h1>
          <p className="mt-3 text-sm text-bb-warm-gray">{lockedDescription}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild>
              <Link to={primaryActionTo}>{primaryActionLabel}</Link>
            </Button>
            {secondaryActionLabel && secondaryActionTo ? (
              <Button variant="outline" asChild>
                <Link to={secondaryActionTo}>{secondaryActionLabel}</Link>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => (
  <AuthGuard>
    <RouteErrorBoundary>{children}</RouteErrorBoundary>
  </AuthGuard>
);
