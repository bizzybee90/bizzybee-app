import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getPreviewAwarePath } from '@/lib/previewMode';

interface PanelNoticeProps {
  title: string;
  description: string;
  icon?: LucideIcon;
  actionLabel?: string;
  actionTo?: string;
  action?: React.ReactNode;
  className?: string;
}

export function PanelNotice({
  title,
  description,
  icon: Icon = Info,
  actionLabel,
  actionTo,
  action,
  className,
}: PanelNoticeProps) {
  const resolvedActionTo = actionTo ? getPreviewAwarePath(actionTo) : undefined;

  return (
    <Card className={cn('border-[0.5px] border-bb-border bg-bb-linen/80 p-5', className)}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-bb-white p-2 text-bb-gold shadow-sm">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h3 className="text-sm font-medium text-bb-text">{title}</h3>
            <p className="mt-1 text-sm text-bb-warm-gray">{description}</p>
          </div>

          {action ??
            (actionLabel && resolvedActionTo && (
              <Button asChild size="sm" variant="outline">
                <Link to={resolvedActionTo}>
                  {actionLabel}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            ))}
        </div>
      </div>
    </Card>
  );
}
