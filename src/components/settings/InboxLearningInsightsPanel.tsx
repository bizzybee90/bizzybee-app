import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Brain, 
  Mail, 
  MessageSquare, 
  TrendingUp,
  Clock,
  BarChart3,
  Sparkles,
  User,
  Building2
} from 'lucide-react';

interface InboxInsights {
  id: string;
  total_emails_analyzed: number;
  total_outbound_analyzed: number;
  emails_by_category: Record<string, number>;
  emails_by_sender_domain: Record<string, number>;
  common_inquiry_types: unknown;
  avg_response_time_hours: number | null;
  response_rate_percent: number | null;
  peak_email_hours: unknown;
  patterns_learned: number;
  analyzed_at: string;
}

interface LearnedResponse {
  id: string;
  email_category: string;
  trigger_phrases: string[];
  response_pattern: string;
  times_used: number;
}

interface VoiceProfile {
  tone_descriptors: string[];
  formality_score: number;
  avg_message_length: number;
  common_phrases: string[];
}

function getSenderDomain(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  return email.split('@')[1]?.toLowerCase() || null;
}

export function InboxLearningInsightsPanel() {
  const { workspace } = useWorkspace();
  const [insights, setInsights] = useState<InboxInsights | null>(null);
  const [learnedResponses, setLearnedResponses] = useState<LearnedResponse[]>([]);
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!workspace?.id) return;

      try {
        const [conversationsRes, resolvedRes, rulesRes, contextRes] = await Promise.all([
          supabase
            .from('conversations')
            .select(
              `
              id,
              created_at,
              email_classification,
              customer:customers(email)
            `,
            )
            .eq('workspace_id', workspace.id)
            .not('email_classification', 'is', null),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .eq('status', 'resolved'),
          supabase
            .from('sender_rules')
            .select('id, sender_pattern, default_classification, hit_count, created_at')
            .eq('workspace_id', workspace.id)
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(10),
          supabase
            .from('business_context')
            .select('custom_flags')
            .eq('workspace_id', workspace.id)
            .maybeSingle(),
        ]);

        const conversations = conversationsRes.data || [];
        const senderRules = rulesRes.data || [];
        const emailsByCategory: Record<string, number> = {};
        const emailsBySenderDomain: Record<string, number> = {};

        conversations.forEach((conversation) => {
          const classification = conversation.email_classification || 'other';
          const customerJoin =
            Array.isArray(conversation.customer) ? conversation.customer[0] : conversation.customer;
          const senderDomain = getSenderDomain(customerJoin?.email);

          emailsByCategory[classification] = (emailsByCategory[classification] || 0) + 1;
          if (senderDomain) {
            emailsBySenderDomain[senderDomain] = (emailsBySenderDomain[senderDomain] || 0) + 1;
          }
        });

        if (conversations.length > 0 || senderRules.length > 0) {
          const latestConversation = [...conversations]
            .map((conversation) => conversation.created_at)
            .filter(Boolean)
            .sort()
            .at(-1);

          setInsights({
            id: 'derived-inbox-insights',
            total_emails_analyzed: conversations.length,
            total_outbound_analyzed: resolvedRes.count || 0,
            emails_by_category: emailsByCategory,
            emails_by_sender_domain: emailsBySenderDomain,
            common_inquiry_types: [],
            avg_response_time_hours: null,
            response_rate_percent: null,
            peak_email_hours: [],
            patterns_learned: senderRules.length,
            analyzed_at: latestConversation || new Date().toISOString(),
          });
        }

        setLearnedResponses(
          senderRules.map((rule) => ({
            id: rule.id,
            email_category: rule.default_classification || 'General',
            trigger_phrases: [rule.sender_pattern],
            response_pattern: `Messages matching ${rule.sender_pattern} are routed as ${rule.default_classification || 'general'}.`,
            times_used: rule.hit_count || 0,
          })),
        );

        // Extract voice profile from business context custom_flags
        if (contextRes.data?.custom_flags) {
          const flags = contextRes.data.custom_flags as Record<string, unknown>;
          if (flags.voice_profile) {
            setVoiceProfile(flags.voice_profile as VoiceProfile);
          }
        }
      } catch (error) {
        console.error('Error fetching learning insights:', error);
        setInsights(null);
        setLearnedResponses([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [workspace?.id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!insights) {
    return (
      <Card className="p-6 text-center">
        <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
        <h3 className="font-medium mb-2">No Learning Data Yet</h3>
        <p className="text-sm text-muted-foreground">
          Connect your email and complete the onboarding to analyze your inbox patterns.
        </p>
      </Card>
    );
  }

  const topCategories = Object.entries(insights.emails_by_category || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  const topDomains = Object.entries(insights.emails_by_sender_domain || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const formatCategory = (str: string) => {
    return str.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getToneLabel = (descriptors: string[] | undefined) => {
    if (!descriptors || descriptors.length === 0) return 'Professional';
    return descriptors.slice(0, 3).map(d => 
      d.charAt(0).toUpperCase() + d.slice(1)
    ).join(' • ');
  };

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3 text-center">
          <Mail className="h-4 w-4 text-primary mx-auto mb-1" />
          <div className="text-xl font-bold">{insights.total_emails_analyzed.toLocaleString()}</div>
          <p className="text-xs text-muted-foreground">Emails Analyzed</p>
        </Card>
        <Card className="p-3 text-center">
          <MessageSquare className="h-4 w-4 text-green-600 mx-auto mb-1" />
          <div className="text-xl font-bold">{insights.total_outbound_analyzed.toLocaleString()}</div>
          <p className="text-xs text-muted-foreground">Responses Studied</p>
        </Card>
        <Card className="p-3 text-center">
          <Sparkles className="h-4 w-4 text-purple-600 mx-auto mb-1" />
          <div className="text-xl font-bold">{insights.patterns_learned}</div>
          <p className="text-xs text-muted-foreground">Patterns Learned</p>
        </Card>
        <Card className="p-3 text-center">
          <Clock className="h-4 w-4 text-amber-600 mx-auto mb-1" />
          <div className="text-xl font-bold">
            {insights.avg_response_time_hours 
              ? `${Math.round(insights.avg_response_time_hours)}h` 
              : '—'}
          </div>
          <p className="text-xs text-muted-foreground">Avg Response Time</p>
        </Card>
      </div>

      {/* Voice Profile */}
      {voiceProfile && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <User className="h-4 w-4 text-primary" />
            <h3 className="font-medium">Your Communication Style</h3>
          </div>
          <div className="bg-primary/5 rounded-lg p-3">
            <p className="font-medium text-primary mb-2">
              {getToneLabel(voiceProfile.tone_descriptors)}
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">
                Formality: {Math.round(voiceProfile.formality_score * 100)}%
              </Badge>
              <Badge variant="outline">
                Avg length: {voiceProfile.avg_message_length} words
              </Badge>
            </div>
            {voiceProfile.common_phrases && voiceProfile.common_phrases.length > 0 && (
              <div className="mt-3 pt-3 border-t border-primary/10">
                <p className="text-xs text-muted-foreground mb-1">Common phrases you use:</p>
                <div className="flex flex-wrap gap-1">
                  {voiceProfile.common_phrases.slice(0, 4).map((phrase, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      "{phrase}"
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Email Categories */}
      {topCategories.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="font-medium">Email Categories</h3>
          </div>
          <div className="space-y-2">
            {topCategories.map(([category, count]) => {
              const percentage = Math.round((count / insights.total_emails_analyzed) * 100);
              return (
                <div key={category} className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="flex justify-between text-sm mb-1">
                      <span>{formatCategory(category)}</span>
                      <span className="text-muted-foreground">{count.toLocaleString()} ({percentage}%)</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Top Sender Domains */}
      {topDomains.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="h-4 w-4 text-primary" />
            <h3 className="font-medium">Top Sender Domains</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {topDomains.map(([domain, count]) => (
              <Badge key={domain} variant="outline" className="text-xs">
                {domain} ({count})
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {/* Learned Response Patterns */}
      {learnedResponses.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="font-medium">Learned Response Patterns</h3>
          </div>
          <div className="space-y-3">
            {learnedResponses.map((response) => (
              <div 
                key={response.id}
                className="p-3 bg-muted/30 rounded-lg"
              >
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="secondary" className="text-xs">
                    {formatCategory(response.email_category || 'General')}
                  </Badge>
                  {response.times_used > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Used {response.times_used}x
                    </span>
                  )}
                </div>
                {response.trigger_phrases && response.trigger_phrases.length > 0 && (
                  <p className="text-xs text-muted-foreground mb-1">
                    Triggers: {response.trigger_phrases.slice(0, 3).join(', ')}
                  </p>
                )}
                <p className="text-sm line-clamp-2">
                  {response.response_pattern}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Last Analyzed */}
      <p className="text-xs text-muted-foreground text-center">
        Last analyzed: {new Date(insights.analyzed_at).toLocaleDateString()} at{' '}
        {new Date(insights.analyzed_at).toLocaleTimeString()}
      </p>
    </div>
  );
}
