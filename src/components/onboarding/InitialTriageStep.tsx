import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Sparkles,
  CheckCircle2,
  Mail,
  Bot,
} from 'lucide-react';
import { toast } from 'sonner';

interface InitialTriageStepProps {
  workspaceId: string;
  onComplete: (results: { processed: number; changed: number }) => void;
  onBack: () => void;
}

export function InitialTriageStep({ workspaceId, onComplete, onBack }: InitialTriageStepProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'running' | 'complete'>('idle');
  const [results, setResults] = useState({ processed: 0, changed: 0, autoHandled: 0 });

  const runTriage = async () => {
    setIsRunning(true);
    setStatus('running');
    setProgress(10);

    try {
      // Call bulk-retriage in batches
      let totalProcessed = 0;
      let totalChanged = 0;
      const batchSize = 50;
      let hasMore = true;

      while (hasMore && totalProcessed < 500) {
        setProgress(Math.min(90, 10 + totalProcessed / 5));

        const { data, error } = await supabase.functions.invoke('trigger-n8n-workflow', {
          body: {
            workspace_id: workspaceId,
            workflow_type: 'email_classification',
            limit: batchSize,
            dryRun: false,
            skipLLM: true, // Use sender rules only for speed
          },
        });

        if (error) throw error;

        totalProcessed += data.processed || 0;
        totalChanged += data.changed || 0;

        // Stop if no more to process
        if (data.processed < batchSize) {
          hasMore = false;
        }
      }

      setProgress(100);
      setStatus('complete');
      setResults({
        processed: totalProcessed,
        changed: totalChanged,
        autoHandled: Math.round(totalChanged * 0.7), // Estimate
      });

      toast.success(`Analyzed ${totalProcessed} emails`);
    } catch (error) {
      console.error('Error running triage:', error);
      toast.error('Failed to analyze inbox');
      setStatus('idle');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">Analyze Your Inbox</h2>
        <p className="text-sm text-muted-foreground">
          BizzyBee will apply your rules to existing emails
        </p>
      </div>

      {status === 'idle' && (
        <Card className="p-8 text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h3 className="font-semibold mb-2">Ready to analyze</h3>
          <p className="text-sm text-muted-foreground mb-6">
            This will sort your historical emails using the rules you just created
          </p>
          <Button onClick={runTriage} size="lg" disabled={isRunning}>
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            Start Analysis
          </Button>
        </Card>
      )}

      {status === 'running' && (
        <Card className="p-8">
          <div className="text-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <div className="space-y-2">
              <h3 className="font-semibold">Analyzing your inbox...</h3>
              <p className="text-sm text-muted-foreground">This may take a minute</p>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        </Card>
      )}

      {status === 'complete' && (
        <Card className="p-8">
          <div className="text-center space-y-6">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold text-lg">Analysis Complete!</h3>
              <p className="text-sm text-muted-foreground">BizzyBee has sorted your inbox</p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-muted/30 rounded-lg p-4 text-center">
                <div className="flex items-center justify-center gap-1 text-2xl font-bold text-foreground">
                  <Mail className="h-5 w-5 text-blue-500" />
                  {results.processed}
                </div>
                <p className="text-xs text-muted-foreground">Analyzed</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 text-center">
                <div className="flex items-center justify-center gap-1 text-2xl font-bold text-green-600">
                  <Bot className="h-5 w-5" />
                  {results.autoHandled}
                </div>
                <p className="text-xs text-muted-foreground">Auto-handled</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 text-center">
                <div className="flex items-center justify-center gap-1 text-2xl font-bold text-amber-600">
                  <Sparkles className="h-5 w-5" />
                  {results.changed}
                </div>
                <p className="text-xs text-muted-foreground">Updated</p>
              </div>
            </div>

            <Button onClick={() => onComplete(results)} size="lg" className="w-full">
              Continue
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </Card>
      )}

      {status === 'idle' && (
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button
            variant="ghost"
            onClick={() => onComplete({ processed: 0, changed: 0 })}
            className="ml-auto"
          >
            Skip this step
          </Button>
        </div>
      )}
    </div>
  );
}
