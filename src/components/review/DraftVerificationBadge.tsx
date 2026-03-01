import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  AlertTriangle,
  AlertCircle,
  Info,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface VerificationIssue {
  type: 'hallucination' | 'factual_error' | 'policy_violation' | 'tone_mismatch' | 'missing_info';
  severity: 'critical' | 'warning' | 'info';
  description: string;
  suggestion?: string;
}

interface DraftVerificationBadgeProps {
  conversationId: string;
  workspaceId: string;
  draft: string;
  verificationStatus?: 'pending' | 'passed' | 'failed' | 'needs_review' | null;
  issues?: VerificationIssue[];
  correctedDraft?: string | null;
  confidenceScore?: number | null;
  onUseCorrectedDraft?: (draft: string) => void;
  onVerificationComplete?: (result: {
    status: string;
    issues: VerificationIssue[];
    correctedDraft?: string;
  }) => void;
}

export function DraftVerificationBadge({
  conversationId,
  workspaceId,
  draft,
  verificationStatus,
  issues = [],
  correctedDraft,
  confidenceScore,
  onUseCorrectedDraft,
  onVerificationComplete,
}: DraftVerificationBadgeProps) {
  const [isVerifying, setIsVerifying] = useState(false);
  const [localStatus, setLocalStatus] = useState(verificationStatus);
  const [localIssues, setLocalIssues] = useState<VerificationIssue[]>(issues);
  const [localCorrectedDraft, setLocalCorrectedDraft] = useState(correctedDraft);
  const [localConfidence, setLocalConfidence] = useState(confidenceScore);
  const { toast } = useToast();

  const runVerification = async () => {
    setIsVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('draft-verify', {
        body: {
          conversation_id: conversationId,
          workspace_id: workspaceId,
          draft_text: draft,
          customer_message: 'Customer inquiry', // Will be fetched from context
        },
      });

      if (error) throw error;

      setLocalStatus(data.status);
      setLocalIssues(data.issues || []);
      setLocalCorrectedDraft(data.corrected_draft);
      setLocalConfidence(data.confidence_score);

      onVerificationComplete?.({
        status: data.status,
        issues: data.issues || [],
        correctedDraft: data.corrected_draft,
      });

      toast({
        title: data.status === 'passed' ? 'Verification Passed' : 'Verification Complete',
        description: data.notes || `Found ${data.issues?.length || 0} issues`,
        variant: data.status === 'failed' ? 'destructive' : 'default',
      });
    } catch (err: any) {
      console.error('Verification failed:', err);
      toast({
        title: 'Verification Failed',
        description: err.message || 'Could not verify draft',
        variant: 'destructive',
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const getStatusIcon = () => {
    if (isVerifying) return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    switch (localStatus) {
      case 'passed':
        return <ShieldCheck className="h-3.5 w-3.5" />;
      case 'failed':
        return <ShieldAlert className="h-3.5 w-3.5" />;
      case 'needs_review':
        return <ShieldQuestion className="h-3.5 w-3.5" />;
      default:
        return <ShieldQuestion className="h-3.5 w-3.5" />;
    }
  };

  const getStatusColor = () => {
    switch (localStatus) {
      case 'passed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'failed':
        return 'bg-destructive/10 text-destructive';
      case 'needs_review':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusLabel = () => {
    if (isVerifying) return 'Verifying...';
    switch (localStatus) {
      case 'passed':
        return 'Verified';
      case 'failed':
        return 'Issues Found';
      case 'needs_review':
        return 'Needs Review';
      default:
        return 'Unverified';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      default:
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const getIssueTypeLabel = (type: string) => {
    switch (type) {
      case 'hallucination':
        return 'Hallucination';
      case 'factual_error':
        return 'Factual Error';
      case 'policy_violation':
        return 'Policy Violation';
      case 'tone_mismatch':
        return 'Tone Mismatch';
      case 'missing_info':
        return 'Missing Info';
      default:
        return type;
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            'cursor-pointer gap-1.5 transition-colors hover:opacity-80',
            getStatusColor()
          )}
        >
          {getStatusIcon()}
          {getStatusLabel()}
          {localConfidence !== null && localConfidence !== undefined && (
            <span className="ml-1 text-xs opacity-70">
              {Math.round(localConfidence * 100)}%
            </span>
          )}
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">Draft Verification</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={runVerification}
              disabled={isVerifying}
              className="h-7 gap-1.5"
            >
              {isVerifying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {localStatus ? 'Re-verify' : 'Verify'}
            </Button>
          </div>

          {localIssues.length > 0 ? (
            <ScrollArea className="max-h-48">
              <div className="space-y-2">
                {localIssues.map((issue, idx) => (
                  <div
                    key={idx}
                    className="rounded-md border p-2 text-sm"
                  >
                    <div className="flex items-start gap-2">
                      {getSeverityIcon(issue.severity)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {getIssueTypeLabel(issue.type)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {issue.description}
                        </p>
                        {issue.suggestion && (
                          <p className="mt-1 text-xs text-primary">
                            {issue.suggestion}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : localStatus === 'passed' ? (
            <p className="text-sm text-muted-foreground">
              No issues found. Draft is ready to send.
            </p>
          ) : !localStatus ? (
            <p className="text-sm text-muted-foreground">
              Click "Verify" to check this draft against your knowledge base.
            </p>
          ) : null}

          {localCorrectedDraft && onUseCorrectedDraft && (
            <div className="pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => onUseCorrectedDraft(localCorrectedDraft)}
              >
                <ShieldCheck className="h-4 w-4" />
                Use Corrected Draft
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
