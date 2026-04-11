import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Brain, 
  TrendingUp, 
  TrendingDown,
  Target,
  Zap,
  BookOpen,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface LearningStats {
  rulesCount: number;
  rulesThisMonth: number;
  accuracyRate: number;
  accuracyTrend: 'up' | 'down' | 'stable';
  totalReviewed: number;
  correctionsCount: number;
  correctionsLastWeek: number;
  automationRate: number;
  avgConfidence: number;
  topMisclassification: { from: string; to: string; count: number } | null;
  timeSavedMinutes: number;
  trainingQueueCount: number;
  trainingQueueLastWeek: number;
  handlingCategories: string[];
}

// Confidence state thresholds
type ConfidenceState = 'learning' | 'stabilising' | 'confident';

const getConfidenceState = (stats: LearningStats): ConfidenceState => {
  // Confident: Low training queue, high accuracy, many rules
  if (stats.trainingQueueCount <= 5 && stats.accuracyRate >= 90 && stats.rulesCount >= 10) {
    return 'confident';
  }
  // Stabilising: Decreasing training queue or good accuracy
  if (stats.accuracyRate >= 75 || (stats.trainingQueueLastWeek > stats.trainingQueueCount)) {
    return 'stabilising';
  }
  // Learning: Still gathering data
  return 'learning';
};

const confidenceStateConfig: Record<ConfidenceState, { label: string; level: number; color: string; icon: typeof Brain }> = {
  learning: { label: 'Learning', level: 1, color: 'bg-amber-500/10 text-amber-600 border-amber-500/20', icon: Brain },
  stabilising: { label: 'Stabilising', level: 2, color: 'bg-purple-500/10 text-purple-600 border-purple-500/20', icon: Sparkles },
  confident: { label: 'Confident', level: 3, color: 'bg-green-500/10 text-green-600 border-green-500/20', icon: CheckCircle2 },
};

export const LearningInsightsWidget = () => {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLearningStats = async () => {
      if (!workspace?.id) return;

      try {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);

        const lastMonthStart = new Date(monthStart);
        lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);

        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        const [
          rulesResult,
          rulesThisMonthResult,
          reviewedThisMonthResult,
          reviewedLastMonthResult,
          correctionsResult,
          correctionsLastWeekResult,
          conversationsResult,
          trainingQueueResult,
          handledCategoriesResult
        ] = await Promise.all([
          // Total rules
          supabase
            .from('sender_rules')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id),
          // Rules this month
          supabase
            .from('sender_rules')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .gte('created_at', monthStart.toISOString()),
          // Reviewed this month
          supabase
            .from('conversations')
            .select('review_outcome')
            .eq('workspace_id', workspace.id)
            .not('reviewed_at', 'is', null)
            .gte('reviewed_at', monthStart.toISOString()),
          // Reviewed last month
          supabase
            .from('conversations')
            .select('review_outcome')
            .eq('workspace_id', workspace.id)
            .not('reviewed_at', 'is', null)
            .gte('reviewed_at', lastMonthStart.toISOString())
            .lt('reviewed_at', monthStart.toISOString()),
          // Corrections this month
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .eq('review_outcome', 'changed')
            .not('reviewed_at', 'is', null)
            .gte('reviewed_at', monthStart.toISOString()),
          // Corrections last week (for trend)
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .eq('review_outcome', 'changed')
            .not('reviewed_at', 'is', null)
            .gte('reviewed_at', weekAgo.toISOString()),
          // Conversations for automation rate
          supabase
            .from('conversations')
            .select('decision_bucket, triage_confidence')
            .eq('workspace_id', workspace.id)
            .gte('created_at', monthStart.toISOString()),
          // Current training queue count
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .eq('needs_review', true)
            .is('reviewed_at', null),
          // Categories with active automation rules (skip_llm = true means fully automated)
          supabase
            .from('sender_rules')
            .select('default_classification')
            .eq('workspace_id', workspace.id)
            .eq('is_active', true)
            .eq('skip_llm', true)
            .limit(10)
        ]);

        // Calculate this month accuracy
        const thisMonthReviews = reviewedThisMonthResult.data || [];
        const thisMonthConfirmed = thisMonthReviews.filter(c => c.review_outcome === 'confirmed').length;
        const thisMonthTotal = thisMonthReviews.length;
        const thisMonthAccuracy = thisMonthTotal > 0 ? Math.round((thisMonthConfirmed / thisMonthTotal) * 100) : 100;

        // Calculate last month accuracy for trend
        const lastMonthReviews = reviewedLastMonthResult.data || [];
        const lastMonthConfirmed = lastMonthReviews.filter(c => c.review_outcome === 'confirmed').length;
        const lastMonthTotal = lastMonthReviews.length;
        const lastMonthAccuracy = lastMonthTotal > 0 ? Math.round((lastMonthConfirmed / lastMonthTotal) * 100) : 100;

        // Determine trend
        let accuracyTrend: 'up' | 'down' | 'stable' = 'stable';
        if (thisMonthAccuracy > lastMonthAccuracy + 5) accuracyTrend = 'up';
        else if (thisMonthAccuracy < lastMonthAccuracy - 5) accuracyTrend = 'down';

        // Calculate automation rate
        const conversations = conversationsResult.data || [];
        const autoHandled = conversations.filter(c => c.decision_bucket === 'auto_handled').length;
        const automationRate = conversations.length > 0 ? Math.round((autoHandled / conversations.length) * 100) : 0;

        // Calculate avg confidence
        const confidenceValues = conversations
          .filter(c => c.triage_confidence != null)
          .map(c => c.triage_confidence as number);
        const avgConfidence = confidenceValues.length > 0
          ? Math.round(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length)
          : 0;

        // Estimate time saved (assume 2 min per auto-handled email)
        const timeSavedMinutes = autoHandled * 2;

        // Get unique categories with full automation from sender_rules
        const handledCategories = [...new Set(
          (handledCategoriesResult.data || [])
            .map(c => c.default_classification)
            .filter(Boolean)
        )].slice(0, 3) as string[];

        setStats({
          rulesCount: rulesResult.count || 0,
          rulesThisMonth: rulesThisMonthResult.count || 0,
          accuracyRate: thisMonthAccuracy,
          accuracyTrend,
          totalReviewed: thisMonthTotal,
          correctionsCount: correctionsResult.count || 0,
          correctionsLastWeek: correctionsLastWeekResult.count || 0,
          automationRate,
          avgConfidence,
          topMisclassification: null,
          timeSavedMinutes,
          trainingQueueCount: trainingQueueResult.count || 0,
          trainingQueueLastWeek: (correctionsLastWeekResult.count || 0) + (trainingQueueResult.count || 0),
          handlingCategories: handledCategories
        });
      } catch (error) {
        console.error('Error fetching learning stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLearningStats();
  }, [workspace?.id]);

  if (loading || !stats) {
    return (
      <Card className="p-4 animate-pulse">
        <div className="h-32 bg-muted/30 rounded-lg" />
      </Card>
    );
  }

  const formatClassification = (str: string) => {
    return str.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const confidenceState = getConfidenceState(stats);
  const stateConfig = confidenceStateConfig[confidenceState];
  const StateIcon = stateConfig.icon;

  // Calculate training trend
  const trainingTrendDown = stats.trainingQueueLastWeek > stats.trainingQueueCount;
  const trainingDelta = stats.trainingQueueLastWeek - stats.trainingQueueCount;

  return (
    <Card 
      className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => navigate('/learning')}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-500" />
          <h2 className="font-semibold text-foreground">Learning</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Confidence State Badge with Level */}
          <Badge variant="outline" className={`text-[10px] px-2 py-0.5 ${stateConfig.color}`}>
            <StateIcon className="h-3 w-3 mr-1" />
            Level {stateConfig.level}: {stateConfig.label}
            {stats.accuracyTrend === 'up' && <TrendingUp className="h-3 w-3 ml-1" />}
          </Badge>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Key metrics row */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 text-lg font-bold text-foreground">
            <BookOpen className="h-3.5 w-3.5 text-purple-500" />
            {stats.rulesCount}
          </div>
          <p className="text-[10px] text-muted-foreground">Rules</p>
          {stats.rulesThisMonth > 0 && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 mt-0.5">
              +{stats.rulesThisMonth} this month
            </Badge>
          )}
        </div>

        <div className="text-center">
          <div className="flex items-center justify-center gap-1 text-lg font-bold text-foreground">
            <Target className="h-3.5 w-3.5 text-success" />
            {stats.accuracyRate}%
          </div>
          <p className="text-[10px] text-muted-foreground">Confidence</p>
          {stats.accuracyTrend === 'up' && (
            <span className="text-[9px] text-green-600">↑ improving</span>
          )}
        </div>

        <div className="text-center">
          <div className="flex items-center justify-center gap-1 text-lg font-bold text-foreground">
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            {stats.automationRate}%
          </div>
          <p className="text-[10px] text-muted-foreground">Automated</p>
        </div>
      </div>

      {/* Training Queue Trend */}
      {stats.trainingQueueCount > 0 && (
        <div className="mb-3 p-2 rounded-lg bg-muted/30">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Training queue</span>
            <div className="flex items-center gap-1">
              <span className="font-medium">{stats.trainingQueueCount} examples</span>
              {trainingTrendDown && trainingDelta > 0 && (
                <span className="text-green-600 flex items-center">
                  <TrendingDown className="h-3 w-3" />
                  ↓{trainingDelta}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Unlocked automations */}
      {stats.handlingCategories.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] text-muted-foreground mb-1">Unlocked automations</p>
          <div className="flex flex-wrap gap-1">
            {stats.handlingCategories.map(cat => (
              <Badge key={cat} variant="secondary" className="text-[9px] px-1.5 py-0 flex items-center gap-0.5">
                <CheckCircle2 className="h-2.5 w-2.5 text-green-600" />
                {formatClassification(cat)}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Insights row */}
      <div className="flex items-center justify-between text-xs border-t pt-3">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>~{Math.round(stats.timeSavedMinutes / 60)}h saved</span>
        </div>
        
        {stats.correctionsCount > 0 && (
          <span className="text-muted-foreground">
            {stats.correctionsCount} teaching moment{stats.correctionsCount !== 1 ? 's' : ''}
          </span>
        )}
        
        {stats.topMisclassification && (
          <span className="text-muted-foreground truncate max-w-[120px]" title={`${formatClassification(stats.topMisclassification.from)} → ${formatClassification(stats.topMisclassification.to)}`}>
            Top fix: {formatClassification(stats.topMisclassification.from).substring(0, 8)}...
          </span>
        )}
      </div>
    </Card>
  );
};
