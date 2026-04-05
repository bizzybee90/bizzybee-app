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
        <div className="flex h-screen w-full bg-bb-linen overflow-hidden flex-col">
          <header className="flex-shrink-0 h-14 border-b border-bb-border bg-bb-white px-4 flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              className="h-9 w-9 text-bb-text"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-[15px] font-medium text-bb-text truncate">BizzyBee</h1>
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
    <div className="flex h-screen w-full overflow-hidden">
      {/* Desktop Sidebar — espresso dark */}
      <aside className="flex-shrink-0 overflow-y-auto relative z-50">{sidebar}</aside>

      {/* Desktop Main Content — linen bg with white content card */}
      <main className="flex-1 flex flex-col overflow-y-auto min-w-0 bg-bb-linen p-6">
        <div className="flex-1 rounded-xl border-[0.5px] border-bb-border bg-bb-white overflow-y-auto">
          {main}
        </div>
      </main>
    </div>
  );
};
