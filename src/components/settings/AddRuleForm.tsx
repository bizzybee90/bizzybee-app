import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import type { RuleCategory } from '@/lib/types';

const CATEGORIES: { value: RuleCategory; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'liability', label: 'Liability' },
  { value: 'service_standards', label: 'Service standards' },
  { value: 'pricing', label: 'Pricing' },
  { value: 'scope', label: 'Scope' },
  { value: 'escalation', label: 'Escalation' },
];

interface AddRuleFormProps {
  onSave: (ruleText: string, category: RuleCategory) => Promise<void>;
  onCancel: () => void;
  initialText?: string;
  initialCategory?: RuleCategory;
  isEdit?: boolean;
}

export function AddRuleForm({ onSave, onCancel, initialText = '', initialCategory = 'general', isEdit }: AddRuleFormProps) {
  const [ruleText, setRuleText] = useState(initialText);
  const [category, setCategory] = useState<RuleCategory>(initialCategory);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!ruleText.trim()) return;
    setSaving(true);
    await onSave(ruleText.trim(), category);
    setSaving(false);
    if (!isEdit) {
      setRuleText('');
      setCategory('general');
    }
  };

  return (
    <div className="rounded-lg border bg-white p-4 space-y-4">
      <div className="space-y-2">
        <Label htmlFor="rule-text" className="text-sm font-medium">Rule</Label>
        <Textarea
          id="rule-text"
          placeholder="e.g. Never admit fault for damage claims without owner approval"
          value={ruleText}
          onChange={e => setRuleText(e.target.value)}
          rows={2}
          className="resize-none"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rule-category" className="text-sm font-medium">Category</Label>
        <Select value={category} onValueChange={v => setCategory(v as RuleCategory)}>
          <SelectTrigger id="rule-category" className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2 pt-1">
        <Button onClick={handleSave} disabled={!ruleText.trim() || saving} size="sm">
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {isEdit ? 'Save changes' : 'Add rule'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
