import { ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';
import { BizzyBeeLogo } from '@/components/branding/BizzyBeeLogo';

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
        <div className="flex h-[100dvh] min-h-[100dvh] w-full bg-bb-linen overflow-hidden flex-col">
          <header className="flex-shrink-0 h-14 border-b border-bb-border bg-bb-white px-4 flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              className="h-9 w-9 text-bb-text"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <BizzyBeeLogo variant="full" size="sm" imgClassName="max-w-[118px]" />
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
    <div className="flex h-[100dvh] min-h-[100dvh] w-full overflow-hidden bg-bb-linen">
      <aside className="relative z-50 flex h-full min-h-0 flex-shrink-0 overflow-hidden shadow-[inset_-1px_0_0_rgba(255,255,255,0.04)]">
        {sidebar}
      </aside>

      <main className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden bg-bb-linen p-3 lg:p-4">
        <div className="flex-1 min-h-0 overflow-auto rounded-[30px] border border-[rgba(28,21,16,0.08)] bg-bb-white shadow-[0_18px_40px_rgba(28,21,16,0.06)]">
          {main}
        </div>
      </main>
    </div>
  );
};
