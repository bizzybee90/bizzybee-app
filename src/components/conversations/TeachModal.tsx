import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Bot, Mail, AlertTriangle, Check, Loader2, Sparkles } from 'lucide-react';
import { Conversation } from '@/lib/types';

interface TeachModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: Conversation;
  onSuccess?: () => void;
}

type BucketChoice = 'auto_handled' | 'quick_win' | 'act_now' | 'wait';

const bucketOptions: {
  value: BucketChoice;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    value: 'auto_handled',
    label: 'Auto-handle',
    description: "Don't show me these",
    icon: <Check className="h-4 w-4 text-green-500" />,
  },
  {
    value: 'wait',
    label: 'FYI only',
    description: 'Show but no reply needed',
    icon: <Mail className="h-4 w-4 text-blue-500" />,
  },
  {
    value: 'quick_win',
    label: 'Show me',
    description: 'Might need a reply',
    icon: <Bot className="h-4 w-4 text-amber-500" />,
  },
  {
    value: 'act_now',
    label: 'Important',
    description: 'Always show immediately',
    icon: <AlertTriangle className="h-4 w-4 text-red-500" />,
  },
];

export function TeachModal({ open, onOpenChange, conversation, onSuccess }: TeachModalProps) {
  const [selectedBucket, setSelectedBucket] = useState<BucketChoice>(
    conversation.decision_bucket || 'quick_win',
  );
  const [createRule, setCreateRule] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const senderEmail = conversation.customer?.email;
  const senderDomain = senderEmail?.split('@')[1];

  const handleSubmit = async () => {
    setIsSubmitting(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user.id)
        .single();

      const workspaceId = userData?.workspace_id;

      // Update the conversation
      const updates: Record<string, any> = {
        decision_bucket: selectedBucket,
        requires_reply: selectedBucket !== 'auto_handled' && selectedBucket !== 'wait',
        updated_at: new Date().toISOString(),
      };

      await supabase.from('conversations').update(updates).eq('id', conversation.id);

      // Log the correction
      await supabase.from('triage_corrections').insert({
        conversation_id: conversation.id,
        original_classification: conversation.decision_bucket,
        new_classification: selectedBucket,
        corrected_by: user.id,
        sender_email: senderEmail,
        sender_domain: senderDomain,
        workspace_id: workspaceId,
      });

      // Create sender rule if requested
      if (createRule && senderDomain && workspaceId) {
        // Check if rule already exists
        const { data: existingRule } = await supabase
          .from('sender_rules')
          .select('id')
          .eq('sender_pattern', `@${senderDomain}`)
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        if (!existingRule) {
          await supabase.from('sender_rules').insert({
            workspace_id: workspaceId,
            sender_pattern: `@${senderDomain}`,
            default_classification:
              selectedBucket === 'auto_handled' ? 'automated_notification' : 'customer_inquiry',
            default_requires_reply: selectedBucket !== 'auto_handled' && selectedBucket !== 'wait',
            is_active: true,
          });

          toast.success(`Rule created for @${senderDomain}`);
        } else {
          // Update existing rule
          await supabase
            .from('sender_rules')
            .update({
              default_classification:
                selectedBucket === 'auto_handled' ? 'automated_notification' : 'customer_inquiry',
              default_requires_reply:
                selectedBucket !== 'auto_handled' && selectedBucket !== 'wait',
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingRule.id);

          toast.success(`Rule updated for @${senderDomain}`);
        }
      } else {
        toast.success('Classification updated');
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Error teaching BizzyBee:', error);
      toast.error('Failed to save. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Teach BizzyBee
          </DialogTitle>
          <DialogDescription>What should happen with emails like this?</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <RadioGroup
            value={selectedBucket}
            onValueChange={(v) => setSelectedBucket(v as BucketChoice)}
            className="space-y-3"
          >
            {bucketOptions.map((option) => (
              <div
                key={option.value}
                className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors cursor-pointer hover:bg-muted/50 ${
                  selectedBucket === option.value ? 'border-primary bg-primary/5' : 'border-border'
                }`}
                onClick={() => setSelectedBucket(option.value)}
              >
                <RadioGroupItem value={option.value} id={option.value} />
                <Label htmlFor={option.value} className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2">
                    {option.icon}
                    <span className="font-medium">{option.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{option.description}</p>
                </Label>
              </div>
            ))}
          </RadioGroup>

          {senderDomain && (
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div className="space-y-0.5">
                <Label htmlFor="create-rule" className="text-sm font-medium">
                  Apply to all from @{senderDomain}
                </Label>
                <p className="text-xs text-muted-foreground">Creates a rule for future emails</p>
              </div>
              <Switch id="create-rule" checked={createRule} onCheckedChange={setCreateRule} />
            </div>
          )}

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} className="flex-1" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
