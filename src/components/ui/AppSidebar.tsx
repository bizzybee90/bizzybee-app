import { NavLink } from 'react-router-dom';
import {
  Home,
  Inbox,
  AlertCircle,
  Mail,
  FileText,
  BookCheck,
  Clock,
  CheckCircle,
  Send,
  Phone,
  BarChart3,
  BookOpen,
  Settings,
} from 'lucide-react';
import beeLogo from '@/assets/bee-logo.png';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

interface AppSidebarProps {
  currentRoute?: string;
  accountName?: string;
}

const primaryNav: NavItem[] = [
  { to: '/', label: 'Home', icon: <Home className="h-4 w-4" /> },
  { to: '/inbox', label: 'Inbox', icon: <Inbox className="h-4 w-4" /> },
  { to: '/needs-action', label: 'Needs Action', icon: <AlertCircle className="h-4 w-4" /> },
  { to: '/unread', label: 'Unread', icon: <Mail className="h-4 w-4" /> },
  { to: '/drafts', label: 'Drafts', icon: <FileText className="h-4 w-4" /> },
  { to: '/review', label: 'Review', icon: <BookCheck className="h-4 w-4" /> },
  { to: '/snoozed', label: 'Snoozed', icon: <Clock className="h-4 w-4" /> },
  { to: '/done', label: 'Done', icon: <CheckCircle className="h-4 w-4" /> },
  { to: '/sent', label: 'Sent', icon: <Send className="h-4 w-4" /> },
  { to: '/ai-phone', label: 'AI Phone', icon: <Phone className="h-4 w-4" /> },
];

const secondaryNav: NavItem[] = [
  { to: '/analytics', label: 'Analytics', icon: <BarChart3 className="h-4 w-4" /> },
  { to: '/knowledge-base', label: 'Knowledge Base', icon: <BookOpen className="h-4 w-4" /> },
  { to: '/settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
];

function SidebarNavItem({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `group flex items-center gap-2.5 rounded-md px-2 py-[7px] text-[12px] font-medium transition-colors duration-100 ${
          isActive
            ? 'bg-[rgba(201,168,76,0.15)] text-bb-gold'
            : 'text-[rgba(253,248,236,0.55)] hover:bg-[rgba(255,255,255,0.05)]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 h-4 w-[3px] rounded-r-full bg-bb-gold" />}
          <span className={isActive ? 'text-bb-gold' : 'text-[rgba(253,248,236,0.4)]'}>
            {item.icon}
          </span>
          <span>{item.label}</span>
          {item.badge != null && item.badge > 0 && (
            <span className="ml-auto rounded-full bg-bb-gold px-1.5 py-0.5 text-[10px] font-medium text-bb-espresso">
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export function AppSidebar({ accountName = 'BizzyBee' }: AppSidebarProps) {
  return (
    <aside className="flex h-screen w-[200px] flex-col bg-bb-espresso">
      {/* Logo lockup */}
      <div className="flex items-center gap-2.5 px-4 py-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-bb-gold">
          <img src={beeLogo} alt="" className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[13px] font-medium text-bb-gold-light">BizzyBee</p>
          <p className="text-[10px] text-bb-muted">{accountName}</p>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {primaryNav.map((item) => (
          <SidebarNavItem key={item.to} item={item} />
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-3 border-t border-[rgba(255,255,255,0.08)]" />

      {/* Secondary nav */}
      <nav className="space-y-0.5 px-2 py-3">
        {secondaryNav.map((item) => (
          <SidebarNavItem key={item.to} item={item} />
        ))}
      </nav>
    </aside>
  );
}
