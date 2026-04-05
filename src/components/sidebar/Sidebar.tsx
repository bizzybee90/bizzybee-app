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
  type LucideIcon,
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { EmailImportIndicator } from './EmailImportIndicator';
import beeLogo from '@/assets/bee-logo.png';
import { cn } from '@/lib/utils';

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
}

export const Sidebar = ({
  forceCollapsed = false,
  onNavigate,
  onFiltersClick,
  isMobileDrawer = false,
}: SidebarProps = {}) => {
  const isCollapsed = !isMobileDrawer && forceCollapsed;

  const { data: viewData } = useQuery({
    queryKey: ['sidebar-view-counts'],
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

  const viewCounts = viewData;
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
    { to: '/ai-phone', icon: Phone, label: 'AI phone' },
  ];

  const secondaryItems: NavItem[] = [
    { to: '/channels', icon: MessageSquare, label: 'Channels' },
    { to: '/analytics', icon: BarChart3, label: 'Analytics' },
    { to: '/knowledge-base', icon: BookOpen, label: 'Knowledge base' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ];

  const SidebarItem = ({ item, compact = false }: { item: NavItem; compact?: boolean }) => {
    const sharedClassName = compact
      ? 'flex items-center justify-center w-10 h-10 rounded-lg transition-all relative text-[rgba(253,248,236,0.48)] hover:bg-white/5 hover:text-[#FDF8EC]'
      : 'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-[rgba(253,248,236,0.58)] transition-all hover:bg-white/5 hover:text-[#FDF8EC]';

    const activeClassName = compact
      ? 'bg-[rgba(201,168,76,0.15)] text-bb-gold shadow-[inset_0_0_0_1px_rgba(201,168,76,0.08)]'
      : 'bg-[rgba(201,168,76,0.15)] text-bb-gold shadow-[inset_0_0_0_1px_rgba(201,168,76,0.08)]';

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
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          <p>
            {item.label}
            {item.count ? ` (${item.count})` : ''}
          </p>
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
          {item.count ? (
            <span className="rounded-full bg-bb-gold px-2 py-0.5 text-[10px] font-medium leading-none text-bb-espresso">
              {item.count > 99 ? '99+' : item.count}
            </span>
          ) : null}
        </span>
      </NavLink>
    );
  };

  if (!isCollapsed) {
    return (
      <TooltipProvider>
        <div
          className={cn(
            'flex h-full w-[220px] flex-col bg-bb-espresso px-4 py-5 text-[#FDF8EC]',
            isMobileDrawer && 'w-full px-0 py-0',
          )}
        >
          <div className={cn('mb-6 flex items-center gap-3', isMobileDrawer && 'px-0 pt-1')}>
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-bb-gold shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
              <img src={beeLogo} alt="BizzyBee" className="h-6 w-6 rounded-md object-cover" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium tracking-[0.03em] text-[#FDF8EC]">
                BizzyBee
              </p>
              <p className="truncate text-[10px] text-[rgba(253,248,236,0.48)]">
                {viewCounts?.workspaceName || 'AI customer operations'}
              </p>
            </div>
          </div>

          <nav className="space-y-1">
            {primaryItems.map((item) => (
              <SidebarItem key={item.to} item={item} />
            ))}
          </nav>

          <div className="mt-4 rounded-xl border border-white/5 bg-white/5">
            <EmailImportIndicator workspaceId={viewCounts?.workspaceId || null} />
          </div>

          <div className="mt-4 h-px bg-white/8" />

          <nav className="mt-4 space-y-1">
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
              <p className="px-3 text-[10px] leading-5 text-[rgba(253,248,236,0.36)]">
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
      <div className="flex flex-col items-center h-full w-16 py-3 gap-1 bg-bb-espresso">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="mb-3 cursor-pointer hover:scale-110 transition-transform">
              <img src={beeLogo} alt="BizzyBee" className="h-8 w-8 rounded-lg object-cover" />
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
