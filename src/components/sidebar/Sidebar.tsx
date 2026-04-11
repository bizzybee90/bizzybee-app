import {
  Home,
  Mail,
  Archive,
  Clock,
  Send,
  Inbox,
  BarChart3,
  MessageSquare,
  Settings,
  ClipboardCheck,
  BookOpen,
  Zap,
  FileEdit,
  Phone,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { EmailImportIndicator } from './EmailImportIndicator';
import { BizzyBeeLogo } from '@/components/branding/BizzyBeeLogo';
import { cn } from '@/lib/utils';
import { isPreviewModeEnabled } from '@/lib/previewMode';
import { useWorkspace } from '@/hooks/useWorkspace';
import { resolveWorkspaceEntitlements } from '@/lib/billing/entitlements';
import { resolveModuleLockState, type ModuleLockState } from '@/components/ProtectedRoute';

interface SidebarProps {
  forceCollapsed?: boolean;
  onNavigate?: () => void;
  onFiltersClick?: () => void;
  isMobileDrawer?: boolean;
}

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  count?: number;
  end?: boolean;
  gateState?: ModuleLockState;
}

export const Sidebar = ({
  forceCollapsed = false,
  onNavigate,
  onFiltersClick,
  isMobileDrawer = false,
}: SidebarProps = {}) => {
  const isCollapsed = !isMobileDrawer && forceCollapsed;
  const isPreviewMode = isPreviewModeEnabled();
  const { workspace, needsOnboarding, loading: workspaceLoading, entitlements } = useWorkspace();
  const activeEntitlements = entitlements ?? resolveWorkspaceEntitlements(null, []);
  const aiPhoneState = resolveModuleLockState({
    isAllowed: activeEntitlements.canUseAiPhone,
    workspaceId: workspace?.id ?? null,
    entitlements: activeEntitlements,
  });
  const analyticsState = resolveModuleLockState({
    isAllowed: activeEntitlements.features.analytics,
    workspaceId: workspace?.id ?? null,
    entitlements: activeEntitlements,
  });
  const knowledgeBaseState = resolveModuleLockState({
    isAllowed: activeEntitlements.features.knowledge_base,
    workspaceId: workspace?.id ?? null,
    entitlements: activeEntitlements,
  });

  const { data: viewData } = useQuery({
    queryKey: ['sidebar-view-counts'],
    enabled: !isPreviewMode,
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return {
          toReply: 0,
          done: 0,
          snoozed: 0,
          review: 0,
          unread: 0,
          drafts: 0,
          workspaceId: null,
          workspaceName: 'AI customer operations',
        };
      }

      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user.id)
        .single();

      if (!userData?.workspace_id)
        return {
          toReply: 0,
          done: 0,
          snoozed: 0,
          review: 0,
          unread: 0,
          drafts: 0,
          workspaceId: null,
          workspaceName: 'AI customer operations',
        };

      const { data: workspace } = await supabase
        .from('workspaces')
        .select('name')
        .eq('id', userData.workspace_id)
        .single();

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [toReplyResult, doneResult, snoozedResult, reviewResult, unreadResult, draftsResult] =
        await Promise.all([
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', userData.workspace_id)
            .eq('requires_reply', true)
            .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated']),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', userData.workspace_id)
            .or('decision_bucket.eq.auto_handled,status.eq.resolved')
            .gte('updated_at', today.toISOString()),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', userData.workspace_id)
            .not('snoozed_until', 'is', null)
            .gt('snoozed_until', new Date().toISOString()),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', userData.workspace_id)
            .eq('needs_review', true)
            .is('reviewed_at', null),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', userData.workspace_id)
            .eq('requires_reply', true)
            .eq('status', 'new'),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', userData.workspace_id)
            .not('ai_draft_response', 'is', null)
            .is('final_response', null)
            .in('status', ['new', 'open', 'ai_handling'])
            .eq('requires_reply', true),
        ]);

      return {
        toReply: toReplyResult.count || 0,
        done: doneResult.count || 0,
        snoozed: snoozedResult.count || 0,
        review: reviewResult.count || 0,
        unread: unreadResult.count || 0,
        drafts: draftsResult.count || 0,
        workspaceId: userData.workspace_id,
        workspaceName: workspace?.name || 'AI customer operations',
      };
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const viewCounts = isPreviewMode
    ? {
        toReply: 0,
        done: 0,
        snoozed: 0,
        review: 0,
        unread: 0,
        drafts: 0,
        workspaceId: null,
        workspaceName: 'Preview workspace',
      }
    : viewData;

  const workspaceLabel = isPreviewMode
    ? 'Preview workspace'
    : workspaceLoading
      ? 'Loading workspace…'
      : !workspace?.id || needsOnboarding
        ? 'Workspace setup incomplete'
        : workspace.name;
  const primaryItems: NavItem[] = [
    { to: '/', icon: Home, label: 'Home', end: true },
    { to: '/inbox', icon: Inbox, label: 'Inbox' },
    { to: '/needs-action', icon: Zap, label: 'Needs action', count: viewCounts?.toReply },
    { to: '/unread', icon: Mail, label: 'Unread', count: viewCounts?.unread },
    { to: '/drafts', icon: FileEdit, label: 'Drafts', count: viewCounts?.drafts },
    { to: '/review', icon: ClipboardCheck, label: 'Training', count: viewCounts?.review },
    { to: '/snoozed', icon: Clock, label: 'Snoozed', count: viewCounts?.snoozed },
    { to: '/done', icon: Archive, label: 'Cleared', count: viewCounts?.done },
    { to: '/sent', icon: Send, label: 'Sent' },
    { to: '/ai-phone', icon: Phone, label: 'AI phone', gateState: aiPhoneState.state },
  ];

  const secondaryItems: NavItem[] = [
    { to: '/channels', icon: MessageSquare, label: 'Channels' },
    { to: '/reviews', icon: Star, label: 'Reviews' },
    { to: '/analytics', icon: BarChart3, label: 'Analytics', gateState: analyticsState.state },
    {
      to: '/knowledge-base',
      icon: BookOpen,
      label: 'Knowledge base',
      gateState: knowledgeBaseState.state,
    },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ];

  const getGatePill = (state: ModuleLockState) => {
    if (state === 'shadow-preview') {
      return (
        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700">
          Shadow
        </span>
      );
    }

    if (state === 'locked') {
      return (
        <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700">
          Locked
        </span>
      );
    }

    return null;
  };

  const getGateDotClass = (state: ModuleLockState) => {
    if (state === 'shadow-preview') {
      return 'bg-sky-400';
    }

    if (state === 'locked') {
      return 'bg-rose-400';
    }

    return '';
  };

  const SidebarItem = ({ item, compact = false }: { item: NavItem; compact?: boolean }) => {
    const sharedClassName = compact
      ? 'flex h-10 w-10 items-center justify-center rounded-xl text-[rgba(253,248,236,0.72)] transition-all relative hover:bg-[rgba(255,255,255,0.08)] hover:text-[#FDF8EC]'
      : 'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[rgba(253,248,236,0.76)] transition-all hover:bg-[rgba(255,255,255,0.08)] hover:text-[#FDF8EC]';

    const activeClassName = compact
      ? 'bg-[rgba(201,168,76,0.18)] text-bb-gold shadow-[inset_0_0_0_1px_rgba(201,168,76,0.12)]'
      : 'bg-[rgba(201,168,76,0.16)] text-bb-gold shadow-[inset_0_0_0_1px_rgba(201,168,76,0.12)]';

    return compact ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={sharedClassName}
            activeClassName={activeClassName}
          >
            <item.icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
            {item.count ? (
              <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bb-gold px-1 text-[10px] font-medium leading-none text-bb-espresso">
                {item.count > 99 ? '99+' : item.count}
              </span>
            ) : null}
            {item.gateState && item.gateState !== 'available' ? (
              <span
                className={`absolute -bottom-0.5 -left-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--bb-espresso)] ${getGateDotClass(item.gateState)}`}
              />
            ) : null}
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          <p>
            {item.label}
            {item.count ? ` (${item.count})` : ''}
          </p>
          {item.gateState === 'shadow-preview' ? (
            <p className="text-xs text-sky-700">Shadow preview</p>
          ) : null}
          {item.gateState === 'locked' ? <p className="text-xs text-rose-700">Locked</p> : null}
        </TooltipContent>
      </Tooltip>
    ) : (
      <NavLink
        to={item.to}
        end={item.end}
        onClick={onNavigate}
        className={sharedClassName}
        activeClassName={activeClassName}
      >
        <item.icon className="h-[16px] w-[16px] flex-shrink-0" strokeWidth={1.7} />
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="truncate">{item.label}</span>
          <span className="flex items-center gap-1.5">
            {item.gateState && item.gateState !== 'available' ? getGatePill(item.gateState) : null}
            {item.count ? (
              <span className="rounded-full bg-bb-gold px-2 py-0.5 text-[10px] font-medium leading-none text-bb-espresso">
                {item.count > 99 ? '99+' : item.count}
              </span>
            ) : null}
          </span>
        </span>
      </NavLink>
    );
  };

  if (!isCollapsed) {
    return (
      <TooltipProvider>
        <div
          className={cn(
            'flex h-full min-h-[100dvh] w-[240px] self-stretch flex-col overflow-y-auto px-4 py-5 text-[#FDF8EC]',
            isMobileDrawer && 'w-full px-0 py-0',
          )}
          style={{ backgroundColor: 'var(--bb-espresso)' }}
        >
          <div
            className={cn('mb-6 flex flex-col items-start gap-3', isMobileDrawer && 'px-0 pt-1')}
          >
            <BizzyBeeLogo
              variant="full"
              size="md"
              chip="light"
              className="max-w-full"
              imgClassName="max-w-[138px]"
            />
            <div className="min-w-0 px-1">
              <p className="truncate text-[11px] uppercase tracking-[0.18em] text-bb-gold/90">
                Workspace
              </p>
              <p className="truncate text-[11px] text-[rgba(253,248,236,0.62)]">{workspaceLabel}</p>
            </div>
          </div>

          <nav className="space-y-1.5">
            {primaryItems.map((item) => (
              <SidebarItem key={item.to} item={item} />
            ))}
          </nav>

          <div className="mt-5 rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.05)]">
            <EmailImportIndicator workspaceId={viewCounts?.workspaceId || null} />
          </div>

          <div className="mt-5 h-px bg-white/10" />

          <nav className="mt-5 space-y-1.5">
            {secondaryItems.map((item) => (
              <SidebarItem key={item.to} item={item} />
            ))}
          </nav>

          <div className="mt-auto pt-4">
            {onFiltersClick ? (
              <button
                type="button"
                onClick={onFiltersClick}
                className="w-full rounded-lg border border-white/5 px-3 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-[rgba(253,248,236,0.42)] transition-colors hover:bg-white/5"
              >
                Workspace navigation
              </button>
            ) : (
              <p className="px-3 text-[10px] leading-5 text-[rgba(253,248,236,0.46)]">
                Calm shell. Light canvas. Gold only where it matters.
              </p>
            )}
          </div>
        </div>
      </TooltipProvider>
    );
  }

  const IconRailItem = ({ item }: { item: NavItem }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className="flex items-center justify-center w-10 h-10 rounded-lg transition-all relative text-[rgba(253,248,236,0.4)] hover:bg-white/5"
          activeClassName="text-bb-gold bg-[rgba(201,168,76,0.15)]"
        >
          <item.icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
          {item.count ? (
            <span className="absolute -top-0.5 -right-0.5 text-bb-espresso text-[10px] font-medium rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none bg-bb-gold">
              {item.count > 99 ? '99+' : item.count}
            </span>
          ) : null}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        <p>
          {item.label}
          {item.count ? ` (${item.count})` : ''}
        </p>
      </TooltipContent>
    </Tooltip>
  );

  return (
    <TooltipProvider>
      <div
        className="flex h-full min-h-[100dvh] w-16 self-stretch flex-col items-center gap-1 py-3"
        style={{ backgroundColor: 'var(--bb-espresso)' }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="mb-3 cursor-pointer transition-transform hover:scale-105">
              <BizzyBeeLogo variant="full" size="xs" chip="light" imgClassName="max-w-[40px]" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p className="font-medium">BizzyBee</p>
          </TooltipContent>
        </Tooltip>

        <nav className="flex flex-col items-center gap-1">
          {primaryItems.map((item) => (
            <IconRailItem key={item.to} item={item} />
          ))}
        </nav>

        <EmailImportIndicator workspaceId={viewData?.workspaceId || null} isCollapsed={true} />
        <div className="flex-1" />
        <nav className="flex flex-col items-center gap-1 pt-2 border-t border-[rgba(255,255,255,0.08)]">
          {secondaryItems.map((item) => (
            <IconRailItem key={item.to} item={item} />
          ))}
        </nav>
      </div>
    </TooltipProvider>
  );
};
