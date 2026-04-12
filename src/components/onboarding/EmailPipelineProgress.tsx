import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  Loader2,
  Circle,
  AlertCircle,
  ArrowRight,
  RotateCcw,
  Mail,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface EmailPipelineProgressProps {
  workspaceId: string;
  connectedEmail: string;
  onNext: () => void;
  onBack: () => void;
  onRetry: () => void;
}

type StageStatus = 'pending' | 'in_progress' | 'done' | 'error';

function StageCard({
  stage,
  title,
  description,
  status,
  icon: Icon,
  children,
}: {
  stage: number;
  title: string;
  description: string;
  status: StageStatus;
  icon: React.ElementType;
  children?: React.ReactNode;
}) {
  const statusConfig = {
    pending: {
      badge: 'Pending',
      badgeClass: 'bg-muted text-muted-foreground',
      iconClass: 'text-muted-foreground',
      StatusIcon: Circle,
    },
    in_progress: {
      badge: 'In Progress',
      badgeClass: 'bg-primary/10 text-primary',
      iconClass: 'text-primary',
      StatusIcon: Loader2,
    },
    done: {
      badge: 'Done',
      badgeClass: 'bg-success/10 text-success',
      iconClass: 'text-success',
      StatusIcon: CheckCircle2,
    },
    error: {
      badge: 'Error',
      badgeClass: 'bg-destructive/10 text-destructive',
      iconClass: 'text-destructive',
      StatusIcon: AlertCircle,
    },
  };

  const config = statusConfig[status];

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-all duration-300',
        status === 'in_progress' && 'border-primary/50 bg-primary/5 shadow-sm',
        status === 'done' && 'border-success/30 bg-success/5',
        status === 'error' && 'border-destructive/30 bg-destructive/5',
        status === 'pending' && 'border-border bg-muted/30 opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={cn('mt-0.5 shrink-0', config.iconClass)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-muted-foreground">STAGE {stage}</span>
              <h3 className="font-semibold text-foreground">{title}</h3>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', config.badgeClass)}>
            {config.badge}
          </span>
          <config.StatusIcon
            className={cn('h-4 w-4', config.iconClass, status === 'in_progress' && 'animate-spin')}
          />
        </div>
      </div>

      {children && <div className="mt-4 pl-8">{children}</div>}
    </div>
  );
}

function ProgressLine({ currentStage }: { currentStage: number }) {
  const stages = ['Import', 'Classify', 'Ready!'];

  return (
    <div className="flex items-center justify-center gap-1 py-4">
      {stages.map((label, index) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                'w-3 h-3 rounded-full transition-all duration-300',
                index < currentStage
                  ? 'bg-success'
                  : index === currentStage
                    ? 'bg-primary ring-2 ring-primary/30'
                    : 'bg-muted',
              )}
            />
            <span
              className={cn(
                'text-xs mt-1 font-medium',
                index <= currentStage ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
          </div>
          {index < stages.length - 1 && (
            <div
              className={cn(
                'w-16 h-0.5 mx-1 mt-[-12px] transition-all duration-300',
                index < currentStage ? 'bg-success' : 'bg-muted',
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function EmailPipelineProgress({
  workspaceId,
  connectedEmail,
  onNext,
  onBack,
  onRetry,
}: EmailPipelineProgressProps) {
  const [stats, setStats] = useState({
    emailsReceived: 0,
    emailsClassified: 0,
    inboxCount: 0,
    sentCount: 0,
    errorMessage: null as string | null,
  });

  const [classificationTriggered, setClassificationTriggered] = useState(false);
  const [webhookError, setWebhookError] = useState(false);
  const [startTime] = useState(Date.now());
  const [showSlowMessage, setShowSlowMessage] = useState(false);
  const classificationTriggeredRef = useRef(false);

  const triggerClassificationWorkflow = useCallback(async () => {
    return;
  }, []);

  // Poll raw_emails for real-time progress every 3 seconds
  useEffect(() => {
    if (!workspaceId) return;

    const fetchStats = async () => {
      const [totalResult, classifiedResult, inboxResult, sentResult] = await Promise.all([
        supabase
          .from('raw_emails')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId),
        supabase
          .from('raw_emails')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .not('category', 'is', null),
        supabase
          .from('email_import_queue')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('direction', 'inbound'),
        supabase
          .from('email_import_queue')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('direction', 'outbound'),
      ]);

      const total = totalResult.count || 0;
      const classified = classifiedResult.count || 0;
      const inbox = inboxResult.count || 0;
      const sent = sentResult.count || 0;

      setStats({
        emailsReceived: total,
        emailsClassified: classified,
        inboxCount: inbox,
        sentCount: sent,
        errorMessage: null,
      });
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [workspaceId]);

  // Show slow message after 5 minutes
  useEffect(() => {
    const timer = setTimeout(() => setShowSlowMessage(true), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, []);

  // Derive stage statuses
  const totalEmails = stats.inboxCount + stats.sentCount;
  const importComplete = totalEmails > 0 && stats.emailsReceived > 0;
  const allClassified =
    stats.emailsReceived > 0 &&
    (stats.emailsClassified >= stats.emailsReceived ||
      stats.emailsClassified / stats.emailsReceived >= 0.99);

  // If no emails need classification (all already have categories), skip to done
  const skipClassification =
    importComplete && stats.emailsReceived > 0 && allClassified && !classificationTriggered;

  const importStatus: StageStatus = importComplete ? 'done' : 'in_progress';

  const classifyStatus: StageStatus = (() => {
    if (webhookError) return 'error';
    if (allClassified && stats.emailsReceived > 0) return 'done';
    if (classificationTriggered && stats.emailsClassified > 0) return 'in_progress';
    if (classificationTriggered) return 'in_progress';
    if (!importComplete) return 'pending';
    return 'pending';
  })();

  const isComplete = classifyStatus === 'done';

  // Classification is handled by the queue workers once import has materialized emails.
  useEffect(() => {
    if (!importComplete || classificationTriggeredRef.current || skipClassification) return;

    const triggerClassification = async () => {
      classificationTriggeredRef.current = true;
      setClassificationTriggered(true);
      setWebhookError(false);

      try {
        await triggerClassificationWorkflow();
        logger.debug('Email classification is already handled by the onboarding runner');
      } catch (error) {
        logger.error('Failed to trigger classification', error);
        setWebhookError(true);
        classificationTriggeredRef.current = false;
        toast.error('Failed to start classification. Click retry.');
      }
    };

    triggerClassification();
  }, [importComplete, skipClassification, triggerClassificationWorkflow]);

  // Update onboarding_progress when classification completes
  useEffect(() => {
    if (!isComplete) return;

    const updateProgress = async () => {
      try {
        await supabase
          .from('onboarding_progress')
          .update({
            email_import_status: 'complete',
            emails_classified: stats.emailsClassified,
            updated_at: new Date().toISOString(),
          })
          .eq('workspace_id', workspaceId);
      } catch (err) {
        logger.error('Failed to update onboarding_progress', err);
      }
    };

    updateProgress();
  }, [isComplete, stats.emailsClassified, workspaceId]);

  const classifyPercent =
    stats.emailsReceived > 0
      ? Math.round((stats.emailsClassified / stats.emailsReceived) * 100)
      : 0;

  const estimateTime = (): string => {
    const remaining = stats.emailsReceived - stats.emailsClassified;
    if (remaining <= 0) return 'Almost done...';
    const minutes = Math.ceil(remaining / 200);
    if (minutes <= 1) return 'Less than a minute';
    if (minutes < 60) return `~${minutes} min remaining`;
    return `~${Math.ceil(minutes / 60)} hour${Math.ceil(minutes / 60) > 1 ? 's' : ''} remaining`;
  };

  const handleRetryClassification = () => {
    classificationTriggeredRef.current = false;
    setClassificationTriggered(false);
    setWebhookError(false);
  };

  const getCurrentStage = (): number => {
    if (isComplete) return 2;
    if (classifyStatus === 'in_progress') return 1;
    return 0;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">Setting Up Your AI Assistant</h2>
        <p className="text-sm text-muted-foreground">
          Teaching BizzyBee to understand your emails.
          <br />
          <span className="font-medium text-foreground">{connectedEmail}</span>
        </p>
      </div>

      {/* Stage Cards */}
      <div className="space-y-3">
        {/* Stage 1: Import */}
        <StageCard
          stage={1}
          title="Import Emails"
          description={
            importComplete ? 'Downloaded your email history' : 'Downloading your email history'
          }
          status={importStatus}
          icon={Mail}
        >
          {importComplete && totalEmails > 0 && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-2">
                  <span className="text-xs">├─</span> Inbox
                </span>
                <span className="font-medium flex items-center gap-1">
                  {stats.inboxCount.toLocaleString()} emails
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-2">
                  <span className="text-xs">└─</span> Sent
                </span>
                <span className="font-medium flex items-center gap-1">
                  {stats.sentCount.toLocaleString()} emails
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                </span>
              </div>
              <div className="pt-1 border-t mt-2">
                <span className="font-semibold">
                  Total: {totalEmails.toLocaleString()} emails imported
                </span>
              </div>
            </div>
          )}
          {!importComplete && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span>
                  Scanning mailbox...{' '}
                  {stats.emailsReceived > 0 && `${stats.emailsReceived.toLocaleString()} found`}
                </span>
              </div>
            </div>
          )}
        </StageCard>

        {/* Stage 2: Classify (native automation pipeline) */}
        <StageCard
          stage={2}
          title="Classify Emails"
          description={
            classifyStatus === 'done'
              ? 'AI sorted emails into categories'
              : classifyStatus === 'in_progress'
                ? 'AI is sorting emails into categories'
                : classifyStatus === 'error'
                  ? 'Classification failed'
                  : 'AI will sort emails into categories'
          }
          status={classifyStatus}
          icon={Sparkles}
        >
          {classifyStatus === 'pending' && (
            <p className="text-sm text-muted-foreground">
              (quotes, bookings, complaints, etc.)
              <br />
              Waiting for import to complete...
            </p>
          )}
          {classifyStatus === 'in_progress' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Progress value={classifyPercent} className="h-2" />
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">
                    {stats.emailsClassified.toLocaleString()} /{' '}
                    {stats.emailsReceived.toLocaleString()}
                  </span>
                  <span className="font-medium">{classifyPercent}%</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span>Classifying... {estimateTime()}</span>
              </div>
              {showSlowMessage && (
                <p className="text-xs text-muted-foreground italic">
                  Still processing... This can take a few minutes for large inboxes.
                </p>
              )}
            </div>
          )}
          {classifyStatus === 'done' && (
            <p className="text-sm text-success">
              ✓ {stats.emailsClassified.toLocaleString()} emails categorised
            </p>
          )}
          {classifyStatus === 'error' && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">Failed to start classification</p>
              <Button
                onClick={handleRetryClassification}
                size="sm"
                variant="outline"
                className="gap-2"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          )}
        </StageCard>
      </div>

      {/* Progress Line */}
      <ProgressLine currentStage={getCurrentStage()} />

      {/* Completion Message */}
      {isComplete && (
        <div className="p-4 bg-success/10 border border-success/30 rounded-lg text-center space-y-2">
          <CheckCircle2 className="h-6 w-6 text-success mx-auto mb-2" />
          <p className="text-sm font-medium text-success">Analysis Complete!</p>
          <p className="text-xs text-muted-foreground">
            Your AI assistant has learned from {stats.emailsClassified.toLocaleString()} emails
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-3">
        <Button onClick={onNext} className="w-full gap-2">
          {isComplete ? 'Continue to Dashboard' : 'Continue'} <ArrowRight className="h-4 w-4" />
        </Button>
        {!isComplete && (
          <p className="text-xs text-center text-muted-foreground">
            You can continue while this runs in the background
          </p>
        )}
        <Button variant="ghost" size="sm" onClick={onBack} className="w-full text-muted-foreground">
          Back
        </Button>
      </div>
    </div>
  );
}
