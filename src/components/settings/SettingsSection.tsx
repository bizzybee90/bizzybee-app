import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function SettingsSection({
  title,
  description,
  children,
  defaultOpen = false,
}: SettingsSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="overflow-hidden rounded-[24px] border border-bb-border bg-gradient-to-b from-bb-white to-bb-cream/60 shadow-[0_14px_32px_rgba(28,21,16,0.04)]">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-bb-linen/40">
          <div>
            <h3 className="text-[15px] font-medium text-bb-text">{title}</h3>
            {description && (
              <p className="mt-1 text-xs leading-5 text-bb-warm-gray">{description}</p>
            )}
          </div>
          <ChevronRight
            className={cn(
              'h-4 w-4 text-bb-warm-gray transition-transform duration-200',
              isOpen && 'rotate-90',
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-bb-border-light/80 bg-bb-white/80 px-5 pb-5 pt-4">
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
