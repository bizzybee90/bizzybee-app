import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import {
  ArrowRight,
  BookmarkPlus,
  Loader2,
  Tag,
  Mail,
  Building2,
  CheckCircle2,
  Plus,
} from 'lucide-react';
import { Conversation } from '@/lib/types';

// Extended classifications matching all email types
const CLASSIFICATIONS = [
  // Customer inquiries - require reply
  {
    value: 'customer_inquiry',
    label: 'Customer Inquiry',
    requiresReply: true,
    category: 'inquiry',
  },
  { value: 'booking_request', label: 'Booking Request', requiresReply: true, category: 'inquiry' },
  { value: 'quote_request', label: 'Quote Request', requiresReply: true, category: 'inquiry' },
  {
    value: 'reschedule_request',
    label: 'Reschedule Request',
    requiresReply: true,
    category: 'inquiry',
  },
  {
    value: 'cancellation_request',
    label: 'Cancellation Request',
    requiresReply: true,
    category: 'inquiry',
  },
  {
    value: 'complaint_dispute',
    label: 'Complaint/Dispute',
    requiresReply: true,
    category: 'complaint',
  },
  {
    value: 'customer_complaint',
    label: 'Customer Complaint',
    requiresReply: true,
    category: 'complaint',
  },
  {
    value: 'customer_feedback',
    label: 'Customer Feedback',
    requiresReply: false,
    category: 'feedback',
  },

  // Leads & follow-ups
  { value: 'lead_new', label: 'New Lead', requiresReply: true, category: 'lead' },
  { value: 'lead_followup', label: 'Lead Follow-up', requiresReply: true, category: 'lead' },

  // Misdirected - wrong recipient
  {
    value: 'misdirected',
    label: 'Misdirected Email',
    requiresReply: false,
    category: 'misdirected',
  },

  // Financial - typically no reply
  {
    value: 'supplier_invoice',
    label: 'Supplier Invoice',
    requiresReply: false,
    category: 'financial',
  },
  {
    value: 'supplier_urgent',
    label: 'Supplier Urgent',
    requiresReply: true,
    category: 'financial',
  },
  {
    value: 'payment_confirmation',
    label: 'Payment Confirmation',
    requiresReply: false,
    category: 'financial',
  },
  {
    value: 'receipt_confirmation',
    label: 'Receipt/Confirmation',
    requiresReply: false,
    category: 'financial',
  },

  // Partner & Business
  { value: 'partner_request', label: 'Partner Request', requiresReply: true, category: 'partner' },

  // Automated/System
  {
    value: 'automated_notification',
    label: 'Auto Notification',
    requiresReply: false,
    category: 'system',
  },
  { value: 'internal_system', label: 'Internal System', requiresReply: false, category: 'system' },
  {
    value: 'informational_only',
    label: 'Info Only (FYI)',
    requiresReply: false,
    category: 'system',
  },

  // Marketing/Spam
  {
    value: 'marketing_newsletter',
    label: 'Marketing/Newsletter',
    requiresReply: false,
    category: 'marketing',
  },
  { value: 'spam_phishing', label: 'Spam/Phishing', requiresReply: false, category: 'spam' },

  // HR/Recruitment
  {
    value: 'recruitment_hr',
    label: 'Recruitment/HR',
    requiresReply: false,
    category: 'recruitment',
  },

  // Custom - user-defined
  { value: '__custom__', label: 'Custom...', requiresReply: false, category: 'custom' },
];

const CATEGORY_COLORS: Record<string, string> = {
  inquiry: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  complaint: 'bg-red-500/10 text-red-600 border-red-500/20',
  feedback: 'bg-green-500/10 text-green-600 border-green-500/20',
  lead: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  misdirected: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  financial: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  partner: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
  system: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
  marketing: 'bg-pink-500/10 text-pink-600 border-pink-500/20',
  spam: 'bg-red-500/10 text-red-600 border-red-500/20',
  recruitment: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  custom: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
};

interface TriageCorrectionFlowProps {
  conversation: Conversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate?: () => void;
}

export function TriageCorrectionFlow({
  conversation,
  open,
  onOpenChange,
  onUpdate,
}: TriageCorrectionFlowProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newClassification, setNewClassification] = useState(
    conversation.email_classification || '',
  );
  const [customClassification, setCustomClassification] = useState('');
  const [customRequiresReply, setCustomRequiresReply] = useState(false);
  const [createSenderRule, setCreateSenderRule] = useState(true);
  const [senderRuleScope, setSenderRuleScope] = useState<'email' | 'domain'>('domain');

  const currentClassification = conversation.email_classification || 'unknown';
  const senderEmail = conversation.customer?.email || null;
  const senderDomain = senderEmail?.split('@')[1] || null;

  const isCustomMode = newClassification === '__custom__';
  const effectiveClassification = isCustomMode
    ? customClassification
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
    : newClassification;

  const selectedConfig = CLASSIFICATIONS.find((c) => c.value === newClassification);
  const currentConfig = CLASSIFICATIONS.find((c) => c.value === currentClassification);

  const effectiveRequiresReply = isCustomMode
    ? customRequiresReply
    : (selectedConfig?.requiresReply ?? false);

  const handleClassificationChange = (value: string) => {
    setNewClassification(value);
    if (value !== '__custom__') {
      setCustomClassification('');
    }
  };

  const handleSubmit = async () => {
    const finalClassification = effectiveClassification;

    if (!finalClassification || finalClassification === currentClassification) {
      toast({ title: 'Please select or enter a different classification' });
      return;
    }

    if (isCustomMode && !customClassification.trim()) {
      toast({ title: 'Please enter a custom classification name' });
      return;
    }

    setIsSubmitting(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user?.id)
        .single();

      if (!userData?.workspace_id) throw new Error('No workspace found');

      const newRequiresReply = effectiveRequiresReply;

      // 1. Log the correction
      const { error: correctionError, data: correctionData } = await supabase
        .from('triage_corrections')
        .insert({
          workspace_id: userData.workspace_id,
          conversation_id: conversation.id,
          original_classification: currentClassification,
          new_classification: finalClassification,
          original_requires_reply: conversation.requires_reply ?? false,
          new_requires_reply: newRequiresReply,
          sender_email: senderEmail,
          sender_domain: senderDomain,
          corrected_by: user?.id,
        })
        .select()
        .single();

      if (correctionError) {
        logger.error('Failed to log correction', correctionError);
      }

      // 2. Create sender rule if enabled
      if (createSenderRule && (senderEmail || senderDomain)) {
        const senderPattern = senderRuleScope === 'email' ? senderEmail : `*@${senderDomain}`;

        // Check if rule already exists
        const { data: existingRule } = await supabase
          .from('sender_rules')
          .select('id')
          .eq('workspace_id', userData.workspace_id)
          .eq('sender_pattern', senderPattern)
          .maybeSingle();

        if (existingRule) {
          // Update existing rule
          await supabase
            .from('sender_rules')
            .update({
              default_classification: finalClassification,
              default_requires_reply: newRequiresReply,
              hit_count: 0, // Reset hit count for updated rules
              created_from_correction: correctionData?.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingRule.id);
        } else {
          // Create new rule
          const { error: ruleError } = await supabase.from('sender_rules').insert({
            workspace_id: userData.workspace_id,
            sender_pattern: senderPattern,
            default_classification: finalClassification,
            default_requires_reply: newRequiresReply,
            is_active: true,
            created_from_correction: correctionData?.id,
          });

          if (ruleError) {
            logger.error('Failed to create sender rule', ruleError);
          }
        }
      }

      // 3. Update the conversation
      const updateData: Record<string, unknown> = {
        email_classification: finalClassification,
        requires_reply: newRequiresReply,
      };

      if (newRequiresReply) {
        updateData.status = 'open';
        updateData.resolved_at = null;
        updateData.decision_bucket = 'quick_win';
      } else {
        updateData.status = 'resolved';
        updateData.resolved_at = new Date().toISOString();
        updateData.decision_bucket = 'auto_handled';
      }

      const { error } = await supabase
        .from('conversations')
        .update(updateData)
        .eq('id', conversation.id);

      if (error) throw error;

      toast({
        title: 'Classification corrected',
        description: createSenderRule
          ? `Sender rule created for ${senderRuleScope === 'email' ? senderEmail : senderDomain}`
          : undefined,
      });

      onOpenChange(false);
      onUpdate?.();
    } catch (error) {
      logger.error('Error correcting classification', error);
      toast({
        title: 'Failed to correct classification',
        description: 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Correct Classification
          </DialogTitle>
          <DialogDescription>
            Correct the AI's classification. Optionally create a sender rule to automatically
            classify future emails.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Current classification */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Current Classification
            </Label>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={currentConfig ? CATEGORY_COLORS[currentConfig.category] : 'bg-muted'}
              >
                {currentConfig?.label || currentClassification}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {conversation.requires_reply ? 'Needs reply' : 'No reply needed'}
              </span>
            </div>
          </div>

          {/* New classification selector */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Correct Classification
            </Label>
            <Select value={newClassification} onValueChange={handleClassificationChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select classification..." />
              </SelectTrigger>
              <SelectContent>
                {CLASSIFICATIONS.map((classification) => (
                  <SelectItem
                    key={classification.value}
                    value={classification.value}
                    disabled={classification.value === currentClassification}
                  >
                    <div className="flex items-center gap-2">
                      {classification.value === '__custom__' ? (
                        <>
                          <Plus className="h-3 w-3" />
                          <span className="font-medium">{classification.label}</span>
                        </>
                      ) : (
                        <>
                          <Badge
                            variant="outline"
                            className={`${CATEGORY_COLORS[classification.category]} text-xs px-1.5 py-0`}
                          >
                            {classification.category}
                          </Badge>
                          <span>{classification.label}</span>
                          {classification.requiresReply && (
                            <span className="text-xs text-muted-foreground">(needs reply)</span>
                          )}
                        </>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Custom classification input */}
          {isCustomMode && (
            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              <div className="space-y-2">
                <Label
                  htmlFor="custom-classification"
                  className="text-xs text-muted-foreground uppercase tracking-wide"
                >
                  Custom Classification Name
                </Label>
                <Input
                  id="custom-classification"
                  placeholder="e.g., Warranty Claim, VIP Request..."
                  value={customClassification}
                  onChange={(e) => setCustomClassification(e.target.value)}
                  maxLength={50}
                />
                <p className="text-xs text-muted-foreground">
                  Will be saved as:{' '}
                  <code className="bg-muted px-1 rounded">{effectiveClassification || '...'}</code>
                </p>
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="custom-requires-reply" className="text-sm">
                    Requires Reply
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Does this type need a human response?
                  </p>
                </div>
                <Switch
                  id="custom-requires-reply"
                  checked={customRequiresReply}
                  onCheckedChange={setCustomRequiresReply}
                />
              </div>
            </div>
          )}

          {/* Change preview */}
          {effectiveClassification && effectiveClassification !== currentClassification && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Change Preview
              </Label>
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <Badge variant="outline" className="bg-muted">
                  {currentConfig?.label || currentClassification}
                </Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <Badge
                  variant="outline"
                  className={
                    isCustomMode
                      ? CATEGORY_COLORS.custom
                      : selectedConfig
                        ? CATEGORY_COLORS[selectedConfig.category]
                        : ''
                  }
                >
                  {isCustomMode ? customClassification || 'Custom' : selectedConfig?.label}
                </Badge>
              </div>
              {effectiveRequiresReply !== (conversation.requires_reply ?? false) && (
                <p className="text-xs text-muted-foreground">
                  {effectiveRequiresReply
                    ? '→ Will be moved to Action Required'
                    : '→ Will be marked as resolved'}
                </p>
              )}
            </div>
          )}

          {/* Sender rule creation */}
          {(senderEmail || senderDomain) && (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="create-rule" className="flex items-center gap-2">
                    <BookmarkPlus className="h-4 w-4" />
                    Create Sender Rule
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically classify future emails from this sender
                  </p>
                </div>
                <Switch
                  id="create-rule"
                  checked={createSenderRule}
                  onCheckedChange={setCreateSenderRule}
                />
              </div>

              {createSenderRule && (
                <div className="space-y-3 pt-2 border-t">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                    Apply rule to
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={senderRuleScope === 'domain' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSenderRuleScope('domain')}
                      className="justify-start"
                      disabled={!senderDomain}
                    >
                      <Building2 className="h-4 w-4 mr-2" />
                      <span className="truncate">@{senderDomain}</span>
                    </Button>
                    <Button
                      type="button"
                      variant={senderRuleScope === 'email' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSenderRuleScope('email')}
                      className="justify-start"
                      disabled={!senderEmail}
                    >
                      <Mail className="h-4 w-4 mr-2" />
                      <span className="truncate">{senderEmail}</span>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {senderRuleScope === 'domain'
                      ? `All emails from @${senderDomain} will be classified as ${isCustomMode ? customClassification : selectedConfig?.label || newClassification}`
                      : `Emails from ${senderEmail} will be classified as ${isCustomMode ? customClassification : selectedConfig?.label || newClassification}`}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isSubmitting ||
              !effectiveClassification ||
              effectiveClassification === currentClassification ||
              (isCustomMode && !customClassification.trim())
            }
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Apply Correction
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
