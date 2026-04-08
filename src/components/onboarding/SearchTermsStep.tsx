import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, Plus, X, Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { generateSearchTerms } from '@/lib/generateSearchTerms';

interface SearchTermsStepProps {
  workspaceId: string;
  onNext: () => void;
  onBack: () => void;
}

interface SearchTerm {
  term: string;
  enabled: boolean;
}

// generateSearchTerms is now imported from @/lib/generateSearchTerms

export function SearchTermsStep({ workspaceId, onNext, onBack }: SearchTermsStepProps) {
  const isPreview = workspaceId === 'preview-workspace';
  const [searchTerms, setSearchTerms] = useState<SearchTerm[]>([]);
  const [customTerm, setCustomTerm] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [businessContext, setBusinessContext] = useState<{
    businessType: string;
    location: string;
    companyName: string;
    websiteUrl: string;
  } | null>(null);

  // Load business context and generate terms
  useEffect(() => {
    const loadBusinessContext = async () => {
      if (isPreview) {
        // In preview mode, generate sample terms without querying Supabase
        setBusinessContext({
          businessType: 'window_cleaning',
          location: 'Luton',
          companyName: 'Preview Business',
          websiteUrl: '',
        });
        const generatedTerms = generateSearchTerms('window_cleaning', 'Luton');
        setSearchTerms(generatedTerms.map((term) => ({ term, enabled: true })));
        setIsLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('business_context')
          .select('company_name, business_type, website_url, service_area')
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          setBusinessContext({
            businessType: data.business_type || '',
            location: data.service_area || '',
            companyName: data.company_name || '',
            websiteUrl: data.website_url || '',
          });

          // Generate search terms
          const generatedTerms = generateSearchTerms(
            data.business_type || '',
            data.service_area || '',
          );

          setSearchTerms(
            generatedTerms.map((term) => ({
              term,
              enabled: true,
            })),
          );
        }
      } catch (error) {
        console.error('Error loading business context:', error);
        toast.error('Failed to load business information');
      } finally {
        setIsLoading(false);
      }
    };

    loadBusinessContext();
  }, [workspaceId, isPreview]);

  const enabledTerms = useMemo(
    () => searchTerms.filter((t) => t.enabled).map((t) => t.term),
    [searchTerms],
  );

  const handleToggleTerm = (index: number) => {
    setSearchTerms((prev) => prev.map((t, i) => (i === index ? { ...t, enabled: !t.enabled } : t)));
  };

  const handleAddCustomTerm = () => {
    const trimmed = customTerm.trim().toLowerCase();
    if (!trimmed) return;

    // Check for duplicates
    if (searchTerms.some((t) => t.term.toLowerCase() === trimmed)) {
      toast.error('This search term already exists');
      return;
    }

    setSearchTerms((prev) => [...prev, { term: trimmed, enabled: true }]);
    setCustomTerm('');
  };

  const handleRemoveTerm = (index: number) => {
    setSearchTerms((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (enabledTerms.length === 0) {
      toast.error('Please enable at least one search term');
      return;
    }

    // In preview mode, skip Supabase write and just advance
    if (isPreview) {
      toast.success('Search terms saved');
      onNext();
      return;
    }

    setIsSaving(true);
    try {
      // Save search terms config to n8n_workflow_progress table
      // Using type workaround since the new table isn't in generated types yet
      const { error } = await supabase
        .from('n8n_workflow_progress' as 'allowed_webhook_ips')
        .upsert(
          {
            workspace_id: workspaceId,
            workflow_type: 'search_terms_config',
            status: 'completed',
            details: {
              search_queries: enabledTerms,
              target_count: 15,
              all_terms: searchTerms,
            },
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as never,
          {
            onConflict: 'workspace_id,workflow_type',
          },
        );

      if (error) throw error;

      // Fire-and-forget: kick off competitor discovery in the background
      // so it runs in parallel with the user's email + channels setup.
      // Errors are silently logged; ProgressScreen has a safety-net retry.
      // See: docs/plans/2026-04-08-early-competitor-discovery-trigger-design.md
      supabase.functions
        .invoke('trigger-n8n-workflow', {
          body: { workspace_id: workspaceId, workflow_type: 'competitor_discovery' },
        })
        .catch((err) => console.error('competitor_discovery trigger failed:', err));

      toast.success('Search terms saved');
      onNext();
    } catch (error) {
      console.error('Error saving search terms:', error);
      toast.error('Failed to save search terms');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CardTitle className="text-xl">Configure Search Terms</CardTitle>
          <CardDescription className="mt-2">Loading your business information...</CardDescription>
        </div>
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <CardTitle className="text-xl">Configure Competitor Search</CardTitle>
        <CardDescription className="mt-2">
          We'll search for competitors using these terms. Enable the ones you want.
        </CardDescription>
      </div>

      {/* Auto-generated terms info */}
      <div className="flex items-start gap-3 p-3 bg-primary/5 rounded-lg border border-primary/20 text-sm">
        <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="text-muted-foreground">
          <span className="font-medium text-foreground">Auto-generated</span> based on your business
          type ({businessContext?.businessType || 'Unknown'}) and location (
          {businessContext?.location || 'Unknown'}).
        </div>
      </div>

      {/* Search terms list */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Search Terms</Label>
        <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
          {searchTerms.map((term, index) => (
            <div
              key={index}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                term.enabled ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30'
              }`}
            >
              <Checkbox
                checked={term.enabled}
                onCheckedChange={() => handleToggleTerm(index)}
                id={`term-${index}`}
              />
              <label
                htmlFor={`term-${index}`}
                className={`flex-1 cursor-pointer ${
                  term.enabled ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                <Search className="h-3.5 w-3.5 inline mr-2 opacity-50" />
                {term.term}
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemoveTerm(index)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        {/* Add custom term */}
        <div className="flex gap-2 pt-2">
          <Input
            placeholder="Add custom search term..."
            value={customTerm}
            onChange={(e) => setCustomTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddCustomTerm();
              }
            }}
            className="flex-1"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleAddCustomTerm}
            disabled={!customTerm.trim()}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Explainer */}
      <p className="text-sm text-muted-foreground">
        We'll find and deeply analyse your top 15 local competitors — extracting every FAQ, pricing
        detail, and service they offer that your site doesn't cover yet.
      </p>

      {/* Summary */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="secondary">{enabledTerms.length} terms enabled</Badge>
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={handleSave}
          disabled={isSaving || enabledTerms.length === 0}
          className="gap-1"
        >
          {isSaving ? (
            <>Saving...</>
          ) : (
            <>
              Continue
              <ChevronRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
