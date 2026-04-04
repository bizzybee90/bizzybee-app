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
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { EmailImportIndicator } from './EmailImportIndicator';
import bizzybeelogo from '@/assets/bizzybee-logo.png';

interface SidebarProps {
  forceCollapsed?: boolean;
  onNavigate?: () => void;
  onFiltersClick?: () => void;
  isMobileDrawer?: boolean;
}

export const Sidebar = ({
  forceCollapsed = false,
  onNavigate,
  onFiltersClick,
  isMobileDrawer = false,
}: SidebarProps = {}) => {
  // In mobile drawer mode, show full sidebar with labels
  const isCollapsed = isMobileDrawer ? false : true; // Always icon rail on desktop

  // Fetch view counts and workspace ID
  const { data: viewData } = useQuery({
    queryKey: ['sidebar-view-counts'],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { toReply: 0, done: 0, snoozed: 0, review: 0, workspaceId: null };

      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user.id)
        .single();

      if (!userData?.workspace_id)
        return { toReply: 0, done: 0, snoozed: 0, review: 0, workspaceId: null };

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
      };
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const viewCounts = viewData;

  // Mobile drawer: show full labels
  if (isMobileDrawer) {
    return (
      <TooltipProvider>
        <div className="flex flex-col h-full overflow-y-auto p-4">
          <div className="flex items-center gap-3 mb-6">
            <img src={bizzybeelogo} alt="BizzyBee" className="h-44 w-auto" />
          </div>
          <nav className="space-y-1 flex-1">
            {[
              { to: '/', icon: Home, label: 'Home', end: true },
              { to: '/inbox', icon: Inbox, label: 'Inbox' },
              {
                to: '/needs-action',
                icon: Zap,
                label: 'Needs Action',
                count: viewCounts?.toReply,
                color: 'text-destructive',
              },
              {
                to: '/unread',
                icon: Mail,
                label: 'Unread',
                count: viewCounts?.unread,
                color: 'text-blue-500',
              },
              {
                to: '/drafts',
                icon: FileEdit,
                label: 'Drafts',
                count: viewCounts?.drafts,
                color: 'text-amber-500',
              },
              {
                to: '/review',
                icon: ClipboardCheck,
                label: 'Training',
                count: viewCounts?.review,
                color: 'text-purple-500',
              },
              {
                to: '/snoozed',
                icon: Clock,
                label: 'Snoozed',
                count: viewCounts?.snoozed,
                color: 'text-amber-500',
              },
              {
                to: '/done',
                icon: Archive,
                label: 'Cleared',
                count: viewCounts?.done,
                color: 'text-green-500',
              },
              { to: '/sent', icon: Send, label: 'Sent' },
              { to: '/ai-phone', icon: Phone, label: 'AI Phone' },
              { to: '/channels', icon: MessageSquare, label: 'Channels' },
              { to: '/analytics', icon: BarChart3, label: 'Analytics' },
              { to: '/knowledge-base', icon: BookOpen, label: 'Knowledge Base' },
              { to: '/settings', icon: Settings, label: 'Settings' },
            ].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-accent/50 transition-all"
                activeClassName="bg-primary/10 text-primary rounded-xl"
              >
                <item.icon className={`h-5 w-5 ${item.color || 'text-muted-foreground'}`} />
                <span className="flex-1 flex items-center justify-between">
                  <span>{item.label}</span>
                  {item.count ? (
                    <span className={`text-xs font-semibold ${item.color || ''}`}>
                      {item.count}
                    </span>
                  ) : null}
                </span>
              </NavLink>
            ))}
          </nav>
        </div>
      </TooltipProvider>
    );
  }

  // Desktop: Icon rail
  const IconRailItem = ({
    to,
    icon: Icon,
    label,
    count,
    color,
    end,
  }: {
    to: string;
    icon: any;
    label: string;
    count?: number;
    color?: string;
    end?: boolean;
  }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={to}
          end={end}
          onClick={onNavigate}
          className="flex items-center justify-center w-10 h-10 rounded-lg transition-all relative text-muted-foreground"
          activeClassName="text-primary"
        >
          <Icon className="h-[22px] w-[22px]" strokeWidth={1.5} />
          {count ? (
            <span className="absolute -top-0.5 -right-0.5 text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none bg-destructive">
              {count > 99 ? '99+' : count}
            </span>
          ) : null}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        <p>
          {label}
          {count ? ` (${count})` : ''}
        </p>
      </TooltipContent>
    </Tooltip>
  );

  return (
    <TooltipProvider>
      <div className="flex flex-col items-center h-full w-16 py-3 gap-1 bg-muted">
        {/* Logo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="mb-3 cursor-pointer hover:scale-110 transition-transform">
              <img src={bizzybeelogo} alt="BizzyBee" className="h-8 w-8 object-contain" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p className="font-semibold">BizzyBee</p>
          </TooltipContent>
        </Tooltip>

        {/* Primary nav - top anchored */}
        <nav className="flex flex-col items-center gap-1">
          <IconRailItem to="/" icon={Home} label="Home" end />
          <IconRailItem to="/inbox" icon={Inbox} label="Inbox" />
          <IconRailItem
            to="/needs-action"
            icon={Zap}
            label="Needs Action"
            count={viewCounts?.toReply}
            color="text-destructive"
          />
          <IconRailItem
            to="/unread"
            icon={Mail}
            label="Unread"
            count={viewCounts?.unread}
            color="text-blue-500"
          />
          <IconRailItem
            to="/drafts"
            icon={FileEdit}
            label="Drafts"
            count={viewCounts?.drafts}
            color="text-amber-500"
          />
          <IconRailItem
            to="/review"
            icon={ClipboardCheck}
            label="Training"
            count={viewCounts?.review}
            color="text-purple-500"
          />
          <IconRailItem
            to="/snoozed"
            icon={Clock}
            label="Snoozed"
            count={viewCounts?.snoozed}
            color="text-amber-500"
          />
          <IconRailItem
            to="/done"
            icon={Archive}
            label="Cleared"
            count={viewCounts?.done}
            color="text-green-500"
          />
          <IconRailItem to="/sent" icon={Send} label="Sent" color="text-blue-500" />
          <IconRailItem to="/ai-phone" icon={Phone} label="AI Phone" />
        </nav>

        {/* Email import */}
        <EmailImportIndicator workspaceId={viewData?.workspaceId || null} isCollapsed={true} />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Secondary nav - bottom anchored */}
        <nav className="flex flex-col items-center gap-1 pt-2 border-t border-border">
          <IconRailItem to="/analytics" icon={BarChart3} label="Analytics" />
          <IconRailItem to="/knowledge-base" icon={BookOpen} label="Knowledge Base" />
          <IconRailItem to="/settings" icon={Settings} label="Settings" />
        </nav>
      </div>
    </TooltipProvider>
  );
};
