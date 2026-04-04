import { ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';

interface ThreeColumnLayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
}

export const ThreeColumnLayout = ({ sidebar, main }: ThreeColumnLayoutProps) => {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (isMobile) {
    return (
      <>
        <div className="flex h-screen w-full bg-background overflow-hidden flex-col">
          <header className="flex-shrink-0 h-14 border-b border-border bg-card px-4 flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              className="h-9 w-9"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold truncate">BizzyBee</h1>
            <div className="w-9" />
          </header>
          <main className="flex-1 overflow-y-auto">{main}</main>
        </div>
        <MobileSidebarSheet
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          onNavigate={() => setSidebarOpen(false)}
        />
      </>
    );
  }

  return (
    <div className="flex h-screen w-full bg-muted/50 overflow-hidden">
      {/* Desktop Sidebar - icon rail */}
      <aside className="bg-white flex-shrink-0 overflow-y-auto relative z-50 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] ring-1 ring-slate-900/5">
        {sidebar}
      </aside>

      {/* Desktop Main Content - floating card */}
      <main className="flex-1 flex flex-col overflow-y-auto min-w-0 p-4">
        <div className="flex-1 bg-white rounded-xl shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] ring-1 ring-slate-900/5 overflow-y-auto">
          {main}
        </div>
      </main>
    </div>
  );
};
