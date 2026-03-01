import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, MessageSquare, CheckCircle2, AlertCircle, BarChart3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export const AIActivityWidget = () => {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [metrics, setMetrics] = useState({
    total: 0,
    resolved: 0,
    resolutionRate: 0,
    lowConfidence: 0
  });
  const [summary, setSummary] = useState<any>(null);
  const [showSummary, setShowSummary] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchTodayMetrics();
  }, []);

  const fetchTodayMetrics = async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data: conversations } = await supabase
        .from('conversations')
        .select('*')
        .eq('is_escalated', false)
        .gte('created_at', today.toISOString());

      if (conversations) {
        const resolved = conversations.filter(c => c.status === 'resolved').length;
        const lowConfidence = conversations.filter(c => c.ai_confidence && c.ai_confidence < 0.7).length;
        
        setMetrics({
          total: conversations.length,
          resolved,
          resolutionRate: conversations.length > 0 ? Math.round((resolved / conversations.length) * 100) : 0,
          lowConfidence
        });
      }
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateSummary = async () => {
    // generate-ai-summary edge function has been removed; no-op
    toast({
      title: 'Summary generation migrated',
      description: 'AI summary generation has been migrated to n8n workflows.'
    });
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            AI Activity Today
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            AI Activity Today
          </CardTitle>
          <CardDescription>
            Real-time metrics for AI-handled conversations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Total Conversations */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MessageSquare className="h-4 w-4" />
                <span>Total Handled</span>
              </div>
              <div className="text-3xl font-bold">{metrics.total}</div>
            </div>

            {/* Resolved */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4" />
                <span>Resolved</span>
              </div>
              <div className="text-3xl font-bold text-success">{metrics.resolved}</div>
            </div>
          </div>

          {/* Resolution Rate */}
          <div className="space-y-3 p-4 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-success" />
                <span className="text-sm font-medium">Resolution Rate</span>
              </div>
              <Badge 
                variant="secondary" 
                className={
                  metrics.resolutionRate >= 80 
                    ? "bg-success/10 text-success hover:bg-success/20"
                    : metrics.resolutionRate >= 60
                      ? "bg-warning/10 text-warning hover:bg-warning/20"
                      : "bg-destructive/10 text-destructive hover:bg-destructive/20"
                }
              >
                {metrics.resolutionRate}%
              </Badge>
            </div>
            
            {/* Progress Bar */}
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className="h-2 rounded-full bg-success transition-all duration-300"
                style={{ width: `${metrics.resolutionRate}%` }}
              />
            </div>

            {/* Status Message */}
            <p className="text-xs text-muted-foreground">
              {metrics.resolutionRate >= 80
                ? "Excellent performance"
                : metrics.resolutionRate >= 60
                  ? "Good, room for improvement"
                  : "Needs attention"}
            </p>
          </div>

          {/* Low Confidence Alert */}
          {metrics.lowConfidence > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/5 border border-warning/20">
              <AlertCircle className="h-4 w-4 text-warning mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium">Low Confidence Conversations</p>
                <p className="text-xs text-muted-foreground">
                  {metrics.lowConfidence} conversation{metrics.lowConfidence !== 1 ? 's' : ''} may need review
                </p>
              </div>
            </div>
          )}

          {/* Generate Summary Button */}
          <Button 
            onClick={generateSummary} 
            disabled={generating || metrics.total === 0}
            className="w-full"
            variant="outline"
          >
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <BarChart3 className="mr-2 h-4 w-4" />
                Generate Full Summary
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Summary Dialog */}
      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>AI Activity Summary - Today</DialogTitle>
          </DialogHeader>
          
          {summary && (
            <div className="space-y-6">
              {/* Key Metrics */}
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold">{summary.metrics.total_conversations}</div>
                  <div className="text-xs text-muted-foreground mt-1">Total</div>
                </div>
                <div className="text-center p-4 bg-success/5 rounded-lg border border-success/20">
                  <div className="text-2xl font-bold text-success">{summary.metrics.resolution_rate}%</div>
                  <div className="text-xs text-muted-foreground mt-1">Resolution Rate</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold">{summary.metrics.average_confidence.toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground mt-1">Avg Confidence</div>
                </div>
              </div>

              {/* Insights */}
              <div className="space-y-2">
                <h3 className="font-semibold text-sm">Key Insights</h3>
                <div className="space-y-2">
                  {summary.insights.map((insight: string, i: number) => (
                    <div key={i} className="text-sm p-3 rounded-lg bg-muted/30 border border-border/50">
                      {insight}
                    </div>
                  ))}
                </div>
              </div>

              {/* Category Breakdown */}
              {Object.keys(summary.breakdowns.by_category).length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">By Category</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(summary.breakdowns.by_category).map(([category, count]) => (
                      <div key={category} className="flex items-center justify-between p-2 rounded-lg bg-muted/30 text-sm">
                        <span className="capitalize">{category.replace('_', ' ')}</span>
                        <Badge variant="secondary">{count as number}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sentiment Breakdown */}
              <div className="space-y-2">
                <h3 className="font-semibold text-sm">Sentiment Distribution</h3>
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center p-3 rounded-lg bg-success/5 border border-success/20">
                    <div className="text-xl font-bold text-success">{summary.breakdowns.by_sentiment.positive || 0}</div>
                    <div className="text-xs text-muted-foreground mt-1">Positive</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/30">
                    <div className="text-xl font-bold">{summary.breakdowns.by_sentiment.neutral || 0}</div>
                    <div className="text-xs text-muted-foreground mt-1">Neutral</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                    <div className="text-xl font-bold text-destructive">{summary.breakdowns.by_sentiment.negative || 0}</div>
                    <div className="text-xs text-muted-foreground mt-1">Negative</div>
                  </div>
                </div>
              </div>

              {/* Low Confidence Alerts */}
              {summary.alerts.low_confidence_conversations.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-warning" />
                    Needs Review ({summary.alerts.low_confidence_conversations.length})
                  </h3>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {summary.alerts.low_confidence_conversations.map((conv: any) => (
                      <div key={conv.id} className="text-xs p-2 rounded bg-warning/5 border border-warning/20">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">Confidence: {(conv.confidence * 100).toFixed(0)}%</span>
                          <Badge variant="outline" className="text-xs">{conv.category}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};