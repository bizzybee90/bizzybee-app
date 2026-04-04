import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Loader2 } from 'lucide-react';

interface ImportProgress {
  current_phase: string;
  emails_received: number;
  emails_classified: number;
}

interface EmailImportBannerProps {
  workspaceId: string;
}

export function EmailImportBanner({ workspaceId }: EmailImportBannerProps) {
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const fetchProgress = useCallback(async () => {
    const { data } = await supabase
      .from('email_import_progress')
      .select('current_phase, emails_received, emails_classified')
      .eq('workspace_id', workspaceId)
      .single();

    if (data) setProgress(data as ImportProgress);
  }, [workspaceId]);

  useEffect(() => {
    void fetchProgress();

    const channel = supabase
      .channel('email-import-banner')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'email_import_progress',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          setProgress(payload.new as ImportProgress);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchProgress, workspaceId]);

  if (!progress || progress.current_phase === 'complete') return null;

  const percent = Math.round(
    (progress.emails_classified / Math.max(progress.emails_received, 1)) * 100,
  );

  const getPhaseLabel = () => {
    switch (progress.current_phase) {
      case 'connecting':
        return 'Connecting to email...';
      case 'importing':
        return 'Importing emails...';
      case 'classifying':
        return `Classifying: ${progress.emails_classified.toLocaleString()} / ${progress.emails_received.toLocaleString()}`;
      case 'analyzing':
        return 'Analyzing conversations...';
      case 'learning':
        return 'Learning your style...';
      default:
        return 'Processing...';
    }
  };

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2">
      <div className="flex items-center gap-3 max-w-4xl mx-auto">
        <Loader2 className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-spin flex-shrink-0" />
        <span className="text-sm text-amber-800 dark:text-amber-300">{getPhaseLabel()}</span>
        {progress.current_phase === 'classifying' && (
          <>
            <Progress value={percent} className="flex-1 h-1.5" />
            <span className="text-xs text-amber-600 dark:text-amber-400 flex-shrink-0">
              {percent}%
            </span>
          </>
        )}
      </div>
    </div>
  );
}
