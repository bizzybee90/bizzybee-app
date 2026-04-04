import { useState, useEffect } from 'react';
import { logger } from '@/lib/logger';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Filter, Plus, Trash2, Loader2, Zap, Pencil, Check, X } from 'lucide-react';

interface SenderRule {
  id: string;
  sender_pattern: string;
  default_classification: string;
  default_requires_reply: boolean;
  override_keywords: string[];
  override_classification: string | null;
  override_requires_reply: boolean | null;
  is_active: boolean;
  hit_count: number;
}

const CLASSIFICATIONS = [
  { value: 'customer_inquiry', label: 'Customer Inquiry' },
  { value: 'automated_notification', label: 'Auto Notification' },
  { value: 'spam_phishing', label: 'Spam/Phishing' },
  { value: 'marketing_newsletter', label: 'Marketing' },
  { value: 'recruitment_hr', label: 'Recruitment' },
  { value: 'receipt_confirmation', label: 'Receipt' },
  { value: 'internal_system', label: 'System' },
];

export function SenderRulesPanel() {
  const { toast } = useToast();
  const [rules, setRules] = useState<SenderRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // New rule form
  const [newPattern, setNewPattern] = useState('');
  const [newClassification, setNewClassification] = useState('automated_notification');
  const [newRequiresReply, setNewRequiresReply] = useState(false);

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editClassification, setEditClassification] = useState('');
  const [editRequiresReply, setEditRequiresReply] = useState(false);

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      const { data, error } = await supabase
        .from('sender_rules')
        .select('*')
        .order('hit_count', { ascending: false });

      if (error) throw error;
      setRules(data || []);
    } catch (error) {
      logger.error('Error fetching sender rules', error);
    } finally {
      setLoading(false);
    }
  };

  const addRule = async () => {
    if (!newPattern.trim()) {
      toast({ title: 'Please enter a sender pattern', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user?.id)
        .single();

      const { error } = await supabase.from('sender_rules').insert({
        workspace_id: userData?.workspace_id,
        sender_pattern: newPattern.trim().toLowerCase(),
        default_classification: newClassification,
        default_requires_reply: newRequiresReply,
        is_active: true,
      });

      if (error) throw error;

      toast({ title: 'Rule added' });
      setNewPattern('');
      setNewClassification('automated_notification');
      setNewRequiresReply(false);
      fetchRules();
    } catch (error) {
      logger.error('Error adding rule', error);
      toast({
        title: 'Failed to add rule',
        description: 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleRule = async (id: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('sender_rules')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      setRules(rules.map((r) => (r.id === id ? { ...r, is_active: isActive } : r)));
    } catch (error) {
      logger.error('Error toggling rule', error);
    }
  };

  const deleteRule = async (id: string) => {
    try {
      const { error } = await supabase.from('sender_rules').delete().eq('id', id);

      if (error) throw error;

      setRules(rules.filter((r) => r.id !== id));
      toast({ title: 'Rule deleted' });
    } catch (error) {
      logger.error('Error deleting rule', error);
    }
  };

  const startEditing = (rule: SenderRule) => {
    setEditingId(rule.id);
    setEditClassification(rule.default_classification);
    setEditRequiresReply(rule.default_requires_reply);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditClassification('');
    setEditRequiresReply(false);
  };

  const saveEdit = async (id: string) => {
    try {
      const { error } = await supabase
        .from('sender_rules')
        .update({
          default_classification: editClassification,
          default_requires_reply: editRequiresReply,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      setRules(
        rules.map((r) =>
          r.id === id
            ? {
                ...r,
                default_classification: editClassification,
                default_requires_reply: editRequiresReply,
              }
            : r,
        ),
      );
      setEditingId(null);
      toast({ title: 'Rule updated' });
    } catch (error) {
      logger.error('Error updating rule', error);
      toast({ title: 'Failed to update rule', variant: 'destructive' });
    }
  };

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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="h-5 w-5" />
          Sender Rules
        </CardTitle>
        <CardDescription>
          Create rules to automatically classify emails from specific senders. Rules are checked
          before AI classification.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Add New Rule */}
        <div className="bg-muted/50 rounded-lg p-4 space-y-3">
          <h4 className="font-medium text-sm">Add New Rule</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              placeholder="@stripe.com or noreply@*"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              className="text-sm"
            />
            <Select value={newClassification} onValueChange={setNewClassification}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLASSIFICATIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch
                checked={newRequiresReply}
                onCheckedChange={setNewRequiresReply}
                id="new-requires-reply"
              />
              <label htmlFor="new-requires-reply" className="text-sm">
                Needs Reply
              </label>
            </div>
            <Button onClick={addRule} disabled={saving} className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-1" />
              Add Rule
            </Button>
          </div>
        </div>

        {/* Existing Rules */}
        <div className="space-y-2">
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No sender rules yet. Add one above or the system will learn from your corrections.
            </p>
          ) : (
            rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between bg-card border rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <Switch
                    checked={rule.is_active}
                    onCheckedChange={(checked) => toggleRule(rule.id, checked)}
                  />
                  <div>
                    <p className="font-mono text-sm">{rule.sender_pattern}</p>
                    {editingId === rule.id ? (
                      <div className="flex items-center gap-2 mt-2">
                        <Select value={editClassification} onValueChange={setEditClassification}>
                          <SelectTrigger className="h-8 text-xs w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CLASSIFICATIONS.map((c) => (
                              <SelectItem key={c.value} value={c.value}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1.5">
                          <Switch
                            checked={editRequiresReply}
                            onCheckedChange={setEditRequiresReply}
                            id={`edit-reply-${rule.id}`}
                          />
                          <label htmlFor={`edit-reply-${rule.id}`} className="text-xs">
                            Reply
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {
                            CLASSIFICATIONS.find((c) => c.value === rule.default_classification)
                              ?.label
                          }
                        </Badge>
                        {rule.default_requires_reply ? (
                          <Badge
                            variant="secondary"
                            className="text-xs bg-green-500/10 text-green-600"
                          >
                            Needs Reply
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Auto-triage
                          </Badge>
                        )}
                        {rule.hit_count > 0 && (
                          <Badge variant="outline" className="text-xs">
                            <Zap className="h-3 w-3 mr-1" />
                            {rule.hit_count} hits
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {editingId === rule.id ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => saveEdit(rule.id)}
                        className="text-green-600 hover:text-green-700"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={cancelEditing}>
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => startEditing(rule)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteRule(rule.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
