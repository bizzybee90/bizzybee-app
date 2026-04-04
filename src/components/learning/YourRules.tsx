import { useEffect, useState, forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useToast } from '@/hooks/use-toast';
import { Pencil, Trash2, Plus, Loader2, BookOpen, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface SenderRule {
  id: string;
  sender_pattern: string;
  default_classification: string;
  is_active: boolean | null;
}

const CLASSIFICATIONS = [
  'supplier_invoice',
  'spam',
  'notification',
  'customer_enquiry',
  'booking_request',
  'complaint',
  'newsletter',
  'internal',
  'other',
];

const ACTIONS = [
  { value: 'auto_handle', label: 'Auto-handle' },
  { value: 'draft_first', label: 'Draft first' },
  { value: 'always_review', label: 'Always review' },
];

const formatClassification = (str: string) =>
  str.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());

const classificationColor = (cls: string): string => {
  const map: Record<string, string> = {
    supplier_invoice: 'bg-blue-50 text-blue-700 border-blue-200',
    spam: 'bg-red-50 text-red-700 border-red-200',
    notification: 'bg-slate-50 text-slate-700 border-slate-200',
    customer_enquiry: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    booking_request: 'bg-purple-50 text-purple-700 border-purple-200',
    complaint: 'bg-orange-50 text-orange-700 border-orange-200',
    newsletter: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    internal: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  };
  return map[cls] || 'bg-slate-50 text-slate-700 border-slate-200';
};

export interface YourRulesHandle {
  highlightRule: (id: string) => void;
}

export const YourRules = forwardRef<YourRulesHandle>((_, ref) => {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const [rules, setRules] = useState<SenderRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editClassification, setEditClassification] = useState('');
  const [editAction, setEditAction] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPattern, setNewPattern] = useState('');
  const [newClassification, setNewClassification] = useState('supplier_invoice');
  const [newAction, setNewAction] = useState('auto_handle');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useImperativeHandle(ref, () => ({
    highlightRule: (id: string) => {
      setHighlightedId(id);
      rowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => setHighlightedId(null), 2000);
    },
  }));

  const fetchRules = useCallback(async () => {
    if (!workspace?.id) return;
    const { data } = await supabase
      .from('sender_rules')
      .select('id, sender_pattern, default_classification, is_active')
      .eq('workspace_id', workspace.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(50);
    setRules((data as SenderRule[]) || []);
    setLoading(false);
  }, [workspace?.id]);

  useEffect(() => {
    void fetchRules();
  }, [fetchRules]);

  const startEdit = (rule: SenderRule) => {
    setEditingId(rule.id);
    setEditClassification(rule.default_classification);
    setEditAction('auto_handle');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await supabase
      .from('sender_rules')
      .update({
        default_classification: editClassification,
      })
      .eq('id', editingId);
    setEditingId(null);
    toast({ title: 'Rule updated' });
    fetchRules();
  };

  const confirmDelete = async (id: string) => {
    await supabase.from('sender_rules').delete().eq('id', id);
    setDeletingId(null);
    toast({ title: 'Rule deleted' });
    fetchRules();
  };

  const addRule = async () => {
    if (!workspace?.id || !newPattern.trim()) return;
    await supabase.from('sender_rules').insert({
      workspace_id: workspace.id,
      sender_pattern: newPattern.trim(),
      default_classification: newClassification,
      is_active: true,
    });
    setShowAddForm(false);
    setNewPattern('');
    toast({ title: 'Rule added' });
    fetchRules();
  };

  if (loading) {
    return (
      <div className="bg-white rounded-3xl ring-1 ring-slate-900/5 shadow-sm p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl ring-1 ring-slate-900/5 shadow-sm p-6 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-slate-500" />
          <h2 className="font-semibold text-slate-900">Your rules</h2>
        </div>
        <span className="text-xs text-slate-400">{rules.length} active</span>
      </div>

      {rules.length === 0 && !showAddForm ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm text-slate-500">
            No rules yet. Review emails in the Teach queue to start teaching BizzyBee.
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-0.5">
          {rules.map((rule) => (
            <div
              key={rule.id}
              ref={(el) => {
                rowRefs.current[rule.id] = el;
              }}
              className={cn(
                'rounded-lg px-3 py-2.5 transition-all cursor-pointer group',
                highlightedId === rule.id
                  ? 'bg-amber-50 ring-1 ring-amber-200'
                  : 'hover:bg-slate-50',
              )}
            >
              {editingId === rule.id ? (
                <div className="space-y-2">
                  <p className="text-sm text-slate-500">
                    Emails from{' '}
                    <span className="font-medium text-slate-900">{rule.sender_pattern}</span>
                  </p>
                  <div className="flex gap-2">
                    <Select value={editClassification} onValueChange={setEditClassification}>
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CLASSIFICATIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {formatClassification(c)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={editAction} onValueChange={setEditAction}>
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTIONS.map((a) => (
                          <SelectItem key={a.value} value={a.value}>
                            {a.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-1.5 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" className="h-7 text-xs" onClick={saveEdit}>
                      <Check className="h-3 w-3 mr-1" /> Save
                    </Button>
                  </div>
                </div>
              ) : deletingId === rule.id ? (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-700">Remove this rule?</p>
                  <div className="flex gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setDeletingId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => confirmDelete(rule.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs shrink-0 border',
                        classificationColor(rule.default_classification),
                      )}
                    >
                      {formatClassification(rule.default_classification)}
                    </Badge>
                    <p className="text-sm text-slate-700 truncate">
                      Emails from{' '}
                      <span className="font-medium text-slate-900">{rule.sender_pattern}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => startEdit(rule)}
                    >
                      <Pencil className="h-3.5 w-3.5 text-slate-400" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setDeletingId(rule.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-slate-400" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAddForm ? (
        <div className="mt-3 p-3 rounded-lg border border-slate-200 space-y-2">
          <p className="text-xs font-medium text-slate-500">New rule</p>
          <Input
            placeholder="e.g. @xero.com"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            className="h-8 text-sm"
          />
          <div className="flex gap-2">
            <Select value={newClassification} onValueChange={setNewClassification}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLASSIFICATIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {formatClassification(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={newAction} onValueChange={setNewAction}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIONS.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-1.5 justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowAddForm(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={addRule}
              disabled={!newPattern.trim()}
            >
              <Plus className="h-3 w-3 mr-1" /> Add rule
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full text-slate-700 hover:bg-slate-50"
          onClick={() => setShowAddForm(true)}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add rule
        </Button>
      )}
    </div>
  );
});

YourRules.displayName = 'YourRules';
