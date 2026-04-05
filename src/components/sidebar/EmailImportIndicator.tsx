import { Mail, Loader2, CheckCircle2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useEmailImportStatus } from '@/hooks/useEmailImportStatus';
import { cn } from '@/lib/utils';

interface EmailImportIndicatorProps {
  workspaceId: string | null;
  isCollapsed?: boolean;
}

export function EmailImportIndicator({
  workspaceId,
  isCollapsed = false,
}: EmailImportIndicatorProps) {
  const { isImporting, progress, statusMessage, phase } = useEmailImportStatus(workspaceId);

  // Only show when actively importing
  if (!isImporting) return null;

  const indicator = (
    <div
      className={cn(
        'flex items-center rounded-lg transition-all',
        isCollapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2.5',
      )}
    >
      <div className="relative flex-shrink-0">
        <Mail className="h-5 w-5 text-bb-gold" />
        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-bb-gold rounded-full animate-pulse" />
      </div>
      {!isCollapsed && (
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[rgba(253,248,236,0.7)] truncate">
              Importing mail
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-bb-gold">{progress}%</span>
              <Loader2 className="h-3 w-3 animate-spin text-[rgba(253,248,236,0.55)]" />
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{indicator}</TooltipTrigger>
        <TooltipContent side="right">
          <p>{statusMessage}</p>
          <p className="text-xs text-muted-foreground">{progress}% complete</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return indicator;
}
