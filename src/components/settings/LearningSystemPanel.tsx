import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Brain,
  Database,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Loader2,
  Play,
  Zap,
  Info,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface BootstrapStats {
  senderRulesCount: number;
  senderStatsCount: number;
  triageCorrectionsCount: number;
  conversationsWithConfidence: number;
  totalConversations: number;
  uniqueRulesCount: number;
}

export function LearningSystemPanel() {
  const { toast } = useToast();
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();

  const [populatingRules, setPopulatingRules] = useState(false);
  const [computingStats, setComputingStats] = useState(false);
  const [applyingRules, setApplyingRules] = useState(false);
  const [lastResult, setLastResult] = useState<{
    seeded?: number;
    learned?: number;
    skipped?: number;
    statsUpdated?: number;
    retriaged?: number;
  } | null>(null);

  // Fetch current stats
  const {
    data: stats,
    isLoading: loadingStats,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ['learning-system-stats', workspace?.id],
    queryFn: async (): Promise<BootstrapStats> => {
      if (!workspace?.id) {
        return {
          senderRulesCount: 0,
          senderStatsCount: 0,
          triageCorrectionsCount: 0,
          conversationsWithConfidence: 0,
          totalConversations: 0,
          uniqueRulesCount: 0,
        };
      }

      const [rulesRes, statsRes, correctionsRes, confidenceRes, totalRes] = await Promise.all([
        supabase
          .from('sender_rules')
          .select('sender_pattern', { count: 'exact' })
          .eq('workspace_id', workspace.id),
        supabase
          .from('sender_behaviour_stats')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .eq('review_outcome', 'changed')
          .not('reviewed_at', 'is', null),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .not('triage_confidence', 'is', null),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id),
      ]);

      // Count unique patterns
      const uniquePatterns = new Set((rulesRes.data || []).map((r) => r.sender_pattern));

      return {
        senderRulesCount: rulesRes.count || 0,
        senderStatsCount: statsRes.count || 0,
        triageCorrectionsCount: correctionsRes.count || 0,
        conversationsWithConfidence: confidenceRes.count || 0,
        totalConversations: totalRes.count || 0,
        uniqueRulesCount: uniquePatterns.size,
      };
    },
    enabled: !!workspace?.id,
    staleTime: 30000,
  });

  const handlePopulateSenderRules = async () => {
    // populate-sender-rules edge function has been removed
    toast({
      title: 'Moved to automation pipeline',
      description: 'Sender rule population now runs through the native automation pipeline.',
    });
  };

  const handleComputeSenderStats = async () => {
    // compute-sender-stats edge function has been removed
    toast({
      title: 'Moved to automation pipeline',
      description: 'Sender stats computation now runs through the native automation pipeline.',
    });
  };

  const handleApplyRulesToExisting = async () => {
    // bulk-retriage-conversations edge function has been removed
    toast({
      title: 'Moved to automation pipeline',
      description: 'Bulk re-triage now runs through the native automation pipeline.',
    });
  };

  const handleRunFullBootstrap = async () => {
    await handlePopulateSenderRules();
    await handleComputeSenderStats();

    toast({
      title: 'Learning System Bootstrapped',
      description: 'Sender rules and behavior stats have been initialized.',
    });
  };

  const getHealthStatus = () => {
    if (!stats) return 'unknown';

    const hasRules = stats.uniqueRulesCount > 0;
    const hasStats = stats.senderStatsCount > 0;
    const hasConfidence = stats.conversationsWithConfidence > 0;

    if (hasRules && hasStats && hasConfidence) return 'healthy';
    if (hasRules || hasStats) return 'partial';
    return 'empty';
  };

  const healthStatus = getHealthStatus();

  if (loadingStats) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Learning System
          {healthStatus === 'healthy' && (
            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Active
            </Badge>
          )}
          {healthStatus === 'partial' && (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
              <AlertCircle className="h-3 w-3 mr-1" />
              Partial
            </Badge>
          )}
          {healthStatus === 'empty' && (
            <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">
              <AlertCircle className="h-3 w-3 mr-1" />
              Not Initialized
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Bootstrap the 3-layer AI system: Sender Rules (Gatekeeper) → Behavior Stats → Review Loop
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Last Result Summary */}
        {lastResult && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 text-sm">
            <h4 className="font-medium text-green-700 mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Last Bootstrap Result
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-green-600">
              {lastResult.seeded !== undefined && <span>{lastResult.seeded} rules seeded</span>}
              {lastResult.learned !== undefined && (
                <span>{lastResult.learned} patterns learned</span>
              )}
              {lastResult.skipped !== undefined && (
                <span>{lastResult.skipped} already existed</span>
              )}
              {lastResult.statsUpdated !== undefined && (
                <span>{lastResult.statsUpdated} stats updated</span>
              )}
              {lastResult.retriaged !== undefined && (
                <span>{lastResult.retriaged} emails re-sorted</span>
              )}
            </div>
          </div>
        )}

        {/* Current Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Database className="h-4 w-4" />
              Sender Rules
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    Rules that automatically classify emails before AI runs. Emails from
                    @stripe.com, @indeed.com, etc. are handled instantly.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="text-2xl font-semibold">{stats?.uniqueRulesCount || 0}</p>
            <p className="text-xs text-muted-foreground">Layer A: Gatekeeper</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <TrendingUp className="h-4 w-4" />
              Behavior Stats
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    Historical data about how you handle emails from each sender domain. Used to
                    suggest new rules.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="text-2xl font-semibold">{stats?.senderStatsCount || 0}</p>
            <p className="text-xs text-muted-foreground">Domains tracked</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Sparkles className="h-4 w-4" />
              Corrections
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    When you reclassify an email, it creates a correction. After 3+ corrections for
                    the same sender, a rule is auto-created.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="text-2xl font-semibold">{stats?.triageCorrectionsCount || 0}</p>
            <p className="text-xs text-muted-foreground">User feedback</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Brain className="h-4 w-4" />
              With Confidence
            </div>
            <p className="text-2xl font-semibold">
              {stats?.totalConversations
                ? `${Math.round((stats.conversationsWithConfidence / stats.totalConversations) * 100)}%`
                : '0%'}
            </p>
            <p className="text-xs text-muted-foreground">
              {stats?.conversationsWithConfidence || 0} / {stats?.totalConversations || 0}
            </p>
          </div>
        </div>

        {/* Apply Rules to Existing - Prominent */}
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Apply Rules to Existing Emails
              </h4>
              <p className="text-sm text-muted-foreground mt-1">
                Re-sort all existing emails using your sender rules. This applies rules to emails
                that arrived before the rules existed.
              </p>
            </div>
            <Button
              onClick={handleApplyRulesToExisting}
              disabled={applyingRules || (stats?.uniqueRulesCount || 0) === 0}
              variant="default"
            >
              {applyingRules ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Apply Now
            </Button>
          </div>
          {(stats?.uniqueRulesCount || 0) === 0 && (
            <p className="text-xs text-amber-600 mt-2">
              No sender rules configured. Click "Bootstrap Now" first to add rules.
            </p>
          )}
        </div>

        {/* Bootstrap Actions */}
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-muted/30 rounded-lg p-4">
            <div>
              <h4 className="font-medium">Quick Bootstrap</h4>
              <p className="text-sm text-muted-foreground">
                Initialize sender rules with common patterns and compute behavior stats from your
                email history.
              </p>
            </div>
            <Button
              onClick={handleRunFullBootstrap}
              disabled={populatingRules || computingStats}
              size="lg"
            >
              {populatingRules || computingStats ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Bootstrap Now
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Populate Sender Rules */}
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium flex items-center gap-2">
                    <Database className="h-4 w-4 text-blue-500" />
                    Sender Rules
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Add ~20 known patterns (Stripe, Indeed, etc.)
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={handlePopulateSenderRules}
                disabled={populatingRules}
                className="w-full"
              >
                {populatingRules ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Populate Rules
              </Button>
            </div>

            {/* Compute Sender Stats */}
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-purple-500" />
                    Behavior Stats
                  </h4>
                  <p className="text-sm text-muted-foreground">Analyze reply rates & patterns</p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={handleComputeSenderStats}
                disabled={computingStats}
                className="w-full"
              >
                {computingStats ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Compute Stats
              </Button>
            </div>
          </div>
        </div>

        {/* How It Works */}
        <div className="bg-muted/30 rounded-lg p-4 text-sm space-y-2">
          <h4 className="font-medium">How the 3-Layer System Works:</h4>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>
              <strong>Layer A - Gatekeeper:</strong> Sender rules match emails before AI runs
              (faster, cheaper, reliable)
            </li>
            <li>
              <strong>Layer B - AI Triage:</strong> Decision router categorizes unmatched emails
              with confidence scores
            </li>
            <li>
              <strong>Layer C - Review Loop:</strong> Low-confidence emails go to Review;
              corrections create new rules
            </li>
          </ol>
          <p className="text-muted-foreground mt-2">
            After 3+ corrections for the same domain, the system automatically creates a sender
            rule.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
