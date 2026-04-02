import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { HouseRule, RuleCategory, RuleSource } from '@/lib/types';

export function useHouseRules(workspaceId: string | undefined) {
  const { toast } = useToast();
  const [rules, setRules] = useState<HouseRule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRules = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const { data, error } = await supabase
        .from('house_rules')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setRules((data as unknown as HouseRule[]) || []);
    } catch (error) {
      console.error('Error fetching house rules:', error);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const activeRules = rules.filter(r => r.source === 'manual' || r.active);
  const activeCount = rules.filter(r => r.active && r.source !== 'suggested').length;
  const suggestions = rules.filter(r => r.source === 'suggested' && r.active);

  const addRule = async (ruleText: string, category: RuleCategory) => {
    if (!workspaceId) return;
    const optimistic: HouseRule = {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      rule_text: ruleText,
      category,
      active: true,
      source: 'manual',
      source_context: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setRules(prev => [...prev, optimistic]);
    try {
      const { data, error } = await supabase
        .from('house_rules')
        .insert({ workspace_id: workspaceId, rule_text: ruleText, category, source: 'manual' })
        .select()
        .single();
      if (error) throw error;
      setRules(prev => prev.map(r => r.id === optimistic.id ? (data as unknown as HouseRule) : r));
      toast({ title: 'Rule added' });
    } catch (error) {
      setRules(prev => prev.filter(r => r.id !== optimistic.id));
      toast({ title: 'Failed to add rule', variant: 'destructive' });
    }
  };

  const updateRule = async (id: string, updates: Partial<Pick<HouseRule, 'rule_text' | 'category' | 'active' | 'source'>>) => {
    const prev = rules.find(r => r.id === id);
    if (!prev) return;
    setRules(rs => rs.map(r => r.id === id ? { ...r, ...updates, updated_at: new Date().toISOString() } : r));
    try {
      const { error } = await supabase
        .from('house_rules')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      if (updates.active !== undefined) {
        toast({ title: updates.active ? 'Rule enabled' : 'Rule disabled' });
      } else {
        toast({ title: 'Rule updated' });
      }
    } catch (error) {
      setRules(rs => rs.map(r => r.id === id ? prev : r));
      toast({ title: 'Failed to update rule', variant: 'destructive' });
    }
  };

  const deleteRule = async (id: string) => {
    const prev = rules;
    setRules(rs => rs.filter(r => r.id !== id));
    try {
      const { error } = await supabase.from('house_rules').delete().eq('id', id);
      if (error) throw error;
      toast({ title: 'Rule deleted' });
    } catch (error) {
      setRules(prev);
      toast({ title: 'Failed to delete rule', variant: 'destructive' });
    }
  };

  const acceptSuggestion = async (id: string) => {
    await updateRule(id, { source: 'manual' });
  };

  const dismissSuggestion = async (id: string) => {
    await updateRule(id, { active: false });
  };

  return {
    rules: activeRules.filter(r => r.source !== 'suggested'),
    suggestions,
    activeCount,
    loading,
    addRule,
    updateRule,
    deleteRule,
    acceptSuggestion,
    dismissSuggestion,
  };
}
