import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Play,
  XCircle,
  Eye,
  RotateCcw,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';

interface LowConfidenceConversation {
  id: string;
  title: string;
  email_classification: string | null;
  decision_bucket: string | null;
  triage_confidence: number | null;
  created_at: string;
}

interface ProcessedResult {
  id: string;
  title: string;
  status: 'success' | 'error' | 'unchanged';
  originalBucket: string | null;
  newBucket: string | null;
  originalClassification: string | null;
  newClassification: string | null;
  originalConfidence: number | null;
  newConfidence: number | null;
  error?: string;
}

export function LowConfidenceWizard() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [step, setStep] = useState<'overview' | 'processing' | 'review'>('overview');
  const [conversations, setConversations] = useState<LowConfidenceConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<ProcessedResult[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  const fetchLowConfidenceEmails = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user?.id)
        .single();

      if (!userData?.workspace_id) return;
      setWorkspaceId(userData.workspace_id);

      // Fetch low confidence emails (< 90% or null)
      const { data, error } = await supabase
        .from('conversations')
        .select('id, title, email_classification, decision_bucket, triage_confidence, created_at')
        .eq('workspace_id', userData.workspace_id)
        .eq('channel', 'email')
        .or('triage_confidence.lt.0.9,triage_confidence.is.null')
        .order('triage_confidence', { ascending: true, nullsFirst: true })
        .limit(100);

      if (error) throw error;
      setConversations(data || []);
    } catch (error) {
      console.error('Error fetching low confidence emails:', error);
      toast({
        title: 'Failed to load emails',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const saved = localStorage.getItem('low-confidence-wizard-state');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as {
          step?: 'overview' | 'processing' | 'review';
          results?: ProcessedResult[];
        };
        if (
          parsed.step === 'review' &&
          Array.isArray(parsed.results) &&
          parsed.results.length > 0
        ) {
          setStep('review');
          setResults(parsed.results);
        }
      } catch {
        // ignore
      }
    }

    void fetchLowConfidenceEmails();
  }, [fetchLowConfidenceEmails]);

  const processConversation = useCallback(
    async (conv: LowConfidenceConversation): Promise<ProcessedResult> => {
      try {
        const { data, error } = await supabase.functions.invoke('trigger-n8n-workflow', {
          body: {
            workflow_type: 'email_classification',
            conversationId: conv.id,
            workspaceId,
            limit: 1,
          },
        });

        if (error) throw error;

        const changed = data?.changed || false;
        // Edge function returns updated.classification and updated.bucket, not result
        const updated = data?.updated;

        return {
          id: conv.id,
          title: conv.title || 'Untitled',
          status: changed ? 'success' : 'unchanged',
          originalBucket: data?.original?.bucket || conv.decision_bucket,
          newBucket: updated?.bucket || conv.decision_bucket,
          originalClassification: data?.original?.classification || conv.email_classification,
          newClassification: updated?.classification || conv.email_classification,
          originalConfidence: data?.original?.confidence || conv.triage_confidence,
          newConfidence: updated?.confidence || conv.triage_confidence,
        };
      } catch (error) {
        console.error('Error processing conversation:', conv.id, error);
        return {
          id: conv.id,
          title: conv.title || 'Untitled',
          status: 'error',
          originalBucket: conv.decision_bucket,
          newBucket: null,
          originalClassification: conv.email_classification,
          newClassification: null,
          originalConfidence: conv.triage_confidence,
          newConfidence: null,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
    [workspaceId],
  );

  const startProcessing = async () => {
    if (!workspaceId) {
      toast({
        title: 'Workspace not ready',
        description: 'Please wait a moment and try again.',
        variant: 'destructive',
      });
      return;
    }

    setStep('processing');
    setProcessing(true);
    setResults([]);
    setCurrentIndex(0);

    const collected: ProcessedResult[] = [];

    for (let i = 0; i < conversations.length; i++) {
      setCurrentIndex(i);
      const result = await processConversation(conversations[i]);
      collected.push(result);
      setResults([...collected]);

      // Small delay to avoid overwhelming the API
      if (i < conversations.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    setProcessing(false);
    setStep('review');

    localStorage.setItem(
      'low-confidence-wizard-state',
      JSON.stringify({ step: 'review', results: collected, ranAt: new Date().toISOString() }),
    );

    const successCount = collected.filter((r) => r.status === 'success').length;
    toast({
      title: 'Processing complete',
      description: `${successCount} classifications updated out of ${conversations.length} emails`,
    });
  };

  const getBucketColor = (bucket: string | null) => {
    switch (bucket) {
      case 'auto_handled':
        return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'quick_win':
        return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
      case 'act_now':
        return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
      case 'wait':
        return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getConfidenceColor = (confidence: number | null) => {
    if (confidence === null) return 'text-muted-foreground';
    if (confidence >= 0.9) return 'text-green-600';
    if (confidence >= 0.7) return 'text-amber-600';
    return 'text-red-600';
  };

  // Filter results: only show as "Updated" if the CLASSIFICATION actually changed
  const classificationChangedResults = results.filter(
    (r) => r.status === 'success' && r.originalClassification !== r.newClassification,
  );
  const bucketOnlyChangedResults = results.filter(
    (r) => r.status === 'success' && r.originalClassification === r.newClassification,
  );
  const unchangedResults = results.filter((r) => r.status === 'unchanged');
  const errorResults = results.filter((r) => r.status === 'error');

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-500" />
          Fix Low Confidence Emails
        </CardTitle>
        <CardDescription>
          Re-process emails that the AI was uncertain about to improve classification accuracy
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 'overview' && (
          <>
            <div className="flex items-center gap-3 bg-amber-500/10 rounded-lg p-4 border border-amber-500/20">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
              <div>
                <p className="text-sm font-medium">{conversations.length} emails need attention</p>
                <p className="text-xs text-muted-foreground">
                  These emails have confidence below 90% and may be misclassified
                </p>
              </div>
            </div>

            {conversations.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Preview of emails to process:</p>
                <ScrollArea className="h-48 border rounded-lg">
                  <div className="p-2 space-y-1">
                    {conversations.slice(0, 20).map((conv) => (
                      <div
                        key={conv.id}
                        className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-muted/50"
                      >
                        <span className="truncate flex-1 mr-2">{conv.title || 'Untitled'}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline" className={getBucketColor(conv.decision_bucket)}>
                            {conv.decision_bucket?.replace(/_/g, ' ') || 'unknown'}
                          </Badge>
                          <span
                            className={`text-xs font-mono ${getConfidenceColor(conv.triage_confidence)}`}
                          >
                            {conv.triage_confidence
                              ? `${Math.round(conv.triage_confidence * 100)}%`
                              : 'N/A'}
                          </span>
                        </div>
                      </div>
                    ))}
                    {conversations.length > 20 && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        +{conversations.length - 20} more emails
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={startProcessing}
                disabled={conversations.length === 0}
                className="flex-1"
              >
                <Play className="h-4 w-4 mr-2" />
                Start Processing {conversations.length} Emails
              </Button>
            </div>
          </>
        )}

        {step === 'processing' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Processing emails...</span>
                <span className="font-mono">
                  {currentIndex + 1} / {conversations.length}
                </span>
              </div>
              <Progress value={((currentIndex + 1) / conversations.length) * 100} />
            </div>

            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-sm truncate">
                <Loader2 className="h-4 w-4 inline mr-2 animate-spin" />
                {conversations[currentIndex]?.title || 'Processing...'}
              </p>
            </div>

            <ScrollArea className="h-48 border rounded-lg">
              <div className="p-2 space-y-1">
                {results.map((result) => (
                  <div key={result.id} className="flex items-center gap-2 text-sm py-1 px-2">
                    {result.status === 'success' && (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    )}
                    {result.status === 'unchanged' && (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    {result.status === 'error' && (
                      <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                    )}
                    <span className="truncate">{result.title}</span>
                    {result.status === 'success' && (
                      <Badge
                        variant="outline"
                        className={`ml-auto shrink-0 ${getBucketColor(result.newBucket)}`}
                      >
                        {result.newClassification?.replace(/_/g, ' ')}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-green-500/10 rounded-lg p-3 text-center border border-green-500/20">
                <p className="text-2xl font-bold text-green-600">
                  {classificationChangedResults.length}
                </p>
                <p className="text-xs text-muted-foreground">Reclassified</p>
              </div>
              <div className="bg-blue-500/10 rounded-lg p-3 text-center border border-blue-500/20">
                <p className="text-2xl font-bold text-blue-600">
                  {bucketOnlyChangedResults.length}
                </p>
                <p className="text-xs text-muted-foreground">Bucket Changed</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-muted-foreground">
                  {unchangedResults.length}
                </p>
                <p className="text-xs text-muted-foreground">Unchanged</p>
              </div>
              <div className="bg-red-500/10 rounded-lg p-3 text-center border border-red-500/20">
                <p className="text-2xl font-bold text-red-600">{errorResults.length}</p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
            </div>

            {classificationChangedResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Reclassified ({classificationChangedResults.length})
                </p>
                <ScrollArea className="h-36 border rounded-lg">
                  <div className="p-2 space-y-1">
                    {classificationChangedResults.map((result) => (
                      <div
                        key={result.id}
                        className="flex items-center justify-between text-sm py-2 px-2 rounded hover:bg-muted/50 group cursor-pointer"
                        onClick={() => navigate(`/conversation/${result.id}`)}
                      >
                        <span className="truncate flex-1 mr-2 group-hover:text-primary">
                          {result.title}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge
                            variant="outline"
                            className={getBucketColor(result.originalBucket)}
                          >
                            {result.originalClassification?.replace(/_/g, ' ') || 'unknown'}
                          </Badge>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <Badge variant="outline" className={getBucketColor(result.newBucket)}>
                            {result.newClassification?.replace(/_/g, ' ')}
                          </Badge>
                          <Eye className="h-4 w-4 opacity-0 group-hover:opacity-50" />
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {bucketOnlyChangedResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-blue-500" />
                  Bucket Changed Only ({bucketOnlyChangedResults.length})
                </p>
                <ScrollArea className="h-28 border rounded-lg">
                  <div className="p-2 space-y-1">
                    {bucketOnlyChangedResults.map((result) => (
                      <div
                        key={result.id}
                        className="flex items-center justify-between text-sm py-2 px-2 rounded hover:bg-muted/50 group cursor-pointer"
                        onClick={() => navigate(`/conversation/${result.id}`)}
                      >
                        <span className="truncate flex-1 mr-2 group-hover:text-primary">
                          {result.title}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge
                            variant="outline"
                            className={getBucketColor(result.originalBucket)}
                          >
                            {result.originalBucket?.replace(/_/g, ' ') || 'unknown'}
                          </Badge>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <Badge variant="outline" className={getBucketColor(result.newBucket)}>
                            {result.newBucket?.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStep('overview');
                  setResults([]);
                  fetchLowConfidenceEmails();
                }}
                className="flex-1"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Run Again
              </Button>
              <Button onClick={() => navigate('/inbox')} className="flex-1">
                <Eye className="h-4 w-4 mr-2" />
                View Inbox
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
