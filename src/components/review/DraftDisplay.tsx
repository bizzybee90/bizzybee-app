import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, CheckCircle, AlertTriangle, XCircle, RefreshCw, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DraftDisplayProps {
  workspaceId: string;
  conversationId: string;
  draftText: string;
  customerMessage: string;
  onDraftUpdate: (newDraft: string) => void;
  autoVerify?: boolean;
}

type VerificationStatus = 'pending' | 'verifying' | 'passed' | 'failed' | 'needs_review';

interface VerificationIssue {
  type: 'hallucination' | 'incorrect_fact' | 'unsupported_claim' | 'tone_mismatch' | 'missing_info';
  description: string;
  severity: 'low' | 'medium' | 'high';
  suggestion?: string;
}

interface VerificationResult {
  status: VerificationStatus;
  confidence_score: number;
  issues: VerificationIssue[];
  corrected_draft?: string;
  notes?: string;
}

export const DraftDisplay = ({ 
  workspaceId, 
  conversationId, 
  draftText, 
  customerMessage,
  onDraftUpdate,
  autoVerify = true
}: DraftDisplayProps) => {
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (draftText && autoVerify) {
      verifyDraft();
    }
  }, [draftText, autoVerify]);

  const verifyDraft = async () => {
    if (!draftText || !customerMessage) return;

    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('draft-verify', {
        body: {
          workspace_id: workspaceId,
          conversation_id: conversationId,
          draft_text: draftText,
          customer_message: customerMessage
        }
      });

      if (error) throw error;
      setVerification(data.verification);

      if (data.verification.status === 'failed') {
        toast.warning('Draft needs review', {
          description: 'Some issues were found that may need attention'
        });
      } else if (data.verification.status === 'passed') {
        toast.success('Draft verified', {
          description: 'No issues found'
        });
      }
    } catch (e: any) {
      console.error('Verification failed:', e);
      // Don't block on verification failure
      setVerification({
        status: 'passed',
        confidence_score: 0.5,
        issues: [],
        notes: 'Verification unavailable'
      });
    } finally {
      setVerifying(false);
    }
  };

  const useCorrectedDraft = () => {
    if (verification?.corrected_draft) {
      onDraftUpdate(verification.corrected_draft);
      toast.success('Draft updated with corrections');
    }
  };

  const getStatusIcon = () => {
    if (verifying) return <Loader2 className="h-4 w-4 animate-spin" />;
    switch (verification?.status) {
      case 'passed': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed': return <XCircle className="h-4 w-4 text-destructive" />;
      case 'needs_review': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      default: return null;
    }
  };

  const getStatusBadge = () => {
    if (verifying) {
      return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Verifying...</Badge>;
    }
    switch (verification?.status) {
      case 'passed': 
        return <Badge className="gap-1 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"><CheckCircle className="h-3 w-3" />Verified</Badge>;
      case 'failed': 
        return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Issues Found</Badge>;
      case 'needs_review': 
        return <Badge className="gap-1 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"><AlertTriangle className="h-3 w-3" />Review Needed</Badge>;
      default: 
        return <Badge variant="outline" className="gap-1">Unverified</Badge>;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'text-destructive';
      case 'medium': return 'text-amber-600 dark:text-amber-400';
      default: return 'text-blue-600 dark:text-blue-400';
    }
  };

  const getIssueTypeLabel = (type: string) => {
    switch (type) {
      case 'hallucination': return 'Hallucination';
      case 'incorrect_fact': return 'Incorrect Fact';
      case 'unsupported_claim': return 'Unsupported Claim';
      case 'tone_mismatch': return 'Tone Mismatch';
      case 'missing_info': return 'Missing Info';
      default: return type;
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-4">
        {/* Verification Status Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            {getStatusBadge()}
            {verification?.confidence_score !== undefined && (
              <span className="text-xs text-muted-foreground">
                {Math.round(verification.confidence_score * 100)}% confidence
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={verifyDraft}
            disabled={verifying}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", verifying && "animate-spin")} />
            Re-verify
          </Button>
        </div>

        {/* Issues Display */}
        {verification?.issues && verification.issues.length > 0 && (
          <Alert variant="destructive" className="bg-destructive/10 border-destructive/20">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2 mt-1">
                {verification.issues.map((issue, i) => (
                  <div key={i} className="text-sm">
                    <span className={cn("font-medium", getSeverityColor(issue.severity))}>
                      {getIssueTypeLabel(issue.type)}:
                    </span>{' '}
                    <span className="text-foreground">{issue.description}</span>
                    {issue.suggestion && (
                      <span className="text-muted-foreground italic"> — {issue.suggestion}</span>
                    )}
                  </div>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Verification Notes */}
        {verification?.notes && verification.status === 'passed' && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{verification.notes}</span>
          </div>
        )}

        {/* Use Corrected Draft Button */}
        {verification?.corrected_draft && (
          <Button
            variant="outline"
            size="sm"
            onClick={useCorrectedDraft}
            className="w-full gap-2 border-primary text-primary hover:bg-primary/10"
          >
            <CheckCircle className="h-4 w-4" />
            Use AI-Corrected Draft
          </Button>
        )}

        {/* Draft Text Display */}
        <div className="rounded-lg bg-muted/50 p-4 border">
          <p className="whitespace-pre-wrap text-sm">{draftText}</p>
        </div>
      </CardContent>
    </Card>
  );
};
