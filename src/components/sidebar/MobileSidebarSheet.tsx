import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Sidebar } from './Sidebar';

interface MobileSidebarSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate?: () => void;
  onFiltersClick?: () => void;
}

export const MobileSidebarSheet = ({
  open,
  onOpenChange,
  onNavigate,
  onFiltersClick,
}: MobileSidebarSheetProps) => {
  const handleNavigate = () => {
    onOpenChange(false);
    onNavigate?.();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-[85vw] max-w-[360px] p-0 border-r-0 shadow-2xl bg-bb-espresso backdrop-blur-xl md:max-w-sm [&>button]:hidden"
      >
        <div className="h-full flex flex-col overflow-y-auto pt-4 pb-safe px-4">
          <Sidebar
            onNavigate={handleNavigate}
            forceCollapsed={false}
            onFiltersClick={onFiltersClick}
            isMobileDrawer
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};
