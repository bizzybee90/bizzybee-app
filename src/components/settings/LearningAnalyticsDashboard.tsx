import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Target,
  Brain,
  Mail,
  Clock,
  CheckCircle,
  AlertCircle,
  Users,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
} from 'lucide-react';
import { useWorkspace } from '@/hooks/useWorkspace';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart';

interface PerformanceMetrics {
  totalConversations: number;
  automatedCount: number;
  automationRate: number;
  avgConfidence: number;
  correctionCount: number;
  overrideRate: number;
  avgResponseTime: number;
  timeSavedHours: number;
}

interface ClassificationBreakdown {
  name: string;
  value: number;
  color: string;
}

interface SenderInsight {
  domain: string;
  totalEmails: number;
  replyRate: number;
  vipScore: number;
  suggestedBucket: string;
}

interface RuleEffectiveness {
  pattern: string;
  hitCount: number;
  classification: string;
  isActive: boolean;
}

interface TrendData {
  date: string;
  corrections: number;
  automated: number;
  confidence: number;
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  customer_inquiry: '#3b82f6',
  customer_followup: '#8b5cf6',
  booking_request: '#22c55e',
  cancellation: '#ef4444',
  complaint: '#f97316',
  payment: '#eab308',
  newsletter: '#6b7280',
  automated_notification: '#64748b',
  spam: '#94a3b8',
  internal: '#0ea5e9',
  other: '#a1a1aa',
};

export function LearningAnalyticsDashboard() {
  const { workspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [classificationData, setClassificationData] = useState<ClassificationBreakdown[]>([]);
  const [senderInsights, setSenderInsights] = useState<SenderInsight[]>([]);
  const [ruleEffectiveness, setRuleEffectiveness] = useState<RuleEffectiveness[]>([]);
  const [trendData, setTrendData] = useState<TrendData[]>([]);
  const [correctionHeatmap, setCorrectionHeatmap] = useState<
    Array<{ from: string; to: string; count: number }>
  >([]);

  useEffect(() => {
    if (workspace?.id) {
      fetchAllData();
    }
  }, [workspace?.id]);

  const fetchAllData = async () => {
    setLoading(true);
    await Promise.all([
      fetchPerformanceMetrics(),
      fetchClassificationBreakdown(),
      fetchSenderInsights(),
      fetchRuleEffectiveness(),
      fetchTrendData(),
      fetchCorrectionHeatmap(),
    ]);
    setLoading(false);
  };

  const fetchPerformanceMetrics = async () => {
    try {
      // Get total conversations
      const { count: totalCount } = await supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace?.id);

      // Get auto-handled conversations
      const { count: autoCount } = await supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace?.id)
        .not('auto_handled_at', 'is', null);

      // Get corrections count
      const { count: correctionCount } = await supabase
        .from('triage_corrections')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace?.id);

      // Get average confidence
      const { data: confidenceData } = await supabase
        .from('conversations')
        .select('triage_confidence')
        .eq('workspace_id', workspace?.id)
        .not('triage_confidence', 'is', null);

      const avgConfidence = confidenceData?.length
        ? confidenceData.reduce((sum, c) => sum + (c.triage_confidence || 0), 0) /
          confidenceData.length
        : 0;

      // Estimate time saved (avg 5 min per email × automated count)
      const timeSaved = ((autoCount || 0) * 5) / 60;

      setMetrics({
        totalConversations: totalCount || 0,
        automatedCount: autoCount || 0,
        automationRate: totalCount ? ((autoCount || 0) / totalCount) * 100 : 0,
        avgConfidence: avgConfidence * 100,
        correctionCount: correctionCount || 0,
        overrideRate: totalCount ? ((correctionCount || 0) / totalCount) * 100 : 0,
        avgResponseTime: 12, // This would need actual calculation from messages
        timeSavedHours: timeSaved,
      });
    } catch (error) {
      logger.error('Error fetching metrics', error);
    }
  };

  const fetchClassificationBreakdown = async () => {
    try {
      const { data } = await supabase
        .from('conversations')
        .select('email_classification')
        .eq('workspace_id', workspace?.id)
        .not('email_classification', 'is', null);

      // Count by classification
      const counts: Record<string, number> = {};
      data?.forEach((c) => {
        const classification = c.email_classification || 'other';
        counts[classification] = (counts[classification] || 0) + 1;
      });

      const breakdown = Object.entries(counts)
        .map(([name, value]) => ({
          name: name.replace(/_/g, ' '),
          value,
          color: CLASSIFICATION_COLORS[name] || CLASSIFICATION_COLORS.other,
        }))
        .sort((a, b) => b.value - a.value);

      setClassificationData(breakdown);
    } catch (error) {
      logger.error('Error fetching classification breakdown', error);
    }
  };

  const fetchSenderInsights = async () => {
    try {
      const { data } = await supabase
        .from('sender_behaviour_stats')
        .select('*')
        .eq('workspace_id', workspace?.id)
        .order('total_messages', { ascending: false })
        .limit(20);

      const insights: SenderInsight[] = (data || []).map((s) => ({
        domain: s.sender_domain,
        totalEmails: s.total_messages || 0,
        replyRate: (s.reply_rate || 0) * 100,
        vipScore: s.vip_score || 0,
        suggestedBucket: s.suggested_bucket || 'wait',
      }));

      setSenderInsights(insights);
    } catch (error) {
      logger.error('Error fetching sender insights', error);
    }
  };

  const fetchRuleEffectiveness = async () => {
    try {
      const { data } = await supabase
        .from('sender_rules')
        .select('sender_pattern, hit_count, default_classification, is_active')
        .eq('workspace_id', workspace?.id)
        .order('hit_count', { ascending: false })
        .limit(20);

      const rules: RuleEffectiveness[] = (data || []).map((r) => ({
        pattern: r.sender_pattern,
        hitCount: r.hit_count || 0,
        classification: r.default_classification,
        isActive: r.is_active ?? true,
      }));

      setRuleEffectiveness(rules);
    } catch (error) {
      logger.error('Error fetching rule effectiveness', error);
    }
  };

  const fetchTrendData = async () => {
    try {
      // Get corrections by date
      const { data: corrections } = await supabase
        .from('triage_corrections')
        .select('corrected_at')
        .eq('workspace_id', workspace?.id)
        .not('corrected_at', 'is', null)
        .order('corrected_at', { ascending: true });

      // Get conversations by date
      const { data: conversations } = await supabase
        .from('conversations')
        .select('created_at, auto_handled_at, triage_confidence')
        .eq('workspace_id', workspace?.id)
        .order('created_at', { ascending: true });

      // Aggregate by date (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const dailyData: Record<
        string,
        { corrections: number; automated: number; confidences: number[] }
      > = {};

      corrections?.forEach((c) => {
        const date = new Date(c.corrected_at!).toISOString().split('T')[0];
        if (new Date(date) >= thirtyDaysAgo) {
          if (!dailyData[date]) dailyData[date] = { corrections: 0, automated: 0, confidences: [] };
          dailyData[date].corrections++;
        }
      });

      conversations?.forEach((c) => {
        const date = new Date(c.created_at!).toISOString().split('T')[0];
        if (new Date(date) >= thirtyDaysAgo) {
          if (!dailyData[date]) dailyData[date] = { corrections: 0, automated: 0, confidences: [] };
          if (c.auto_handled_at) dailyData[date].automated++;
          if (c.triage_confidence) dailyData[date].confidences.push(c.triage_confidence);
        }
      });

      const trends = Object.entries(dailyData)
        .map(([date, data]) => ({
          date,
          corrections: data.corrections,
          automated: data.automated,
          confidence: data.confidences.length
            ? Math.round(
                (data.confidences.reduce((a, b) => a + b, 0) / data.confidences.length) * 100,
              )
            : 0,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      setTrendData(trends);
    } catch (error) {
      logger.error('Error fetching trend data', error);
    }
  };

  const fetchCorrectionHeatmap = async () => {
    try {
      const { data } = await supabase
        .from('triage_corrections')
        .select('original_classification, new_classification')
        .eq('workspace_id', workspace?.id)
        .not('original_classification', 'is', null)
        .not('new_classification', 'is', null);

      // Aggregate corrections
      const heatmapCounts: Record<string, number> = {};
      data?.forEach((c) => {
        const key = `${c.original_classification}|${c.new_classification}`;
        heatmapCounts[key] = (heatmapCounts[key] || 0) + 1;
      });

      const heatmap = Object.entries(heatmapCounts)
        .map(([key, count]) => {
          const [from, to] = key.split('|');
          return { from, to, count };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      setCorrectionHeatmap(heatmap);
    } catch (error) {
      logger.error('Error fetching correction heatmap', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const chartConfig = {
    corrections: { label: 'Corrections', color: 'hsl(var(--destructive))' },
    automated: { label: 'Automated', color: 'hsl(var(--primary))' },
    confidence: { label: 'Confidence', color: 'hsl(var(--chart-3))' },
  } satisfies ChartConfig;

  return (
    <div className="space-y-6">
      {/* Key Metrics Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Automation Rate"
          value={`${metrics?.automationRate.toFixed(1) || 0}%`}
          description={`${metrics?.automatedCount || 0} of ${metrics?.totalConversations || 0} emails`}
          icon={Zap}
          trend={metrics?.automationRate && metrics.automationRate > 50 ? 'up' : 'neutral'}
        />
        <MetricCard
          title="AI Confidence"
          value={`${metrics?.avgConfidence.toFixed(0) || 0}%`}
          description="Average classification confidence"
          icon={Target}
          trend={metrics?.avgConfidence && metrics.avgConfidence > 80 ? 'up' : 'neutral'}
        />
        <MetricCard
          title="Override Rate"
          value={`${metrics?.overrideRate.toFixed(1) || 0}%`}
          description={`${metrics?.correctionCount || 0} corrections made`}
          icon={AlertCircle}
          trend={metrics?.overrideRate && metrics.overrideRate < 10 ? 'up' : 'down'}
        />
        <MetricCard
          title="Time Saved"
          value={`${metrics?.timeSavedHours.toFixed(0) || 0}h`}
          description="Estimated hours saved"
          icon={Clock}
          trend="up"
        />
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="classifications">Classifications</TabsTrigger>
          <TabsTrigger value="senders">Senders</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="learning">Learning</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Automation Trend */}
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="text-base">Automation Over Time</CardTitle>
                <CardDescription>Daily automated vs corrected emails</CardDescription>
              </CardHeader>
              <CardContent className="overflow-hidden">
                <div className="h-[300px] w-full">
                  <ChartContainer config={chartConfig} className="h-full w-full">
                    <AreaChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(val) =>
                          new Date(val).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })
                        }
                        className="text-xs"
                      />
                      <YAxis className="text-xs" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area
                        type="monotone"
                        dataKey="automated"
                        stackId="1"
                        stroke="hsl(var(--primary))"
                        fill="hsl(var(--primary))"
                        fillOpacity={0.3}
                      />
                      <Area
                        type="monotone"
                        dataKey="corrections"
                        stackId="2"
                        stroke="hsl(var(--destructive))"
                        fill="hsl(var(--destructive))"
                        fillOpacity={0.3}
                      />
                    </AreaChart>
                  </ChartContainer>
                </div>
              </CardContent>
            </Card>

            {/* Classification Distribution */}
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="text-base">Email Distribution</CardTitle>
                <CardDescription>By classification type</CardDescription>
              </CardHeader>
              <CardContent className="overflow-hidden">
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={classificationData.slice(0, 6)}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {classificationData.slice(0, 6).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, name: string) => [`${value} emails`, name]}
                        contentStyle={{
                          backgroundColor: 'hsl(var(--popover))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                        }}
                      />
                      <Legend
                        layout="vertical"
                        align="right"
                        verticalAlign="middle"
                        wrapperStyle={{ fontSize: '12px', paddingLeft: '10px' }}
                        formatter={(value) => (
                          <span className="text-xs text-foreground">{value}</span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Correction Heatmap */}
          {correctionHeatmap.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  Top Misclassifications
                </CardTitle>
                <CardDescription>What the AI gets wrong most often</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {correctionHeatmap.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-xs">
                          {item.from.replace(/_/g, ' ')}
                        </Badge>
                        <span className="text-muted-foreground">→</span>
                        <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">
                          {item.to.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <span className="text-sm font-medium">{item.count}×</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Classifications Tab */}
        <TabsContent value="classifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Classification Breakdown</CardTitle>
              <CardDescription>Distribution of email types in your inbox</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={classificationData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={150} className="text-xs" />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))">
                    {classificationData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Senders Tab */}
        <TabsContent value="senders" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Top Senders
              </CardTitle>
              <CardDescription>Most active email senders with behavior stats</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {senderInsights.map((sender, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Mail className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-mono text-sm">@{sender.domain}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{sender.totalEmails} emails</span>
                          <span>•</span>
                          <span>{sender.replyRate.toFixed(0)}% reply rate</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-xs">
                        {sender.suggestedBucket.replace(/_/g, ' ')}
                      </Badge>
                      <div className="text-right">
                        <p className="text-sm font-medium">VIP: {sender.vipScore.toFixed(0)}</p>
                        <Progress value={sender.vipScore * 10} className="h-1 w-16" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rules Tab */}
        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Rule Effectiveness
              </CardTitle>
              <CardDescription>How your sender rules are performing</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {ruleEffectiveness.map((rule, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-lg ${rule.isActive ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}
                      >
                        <CheckCircle className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-mono text-sm">{rule.pattern}</p>
                        <Badge variant="secondary" className="text-xs mt-1">
                          {rule.classification.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold">{rule.hitCount}</p>
                      <p className="text-xs text-muted-foreground">hits</p>
                    </div>
                  </div>
                ))}
                {ruleEffectiveness.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">
                    No rules created yet. Create rules from the Learning section.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Learning Tab */}
        <TabsContent value="learning" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="text-base">Confidence Trend</CardTitle>
                <CardDescription>Is the AI getting more confident over time?</CardDescription>
              </CardHeader>
              <CardContent className="overflow-hidden">
                <div className="h-[250px] w-full">
                  <ChartContainer config={chartConfig} className="h-full w-full">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(val) =>
                          new Date(val).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })
                        }
                        className="text-xs"
                      />
                      <YAxis domain={[0, 100]} className="text-xs" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line
                        type="monotone"
                        dataKey="confidence"
                        stroke="hsl(var(--chart-3))"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ChartContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="text-base">Corrections Over Time</CardTitle>
                <CardDescription>Are you correcting the AI less over time?</CardDescription>
              </CardHeader>
              <CardContent className="overflow-hidden">
                <div className="h-[250px] w-full">
                  <ChartContainer config={chartConfig} className="h-full w-full">
                    <BarChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(val) =>
                          new Date(val).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })
                        }
                        className="text-xs"
                      />
                      <YAxis className="text-xs" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="corrections"
                        fill="hsl(var(--destructive))"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string;
  description: string;
  icon: React.ElementType;
  trend: 'up' | 'down' | 'neutral';
}

function MetricCard({ title, value, description, icon: Icon, trend }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          {trend === 'up' && <ArrowUpRight className="h-5 w-5 text-green-500" />}
          {trend === 'down' && <ArrowDownRight className="h-5 w-5 text-red-500" />}
        </div>
        <div className="mt-4">
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
