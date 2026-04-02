import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Loader2, ShieldCheck, Lightbulb } from 'lucide-react';
import { useHouseRules } from '@/hooks/useHouseRules';
import { useWorkspace } from '@/hooks/useWorkspace';
import { HouseRuleRow } from './HouseRuleRow';
import { AddRuleForm } from './AddRuleForm';
import { SuggestionCard } from './SuggestionCard';
import type { HouseRule, RuleCategory } from '@/lib/types';

export function HouseRulesPanel() {
  const { workspace } = useWorkspace();
  const {
    rules,
    suggestions,
    activeCount,
    loading,
    addRule,
    updateRule,
    deleteRule,
    acceptSuggestion,
    dismissSuggestion,
  } = useHouseRules(workspace?.id);

  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<HouseRule | null>(null);

  const handleAdd = async (text: string, category: RuleCategory) => {
    await addRule(text, category);
    setShowForm(false);
  };

  const handleEditSave = async (text: string, category: RuleCategory) => {
    if (!editingRule) return;
    await updateRule(editingRule.id, { rule_text: text, category, source: 'manual' });
    setEditingRule(null);
  };

  const handleSuggestionEdit = (rule: HouseRule) => {
    setEditingRule(rule);
    setShowForm(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold">Brand rules</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Rules your AI will always follow — no exceptions.
          </p>
        </div>
        {!showForm && !editingRule && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add rule
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-white">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-green-50 flex items-center justify-center">
              <ShieldCheck className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <p className="text-xl font-semibold leading-none">{activeCount}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Active rules</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <Lightbulb className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <p className="text-xl font-semibold leading-none">{suggestions.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Pending suggestions</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add form (slides in) */}
      {showForm && (
        <AddRuleForm onSave={handleAdd} onCancel={() => setShowForm(false)} />
      )}

      {/* Edit form (slides in) */}
      {editingRule && (
        <AddRuleForm
          onSave={handleEditSave}
          onCancel={() => setEditingRule(null)}
          initialText={editingRule.rule_text}
          initialCategory={editingRule.category}
          isEdit
        />
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Suggestions</p>
          {suggestions.map(s => (
            <SuggestionCard
              key={s.id}
              rule={s}
              onAccept={acceptSuggestion}
              onEdit={handleSuggestionEdit}
              onDismiss={dismissSuggestion}
            />
          ))}
        </div>
      )}

      {/* Active rules list */}
      {rules.length > 0 ? (
        <div className="space-y-2">
          {suggestions.length > 0 && (
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active rules</p>
          )}
          {rules.map(rule => (
            <HouseRuleRow
              key={rule.id}
              rule={rule}
              onToggle={(id, active) => updateRule(id, { active })}
              onEdit={r => { setEditingRule(r); setShowForm(false); }}
              onDelete={deleteRule}
            />
          ))}
        </div>
      ) : !showForm && (
        <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            You haven't added any rules yet.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Add your first rule to start training your AI.
          </p>
          <Button size="sm" variant="outline" className="mt-4" onClick={() => setShowForm(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add your first rule
          </Button>
        </div>
      )}
    </div>
  );
}
