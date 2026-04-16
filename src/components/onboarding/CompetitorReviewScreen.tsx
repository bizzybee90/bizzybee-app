import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Search,
  Plus,
  Loader2,
  Globe,
  Star,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  Sparkles,
  ExternalLink,
  X,
  MapPin,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Eye,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  bulkSetOnboardingCompetitorSelection,
  deleteOnboardingCompetitor,
  listOnboardingCompetitors,
  toggleOnboardingCompetitorSelection,
} from '@/lib/onboarding/competitors';

interface Competitor {
  id: string;
  business_name: string | null;
  domain: string;
  url: string;
  rating: number | null;
  reviews_count: number | null;
  is_selected: boolean;
  discovery_source: string | null;
  location_data: any;
  distance_miles: number | null;
  match_reason: string | null;
  validation_status: string | null;
  relevance_score: number | null;
}

interface CompetitorReviewScreenProps {
  workspaceId: string;
  jobId: string;
  nicheQuery: string;
  serviceArea: string;
  targetCount: number;
  onConfirm: (selectedCount: number) => void;
  onBack: () => void;
  onSkip: () => void;
  onRestart?: () => void;
}

// Known directories that might slip through - show warning badge
const SUSPICIOUS_DOMAINS = [
  'yell',
  'checkatrade',
  'bark',
  'trustatrader',
  'mybuilder',
  'rated-people',
  'ratedpeople',
  'trustpilot',
  'houzz',
  'yelp',
  'freeindex',
  'gumtree',
  'scoot',
  'findatrade',
  'hotfrog',
];

const ITEMS_PER_PAGE = 50;

export function CompetitorReviewScreen({
  workspaceId,
  jobId,
  nicheQuery,
  serviceArea,
  targetCount,
  onConfirm,
  onBack,
  onSkip,
  onRestart,
}: CompetitorReviewScreenProps) {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(ITEMS_PER_PAGE);

  // Transparency: show exact search terms used for SERP discovery
  const [queriesUsed, setQueriesUsed] = useState<string[]>([]);
  const [showQueriesUsed, setShowQueriesUsed] = useState(true);

  // Fetch competitors for this job
  useEffect(() => {
    const fetchCompetitors = async () => {
      setIsLoading(true);
      try {
        const response = await listOnboardingCompetitors(workspaceId, jobId);
        setCompetitors((response.competitors || []) as Competitor[]);
      } catch (err) {
        logger.error('Error fetching competitors', err);
        toast.error('Failed to load competitors');
      } finally {
        setIsLoading(false);
      }
    };

    fetchCompetitors();
  }, [jobId, workspaceId]);

  // Fetch exact search queries used for this job (stored on the job record)
  useEffect(() => {
    const fetchQueriesUsed = async () => {
      try {
        const { data, error } = await supabase
          .from('competitor_research_jobs')
          .select('search_queries')
          .eq('id', jobId)
          .maybeSingle();

        if (error) throw error;

        // search_queries is a JSON column; in our usage we store an array of strings.
        const raw = (data as { search_queries?: unknown } | null)?.search_queries;
        const parsed = Array.isArray(raw) ? raw.filter((q) => typeof q === 'string') : [];
        setQueriesUsed(parsed);
      } catch (err) {
        // Non-blocking; the screen should still work without this metadata.
        logger.warn('Failed to load search queries used', { error: String(err) });
      }
    };

    fetchQueriesUsed();
  }, [jobId]);

  // Filter competitors based on search
  const filteredCompetitors = useMemo(() => {
    if (!searchQuery.trim()) return competitors;
    const search = searchQuery.toLowerCase();
    return competitors.filter(
      (c) =>
        c.business_name?.toLowerCase().includes(search) || c.domain.toLowerCase().includes(search),
    );
  }, [competitors, searchQuery]);

  // Paginated display
  const displayedCompetitors = useMemo(() => {
    return filteredCompetitors.slice(0, displayLimit);
  }, [filteredCompetitors, displayLimit]);

  const hasMore = filteredCompetitors.length > displayLimit;
  const remainingCount = filteredCompetitors.length - displayLimit;

  // Calculate selected count
  const selectedCount = useMemo(
    () => competitors.filter((c) => c.is_selected).length,
    [competitors],
  );

  // Check if domain looks suspicious
  const isSuspiciousDomain = (domain: string): boolean => {
    return SUSPICIOUS_DOMAINS.some((sus) => domain.toLowerCase().includes(sus));
  };

  // Get validation badge
  const getValidationBadge = (status: string | null) => {
    if (status === 'valid') {
      return (
        <Badge variant="outline" className="text-xs text-success border-success/30 bg-success/10">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Valid
        </Badge>
      );
    }
    if (status === 'invalid' || status === 'timeout') {
      return (
        <Badge
          variant="outline"
          className="text-xs text-destructive border-destructive/30 bg-destructive/10"
        >
          <XCircle className="h-3 w-3 mr-1" />
          Unreachable
        </Badge>
      );
    }
    return null; // pending - no badge
  };

  // Toggle individual competitor selection
  const handleToggleSelection = async (competitorId: string, newValue: boolean) => {
    // Optimistic update
    setCompetitors((prev) =>
      prev.map((c) => (c.id === competitorId ? { ...c, is_selected: newValue } : c)),
    );

    // Persist to database
    try {
      await toggleOnboardingCompetitorSelection(workspaceId, competitorId, newValue);
    } catch (error) {
      // Revert on error
      setCompetitors((prev) =>
        prev.map((c) => (c.id === competitorId ? { ...c, is_selected: !newValue } : c)),
      );
      toast.error('Failed to update selection');
    }
  };

  // Select all filtered non-selected competitors (no cap — user retains full control)
  const handleSelectAll = async () => {
    const toSelect = filteredCompetitors.filter((c) => !c.is_selected);

    if (toSelect.length === 0) {
      return;
    }

    const ids = toSelect.map((c) => c.id);

    // Optimistic update
    setCompetitors((prev) =>
      prev.map((c) => (ids.includes(c.id) ? { ...c, is_selected: true } : c)),
    );

    // Persist to database
    try {
      await bulkSetOnboardingCompetitorSelection(workspaceId, ids, true);
      toast.success(`Selected ${toSelect.length} competitors`);
    } catch (error) {
      toast.error('Failed to update selections');
    }
  };

  // Clear all selections
  const handleClearAll = async () => {
    const ids = competitors.filter((c) => c.is_selected).map((c) => c.id);

    // Optimistic update
    setCompetitors((prev) => prev.map((c) => ({ ...c, is_selected: false })));

    // Persist to database
    try {
      await bulkSetOnboardingCompetitorSelection(workspaceId, ids, false);
    } catch (error) {
      toast.error('Failed to clear selections');
    }
  };

  // Delete a competitor
  const handleDeleteCompetitor = async (competitorId: string) => {
    // Optimistic update
    setCompetitors((prev) => prev.filter((c) => c.id !== competitorId));

    try {
      await deleteOnboardingCompetitor(workspaceId, competitorId);
    } catch (error) {
      toast.error('Failed to delete competitor');
    }
  };

  // Add manual URL
  const handleAddManualUrl = async () => {
    if (!manualUrl.trim()) return;

    let cleanUrl = manualUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    let hostname: string;
    try {
      hostname = new URL(cleanUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      toast.error('Invalid URL format');
      return;
    }

    // Check if already exists
    if (competitors.some((c) => c.domain === hostname || c.url === cleanUrl)) {
      toast.error('This website is already in the list');
      return;
    }

    setIsAddingUrl(true);
    try {
      const { data, error } = await supabase.functions.invoke('add-manual-competitor', {
        body: {
          workspace_id: workspaceId,
          job_id: jobId,
          url: cleanUrl,
        },
      });

      if (error || data?.ok === false || !data?.competitor) {
        throw error || new Error(data?.error || 'Failed to add competitor');
      }

      const competitor = data.competitor as Competitor;
      setCompetitors((prev) =>
        prev.some((item) => item.id === competitor.id) ? prev : [competitor, ...prev],
      );
      setManualUrl('');
      toast.success(
        data?.reused ? 'Competitor already existed and has been loaded' : 'Competitor added',
      );
    } catch (err) {
      logger.error('Error adding URL', err);
      toast.error(err instanceof Error ? err.message : 'Failed to add competitor');
    } finally {
      setIsAddingUrl(false);
    }
  };

  // Confirm and start scraping
  const handleConfirm = async () => {
    if (selectedCount === 0) {
      toast.error('Please select at least one competitor');
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedCompetitorIds = competitors
        .filter((competitor) => competitor.is_selected)
        .map((competitor) => competitor.id);

      const { data, error } = await supabase.functions.invoke('start-faq-generation', {
        body: {
          workspace_id: workspaceId,
          selected_competitor_ids: selectedCompetitorIds,
          target_count: targetCount,
          trigger_source: 'onboarding_competitor_review',
        },
      });

      if (error) throw error;

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to start scraping');
      }

      toast.success(
        `Deep analysis started for ${Number(data?.sitesCountAnalysed || data?.sitesCount || selectedCount)} websites`,
      );
      onConfirm(selectedCount);
    } catch (err) {
      logger.error('Error starting scrape', err);
      toast.error('Failed to start analysis');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show more items
  const handleShowMore = () => {
    setDisplayLimit((prev) => prev + ITEMS_PER_PAGE);
  };

  // Estimate cost based on selected count
  const estimatedCost = useMemo(() => {
    const costPerSite = 0.1;
    return (selectedCount * costPerSite).toFixed(2);
  }, [selectedCount]);

  // Count invalid sites
  const invalidCount = useMemo(
    () =>
      competitors.filter(
        (c) =>
          c.is_selected && (c.validation_status === 'invalid' || c.validation_status === 'timeout'),
      ).length,
    [competitors],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading competitors...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center space-y-1">
        <h2 className="text-xl font-semibold text-foreground">Review Competitors</h2>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{selectedCount}</span> of{' '}
          <span className="font-medium text-foreground">{competitors.length}</span> selected
          {selectedCount > 10 && (
            <>
              <span className="mx-2">•</span>
              <span className="italic text-muted-foreground">
                More than 10 — that's fine, just a heads-up.
              </span>
            </>
          )}
        </p>
      </div>

      {/* Soft recommendation — user picks whatever they want; this is a hint, not a cap */}
      <div className="border border-primary/20 bg-primary/5 p-3 rounded-lg text-sm text-foreground">
        <p>
          <span className="font-medium">We recommend picking 5–10 competitors.</span> That's usually
          enough for diverse coverage without diluting your own voice. More is fine if you prefer,
          but your own website will always be the primary source of truth for your AI's answers.
        </p>
      </div>

      {/* Search terms used (SERP) */}
      {queriesUsed.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowQueriesUsed((v) => !v)}
            className="w-full flex items-center justify-between p-3 text-left hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Search terms used</span>
              <span className="text-xs text-muted-foreground">({queriesUsed.length})</span>
            </div>
            {showQueriesUsed ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {showQueriesUsed && (
            <div className="p-3 pt-0 space-y-2 border-t bg-muted/30">
              <p className="text-xs text-muted-foreground">
                These are the exact Google search phrases used to find the competitors below.
              </p>
              <div className="flex flex-wrap gap-2">
                {queriesUsed.map((q) => (
                  <Badge key={q} variant="secondary" className="font-mono text-xs">
                    {q}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search and bulk actions */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search competitors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={handleSelectAll}>
          Select All
        </Button>
        <Button variant="outline" size="sm" onClick={handleClearAll}>
          Clear
        </Button>
      </div>

      {/* Invalid sites warning */}
      {invalidCount > 0 && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-muted border text-sm text-muted-foreground">
          <XCircle className="h-4 w-4 flex-shrink-0" />
          <span>
            {invalidCount} selected site{invalidCount > 1 ? 's' : ''} could not be reached — they'll
            be replaced automatically
          </span>
        </div>
      )}

      {/* Competitor list */}
      <div className="h-[320px] rounded-md border overflow-y-auto">
        <div className="p-2 pr-4 space-y-1">
          {displayedCompetitors.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery ? 'No competitors match your search' : 'No competitors found'}
            </div>
          ) : (
            <>
              {displayedCompetitors.map((competitor) => (
                <div
                  key={competitor.id}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                    competitor.is_selected
                      ? 'bg-primary/5 border-primary/20'
                      : 'bg-muted/30 border-transparent opacity-60',
                  )}
                >
                  <Checkbox
                    checked={competitor.is_selected}
                    onCheckedChange={(checked) =>
                      handleToggleSelection(competitor.id, checked === true)
                    }
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground truncate">
                        {competitor.business_name || competitor.domain}
                      </span>
                      {competitor.distance_miles != null && (
                        <Badge variant="outline" className="text-xs">
                          <MapPin className="h-3 w-3 mr-1" />
                          {competitor.distance_miles} mi
                        </Badge>
                      )}
                      {competitor.discovery_source === 'manual' && (
                        <Badge variant="secondary" className="text-xs">
                          Manual
                        </Badge>
                      )}
                      {getValidationBadge(competitor.validation_status)}
                      {competitor.match_reason && !competitor.match_reason.startsWith('Weak') && (
                        <Badge
                          variant={
                            competitor.match_reason === 'Local business'
                              ? 'secondary'
                              : competitor.match_reason === 'Manual check'
                                ? 'outline'
                                : 'default'
                          }
                          className={cn(
                            'text-xs',
                            competitor.match_reason === 'Local business' &&
                              'text-blue-600 border-blue-300 bg-blue-50',
                            competitor.match_reason === 'Manual check' && 'text-muted-foreground',
                          )}
                        >
                          {competitor.match_reason}
                        </Badge>
                      )}
                      {competitor.match_reason?.startsWith('Weak') && (
                        <Badge
                          variant="outline"
                          className="text-xs text-amber-600 border-amber-300 bg-amber-50"
                        >
                          {competitor.match_reason}
                        </Badge>
                      )}
                      {isSuspiciousDomain(competitor.domain) && (
                        <Badge
                          variant="outline"
                          className="text-xs text-amber-600 border-amber-300"
                        >
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          May be directory
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        {competitor.domain}
                      </span>
                      {competitor.rating && (
                        <span className="flex items-center gap-1">
                          <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                          {competitor.rating.toFixed(1)}
                          {competitor.reviews_count && (
                            <span className="text-xs">({competitor.reviews_count})</span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons - always visible */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                      <a href={competitor.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteCompetitor(competitor.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}

              {/* Show more button */}
              {hasMore && (
                <Button variant="ghost" className="w-full mt-2" onClick={handleShowMore}>
                  <ChevronDown className="h-4 w-4 mr-2" />
                  Show {Math.min(remainingCount, ITEMS_PER_PAGE)} more competitors
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Add manual URL */}
      <div className="border rounded-lg p-3 bg-muted/30">
        <p className="text-sm font-medium mb-2">Add a competitor we missed</p>
        <div className="flex gap-2">
          <Input
            placeholder="https://example.com"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddManualUrl()}
            disabled={isAddingUrl}
          />
          <Button
            onClick={handleAddManualUrl}
            disabled={!manualUrl.trim() || isAddingUrl}
            size="icon"
          >
            {isAddingUrl ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Summary and actions */}
      <div className="border-t pt-4 space-y-4">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span>
              <span className="font-medium">{selectedCount}</span> of{' '}
              <span className="font-medium">{competitors.length}</span> competitors selected
            </span>
          </div>
          <span className="text-muted-foreground">Estimated analysis cost: ~${estimatedCost}</span>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          {onRestart && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Redo
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Restart Competitor Research?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Choose how you'd like to redo the competitor discovery:
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-3 py-4">
                  <Button
                    className="w-full justify-start"
                    variant="outline"
                    onClick={() => {
                      onRestart();
                    }}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Restart & run discovery
                    <span className="ml-auto text-xs text-muted-foreground">Fresh search</span>
                  </Button>
                  <Button className="w-full justify-start" variant="outline" onClick={onBack}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to setup
                    <span className="ml-auto text-xs text-muted-foreground">Change niche/area</span>
                  </Button>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <Button variant="ghost" onClick={onSkip}>
            Skip
          </Button>

          <Button
            onClick={handleConfirm}
            disabled={selectedCount === 0 || isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Confirm & Start Analysis ({selectedCount})
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
