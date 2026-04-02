import { Button } from '@/components/ui/button';
import { Check, Pencil, X } from 'lucide-react';
import type { HouseRule } from '@/lib/types';

interface SuggestionCardProps {
  rule: HouseRule;
  onAccept: (id: string) => void;
  onEdit: (rule: HouseRule) => void;
  onDismiss: (id: string) => void;
}

export function SuggestionCard({ rule, onAccept, onEdit, onDismiss }: SuggestionCardProps) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 border-l-4 border-l-amber-400">
      <p className="text-xs font-medium text-amber-700 mb-1.5">Suggested rule</p>
      <p className="text-sm text-foreground mb-1">{rule.rule_text}</p>
      {rule.source_context && (
        <p className="text-xs text-muted-foreground mb-3">{rule.source_context}</p>
      )}
      <div className="flex gap-2 mt-3">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onAccept(rule.id)}>
          <Check className="mr-1 h-3 w-3" /> Save rule
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onEdit(rule)}>
          <Pencil className="mr-1 h-3 w-3" /> Edit first
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => onDismiss(rule.id)}>
          <X className="mr-1 h-3 w-3" /> Dismiss
        </Button>
      </div>
    </div>
  );
}
