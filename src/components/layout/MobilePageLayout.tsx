import { useState, ReactNode } from 'react';
import { MobileHeader } from '@/components/sidebar/MobileHeader';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';

interface MobilePageLayoutProps {
  children: ReactNode;
  showBackButton?: boolean;
  onBackClick?: () => void;
  backToText?: string;
}

export const MobilePageLayout = ({
  children,
  showBackButton,
  onBackClick,
  backToText,
}: MobilePageLayoutProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-bb-linen flex flex-col">
      <MobileHeader
        onMenuClick={() => setSidebarOpen(true)}
        showBackButton={showBackButton}
        onBackClick={onBackClick}
        backToText={backToText}
      />
      <MobileSidebarSheet
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        onNavigate={() => setSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
};
