import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { logger } from '@/lib/logger';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/hooks/useWorkspace';
import {
  Brain,
  ArrowRight,
  Zap,
  Loader2,
  TrendingUp,
  RefreshCw,
  Mail,
  CheckCircle,
  RotateCcw,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';

interface CorrectionGroup {
  sender_domain: string;
  original_classification: string;
  new_classification: string;
  count: number;
}

interface SuggestedRule {
  senderDomain: string;
  totalEmails: number;
  replyRate: number;
  suggestedBucket: string;
  suggestedClassification: string;
  requiresReply: boolean;
  confidence: number;
}

interface RetriagedResult {
  id: string;
  title: string;
  originalBucket: string;
  newBucket: string;
  originalClassification: string;
  newClassification: string;
  originalConfidence: number;
  newConfidence: number;
}

export function TriageLearningPanel() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { workspace } = useWorkspace();
  const [corrections, setCorrections] = useState<CorrectionGroup[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [creatingRule, setCreatingRule] = useState<string | null>(null);

  // Bulk re-triage state
  const [isRetriaging, setIsRetriaging] = useState(false);
  const [retriageResults, setRetriageResults] = useState<RetriagedResult[]>([]);
  const [lowConfidenceCount, setLowConfidenceCount] = useState<number>(0);
  const [totalConversationCount, setTotalConversationCount] = useState<number>(0);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.85);
  const [retriageLimit, setRetriageLimit] = useState(100);
  const [retriageAll, setRetriageAll] = useState(false);

  const fetchLowConfidenceCount = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user?.id)
        .single();

      if (!userData?.workspace_id) return;

      // Count low confidence conversations
      const { count: lowCount } = await supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', userData.workspace_id)
        .or(`triage_confidence.lt.${confidenceThreshold},triage_confidence.is.null`);

      // Count total conversations
      const { count: totalCount } = await supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', userData.workspace_id);

      setLowConfidenceCount(lowCount || 0);
      setTotalConversationCount(totalCount || 0);
    } catch (error) {
      logger.error('Error fetching low confidence count', error);
    }
  }, [confidenceThreshold]);

  const runBulkRetriage = async () => {
    setIsRetriaging(true);
    setRetriageResults([]);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user?.id)
        .single();

      if (!userData?.workspace_id) return;

      // bulk-retriage-conversations edge function has been removed
      toast({
        title: 'Moved to automation pipeline',
        description: 'Bulk re-triage now runs through the native automation pipeline.',
      });
    } catch (error) {
      logger.error('Error running bulk re-triage', error);
      toast({
        title: 'Re-triage failed',
        variant: 'destructive',
      });
    } finally {
      setIsRetriaging(false);
    }
  };

  const fetchCorrections = useCallback(async () => {
    try {
      if (!workspace?.id) {
        setCorrections([]);
        return;
      }

      // Derive repeat reclassification patterns from reviewed conversations.
      const { data, error } = await supabase
        .from('conversations')
        .select(
          `
          id,
          email_classification,
          customer:customers(email)
        `,
        )
        .eq('workspace_id', workspace.id)
        .eq('review_outcome', 'changed')
        .not('reviewed_at', 'is', null)
        .not('email_classification', 'is', null)
        .limit(150);

      if (error) throw error;

      // Group and count
      const grouped: Record<string, CorrectionGroup> = {};
      (data || []).forEach((c) => {
        const customerJoin = Array.isArray(c.customer) ? c.customer[0] : c.customer;
        const senderEmail = customerJoin?.email || null;
        const senderDomain = senderEmail?.split('@')[1] || null;

        if (!senderDomain || !c.email_classification) {
          return;
        }

        const key = `${senderDomain}|${c.email_classification}`;
        if (!grouped[key]) {
          grouped[key] = {
            sender_domain: senderDomain,
            original_classification: 'manual_review',
            new_classification: c.email_classification,
            count: 0,
          };
        }
        grouped[key].count++;
      });

      // Sort by count descending
      const sorted = Object.values(grouped)
        .filter((g) => g.count >= 2) // Only show patterns with 2+ corrections
        .sort((a, b) => b.count - a.count);

      setCorrections(sorted);
    } catch (error) {
      logger.error('Error fetching corrections', error);
      setCorrections([]);
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  const fetchSuggestions = useCallback(async () => {
    setLoadingSuggestions(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user?.id)
        .single();

      if (!userData?.workspace_id) return;

      // bootstrap-sender-rules edge function has been removed
      toast({
        title: 'Moved to automation pipeline',
        description: 'Sender rule bootstrapping now runs through the native automation pipeline.',
      });
      setSuggestions([]);
    } catch (error) {
      logger.error('Error fetching suggestions', error);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchCorrections();
    void fetchSuggestions();
    void fetchLowConfidenceCount();
  }, [fetchCorrections, fetchLowConfidenceCount, fetchSuggestions]);

  const createRuleFromSuggestion = async (suggestion: SuggestedRule) => {
    setCreatingRule(suggestion.senderDomain);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user?.id)
        .single();

      // Check if rule already exists
      const { data: existingRule } = await supabase
        .from('sender_rules')
        .select('id')
        .eq('sender_pattern', `@${suggestion.senderDomain}`)
        .single();

      if (existingRule) {
        toast({
          title: 'Rule already exists',
          description: `A rule for @${suggestion.senderDomain} already exists`,
        });
        return;
      }

      const { error } = await supabase.from('sender_rules').insert({
        workspace_id: userData?.workspace_id,
        sender_pattern: `@${suggestion.senderDomain}`,
        default_classification: suggestion.suggestedClassification,
        default_requires_reply: suggestion.requiresReply,
        is_active: true,
      });

      if (error) throw error;

      toast({
        title: 'Rule created',
        description: `Emails from @${suggestion.senderDomain} will now be classified as ${suggestion.suggestedClassification.replace('_', ' ')}`,
      });

      setSuggestions(suggestions.filter((s) => s.senderDomain !== suggestion.senderDomain));
    } catch (error) {
      logger.error('Error creating rule', error);
      toast({
        title: 'Failed to create rule',
        variant: 'destructive',
      });
    } finally {
      setCreatingRule(null);
    }
  };

  const createRuleFromPattern = async (pattern: CorrectionGroup) => {
    setCreatingRule(pattern.sender_domain);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user?.id)
        .single();

      // Check if rule already exists
      const { data: existingRule } = await supabase
        .from('sender_rules')
        .select('id')
        .eq('sender_pattern', `@${pattern.sender_domain}`)
        .single();

      if (existingRule) {
        toast({
          title: 'Rule already exists',
          description: `A rule for @${pattern.sender_domain} already exists`,
        });
        return;
      }

      // Determine if it requires reply based on the correction pattern
      const requiresReply = pattern.new_classification === 'customer_inquiry';

      const { error } = await supabase.from('sender_rules').insert({
        workspace_id: userData?.workspace_id,
        sender_pattern: `@${pattern.sender_domain}`,
        default_classification: pattern.new_classification,
        default_requires_reply: requiresReply,
        is_active: true,
      });

      if (error) throw error;

      toast({
        title: 'Rule created',
        description: `Emails from @${pattern.sender_domain} will now be classified as ${pattern.new_classification}`,
      });

      // Remove from list
      setCorrections(corrections.filter((c) => c.sender_domain !== pattern.sender_domain));
    } catch (error) {
      logger.error('Error creating rule', error);
      toast({
        title: 'Failed to create rule',
        variant: 'destructive',
      });
    } finally {
      setCreatingRule(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const getBucketColor = (bucket: string) => {
    switch (bucket) {
      case 'auto_handled':
        return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'quick_win':
        return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
      case 'act_now':
        return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      {/* Bulk Re-Triage Section - Prominent at top */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-primary" />
                Re-Triage All Conversations
              </CardTitle>
              <CardDescription>
                Re-run the improved AI triage on existing conversations to fix classifications.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Re-triage ALL toggle */}
          <div className="flex items-center justify-between p-4 bg-primary/10 rounded-lg border border-primary/20">
            <div className="space-y-1">
              <Label className="text-base font-medium">Re-triage ALL conversations</Label>
              <p className="text-sm text-muted-foreground">
                Apply the new misdirected fix to every email ({totalConversationCount} total)
              </p>
            </div>
            <Switch checked={retriageAll} onCheckedChange={setRetriageAll} />
          </div>

          {!retriageAll && lowConfidenceCount > 0 && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
              <span className="text-sm text-amber-700 dark:text-amber-300">
                <span className="font-semibold">{lowConfidenceCount}</span> conversations have low
                confidence (below {Math.round(confidenceThreshold * 100)}%) and could benefit from
                re-triaging.
              </span>
            </div>
          )}

          {!retriageAll && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">
                  Confidence Threshold: {Math.round(confidenceThreshold * 100)}%
                </Label>
                <Slider
                  value={[confidenceThreshold * 100]}
                  onValueChange={(value) => {
                    setConfidenceThreshold(value[0] / 100);
                    fetchLowConfidenceCount();
                  }}
                  max={100}
                  min={50}
                  step={5}
                  className="py-2"
                />
                <p className="text-xs text-muted-foreground">
                  Only conversations below this confidence will be re-triaged
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Batch Size: {retriageLimit}</Label>
                <Slider
                  value={[retriageLimit]}
                  onValueChange={(value) => setRetriageLimit(value[0])}
                  max={500}
                  min={10}
                  step={10}
                  className="py-2"
                />
                <p className="text-xs text-muted-foreground">
                  Number of conversations to process at once
                </p>
              </div>
            </div>
          )}

          {retriageAll && (
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                Batch Size: {retriageLimit} (of {totalConversationCount} total)
              </Label>
              <Slider
                value={[retriageLimit]}
                onValueChange={(value) => setRetriageLimit(value[0])}
                max={500}
                min={10}
                step={10}
                className="py-2"
              />
              <p className="text-xs text-muted-foreground">
                You may need to run multiple batches to process all conversations
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={runBulkRetriage}
              disabled={isRetriaging}
              className="min-w-[160px]"
              variant={retriageAll ? 'default' : 'secondary'}
            >
              {isRetriaging ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Re-triaging...
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  {retriageAll
                    ? `Re-Triage All (${Math.min(retriageLimit, totalConversationCount)})`
                    : 'Re-Triage Now'}
                </>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              {retriageAll
                ? 'All conversations will be re-classified with the improved logic'
                : 'This will update classifications using the improved AI logic'}
            </span>
          </div>

          {retriageResults.length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                Re-Triage Results
              </h4>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {retriageResults.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                  >
                    <span className="truncate flex-1 mr-4">{r.title}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-xs">
                        {r.originalClassification?.replace(/_/g, ' ')}
                      </Badge>
                      <ArrowRight className="h-3 w-3" />
                      <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">
                        {r.newClassification?.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      {/* Historical Behavior Suggestions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Suggested Rules from Inbox Patterns
              </CardTitle>
              <CardDescription>
                Based on your historical email patterns, these senders could be automated.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchSuggestions}
              disabled={loadingSuggestions}
            >
              {loadingSuggestions ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingSuggestions ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No suggestions yet. Once you have more email history, patterns will appear here.
            </p>
          ) : (
            <div className="space-y-3">
              {suggestions.slice(0, 10).map((suggestion) => (
                <div
                  key={suggestion.senderDomain}
                  className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                      <p className="font-mono text-sm truncate">@{suggestion.senderDomain}</p>
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <span className="font-medium">{suggestion.totalEmails}</span> emails
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <span className="font-medium">
                          {Math.round(suggestion.replyRate * 100)}%
                        </span>{' '}
                        reply rate
                      </span>
                      <span>•</span>
                      <Badge
                        variant="outline"
                        className={`text-xs ${getBucketColor(suggestion.suggestedBucket)}`}
                      >
                        {suggestion.suggestedBucket.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-muted-foreground">Confidence:</span>
                      <Progress value={suggestion.confidence * 100} className="h-1.5 w-20" />
                      <span className="text-xs text-muted-foreground">
                        {Math.round(suggestion.confidence * 100)}%
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => createRuleFromSuggestion(suggestion)}
                    disabled={creatingRule === suggestion.senderDomain}
                    className="ml-4 shrink-0"
                  >
                    {creatingRule === suggestion.senderDomain ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Accept
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Correction-Based Suggestions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Learning from Corrections
          </CardTitle>
          <CardDescription>
            Based on reviewed reclassifications, BizzyBee has identified sender patterns that could
            become rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {corrections.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No patterns detected yet. Keep correcting misclassified emails and suggestions will
              appear here.
            </p>
          ) : (
            <div className="space-y-3">
              {corrections.map((pattern) => (
                <div
                  key={`${pattern.sender_domain}-${pattern.new_classification}`}
                  className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-mono text-sm">@{pattern.sender_domain}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-xs">
                          {pattern.original_classification.replace('_', ' ')}
                        </Badge>
                        <ArrowRight className="h-3 w-3" />
                        <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">
                          {pattern.new_classification.replace('_', ' ')}
                        </Badge>
                        <span className="ml-2">({pattern.count} corrections)</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => createRuleFromPattern(pattern)}
                    disabled={creatingRule === pattern.sender_domain}
                  >
                    {creatingRule === pattern.sender_domain ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Zap className="h-4 w-4 mr-1" />
                        Create Rule
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
