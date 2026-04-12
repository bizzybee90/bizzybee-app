import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { useToast } from '@/hooks/use-toast';
import { ArrowUp, Tag, RefreshCw, Loader2 } from 'lucide-react';
import { Conversation } from '@/lib/types';
import { TriageCorrectionFlow } from './TriageCorrectionFlow';
import { Badge } from '@/components/ui/badge';

interface TriageQuickActionsProps {
  conversation: Conversation;
  onUpdate?: () => void;
}

interface RetriageResult {
  success: boolean;
  changed: boolean;
  original: {
    classification: string;
    bucket: string;
  };
  updated: {
    classification: string;
    bucket: string;
    confidence: number;
    why_this_needs_you: string;
  };
}

export function TriageQuickActions({ conversation, onUpdate }: TriageQuickActionsProps) {
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRetriaging, setIsRetriaging] = useState(false);
  const [retriageResult, setRetriageResult] = useState<RetriageResult | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const currentClassification = conversation.email_classification || '';

  const handleRetriage = async () => {
    setIsRetriaging(true);
    setRetriageResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('classify-conversation', {
        body: { conversation_id: conversation.id, workspace_id: conversation.workspace_id },
      });

      if (error) throw error;

      setRetriageResult(data);

      if (data.changed) {
        toast({
          title: 'Re-triage complete',
          description: `Changed from ${data.original.classification?.replace(/_/g, ' ')} → ${data.updated.classification?.replace(/_/g, ' ')}`,
        });
        onUpdate?.();
      } else {
        toast({
          title: 'No change needed',
          description: 'Classification remains the same after re-triage',
        });
      }
    } catch (error) {
      logger.error('Error retriaging conversation', error);
      toast({
        title: 'Re-triage failed',
        description: 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setIsRetriaging(false);
    }
  };

  const handleMoveToActionRequired = async () => {
    setIsUpdating(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user?.id)
        .single();

      // Log the correction for learning
      const { error: correctionError } = await supabase.from('triage_corrections').insert({
        workspace_id: userData?.workspace_id,
        conversation_id: conversation.id,
        original_classification: currentClassification,
        new_classification: 'customer_inquiry',
        original_requires_reply: false,
        new_requires_reply: true,
        sender_email: conversation.customer?.email || null,
        sender_domain: conversation.customer?.email?.split('@')[1] || null,
        corrected_by: user?.id,
      });

      if (correctionError) {
        logger.error('Failed to log correction', correctionError);
      }

      // Update the conversation
      const { error } = await supabase
        .from('conversations')
        .update({
          requires_reply: true,
          email_classification: 'customer_inquiry',
          status: 'open',
          resolved_at: null,
          decision_bucket: 'quick_win',
        })
        .eq('id', conversation.id);

      if (error) throw error;

      toast({ title: 'Moved to Action Required' });
      onUpdate?.();
    } catch (error) {
      logger.error('Error moving conversation', error);
      toast({
        title: 'Failed to move',
        description: 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const getBucketColor = (bucket: string) => {
    switch (bucket) {
      case 'act_now':
        return 'bg-red-500/10 text-red-600 border-red-200';
      case 'quick_win':
        return 'bg-yellow-500/10 text-yellow-600 border-yellow-200';
      case 'auto_handled':
        return 'bg-green-500/10 text-green-600 border-green-200';
      case 'wait':
        return 'bg-blue-500/10 text-blue-600 border-blue-200';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3 mt-3 pt-3 border-t border-border/30">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetriage}
            disabled={isRetriaging}
            className="flex items-center gap-1.5 text-xs"
          >
            {isRetriaging ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Re-triage
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleMoveToActionRequired}
            disabled={isUpdating}
            className="flex items-center gap-1.5 text-xs"
          >
            <ArrowUp className="h-3 w-3" />
            Action Required
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setCorrectionOpen(true)}
            className="flex items-center gap-1.5 text-xs"
          >
            <Tag className="h-3 w-3" />
            Correct
          </Button>
        </div>

        {retriageResult && (
          <div className="bg-muted/30 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">
                {retriageResult.changed ? 'Classification Updated' : 'No Change'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-xs"
                onClick={() => setRetriageResult(null)}
              >
                Dismiss
              </Button>
            </div>
            {retriageResult.changed && (
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className={getBucketColor(retriageResult.original.bucket)}>
                  {retriageResult.original.classification?.replace(/_/g, ' ')}
                </Badge>
                <span className="text-muted-foreground">→</span>
                <Badge variant="outline" className={getBucketColor(retriageResult.updated.bucket)}>
                  {retriageResult.updated.classification?.replace(/_/g, ' ')}
                </Badge>
                <span className="text-muted-foreground ml-1">
                  ({Math.round(retriageResult.updated.confidence * 100)}% confidence)
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <TriageCorrectionFlow
        conversation={conversation}
        open={correctionOpen}
        onOpenChange={setCorrectionOpen}
        onUpdate={onUpdate}
      />
    </>
  );
}
