import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Play, Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';

const DELETED_FUNCTIONS = new Set([
  'ai-inbox-summary',
  'backfill-classify',
  'bootstrap-sender-rules',
  'bulk-retriage',
  'business-location',
  'classification-worker',
  'classify-emails',
  'cleanup-old-data',
  'competitor-dedupe-faqs',
  'competitor-discover',
  'competitor-discover-smart',
  'competitor-discovery-start',
  'competitor-faq-generate',
  'competitor-faq-per-site',
  'competitor-hybrid-discovery',
  'competitor-places-discover',
  'competitor-refine-faqs',
  'competitor-research-watchdog',
  'competitor-scrape',
  'competitor-scrape-start',
  'competitor-search-suggest',
  'competitor-serp-discovery',
  'competitor-webhooks',
  'compute-sender-stats',
  'consolidate-faqs',
  'copy-industry-faqs',
  'customer-intelligence',
  'detect-style-drift',
  'email-classify',
  'email-classify-v2',
  'email-import',
  'extract-website-faqs',
  'force-email-sync',
  'generate-response',
  'generate-ai-summary',
  'handle-discovery-complete',
  'handle-scrape-failed',
  'hydrate-worker',
  'industry-keywords',
  'kb-discover-competitors',
  'kb-mine-site',
  'kb-start-job',
  'learn-correction',
  'learn-from-edit',
  'log-conversation',
  'pattern-detect',
  'pipeline-watchdog',
  'places-webhook',
  'process-own-website-scrape',
  'process-worker',
  'receive-apify-data',
  'recover-competitor-job',
  'refine-competitor-faqs',
  'resume-own-website-scrape',
  'save-classification-correction',
  'scan-worker',
  'send-csat-request',
  'send-scheduled-summary',
  'send-summary-notifications',
  'start-competitor-analysis',
  'start-competitor-research',
  'start-own-website-scrape',
  'start-website-scrape',
  'sync-recent-emails',
  'test-conversation',
  'test-integration',
  'validate-competitor-sites',
  'voice-learn',
  'voice-learning',
  'website-scrape',
  'competitor-extract-faqs',
  'competitor-scrape-worker',
  'bulk-retriage-conversations',
  'populate-sender-rules',
  'cleanup-duplicates',
  'email-sync',
]);

interface Trigger {
  name: string;
  function: string;
  params: { name: string; type: 'text' | 'select'; options?: string[]; default?: string }[];
  description: string;
}

interface TriggerResult {
  triggerId: string;
  status: 'running' | 'success' | 'error';
  duration?: number;
  response?: unknown;
  error?: string;
}

const TRIGGERS: Trigger[] = [
  {
    name: 'Import Emails',
    function: 'start-email-import',
    params: [
      { name: 'mode', type: 'select', options: ['onboarding', 'backfill'], default: 'onboarding' },
    ],
    description: 'Trigger email import via unified pipeline',
  },
  {
    name: 'Classify Emails',
    function: 'email-classify-v2',
    params: [],
    description: 'Run AI classification on unclassified emails',
  },
  {
    name: 'Learn Voice',
    function: 'voice-learn',
    params: [],
    description: 'Analyze sent emails for voice profile',
  },
  {
    name: 'Scrape Website',
    function: 'website-scrape',
    params: [{ name: 'website_url', type: 'text' }],
    description: 'Extract FAQs from website',
  },
  {
    name: 'Discover Competitors',
    function: 'competitor-discover',
    params: [],
    description: 'Find local competitors',
  },
  {
    name: 'Generate Insights',
    function: 'pattern-detect',
    params: [{ name: 'period_days', type: 'select', options: ['7', '14', '30'], default: '7' }],
    description: 'Generate inbox insights',
  },
  {
    name: 'Analyze Customers',
    function: 'customer-intelligence',
    params: [
      { name: 'action', type: 'select', options: ['analyze', 'refresh_all'], default: 'analyze' },
    ],
    description: 'Build customer profiles',
  },
  {
    name: 'AI Inbox Summary',
    function: 'ai-inbox-summary',
    params: [],
    description: 'Generate AI summary of inbox',
  },
  {
    name: 'Draft Verify',
    function: 'draft-verify',
    params: [{ name: 'draft_text', type: 'text' }],
    description: 'Verify AI draft for accuracy',
  },
];

export function ManualTriggers() {
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('');
  const [paramValues, setParamValues] = useState<Record<string, Record<string, string>>>({});
  const [results, setResults] = useState<Record<string, TriggerResult>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  const fetchWorkspaces = async () => {
    const { data } = await supabase.from('workspaces').select('id, name').order('name');

    setWorkspaces(data || []);
    if (data && data.length > 0) {
      setSelectedWorkspace(data[0].id);
    }
  };

  const runTrigger = async (trigger: Trigger) => {
    if (DELETED_FUNCTIONS.has(trigger.function)) {
      toast.info('This function now runs through the native automation pipeline');
      return;
    }

    const triggerId = trigger.function;

    setResults((prev) => ({
      ...prev,
      [triggerId]: { triggerId, status: 'running' },
    }));

    const startTime = Date.now();

    try {
      const params: Record<string, unknown> = {
        workspace_id: selectedWorkspace,
      };

      // Add custom params
      const customParams = paramValues[triggerId] || {};
      trigger.params.forEach((param) => {
        const value = customParams[param.name] || param.default;
        if (value) {
          params[param.name] = value;
        }
      });

      const { data, error } = await supabase.functions.invoke(trigger.function, {
        body: params,
      });

      const duration = Date.now() - startTime;

      if (error) {
        setResults((prev) => ({
          ...prev,
          [triggerId]: { triggerId, status: 'error', duration, error: error.message },
        }));
      } else {
        setResults((prev) => ({
          ...prev,
          [triggerId]: { triggerId, status: 'success', duration, response: data },
        }));
      }
    } catch (err) {
      const duration = Date.now() - startTime;
      setResults((prev) => ({
        ...prev,
        [triggerId]: { triggerId, status: 'error', duration, error: String(err) },
      }));
    }
  };

  const updateParam = (triggerId: string, paramName: string, value: string) => {
    setParamValues((prev) => ({
      ...prev,
      [triggerId]: {
        ...(prev[triggerId] || {}),
        [paramName]: value,
      },
    }));
  };

  const getStatusIcon = (result?: TriggerResult) => {
    if (!result) return null;
    switch (result.status) {
      case 'running':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Manual Function Triggers</CardTitle>
        <div className="flex items-center gap-4 mt-4">
          <div className="flex-1 max-w-xs">
            <Label htmlFor="workspace">Workspace</Label>
            <Select value={selectedWorkspace} onValueChange={setSelectedWorkspace}>
              <SelectTrigger>
                <SelectValue placeholder="Select workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name || ws.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {TRIGGERS.map((trigger) => {
            const result = results[trigger.function];
            const isRunning = result?.status === 'running';

            return (
              <Card key={trigger.function} className="bg-muted/30">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h4 className="font-medium">{trigger.name}</h4>
                      <p className="text-xs text-muted-foreground">{trigger.description}</p>
                    </div>
                    {getStatusIcon(result)}
                  </div>

                  {trigger.params.length > 0 && (
                    <div className="space-y-2 my-3">
                      {trigger.params.map((param) => (
                        <div key={param.name}>
                          <Label className="text-xs">{param.name}</Label>
                          {param.type === 'select' ? (
                            <Select
                              value={
                                paramValues[trigger.function]?.[param.name] || param.default || ''
                              }
                              onValueChange={(v) => updateParam(trigger.function, param.name, v)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {param.options?.map((opt) => (
                                  <SelectItem key={opt} value={opt}>
                                    {opt}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              className="h-8 text-xs"
                              placeholder={param.name}
                              value={paramValues[trigger.function]?.[param.name] || ''}
                              onChange={(e) =>
                                updateParam(trigger.function, param.name, e.target.value)
                              }
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    size="sm"
                    className="w-full mt-2"
                    onClick={() => runTrigger(trigger)}
                    disabled={isRunning || !selectedWorkspace}
                  >
                    {isRunning ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3 mr-1" />
                    )}
                    Run
                  </Button>

                  {result && result.status !== 'running' && (
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex items-center gap-2 text-xs">
                        <Clock className="h-3 w-3" />
                        <span>{result.duration}ms</span>
                        <Badge
                          variant={result.status === 'success' ? 'default' : 'destructive'}
                          className="text-xs"
                        >
                          {result.status}
                        </Badge>
                      </div>
                      {result.error && (
                        <p className="text-xs text-red-500 mt-1 line-clamp-2">{result.error}</p>
                      )}
                      {result.response && (
                        <ScrollArea className="h-20 mt-2">
                          <pre className="text-xs bg-background p-2 rounded overflow-x-auto">
                            {JSON.stringify(result.response, null, 2)}
                          </pre>
                        </ScrollArea>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
