import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { useEmailImportStatus } from '@/hooks/useEmailImportStatus';
import {
  ChevronLeft,
  Loader2,
  Brain,
  CheckCircle2,
  Sparkles,
  Clock,
  Send,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';

interface InboxLearningStepProps {
  workspaceId: string;
  onComplete: (results: {
    emailsAnalyzed: number;
    patternsLearned: number;
    voiceProfileBuilt: boolean;
  }) => void;
  onBack: () => void;
}

interface LearningResult {
  emailsAnalyzed: number;
  totalConversations: number;
  totalOutbound: number;
  profile: {
    tone: string;
    tone_description: string;
    formality_level: number;
  } | null;
  topCategories: { category: string; count: number }[];
}

export function InboxLearningStep({ workspaceId, onComplete, onBack }: InboxLearningStepProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'complete' | 'error'>('idle');
  const [result, setResult] = useState<LearningResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check email import status
  const {
    isImporting,
    phase: importPhase,
    progress: importProgress,
    inboxCount,
    sentCount,
    hasSentEmails,
  } = useEmailImportStatus(workspaceId);

  const runLearning = async () => {
    setStatus('running');
    setError(null);

    try {
      logger.debug('Starting voice learning with Claude');

      const { data, error: fnError } = await supabase.functions.invoke('trigger-n8n-workflow', {
        body: { workspace_id: workspaceId, workflow_type: 'voice_learning' },
      });

      if (fnError) {
        logger.error('Function error', fnError);
        throw fnError;
      }

      // Check for not enough emails error
      if (data?.success === false && data?.error === 'not_enough_emails') {
        setError(data.message);
        setStatus('error');
        return;
      }

      if (data?.error && data?.success === false) {
        throw new Error(data.error);
      }

      setResult({
        emailsAnalyzed: data.emailsAnalyzed || 0,
        totalConversations: data.totalConversations || 0,
        totalOutbound: data.totalOutbound || 0,
        profile: data.profile,
        topCategories: data.topCategories || [],
      });

      setStatus('complete');
      toast.success('Voice learning complete!');
    } catch (err) {
      logger.error('Inbox learning error', err);
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
      toast.error('Learning failed - you can try again or continue');
    }
  };

  const handleContinue = () => {
    onComplete({
      emailsAnalyzed: result?.emailsAnalyzed || 0,
      patternsLearned: result?.topCategories?.length || 0,
      voiceProfileBuilt: !!result?.profile,
    });
  };

  const handleSkip = () => {
    onComplete({
      emailsAnalyzed: 0,
      patternsLearned: 0,
      voiceProfileBuilt: false,
    });
  };

  const getToneLabel = (tone: string) => {
    const labels: Record<string, string> = {
      friendly: 'Friendly & Approachable',
      professional: 'Professional & Polished',
      casual: 'Casual & Relaxed',
      formal: 'Formal & Business-like',
    };
    return labels[tone] || tone;
  };

  // Check if we need to wait for sent emails
  const needsToWaitForSent = isImporting && importPhase === 'fetching_inbox';
  const importDoneButNoSent = !isImporting && importPhase === 'complete' && !hasSentEmails;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">Learn from Your Emails</h2>
        <p className="text-sm text-muted-foreground">
          BizzyBee will study your sent emails to understand how you communicate
        </p>
      </div>

      {/* Waiting for sent emails to import */}
      {needsToWaitForSent && status === 'idle' && (
        <Card className="p-6">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto">
              <Clock className="h-8 w-8 text-amber-600" />
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">Waiting for your sent emails...</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Voice learning needs your sent emails to analyze your writing style. We're currently
                importing your inbox.
              </p>
            </div>

            {/* Import progress */}
            <div className="bg-muted/30 rounded-lg p-4 max-w-sm mx-auto">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground">Import progress</span>
                <span className="font-medium">{importProgress}%</span>
              </div>
              <Progress value={importProgress} className="h-2 mb-3" />
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-primary">●</span>
                  <span>Inbox: {inboxCount.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Send className="h-3 w-3" />
                  <span>Sent: Pending...</span>
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              This step will be available once sent emails are imported
            </p>

            <Button variant="ghost" onClick={handleSkip} className="mt-2">
              Skip for now
            </Button>
          </div>
        </Card>
      )}

      {/* Import done but no sent emails found */}
      {importDoneButNoSent && status === 'idle' && (
        <Card className="p-6">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="h-8 w-8 text-amber-600" />
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">No sent emails found</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Voice learning requires examples of your replies to analyze your communication
                style. We couldn't find sent emails in your connected account.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              You can continue without voice learning - BizzyBee will use a default professional
              style.
            </p>
            <Button onClick={handleSkip}>Continue without voice profile</Button>
          </div>
        </Card>
      )}

      {/* Ready to learn (has sent emails or still importing sent) */}
      {status === 'idle' && !needsToWaitForSent && !importDoneButNoSent && (
        <Card className="p-8 text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Brain className="h-8 w-8 text-primary" />
          </div>
          <h3 className="font-semibold mb-2">Ready to learn your style</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            We'll analyze your sent emails using Claude AI to understand your tone, common phrases,
            and how you handle different situations.
          </p>
          {sentCount > 0 && (
            <p className="text-xs text-muted-foreground mb-4">
              Found {sentCount.toLocaleString()} sent emails to analyze
            </p>
          )}
          <p className="text-xs text-muted-foreground mb-4">This usually takes about 15 seconds</p>
          <Button onClick={runLearning} size="lg">
            <Sparkles className="h-4 w-4 mr-2" />
            Start Learning
          </Button>
        </Card>
      )}

      {status === 'running' && (
        <Card className="p-8 text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <h3 className="font-semibold mb-2">Learning from your emails...</h3>
          <p className="text-sm text-muted-foreground">
            Analyzing your communication style with Claude AI
          </p>
          <p className="text-xs text-muted-foreground mt-4">
            This should only take about 15 seconds
          </p>
        </Card>
      )}

      {status === 'error' && (
        <Card className="p-8 text-center">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Brain className="h-8 w-8 text-destructive" />
          </div>
          <h3 className="font-semibold mb-2">Something went wrong</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {error || 'Unable to analyze emails. You can try again or continue without this step.'}
          </p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={runLearning}>
              Try Again
            </Button>
            <Button onClick={handleSkip}>Continue Anyway</Button>
          </div>
        </Card>
      )}

      {status === 'complete' && result && (
        <div className="space-y-4">
          <Card className="p-6">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">Learning Complete!</h3>
                <p className="text-sm text-muted-foreground">
                  BizzyBee now understands your communication style
                </p>
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto">
                <div className="bg-muted/30 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-foreground">{result.emailsAnalyzed}</div>
                  <p className="text-xs text-muted-foreground">Emails analyzed</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-green-600">
                    {result.topCategories.length}
                  </div>
                  <p className="text-xs text-muted-foreground">Patterns found</p>
                </div>
              </div>

              {/* Voice profile */}
              {result.profile && (
                <div className="bg-primary/5 rounded-lg p-4 text-left max-w-md mx-auto">
                  <p className="text-xs text-muted-foreground mb-1">Your communication style</p>
                  <p className="font-medium text-primary mb-2">
                    {getToneLabel(result.profile.tone)}
                  </p>
                  {result.profile.tone_description && (
                    <p className="text-sm text-muted-foreground">
                      {result.profile.tone_description}
                    </p>
                  )}
                </div>
              )}

              {/* Top categories */}
              {result.topCategories.length > 0 && (
                <div className="text-left max-w-md mx-auto">
                  <p className="text-xs text-muted-foreground mb-2">
                    Common email types you handle
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {result.topCategories.slice(0, 5).map((cat, i) => (
                      <span key={i} className="px-2 py-1 bg-muted/50 rounded text-xs capitalize">
                        {cat.category.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={onBack}>
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button onClick={handleContinue}>Continue</Button>
          </div>
        </div>
      )}

      {/* Back button for idle and running states (when not waiting) */}
      {(status === 'idle' || status === 'running') &&
        !needsToWaitForSent &&
        !importDoneButNoSent && (
          <div className="flex justify-between">
            <Button variant="outline" onClick={onBack}>
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            {status === 'running' && (
              <Button variant="ghost" onClick={handleSkip}>
                Skip for now
              </Button>
            )}
          </div>
        )}

      {/* Back button when waiting for sent emails */}
      {needsToWaitForSent && status === 'idle' && (
        <div className="flex justify-start">
          <Button variant="outline" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>
      )}
    </div>
  );
}
