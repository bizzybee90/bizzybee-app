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
      <div className="rounded-xl border border-bb-border bg-bb-white shadow-sm">
        <CollapsibleTrigger className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-bb-linen/60 rounded-xl transition-colors">
          <div>
            <h3 className="font-medium text-sm text-bb-text">{title}</h3>
            {description && <p className="text-xs text-bb-warm-gray mt-0.5">{description}</p>}
          </div>
          <ChevronRight
            className={cn(
              'h-4 w-4 text-bb-warm-gray transition-transform duration-200',
              isOpen && 'rotate-90',
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-bb-border-light px-4 pb-4 pt-3">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
