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
import { generateSearchTerms, normalizePrimaryServiceLocation } from '@/lib/generateSearchTerms';

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
          location: normalizePrimaryServiceLocation('Luton'),
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
            location: normalizePrimaryServiceLocation(data.service_area || ''),
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

    // Fire-and-forget: we intentionally do NOT await the invoke. Awaiting caused
    // the "Saving..." button to hang for 20-50s when the edge function was slow
    // (competitor discovery can take that long to provision). ProgressScreen's
    // autoTrigger hook (useOnboardingDiscoveryAutoTrigger) is the safety net if
    // this invoke fails before the server records the run.
    setIsSaving(true);
    try {
      const discoveryPromise = supabase.functions
        .invoke('start-onboarding-discovery', {
          body: {
            workspace_id: workspaceId,
            search_queries: enabledTerms,
            target_count: 15,
            trigger_source: 'onboarding_search_terms',
          },
        })
        .then((result) => {
          if (result?.error) {
            console.warn(
              'start-onboarding-discovery returned error (autoTrigger will retry)',
              result.error,
            );
            return null;
          }
          return result?.data ?? null;
        })
        .catch((err) => {
          console.warn('start-onboarding-discovery threw (autoTrigger will retry)', err);
          return null;
        });

      // Best-effort immediate nudge after the invoke resolves. Still fire-and-forget.
      void discoveryPromise.then((data) => {
        void supabase.functions
          .invoke('onboarding-worker-nudge', {
            body: {
              workspace_id: workspaceId,
              workflow_key: 'competitor_discovery',
              run_id: typeof data?.run_id === 'string' ? data.run_id : undefined,
            },
          })
          .catch((nudgeError) => {
            console.warn('Failed to kick competitor discovery immediately', nudgeError);
          });
      });

      toast.success('Search terms saved');
      onNext();
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CardTitle className="text-xl">Loading discovery setup</CardTitle>
          <CardDescription className="mt-2">
            We&apos;re reading your business details and preparing a few useful search ideas.
          </CardDescription>
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
        <CardTitle className="text-xl">Optional: widen discovery beyond your website</CardTitle>
        <CardDescription className="mt-2">
          BizzyBee can look a little wider and see how nearby competitors describe similar work. You
          can keep the suggestions, trim them back, or skip this later without affecting your core
          inbox and phone setup.
        </CardDescription>
      </div>

      {/* Auto-generated terms info */}
      <div className="flex items-start gap-3 p-3 bg-primary/5 rounded-lg border border-primary/20 text-sm">
        <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="text-muted-foreground">
          <span className="font-medium text-foreground">BizzyBee suggested these</span> from your
          business type ({businessContext?.businessType || 'Unknown'}) and location (
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
        We&apos;ll find and analyse your top 15 local competitors - pulling out the services,
        pricing cues, and FAQs worth covering next.
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
              Continue to launch review
              <ChevronRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
