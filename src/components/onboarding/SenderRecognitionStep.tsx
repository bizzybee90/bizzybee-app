import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Check,
  Eye,
  AlertTriangle,
  SkipForward,
} from 'lucide-react';
import { toast } from 'sonner';
import { ChannelIcon } from '@/components/shared/ChannelIcon';

interface SenderRecognitionStepProps {
  workspaceId: string;
  onRulesCreated: (count: number) => void;
  onNext: () => void;
  onBack: () => void;
}

interface SampleEmail {
  id: string;
  senderEmail: string;
  senderDomain: string;
  senderName: string;
  subject: string;
  channel: string;
}

type Decision = 'auto_handled' | 'quick_win' | 'act_now';

export function SenderRecognitionStep({
  workspaceId,
  onRulesCreated,
  onNext,
  onBack,
}: SenderRecognitionStepProps) {
  const [samples, setSamples] = useState<SampleEmail[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchSamples = useCallback(async () => {
    try {
      // Get distinct sender domains with sample emails
      const { data } = await supabase
        .from('conversations')
        .select(
          `
          id,
          title,
          channel,
          customer:customers(email, name)
        `,
        )
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(100);

      // Group by domain and take one sample per domain
      const domainSamples: Record<string, SampleEmail> = {};
      (data || []).forEach((conv) => {
        const email = conv.customer?.[0]?.email;
        const domain = email?.split('@')[1];
        if (domain && !domainSamples[domain]) {
          domainSamples[domain] = {
            id: conv.id,
            senderEmail: email || '',
            senderDomain: domain,
            senderName: conv.customer?.[0]?.name || email?.split('@')[0] || 'Unknown',
            subject: conv.title || 'No subject',
            channel: conv.channel || 'email',
          };
        }
      });

      // Take up to 10 samples
      const sampleList = Object.values(domainSamples).slice(0, 10);
      setSamples(sampleList);
    } catch (error) {
      console.error('Error fetching samples:', error);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchSamples();
  }, [fetchSamples]);

  const handleDecision = (decision: Decision) => {
    const sample = samples[currentIndex];
    if (!sample) return;

    setDecisions((prev) => ({
      ...prev,
      [sample.senderDomain]: decision,
    }));

    // Move to next
    if (currentIndex < samples.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleSkip = () => {
    if (currentIndex < samples.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleFinish = async () => {
    setIsSaving(true);
    try {
      let rulesCreated = 0;

      for (const [domain, decision] of Object.entries(decisions)) {
        // Check if rule exists
        const { data: existing } = await supabase
          .from('sender_rules')
          .select('id')
          .eq('sender_pattern', `@${domain}`)
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        if (!existing) {
          await supabase.from('sender_rules').insert({
            workspace_id: workspaceId,
            sender_pattern: `@${domain}`,
            default_classification:
              decision === 'auto_handled' ? 'automated_notification' : 'customer_inquiry',
            default_requires_reply: decision !== 'auto_handled',
            is_active: true,
          });
          rulesCreated++;
        }
      }

      onRulesCreated(rulesCreated);
      toast.success(`Created ${rulesCreated} sender rules`);
      onNext();
    } catch (error) {
      console.error('Error saving rules:', error);
      toast.error('Failed to save rules');
    } finally {
      setIsSaving(false);
    }
  };

  const currentSample = samples[currentIndex];
  const isComplete = currentIndex >= samples.length - 1 && Object.keys(decisions).length > 0;
  const progress = samples.length > 0 ? ((currentIndex + 1) / samples.length) * 100 : 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (samples.length === 0) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">No emails to review</h2>
          <p className="text-sm text-muted-foreground">We'll learn as emails come in</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button onClick={onNext} className="flex-1">
            Continue
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">Teach BizzyBee about your senders</h2>
        <p className="text-sm text-muted-foreground">
          Quick-swipe through sample emails. {currentIndex + 1} of {samples.length}
        </p>
        <div className="w-full bg-muted rounded-full h-2">
          <div
            className="bg-primary h-2 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {currentSample && !isComplete && (
        <Card className="p-6">
          <div className="flex items-start gap-3 mb-4">
            <ChannelIcon channel={currentSample.channel} className="h-5 w-5 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium truncate">{currentSample.senderName}</p>
                <Badge variant="outline" className="text-xs font-mono">
                  @{currentSample.senderDomain}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground truncate">{currentSample.senderEmail}</p>
            </div>
          </div>
          <p className="text-sm bg-muted/50 rounded-lg p-3 line-clamp-2">{currentSample.subject}</p>

          <div className="grid grid-cols-3 gap-3 mt-6">
            <Button
              variant="outline"
              onClick={() => handleDecision('auto_handled')}
              className="flex-col h-auto py-4 hover:bg-green-500/10 hover:border-green-500"
            >
              <Check className="h-5 w-5 mb-1 text-green-500" />
              <span className="text-xs font-medium">Auto-handle</span>
              <span className="text-[10px] text-muted-foreground">Don't bother me</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => handleDecision('quick_win')}
              className="flex-col h-auto py-4 hover:bg-amber-500/10 hover:border-amber-500"
            >
              <Eye className="h-5 w-5 mb-1 text-amber-500" />
              <span className="text-xs font-medium">Show me</span>
              <span className="text-[10px] text-muted-foreground">Might need reply</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => handleDecision('act_now')}
              className="flex-col h-auto py-4 hover:bg-red-500/10 hover:border-red-500"
            >
              <AlertTriangle className="h-5 w-5 mb-1 text-red-500" />
              <span className="text-xs font-medium">Important</span>
              <span className="text-[10px] text-muted-foreground">Always show</span>
            </Button>
          </div>

          <Button
            variant="ghost"
            onClick={handleSkip}
            className="w-full mt-3 text-muted-foreground"
          >
            <SkipForward className="h-4 w-4 mr-2" />
            Skip this sender
          </Button>
        </Card>
      )}

      {isComplete && (
        <Card className="p-6 text-center">
          <Check className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h3 className="font-semibold mb-2">Great job!</h3>
          <p className="text-sm text-muted-foreground mb-4">
            You've taught BizzyBee about {Object.keys(decisions).length} sender types
          </p>
          <Button onClick={handleFinish} disabled={isSaving} className="w-full">
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <ChevronRight className="h-4 w-4 mr-2" />
            )}
            Save & Continue
          </Button>
        </Card>
      )}

      {!isComplete && (
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button variant="ghost" onClick={handleFinish} disabled={isSaving} className="ml-auto">
            {Object.keys(decisions).length > 0
              ? `Finish with ${Object.keys(decisions).length} rules`
              : 'Skip this step'}
          </Button>
        </div>
      )}
    </div>
  );
}
