import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Pencil, Trash2 } from 'lucide-react';
import type { HouseRule, RuleCategory } from '@/lib/types';

const CATEGORY_COLORS: Record<RuleCategory, string> = {
  general: 'bg-gray-100 text-gray-700',
  liability: 'bg-purple-100 text-purple-700',
  service_standards: 'bg-teal-100 text-teal-700',
  pricing: 'bg-orange-100 text-orange-700',
  scope: 'bg-blue-100 text-blue-700',
  escalation: 'bg-amber-100 text-amber-700',
};

const CATEGORY_LABELS: Record<RuleCategory, string> = {
  general: 'General',
  liability: 'Liability',
  service_standards: 'Service standards',
  pricing: 'Pricing',
  scope: 'Scope',
  escalation: 'Escalation',
};

interface HouseRuleRowProps {
  rule: HouseRule;
  onToggle: (id: string, active: boolean) => void;
  onEdit: (rule: HouseRule) => void;
  onDelete: (id: string) => void;
}

export function HouseRuleRow({ rule, onToggle, onEdit, onDelete }: HouseRuleRowProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="group rounded-lg border bg-white p-3 sm:p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${rule.active ? 'text-foreground' : 'text-muted-foreground'}`}>
            {rule.rule_text}
          </p>
          <Badge variant="secondary" className={`mt-1.5 text-[10px] font-medium px-1.5 py-0 ${CATEGORY_COLORS[rule.category]}`}>
            {CATEGORY_LABELS[rule.category]}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Switch
            checked={rule.active}
            onCheckedChange={checked => onToggle(rule.id, checked)}
            className="scale-90"
          />
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => onEdit(rule)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive" onClick={() => setConfirming(true)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {confirming && (
        <div className="flex items-center gap-2 pt-1 text-sm">
          <span className="text-muted-foreground">Are you sure? This cannot be undone.</span>
          <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={() => { onDelete(rule.id); setConfirming(false); }}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
