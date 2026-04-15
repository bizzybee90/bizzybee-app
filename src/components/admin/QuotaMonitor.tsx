import { useEffect, useState } from 'react';
import { Bot, Brain, EyeOff, Mail, RefreshCw, Shield, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ProviderBreakdown {
  provider: string;
  cost: number;
  requests: number;
  tokens: number;
  lastSeen: string | null;
}

interface PartBreakdown {
  part: string;
  provider: string;
  functionName: string;
  taskType: string;
  cost: number;
  requests: number;
  tokens: number;
  lastSeen: string | null;
}

interface RecentCostEvent {
  provider: string;
  functionName: string;
  taskType: string;
  model: string | null;
  part: string;
  cost: number;
  requests: number;
  tokens: number;
  createdAt: string | null;
  metadataSummary: string;
}

interface DeveloperCostResponse {
  success: boolean;
  viewer: string;
  totals: {
    cost24h: number;
    cost7d: number;
    requests24h: number;
    requests7d: number;
    tokens24h: number;
    tokens7d: number;
  };
  byProvider: ProviderBreakdown[];
  byPart: PartBreakdown[];
  recent: RecentCostEvent[];
}

const providerIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  claude: Brain,
  openai: Bot,
  aurinko: Mail,
  apify: Zap,
  lovable: Zap,
  runner: Shield,
  supabase: Shield,
};

function formatUsd(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function formatCount(value: number) {
  return new Intl.NumberFormat('en-GB').format(value);
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function QuotaMonitor() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DeveloperCostResponse | null>(null);
  const [accessState, setAccessState] = useState<
    'allowed' | 'developer_only' | 'not_configured' | 'error'
  >('allowed');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    void fetchInsights();
  }, []);

  const fetchInsights = async () => {
    setLoading(true);
    setMessage('');
    try {
      const { data, error } = await supabase.functions.invoke('developer-cost-insights');

      if (error) {
        const lower = (error.message || '').toLowerCase();
        if (lower.includes('developer-only')) {
          setAccessState('developer_only');
          setMessage('Cost visibility is reserved for allowlisted developer accounts.');
        } else if (lower.includes('allowlist is not configured')) {
          setAccessState('not_configured');
          setMessage('Set DEVELOPER_COST_EMAIL_ALLOWLIST in Supabase to enable this panel.');
        } else if (
          lower.includes('invalid or expired') ||
          lower.includes('missing authentication')
        ) {
          setAccessState('developer_only');
          setMessage('Sign in with an allowlisted developer account to view cost insights.');
        } else {
          setAccessState('error');
          setMessage(error.message || 'Failed to load developer cost insights.');
        }
        setData(null);
        return;
      }

      setAccessState('allowed');
      setData((data ?? null) as DeveloperCostResponse | null);
    } catch (error) {
      setAccessState('error');
      setMessage(
        error instanceof Error ? error.message : 'Failed to load developer cost insights.',
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Developer Cost Monitor</CardTitle>
            <p className="text-sm text-muted-foreground">
              Private cost visibility for developer accounts only.
            </p>
          </div>
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardHeader>
      </Card>
    );
  }

  if (accessState !== 'allowed' || !data) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Developer Cost Monitor</CardTitle>
            <p className="text-sm text-muted-foreground">
              Hidden from customer workspaces, even if they are admins.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchInsights} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted">
              <EyeOff className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="font-medium text-foreground">Developer-only visibility</p>
            <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const summaryCards = [
    {
      label: 'Last 24h cost',
      value: formatUsd(data.totals.cost24h),
      caption: `${formatCount(data.totals.requests24h)} requests`,
    },
    {
      label: 'Last 7d cost',
      value: formatUsd(data.totals.cost7d),
      caption: `${formatCount(data.totals.requests7d)} requests`,
    },
    {
      label: '24h tokens',
      value: formatCount(data.totals.tokens24h),
      caption: 'Across all tracked providers',
    },
    {
      label: 'Viewer',
      value: data.viewer,
      caption: 'Allowlisted developer account',
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-lg">Developer Cost Monitor</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cost and usage broken down by workflow part, not by customer workspace.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchInsights} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-2xl border border-border bg-muted/20 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {card.label}
              </p>
              <p className="mt-2 text-xl font-semibold text-foreground">{card.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.caption}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">Cost by provider</h3>
            <div className="grid gap-3">
              {data.byProvider.map((provider) => {
                const Icon = providerIcons[provider.provider] ?? Shield;
                return (
                  <div
                    key={provider.provider}
                    className="flex items-center justify-between rounded-2xl border border-border bg-background p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-primary/10 p-2 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium capitalize text-foreground">
                          {provider.provider}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatCount(provider.requests)} requests · {formatCount(provider.tokens)}{' '}
                          tokens
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-foreground">{formatUsd(provider.cost)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(provider.lastSeen)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">Cost by workflow part</h3>
            <div className="overflow-hidden rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="p-3 text-left font-medium text-muted-foreground">Part</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Provider</th>
                    <th className="p-3 text-right font-medium text-muted-foreground">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byPart.slice(0, 10).map((part) => (
                    <tr key={`${part.provider}-${part.part}`} className="border-t border-border/70">
                      <td className="p-3">
                        <p className="font-medium text-foreground">{part.part}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatCount(part.requests)} requests · {formatCount(part.tokens)} tokens
                        </p>
                      </td>
                      <td className="p-3 text-muted-foreground">{part.provider}</td>
                      <td className="p-3 text-right font-medium text-foreground">
                        {formatUsd(part.cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Recent billable operations</h3>
          <div className="overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="p-3 text-left font-medium text-muted-foreground">Operation</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Model</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">Cost</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((row, index) => (
                  <tr
                    key={`${row.part}-${row.createdAt}-${index}`}
                    className="border-t border-border/70"
                  >
                    <td className="p-3">
                      <p className="font-medium text-foreground">{row.part}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.provider} · {formatCount(row.requests)} requests ·{' '}
                        {formatCount(row.tokens)} tokens
                      </p>
                    </td>
                    <td className="p-3 text-muted-foreground">{row.model || '—'}</td>
                    <td className="p-3 text-right font-medium text-foreground">
                      {formatUsd(row.cost)}
                    </td>
                    <td className="p-3 text-right text-muted-foreground">
                      {formatDate(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
