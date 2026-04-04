import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAiPhoneConfig } from '@/hooks/useAiPhoneConfig';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Plus, Search, Pencil, Trash2, BookOpen, Loader2 } from 'lucide-react';
import type { AiPhoneKBEntry } from '@/lib/types';

type KBCategory = AiPhoneKBEntry['category'];

const CATEGORIES: { value: KBCategory; label: string }[] = [
  { value: 'faq', label: 'FAQ' },
  { value: 'pricing', label: 'Pricing' },
  { value: 'services', label: 'Services' },
  { value: 'policies', label: 'Policies' },
  { value: 'general', label: 'General' },
];

const CATEGORY_COLOURS: Record<KBCategory, { bg: string; text: string }> = {
  faq: { bg: 'bg-blue-50', text: 'text-blue-700' },
  pricing: { bg: 'bg-green-50', text: 'text-green-700' },
  services: { bg: 'bg-purple-50', text: 'text-purple-700' },
  policies: { bg: 'bg-amber-50', text: 'text-amber-700' },
  general: { bg: 'bg-gray-100', text: 'text-gray-600' },
};

const FILTER_TABS: { value: KBCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  ...CATEGORIES,
];

interface FormState {
  title: string;
  content: string;
  category: KBCategory;
}

const EMPTY_FORM: FormState = { title: '', content: '', category: 'faq' };

export const KnowledgeBaseEditor = () => {
  const { config } = useAiPhoneConfig();
  const configId = config?.id ?? null;
  const queryClient = useQueryClient();

  const [activeFilter, setActiveFilter] = useState<KBCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  // --- Fetch entries ---
  const {
    data: entries = [],
    isLoading,
  } = useQuery<AiPhoneKBEntry[]>({
    queryKey: ['ai-phone-kb', configId],
    queryFn: async () => {
      if (!configId) return [];
      const { data, error } = await supabase
        .from('ai_phone_knowledge_base' as any)
        .select('*')
        .eq('config_id', configId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as unknown as AiPhoneKBEntry[]) ?? [];
    },
    enabled: !!configId,
  });

  // --- Sync KB to Retell (fire-and-forget) ---
  const syncToRetell = () => {
    supabase.functions.invoke('retell-update-agent', { body: {} }).catch(() => {
      // fire-and-forget — errors are non-critical
    });
  };

  // --- Add mutation ---
  const addMutation = useMutation({
    mutationFn: async (entry: FormState) => {
      if (!configId) throw new Error('No config found');
      const { data, error } = await supabase
        .from('ai_phone_knowledge_base' as any)
        .insert({
          config_id: configId,
          title: entry.title,
          content: entry.content,
          category: entry.category,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-phone-kb', configId] });
      toast.success('Entry added');
      resetForm();
      syncToRetell();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to add entry');
    },
  });

  // --- Update mutation ---
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...fields }: FormState & { id: string }) => {
      const { data, error } = await supabase
        .from('ai_phone_knowledge_base' as any)
        .update({
          title: fields.title,
          content: fields.content,
          category: fields.category,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-phone-kb', configId] });
      toast.success('Entry updated');
      resetForm();
      syncToRetell();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update entry');
    },
  });

  // --- Delete mutation ---
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('ai_phone_knowledge_base' as any)
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-phone-kb', configId] });
      toast.success('Entry deleted');
      syncToRetell();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete entry');
    },
  });

  // --- Filtered + searched entries ---
  const filteredEntries = useMemo(() => {
    let result = entries;
    if (activeFilter !== 'all') {
      result = result.filter((e) => e.category === activeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q)
      );
    }
    return result;
  }, [entries, activeFilter, searchQuery]);

  // --- Form helpers ---
  const resetForm = () => {
    setForm(EMPTY_FORM);
    setIsAdding(false);
    setEditingId(null);
  };

  const startEdit = (entry: AiPhoneKBEntry) => {
    setIsAdding(false);
    setEditingId(entry.id);
    setForm({ title: entry.title, content: entry.content, category: entry.category });
  };

  const startAdd = () => {
    setEditingId(null);
    setIsAdding(true);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = () => {
    if (!form.title.trim() || !form.content.trim()) {
      toast.error('Title and content are required');
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...form });
    } else {
      addMutation.mutate(form);
    }
  };

  const wordCount = form.content.trim().split(/\s+/).filter(Boolean).length;
  const isSaving = addMutation.isPending || updateMutation.isPending;

  // --- Render inline form ---
  const renderForm = () => (
    <Card
      className="border"
      style={{
        borderColor: 'var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <CardContent className="p-5 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="kb-title" className="text-[13px]">
            Title
          </Label>
          <Input
            id="kb-title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. What areas do you cover?"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="kb-content" className="text-[13px]">
            Content
          </Label>
          <Textarea
            id="kb-content"
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder="Write the answer the AI should give..."
            rows={5}
          />
          <div className="flex items-center justify-between">
            <p
              className={cn('text-[12px]', wordCount > 500 ? 'text-red-500' : '')}
              style={wordCount <= 500 ? { color: 'var(--text-tertiary)' } : undefined}
            >
              {wordCount} word{wordCount !== 1 ? 's' : ''}
            </p>
            <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              Keep entries under 500 words for best results
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="kb-category" className="text-[13px]">
            Category
          </Label>
          <Select
            value={form.category}
            onValueChange={(v) => setForm((f) => ({ ...f, category: v as KBCategory }))}
          >
            <SelectTrigger id="kb-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 pt-1">
          <Button
            onClick={handleSubmit}
            disabled={isSaving}
            style={{ backgroundColor: 'var(--accent-primary)' }}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {editingId ? 'Update' : 'Save'}
          </Button>
          <Button variant="ghost" onClick={resetForm} disabled={isSaving}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Knowledge Base
        </h2>
        {!isAdding && !editingId && (
          <Button
            onClick={startAdd}
            size="sm"
            style={{ backgroundColor: 'var(--accent-primary)' }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Entry
          </Button>
        )}
      </div>

      {/* Inline form when adding */}
      {isAdding && renderForm()}

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-2">
        {FILTER_TABS.map((tab) => {
          const isActive = activeFilter === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveFilter(tab.value)}
              className={cn(
                'px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors',
                isActive
                  ? 'text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
              style={isActive ? { backgroundColor: 'var(--accent-primary)' } : undefined}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
          style={{ color: 'var(--text-tertiary)' }}
        />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search entries..."
          className="pl-9"
        />
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--accent-primary)' }} />
        </div>
      )}

      {/* Entry list */}
      {!isLoading && filteredEntries.length > 0 && (
        <div className="space-y-3">
          {filteredEntries.map((entry) => {
            if (editingId === entry.id) return <div key={entry.id}>{renderForm()}</div>;

            const colours = CATEGORY_COLOURS[entry.category];
            const charCount = entry.content.length;

            return (
              <Card
                key={entry.id}
                className="group border"
                style={{
                  borderColor: 'var(--border-subtle)',
                  borderRadius: 'var(--radius-lg)',
                }}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <p
                          className="text-[15px] font-medium truncate"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {entry.title}
                        </p>
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0',
                            colours.bg,
                            colours.text
                          )}
                        >
                          {CATEGORIES.find((c) => c.value === entry.category)?.label}
                        </span>
                      </div>
                      <p
                        className="text-[13px] line-clamp-2"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {entry.content}
                      </p>
                      <p
                        className="text-[11px] mt-2"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {charCount} character{charCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => startEdit(entry)}
                      >
                        <Pencil className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => deleteMutation.mutate(entry.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && entries.length === 0 && !isAdding && (
        <div
          className="bg-card flex flex-col items-center justify-center py-12 text-center"
          style={{
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <BookOpen className="h-8 w-8 mb-3" style={{ color: 'var(--text-tertiary)' }} />
          <p className="text-[15px] font-medium" style={{ color: 'var(--text-secondary)' }}>
            No entries yet
          </p>
          <p
            className="text-[13px] mt-1 max-w-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Add your first FAQ to help your AI phone assistant answer questions.
          </p>
          <Button
            onClick={startAdd}
            className="mt-5"
            size="sm"
            style={{ backgroundColor: 'var(--accent-primary)' }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Entry
          </Button>
        </div>
      )}

      {/* No results for filter/search */}
      {!isLoading && entries.length > 0 && filteredEntries.length === 0 && (
        <p className="text-center py-8 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
          No entries match your filters.
        </p>
      )}
    </div>
  );
};
