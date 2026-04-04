import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Star,
  RefreshCw,
  MessageSquare,
  Clock,
  Hash,
  ChevronDown,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface CustomerIntelligenceProps {
  workspaceId: string;
  customerId: string;
  conversationId?: string;
}

interface CustomerData {
  id: string;
  name: string | null;
  email: string | null;
  vip_status: boolean;
  sentiment_trend: string | null;
  response_preference: string | null;
  topics_discussed: string[] | null;
  intelligence: {
    summary?: string;
    communication_patterns?: {
      typical_response_time?: string;
      message_length?: string;
      tone?: string;
    };
    lifetime_value_estimate?: string;
  } | null;
  last_analyzed_at: string | null;
}

interface CustomerInsight {
  id: string;
  insight_type: string;
  insight_text: string;
  confidence: number | null;
  created_at: string;
}

// Collapsible section component
const CollapsibleSection = ({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-100/80 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        {title}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
};

export const CustomerIntelligence = ({
  workspaceId,
  customerId,
  conversationId,
}: CustomerIntelligenceProps) => {
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [insights, setInsights] = useState<CustomerInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const enrichAttemptedRef = useRef<string | null>(null);

  const loadCustomerData = useCallback(async () => {
    const { data: customerData } = await supabase
      .from('customers')
      .select(
        'id, name, email, vip_status, sentiment_trend, response_preference, topics_discussed, intelligence, last_analyzed_at',
      )
      .eq('id', customerId)
      .single();

    const { data: insightsData } = await supabase
      .from('customer_insights')
      .select('id, insight_type, insight_text, confidence, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(10);

    const typedCustomer = customerData as CustomerData | null;
    setCustomer(typedCustomer);
    setInsights((insightsData || []) as CustomerInsight[]);

    const intel = typedCustomer?.intelligence as CustomerData['intelligence'];
    return {
      hasIntelligence: Boolean(intel && Object.keys(intel).length > 0 && intel.summary),
      hasInsights: (insightsData || []).length > 0,
    };
  }, [customerId]);

  const triggerEnrichment = useCallback(async () => {
    setEnriching(true);
    try {
      let convId = conversationId;
      if (!convId) {
        const { data: recentConv } = await supabase
          .from('conversations')
          .select('id')
          .eq('customer_id', customerId)
          .eq('workspace_id', workspaceId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();
        convId = recentConv?.id;
      }

      if (!convId) {
        setEnriching(false);
        return;
      }

      const { error } = await supabase.functions.invoke('ai-enrich-conversation', {
        body: {
          conversation_id: convId,
          customer_id: customerId,
          workspace_id: workspaceId,
        },
      });

      if (error) {
        console.error('Enrichment error:', error);
      } else {
        await loadCustomerData();
      }
    } catch (err) {
      console.error('Auto-enrichment error:', err);
    } finally {
      setEnriching(false);
    }
  }, [conversationId, customerId, loadCustomerData, workspaceId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { hasIntelligence, hasInsights } = await loadCustomerData();

      if (!hasIntelligence && !hasInsights && enrichAttemptedRef.current !== customerId) {
        enrichAttemptedRef.current = customerId;
        void triggerEnrichment();
      }
    } catch (e) {
      console.error('Error fetching intelligence:', e);
    } finally {
      setLoading(false);
    }
  }, [customerId, loadCustomerData, triggerEnrichment]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleManualRefresh = async () => {
    enrichAttemptedRef.current = null;
    setEnriching(true);
    try {
      let convId = conversationId;
      if (!convId) {
        const { data: recentConv } = await supabase
          .from('conversations')
          .select('id')
          .eq('customer_id', customerId)
          .eq('workspace_id', workspaceId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();
        convId = recentConv?.id;
      }

      if (!convId) {
        toast.info('No conversations found');
        setEnriching(false);
        return;
      }

      const { error } = await supabase.functions.invoke('ai-enrich-conversation', {
        body: {
          conversation_id: convId,
          customer_id: customerId,
          workspace_id: workspaceId,
        },
      });

      if (error) {
        toast.error('Refresh failed');
      } else {
        toast.success('Intelligence updated');
        await fetchData();
      }
    } catch (err) {
      toast.error('Refresh failed');
    } finally {
      setEnriching(false);
    }
  };

  const getSentimentLabel = (trend: string | null | undefined) => {
    switch (trend) {
      case 'positive':
        return 'Positive';
      case 'negative':
        return 'Negative';
      case 'declining':
        return 'Declining';
      default:
        return 'Neutral';
    }
  };

  const getSentimentColor = (trend: string | null | undefined) => {
    switch (trend) {
      case 'positive':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'negative':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'declining':
        return 'bg-orange-50 text-orange-700 border-orange-200';
      default:
        return 'bg-slate-50 text-slate-600 border-slate-200';
    }
  };

  const getInsightTypeColor = (type: string) => {
    switch (type) {
      case 'opportunity':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'risk':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'preference':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'behavior':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      default:
        return 'bg-slate-50 text-slate-600 border-slate-200';
    }
  };

  const getInitials = (name: string | null, email: string | null) => {
    if (name) {
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    if (email) return email[0].toUpperCase();
    return '?';
  };

  // ── Loading state: structured skeleton ──
  if (loading) {
    return (
      <div className="space-y-5 py-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-16 w-16 rounded-full bg-muted animate-pulse" />
          <div className="h-4 w-32 bg-muted rounded animate-pulse" />
          <div className="h-3 w-40 bg-muted rounded animate-pulse" />
        </div>
        <div className="space-y-2 px-2">
          <div className="h-3 w-full bg-muted rounded animate-pulse" />
          <div className="h-3 w-4/5 bg-muted rounded animate-pulse" />
        </div>
        <p className="text-xs text-center font-medium bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-500 animate-pulse">
          AI analysing customer history...
        </p>
      </div>
    );
  }

  const intelligence = customer?.intelligence as CustomerData['intelligence'];
  const hasContent = !!(intelligence?.summary || insights.length > 0);

  // ── Enriching state ──
  if (!hasContent) {
    return (
      <div className="space-y-5 py-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-16 w-16 rounded-full bg-muted animate-pulse" />
          <div className="h-4 w-32 bg-muted rounded animate-pulse" />
          <div className="h-3 w-40 bg-muted rounded animate-pulse" />
        </div>
        <div className="space-y-2 px-2">
          <div className="h-3 w-full bg-muted rounded animate-pulse" />
          <div className="h-3 w-4/5 bg-muted rounded animate-pulse" />
        </div>
        <p className="text-xs text-center font-medium bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-500 animate-pulse">
          {enriching ? 'AI analysing customer history...' : 'Building intelligence profile...'}
        </p>
      </div>
    );
  }

  // ── Loaded state: tinted glass with collapsible sections ──
  return (
    <div className="space-y-4">
      {/* Avatar + Name — primary top element */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 shadow-sm border border-slate-100/50 flex flex-col items-center text-center">
        <div className="h-16 w-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold shadow-lg mb-3">
          {getInitials(customer?.name ?? null, customer?.email ?? null)}
        </div>
        <p className="font-semibold text-foreground text-base">
          {customer?.name || 'Unknown Customer'}
        </p>
        {customer?.email && (
          <p className="text-sm text-muted-foreground mt-0.5">{customer.email}</p>
        )}
        <div className="flex flex-wrap gap-1.5 justify-center mt-2">
          {customer?.vip_status && (
            <Badge className="bg-amber-50 text-amber-700 border border-amber-200">
              <Star className="h-3 w-3 mr-1" />
              VIP
            </Badge>
          )}
          {intelligence?.lifetime_value_estimate && (
            <Badge variant="outline" className="capitalize text-xs">
              LTV: {intelligence.lifetime_value_estimate}
            </Badge>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground mt-2"
              onClick={handleManualRefresh}
              disabled={enriching}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', enriching && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Re-analyse customer</TooltipContent>
        </Tooltip>
      </div>

      {/* Tinted glass data sections */}
      <div className="bg-gradient-to-b from-indigo-50/40 to-white/80 border border-indigo-100/50 shadow-sm rounded-2xl p-5">
        {/* AI Summary */}
        {intelligence?.summary && (
          <div className="text-sm text-foreground/80 leading-relaxed mb-4 pb-3 border-b border-slate-100/80">
            {intelligence.summary}
          </div>
        )}

        {/* Communication Style — collapsible */}
        {intelligence?.communication_patterns && (
          <CollapsibleSection title="Communication Style" defaultOpen>
            <div className="flex flex-wrap gap-1.5">
              {intelligence.communication_patterns.tone && (
                <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 rounded-md text-xs font-medium">
                  <MessageSquare className="h-3 w-3" />
                  {intelligence.communication_patterns.tone}
                </span>
              )}
              {intelligence.communication_patterns.message_length && (
                <span className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 border border-purple-200 px-2 py-1 rounded-md text-xs font-medium">
                  <Hash className="h-3 w-3" />
                  {intelligence.communication_patterns.message_length} messages
                </span>
              )}
              {intelligence.communication_patterns.typical_response_time && (
                <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-md text-xs font-medium">
                  <Clock className="h-3 w-3" />
                  {intelligence.communication_patterns.typical_response_time}
                </span>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Sentiment — collapsible */}
        <CollapsibleSection title="Sentiment" defaultOpen>
          <Badge
            variant="outline"
            className={cn('text-xs border', getSentimentColor(customer?.sentiment_trend))}
          >
            {getSentimentLabel(customer?.sentiment_trend)}
          </Badge>
        </CollapsibleSection>

        {/* Topics — collapsible */}
        {customer?.topics_discussed && customer.topics_discussed.length > 0 && (
          <CollapsibleSection title="Topics">
            <div className="flex flex-wrap gap-1.5">
              {customer.topics_discussed.map((topic: string, i: number) => (
                <span
                  key={i}
                  className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-md text-xs font-medium"
                >
                  {topic}
                </span>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Insights — collapsible */}
        {insights.length > 0 && (
          <CollapsibleSection title="Insights">
            <div className="space-y-2">
              {insights.slice(0, 5).map((insight) => (
                <div
                  key={insight.id}
                  className="rounded-xl bg-white/60 border border-slate-100 p-2.5"
                >
                  <div className="flex items-start gap-2">
                    <Badge
                      className={cn(
                        'text-xs capitalize shrink-0 border',
                        getInsightTypeColor(insight.insight_type),
                      )}
                    >
                      {insight.insight_type}
                    </Badge>
                    <p className="text-sm text-muted-foreground">{insight.insight_text}</p>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}
      </div>

      {customer?.last_analyzed_at && (
        <p className="text-xs text-muted-foreground text-center">
          Last analysed: {new Date(customer.last_analyzed_at).toLocaleDateString()}
        </p>
      )}
    </div>
  );
};
