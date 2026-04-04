import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Mail, Download, Brain, CheckCircle, Loader2, Clock, AlertCircle } from 'lucide-react';

interface ImportJob {
  id: string;
  status: string;
  total_scanned: number;
  total_hydrated: number;
  total_processed: number;
  total_estimated: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface EmailImportProgressProps {
  jobId?: string;
  workspaceId?: string;
  onComplete?: () => void;
}

export function EmailImportProgress({ jobId, workspaceId, onComplete }: EmailImportProgressProps) {
  const [job, setJob] = useState<ImportJob | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(jobId || null);

  const fetchJob = useCallback(
    async (id: string) => {
      const { data } = await supabase.from('import_jobs').select('*').eq('id', id).single();

      if (data) {
        setJob(data as ImportJob);
        if (data.status === 'completed' && onComplete) {
          onComplete();
        }
      }
    },
    [onComplete],
  );

  const findActiveJob = useCallback(
    async (wsId: string) => {
      const { data } = await supabase
        .from('import_jobs')
        .select('*')
        .eq('workspace_id', wsId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        setActiveJobId(data.id);
        setJob(data as ImportJob);
        if (data.status === 'completed' && onComplete) {
          onComplete();
        }
      }
    },
    [onComplete],
  );

  useEffect(() => {
    // If we have a jobId, use it directly
    if (jobId) {
      setActiveJobId(jobId);
      void fetchJob(jobId);
    } else if (workspaceId) {
      // Otherwise find the most recent active job for this workspace
      void findActiveJob(workspaceId);
    }
  }, [fetchJob, findActiveJob, jobId, workspaceId]);

  useEffect(() => {
    if (!activeJobId) return;

    // Subscribe to changes
    const channel = supabase
      .channel(`import-job-${activeJobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'import_jobs',
          filter: `id=eq.${activeJobId}`,
        },
        (payload) => {
          const newJob = payload.new as ImportJob;
          setJob(newJob);
          if (newJob.status === 'completed' && onComplete) {
            onComplete();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeJobId, onComplete]);

  if (!job) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading...</span>
      </div>
    );
  }

  // Calculate progress percentages
  const scanProgress = job.total_estimated
    ? Math.min(100, Math.round((job.total_scanned / job.total_estimated) * 100))
    : job.total_scanned > 0
      ? 100
      : 0;

  const hydrateProgress =
    job.total_scanned > 0
      ? Math.min(100, Math.round((job.total_hydrated / job.total_scanned) * 100))
      : 0;

  const processProgress =
    job.total_hydrated > 0
      ? Math.min(100, Math.round((job.total_processed / job.total_hydrated) * 100))
      : 0;

  // Calculate overall progress
  const getOverallProgress = () => {
    switch (job.status) {
      case 'initializing':
        return 5;
      case 'scanning':
        return 10 + scanProgress * 0.2;
      case 'hydrating':
        return 30 + hydrateProgress * 0.4;
      case 'processing':
        return 70 + processProgress * 0.25;
      case 'completed':
        return 100;
      case 'failed':
        return 0;
      default:
        return 0;
    }
  };

  // Calculate time remaining
  const getTimeRemaining = () => {
    if (job.status === 'completed' || job.status === 'failed') return null;

    const emailsRemaining = job.total_scanned - job.total_hydrated;
    if (emailsRemaining <= 0) return null;

    // ~450 emails/min for hydration
    const minutesRemaining = Math.ceil(emailsRemaining / 450);

    if (minutesRemaining >= 60) {
      const hours = Math.floor(minutesRemaining / 60);
      const mins = minutesRemaining % 60;
      return `~${hours}h ${mins}m remaining`;
    }

    return `~${minutesRemaining} min remaining`;
  };

  const phases = [
    {
      id: 'scan',
      label: 'Finding Emails',
      description: job.total_estimated
        ? `${job.total_scanned.toLocaleString()} / ~${job.total_estimated.toLocaleString()}`
        : `${job.total_scanned.toLocaleString()} found`,
      status: job.status === 'scanning' ? 'active' : job.total_scanned > 0 ? 'complete' : 'pending',
      icon: Mail,
      progress: scanProgress,
    },
    {
      id: 'hydrate',
      label: 'Downloading Content',
      description: `${job.total_hydrated.toLocaleString()} / ${job.total_scanned.toLocaleString()}`,
      status:
        job.status === 'hydrating'
          ? 'active'
          : job.total_hydrated === job.total_scanned && job.total_scanned > 0
            ? 'complete'
            : 'pending',
      icon: Download,
      progress: hydrateProgress,
    },
    {
      id: 'process',
      label: 'Analyzing Emails',
      description: `${job.total_processed.toLocaleString()} / ${job.total_hydrated.toLocaleString()}`,
      status:
        job.status === 'processing'
          ? 'active'
          : job.status === 'completed'
            ? 'complete'
            : 'pending',
      icon: Brain,
      progress: processProgress,
    },
  ];

  const isComplete = job.status === 'completed';
  const isFailed = job.status === 'failed';

  return (
    <div className="space-y-6 p-6 bg-card rounded-lg border">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isComplete ? (
            <CheckCircle className="h-6 w-6 text-green-600" />
          ) : isFailed ? (
            <AlertCircle className="h-6 w-6 text-destructive" />
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          )}
          <div>
            <h3 className="text-lg font-semibold">
              {isComplete
                ? 'Import Complete!'
                : isFailed
                  ? 'Import Failed'
                  : 'Importing Your Emails'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isComplete
                ? 'BizzyBee now understands how you communicate'
                : isFailed
                  ? job.error_message
                  : 'BizzyBee is learning from your email history'}
            </p>
          </div>
        </div>
        {getTimeRemaining() && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            {getTimeRemaining()}
          </div>
        )}
      </div>

      {/* Overall Progress Bar */}
      <div className="space-y-2">
        <Progress value={getOverallProgress()} className="h-2" />
        <p className="text-sm text-muted-foreground text-right">
          {Math.round(getOverallProgress())}% complete
        </p>
      </div>

      {/* Phase Steps */}
      <div className="space-y-4">
        {phases.map((phase) => (
          <div
            key={phase.id}
            className={`flex items-start gap-4 p-3 rounded-lg transition-colors ${
              phase.status === 'active'
                ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800'
                : phase.status === 'complete'
                  ? 'bg-green-50 dark:bg-green-950/30'
                  : 'bg-muted/50'
            }`}
          >
            <div
              className={`p-2 rounded-full ${
                phase.status === 'active'
                  ? 'bg-amber-100 dark:bg-amber-900'
                  : phase.status === 'complete'
                    ? 'bg-green-100 dark:bg-green-900'
                    : 'bg-muted'
              }`}
            >
              {phase.status === 'active' ? (
                <Loader2 className="w-5 h-5 text-amber-600 dark:text-amber-400 animate-spin" />
              ) : phase.status === 'complete' ? (
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              ) : (
                <phase.icon className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex justify-between items-center">
                <p
                  className={`font-medium ${
                    phase.status === 'active'
                      ? 'text-amber-900 dark:text-amber-200'
                      : phase.status === 'complete'
                        ? 'text-green-900 dark:text-green-200'
                        : 'text-muted-foreground'
                  }`}
                >
                  {phase.label}
                </p>
                <p
                  className={`text-sm ${
                    phase.status === 'active'
                      ? 'text-amber-700 dark:text-amber-400'
                      : phase.status === 'complete'
                        ? 'text-green-700 dark:text-green-400'
                        : 'text-muted-foreground/70'
                  }`}
                >
                  {phase.description}
                </p>
              </div>
              {phase.status === 'active' && (
                <Progress value={phase.progress} className="h-1 mt-2" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Completion Summary */}
      {isComplete && (
        <div className="mt-6 p-4 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-800">
          <h4 className="font-medium text-green-900 dark:text-green-200 mb-2">
            What BizzyBee Learned
          </h4>
          <ul className="space-y-1 text-sm text-green-800 dark:text-green-300">
            <li>✓ Imported {job.total_scanned.toLocaleString()} emails</li>
            <li>✓ Analyzed {job.total_processed.toLocaleString()} emails</li>
            <li>✓ Learned your communication style</li>
            <li>✓ Ready to help you respond faster</li>
          </ul>
        </div>
      )}

      {/* Error Display */}
      {isFailed && job.error_message && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <p className="text-sm text-destructive">{job.error_message}</p>
        </div>
      )}
    </div>
  );
}
