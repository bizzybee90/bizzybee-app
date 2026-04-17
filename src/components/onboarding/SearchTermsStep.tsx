import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, Plus, X, Search } from 'lucide-react';
import { toast } from 'sonner';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { generateSearchTerms, normalizePrimaryServiceLocation } from '@/lib/generateSearchTerms';
import { markPendingOnboardingDiscoveryTrigger } from '@/lib/onboarding/discoveryTrigger';
import { parsePrimaryServiceArea } from '@/lib/onboarding/serviceArea';
import { cn } from '@/lib/utils';

interface SearchTermsStepProps {
  workspaceId: string;
  onNext: () => void;
  onBack: () => void;
}

interface SearchTerm {
  term: string;
  enabled: boolean;
}

/**
 * Shape of the raw jsonb returned by `public.expand_search_queries`.
 * Duplicated here (rather than imported from the Deno shared module at
 * `supabase/functions/_shared/expandSearchQueries.ts`) because the app's
 * tsconfig.app.json only includes `src`, so cross-boundary imports would
 * pull the shared module out of its own tsc scope. The source of truth
 * lives with the SQL RPC; both copies must stay in lockstep.
 *
 * Parity with the shared module's `fromRpcResult` is enforced by the test
 * `__tests__/mapRpcResult.parity.test.ts` — that test imports from BOTH
 * files and diffs their output, so a drift in either copy trips CI.
 */
export interface ExpandSearchQueriesRpcResult {
  queries: string[];
  towns_used: string[];
  primary_coverage: string[];
  expanded_coverage: string[];
}

export interface ExpandedQueriesState {
  queries: string[];
  townsUsed: string[];
  primaryCoverage: string[];
  expandedCoverage: string[];
}

/**
 * Mirror of `fromRpcResult` in `supabase/functions/_shared/expandSearchQueries.ts`.
 * Each array falls back to `[]` so downstream code can assume non-null arrays.
 * Accepts `null` too (Supabase RPC can return null on soft failures) —
 * shared `fromRpcResult` does not, so the parity test handles that edge
 * by checking non-null inputs only.
 * Keep in sync with the shared module.
 */
export function mapRpcResult(raw: ExpandSearchQueriesRpcResult | null): ExpandedQueriesState {
  if (!raw) {
    return { queries: [], townsUsed: [], primaryCoverage: [], expandedCoverage: [] };
  }
  return {
    queries: raw.queries ?? [],
    townsUsed: raw.towns_used ?? [],
    primaryCoverage: raw.primary_coverage ?? [],
    expandedCoverage: raw.expanded_coverage ?? [],
  };
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
    // Raw `service_area` string preserved verbatim so `parsePrimaryServiceArea`
    // can extract the radius parenthetical. The normalized `location` field
    // strips `(20 miles)` for display, which would always yield radius=0 here.
    serviceAreaRaw: string;
    companyName: string;
    websiteUrl: string;
  } | null>(null);

  const [expandedQueries, setExpandedQueries] = useState<string[]>([]);
  const [townsUsed, setTownsUsed] = useState<string[]>([]);
  const [excludedTowns, setExcludedTowns] = useState<Set<string>>(new Set());
  const [isExpanding, setIsExpanding] = useState(false);

  // Load business context and generate terms
  useEffect(() => {
    const loadBusinessContext = async () => {
      if (isPreview) {
        // In preview mode, generate sample terms without querying Supabase
        setBusinessContext({
          businessType: 'window_cleaning',
          location: normalizePrimaryServiceLocation('Luton (20 miles)'),
          serviceAreaRaw: 'Luton (20 miles)',
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
            serviceAreaRaw: data.service_area || '',
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

  // Primary town + radius parsed from the raw service_area string. The parser
  // returns null for empty / whitespace input; a null value short-circuits the
  // expand-queries effect below.
  const primaryArea = useMemo(
    () => parsePrimaryServiceArea(businessContext?.serviceAreaRaw ?? null),
    [businessContext?.serviceAreaRaw],
  );

  // Call expand_search_queries when the enabled term set or primary area changes.
  // Preview mode skips the RPC and pretends the primary town is the only town
  // used so the UI still renders deterministically.
  useEffect(() => {
    let cancelled = false;

    if (isPreview) {
      setExpandedQueries(enabledTerms);
      setTownsUsed(primaryArea ? [primaryArea.town] : []);
      setIsExpanding(false);
      return () => {
        cancelled = true;
      };
    }

    if (!primaryArea || enabledTerms.length === 0) {
      setExpandedQueries([]);
      setTownsUsed([]);
      setIsExpanding(false);
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      setIsExpanding(true);
      try {
        // Try the Places-based nearby-towns discovery first. Replaces the
        // uk_towns + haversine RPC path which returns raw nearest-by-
        // distance results — those include wards/suburbs (Sopwell,
        // Fleetville, Bennetts End, Marshalswick…) that won't rank
        // independently for "window cleaner Sopwell" because Google
        // attributes them to the parent town. Places Nearby Search with
        // type=locality natively filters these out.
        let townNames: string[] | null = null;
        try {
          const placesResp = await supabase.functions.invoke('get-nearby-towns', {
            body: {
              primary_town: primaryArea.town,
              radius_miles: primaryArea.radiusMiles,
              max_towns: 20,
            },
          });
          if (cancelled) return;
          const placesData = placesResp.data as { towns?: Array<{ name?: string }> } | null;
          const places = Array.isArray(placesData?.towns)
            ? placesData!.towns
                .map((t) => (typeof t?.name === 'string' ? t.name.trim() : ''))
                .filter((n): n is string => n.length > 0)
            : [];
          if (places.length >= 2) {
            townNames = [primaryArea.town, ...places];
          } else {
            console.warn(
              '[SearchTermsStep] get-nearby-towns returned too few towns, falling back to RPC',
              { places_count: places.length, error: placesResp.error },
            );
          }
        } catch (placesErr) {
          console.warn('[SearchTermsStep] get-nearby-towns threw, falling back to RPC', placesErr);
        }

        if (townNames) {
          // Build queries client-side from the Places-curated town list
          // using the same stem-extraction shape the RPC uses: for each
          // enabled term, strip the primary town suffix to get the
          // service-only stem; then cross each stem with each town.
          // Primary town gets all stems; nearby towns get the first 3
          // stems (matches RPC's p_terms_per_nearby_town=3 default).
          const primaryLower = primaryArea.town.toLowerCase();
          const stems = enabledTerms
            .map((t) =>
              t
                .toLowerCase()
                .replace(new RegExp(`[\\s,.;:\\-]*${primaryLower}$`, 'i'), '')
                .trim(),
            )
            .filter((s) => s.length > 0);
          const primaryStems = stems;
          const nearbyStemCount = 3;
          const nearbyStems = stems.slice(0, nearbyStemCount);
          const seen = new Set<string>();
          const builtQueries: string[] = [];
          for (const stem of primaryStems) {
            const q = `${stem} ${primaryLower}`;
            if (!seen.has(q)) {
              seen.add(q);
              builtQueries.push(q);
            }
          }
          for (const town of townNames.slice(1)) {
            const townLower = town.toLowerCase();
            for (const stem of nearbyStems) {
              const q = `${stem} ${townLower}`;
              if (!seen.has(q)) {
                seen.add(q);
                builtQueries.push(q);
              }
            }
          }
          setExpandedQueries(builtQueries);
          setTownsUsed(townNames);
          return;
        }

        // Fallback: RPC path (uk_towns haversine). Kept as a safety net
        // if Places is unreachable or returns insufficient data.
        const { data, error } = await supabase.rpc('expand_search_queries', {
          p_search_terms: enabledTerms,
          p_primary_town: primaryArea.town,
          p_radius_miles: primaryArea.radiusMiles,
          p_terms_per_nearby_town: 3,
          p_max_queries: 120,
          p_max_nearby_towns: 20,
        });
        if (cancelled) return;
        if (error) {
          console.warn('[SearchTermsStep] expand_search_queries RPC failed', error);
          setExpandedQueries(enabledTerms);
          setTownsUsed([primaryArea.town]);
          return;
        }
        const mapped = mapRpcResult(data as ExpandSearchQueriesRpcResult | null);
        setExpandedQueries(mapped.queries);
        setTownsUsed(mapped.townsUsed);
      } finally {
        if (!cancelled) setIsExpanding(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [enabledTerms, primaryArea?.town, primaryArea?.radiusMiles, isPreview, primaryArea]);

  // Final search_queries payload: expandedQueries minus anything matching an
  // excluded town. A query is "matched" to a town by a case-insensitive
  // trailing " {town}" suffix, which is how the RPC constructs them.
  //
  // Must sort townsUsed DESCENDING by length before matching so overlapping
  // suffixes resolve to the longer town. Without this, "plumber hemel
  // hempstead" could be attributed to "Hemel" if "Hemel" sits earlier in
  // townsUsed than "Hemel Hempstead" — same for "Bury" vs "Bury St Edmunds"
  // and any Welsh "Pont*" clusters. Longest-first match is stable.
  const finalQueries = useMemo(() => {
    if (excludedTowns.size === 0) return expandedQueries;
    const excludedLower = new Set(Array.from(excludedTowns).map((t) => t.toLowerCase()));
    const townsByLength = [...townsUsed].sort((a, b) => b.length - a.length);
    return expandedQueries.filter((q) => {
      const lowered = q.toLowerCase();
      const town = townsByLength.find((t) => lowered.endsWith(` ${t.toLowerCase()}`));
      return !town || !excludedLower.has(town.toLowerCase());
    });
  }, [expandedQueries, excludedTowns, townsUsed]);

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

  const handleToggleTown = (town: string) => {
    if (!primaryArea) return;
    if (town.toLowerCase() === primaryArea.town.toLowerCase()) return;
    setExcludedTowns((prev) => {
      const next = new Set(prev);
      if (next.has(town)) next.delete(town);
      else next.add(town);
      return next;
    });
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
      markPendingOnboardingDiscoveryTrigger(workspaceId);

      // Use the radius-expanded + town-filtered query list when it's populated;
      // fall back to the raw enabledTerms if the RPC returned nothing (e.g. an
      // error path). Never send an empty array downstream.
      const payloadQueries = finalQueries.length > 0 ? finalQueries : enabledTerms;

      // Send the user-retained town list so the backend's Places discovery
      // can fan out across every town in the chip row instead of querying
      // the primary town only. Excluded towns are already filtered out of
      // `townsUsed` by the useMemo that derives from excludedTowns, but we
      // belt-and-brace filter again here.
      const activeTowns = townsUsed.filter((t) => !excludedTowns.has(t));

      const discoveryPromise = supabase.functions
        .invoke('start-onboarding-discovery', {
          body: {
            workspace_id: workspaceId,
            search_queries: payloadQueries,
            towns_used: activeTowns,
            // Request the server-side hard cap. start-onboarding-discovery
            // clamps to Math.min(25, ...), so anything above 25 is noise;
            // below that was the old UI default that left the Places fan-
            // out pool underused. The radius-expanded chip row + Places
            // fan-out easily fills 25 real candidates for UK service
            // businesses.
            target_count: 25,
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

  const remainingTownCount = townsUsed.length - excludedTowns.size;
  const allTownsExcluded = townsUsed.length > 1 && finalQueries.length === 0;

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

      {/* Auto-generated terms info — 🐝 brand mark instead of generic AI sparkle. */}
      <div className="flex items-start gap-3 p-3 bg-primary/5 rounded-lg border border-primary/20 text-sm">
        <span role="img" aria-label="BizzyBee" className="text-base leading-none mt-0.5 shrink-0">
          🐝
        </span>
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

      {/* Radius-expanded town chip row. Appears only when the RPC resolved at
          least one nearby town. Clicking a chip excludes every query ending
          with that town from the final payload; the primary town chip is
          always locked in. */}
      {townsUsed.length > 1 && primaryArea && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            Searching in {remainingTownCount} towns within {primaryArea.radiusMiles} miles
          </Label>
          <p className="text-xs text-muted-foreground">
            {finalQueries.length} queries will fire across these areas. Click a town to exclude it.
          </p>
          <div className="flex flex-wrap gap-2">
            {townsUsed.map((town) => {
              const isPrimary = town.toLowerCase() === primaryArea.town.toLowerCase();
              const isExcluded = excludedTowns.has(town);
              return (
                <button
                  key={town}
                  type="button"
                  disabled={isPrimary}
                  onClick={() => handleToggleTown(town)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs border transition',
                    isPrimary
                      ? 'bg-primary/10 border-primary/30 text-primary cursor-default'
                      : isExcluded
                        ? 'bg-muted border-muted-foreground/20 text-muted-foreground line-through'
                        : 'bg-background border-foreground/20 hover:bg-muted',
                  )}
                >
                  {town}
                  {isPrimary && ' (primary)'}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Explainer */}
      <p className="text-sm text-muted-foreground">
        We&apos;ll find and analyse your top 15 local competitors - pulling out the services,
        pricing cues, and FAQs worth covering next.
      </p>

      {/* Summary */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="secondary">{enabledTerms.length} terms enabled</Badge>
        {isExpanding && <span className="text-xs">Computing radius expansion…</span>}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={handleSave}
          disabled={isSaving || enabledTerms.length === 0 || allTownsExcluded}
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
