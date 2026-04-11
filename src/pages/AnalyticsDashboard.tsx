import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { Sidebar } from '@/components/sidebar/Sidebar';
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  MessageSquare,
  Bot,
  Clock,
  CheckCircle,
  Star,
  TrendingUp,
  MessageCircle,
  Menu,
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';
import { BackButton } from '@/components/shared/BackButton';
import { useWorkspace } from '@/hooks/useWorkspace';
import { PanelNotice } from '@/components/settings/PanelNotice';
import { ModuleGateNotice, resolveModuleLockState } from '@/components/ProtectedRoute';

type TimeRange = 'today' | '7days' | '30days';

interface AnalyticsData {
  totalConversations: number;
  aiHandled: number;
  humanHandled: number;
  escalated: number;
  avgResponseTimeSeconds: number;
  resolutionRate: number;
  avgCSAT: number | null;
  csatCount: number;
  byChannel: { name: string; value: number; color: string }[];
  volumeOverTime: { date: string; total: number; ai: number; escalated: number }[];
}

export default function AnalyticsDashboard() {
  const { workspace, loading: workspaceLoading, entitlements } = useWorkspace();
  const [timeRange, setTimeRange] = useState<TimeRange>('7days');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const analyticsDecision = entitlements?.decisions.features.analytics;
  const analyticsLockState = resolveModuleLockState({
    isAllowed:
      analyticsDecision?.isAllowed ?? (entitlements ? entitlements.features.analytics : true),
    wouldBlock: analyticsDecision?.wouldBlock ?? false,
    workspaceId: workspace?.id ?? null,
    entitlements,
  });

  const getDateRange = useCallback(() => {
    const now = new Date();
    switch (timeRange) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now), days: 1 };
      case '7days':
        return { start: startOfDay(subDays(now, 7)), end: endOfDay(now), days: 7 };
      case '30days':
        return { start: startOfDay(subDays(now, 30)), end: endOfDay(now), days: 30 };
    }
  }, [timeRange]);

  const fetchAnalytics = useCallback(async () => {
    if (workspaceLoading) {
      return;
    }

    if (analyticsLockState.state === 'locked') {
      setData(null);
      setFetchError(null);
      setLoading(false);
      return;
    }

    if (!workspace?.id) {
      setData(null);
      setFetchError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setFetchError(null);
    const { start, end, days } = getDateRange();

    try {
      // Fetch all conversations in range
      const { data: conversations, error } = await supabase
        .from('conversations')
        .select(
          'id, channel, status, is_escalated, auto_responded, human_edited, first_response_at, created_at, resolved_at, customer_satisfaction, conversation_type',
        )
        .eq('workspace_id', workspace.id)
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString());

      if (error) throw error;

      const total = conversations?.length || 0;

      // Count AI handled vs human handled vs escalated
      const aiHandled =
        conversations?.filter(
          (c) => c.conversation_type === 'ai_handled' || (c.auto_responded && !c.is_escalated),
        ).length || 0;

      const escalated = conversations?.filter((c) => c.is_escalated).length || 0;
      const humanHandled = total - aiHandled;

      // Calculate average response time
      const withResponse = conversations?.filter((c) => c.first_response_at && c.created_at) || [];
      const avgResponseTimeSeconds =
        withResponse.length > 0
          ? withResponse.reduce((acc, c) => {
              const created = new Date(c.created_at).getTime();
              const responded = new Date(c.first_response_at!).getTime();
              return acc + (responded - created) / 1000;
            }, 0) / withResponse.length
          : 0;

      // Resolution rate
      const resolved = conversations?.filter((c) => c.status === 'resolved').length || 0;
      const resolutionRate = total > 0 ? (resolved / total) * 100 : 0;

      // CSAT
      const withCSAT = conversations?.filter((c) => c.customer_satisfaction !== null) || [];
      const avgCSAT =
        withCSAT.length > 0
          ? withCSAT.reduce((acc, c) => acc + (c.customer_satisfaction || 0), 0) / withCSAT.length
          : null;

      // By channel
      const channelCounts: Record<string, number> = {};
      conversations?.forEach((c) => {
        const ch = c.channel || 'unknown';
        channelCounts[ch] = (channelCounts[ch] || 0) + 1;
      });

      const channelColors: Record<string, string> = {
        sms: '#8b5cf6',
        whatsapp: '#10b981',
        email: '#3b82f6',
        web_chat: '#a855f7',
        web: '#a855f7',
      };

      const byChannel = Object.entries(channelCounts).map(([name, value]) => ({
        name: name.replace('_', ' ').toUpperCase(),
        value,
        color: channelColors[name] || 'hsl(var(--muted))',
      }));

      // Volume over time
      const volumeMap: Record<string, { total: number; ai: number; escalated: number }> = {};

      for (let i = 0; i < days; i++) {
        const date = format(subDays(new Date(), days - 1 - i), 'MMM dd');
        volumeMap[date] = { total: 0, ai: 0, escalated: 0 };
      }

      conversations?.forEach((c) => {
        const date = format(new Date(c.created_at), 'MMM dd');
        if (volumeMap[date]) {
          volumeMap[date].total++;
          if (c.conversation_type === 'ai_handled' || (c.auto_responded && !c.is_escalated)) {
            volumeMap[date].ai++;
          }
          if (c.is_escalated) {
            volumeMap[date].escalated++;
          }
        }
      });

      const volumeOverTime = Object.entries(volumeMap).map(([date, counts]) => ({
        date,
        ...counts,
      }));

      setData({
        totalConversations: total,
        aiHandled,
        humanHandled,
        escalated,
        avgResponseTimeSeconds,
        resolutionRate,
        avgCSAT,
        csatCount: withCSAT.length,
        byChannel,
        volumeOverTime,
      });
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setFetchError('Failed to load analytics data.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [analyticsLockState.state, getDateRange, workspace?.id, workspaceLoading]);

  useEffect(() => {
    void fetchAnalytics();
  }, [fetchAnalytics]);

  const formatResponseTime = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
  };

  const handledData = data
    ? [
        { name: 'AI Handled', value: data.aiHandled, color: '#10b981' },
        { name: 'Human Handled', value: data.humanHandled - data.escalated, color: '#3b82f6' },
        { name: 'Escalated', value: data.escalated, color: '#f97316' },
      ].filter((d) => d.value > 0)
    : [];

  const containmentRate =
    data && data.totalConversations > 0
      ? ((data.aiHandled / data.totalConversations) * 100).toFixed(1)
      : '0';

  const renderLoadingContent = () => (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20 rounded-full" />
          <Skeleton className="h-9 w-20 rounded-full" />
          <Skeleton className="h-9 w-20 rounded-full" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Card
            key={index}
            className="rounded-2xl border-[0.5px] border-bb-border bg-bb-white p-6 shadow-[0_10px_24px_rgba(28,21,16,0.03)]"
          >
            <div className="space-y-3">
              <Skeleton className="h-12 w-12 rounded-2xl" />
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-3 w-28" />
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl border-[0.5px] border-bb-border bg-bb-white p-6">
          <div className="space-y-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-[250px] rounded-2xl" />
          </div>
        </Card>
        <Card className="rounded-2xl border-[0.5px] border-bb-border bg-bb-white p-6">
          <div className="space-y-4">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-[250px] rounded-2xl" />
          </div>
        </Card>
      </div>

      <Card className="rounded-2xl border-[0.5px] border-bb-border bg-bb-white p-6">
        <div className="space-y-4">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-[300px] rounded-2xl" />
        </div>
      </Card>
    </div>
  );

  if (analyticsLockState.state === 'locked') {
    const lockedContent = (
      <ModuleGateNotice
        icon={TrendingUp}
        moduleName="Analytics"
        lockState={analyticsLockState}
        lockedTitle="Analytics unlocks on Growth and above"
        lockedDescription="Analytics is available on Growth and Pro plans. Upgrade this workspace to unlock trends, containment metrics, response times, and channel performance."
        shadowDescription="Analytics would be blocked for this workspace once billing enforcement reaches hard mode."
        primaryActionLabel="Review plan"
        primaryActionTo="/settings"
        secondaryActionLabel="Back to inbox"
        secondaryActionTo="/"
      />
    );

    if (isMobile) {
      return (
        <>
          <div className="flex h-screen w-full bg-bb-linen overflow-hidden flex-col">
            <header className="flex-shrink-0 h-14 border-b border-bb-border bg-bb-white px-4 flex items-center justify-between">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(true)}
                className="h-9 w-9"
              >
                <Menu className="h-5 w-5" />
              </Button>
              <h1 className="text-lg font-medium text-bb-text truncate">Analytics</h1>
              <div className="w-9" />
            </header>
            <main className="flex-1 overflow-y-auto p-4">{lockedContent}</main>
          </div>
          <MobileSidebarSheet
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            onNavigate={() => setSidebarOpen(false)}
          />
        </>
      );
    }

    return (
      <div className="flex h-screen w-full bg-bb-linen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">{lockedContent}</main>
      </div>
    );
  }

  if (isMobile) {
    return (
      <>
        <div className="flex h-screen w-full bg-bb-linen overflow-hidden flex-col">
          <header className="flex-shrink-0 h-14 border-b border-bb-border bg-bb-white px-4 flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              className="h-9 w-9"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-medium text-bb-text truncate">Analytics</h1>
            <div className="w-9" />
          </header>
          <main className="flex-1 overflow-y-auto p-4">{renderContent()}</main>
        </div>
        <MobileSidebarSheet
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          onNavigate={() => setSidebarOpen(false)}
        />
      </>
    );
  }

  return (
    <div className="flex h-screen w-full bg-bb-linen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">{renderContent()}</main>
    </div>
  );

  function renderContent() {
    return (
      <div className="space-y-6">
        {analyticsLockState.state === 'shadow-preview' ? (
          <ModuleGateNotice
            icon={TrendingUp}
            moduleName="Analytics"
            lockState={analyticsLockState}
            lockedDescription=""
            shadowDescription="This workspace is currently outside the Analytics plan tier. Shadow mode keeps this module visible for testing, but it would lock under hard enforcement."
            primaryActionLabel=""
            primaryActionTo="/settings"
          />
        ) : null}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <BackButton to="/" label="Back to Dashboard" />
            <h1 className="text-[18px] font-medium text-bb-text mt-2">Analytics Dashboard</h1>
            <p className="text-bb-warm-gray">AI performance and conversation insights</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={timeRange === 'today' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTimeRange('today')}
            >
              Today
            </Button>
            <Button
              variant={timeRange === '7days' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTimeRange('7days')}
            >
              7 Days
            </Button>
            <Button
              variant={timeRange === '30days' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTimeRange('30days')}
            >
              30 Days
            </Button>
          </div>
        </div>

        {loading ? (
          renderLoadingContent()
        ) : !workspace?.id ? (
          <PanelNotice
            icon={TrendingUp}
            title="Analytics will appear after setup"
            description="Finish onboarding and start bringing conversations into BizzyBee. Once the workspace is connected, this page will show volume, containment, response time, and channel mix."
            actionLabel="Open onboarding"
            actionTo="/onboarding?reset=true"
          />
        ) : fetchError ? (
          <PanelNotice
            icon={TrendingUp}
            title="Analytics couldn't load right now"
            description="BizzyBee hit a temporary issue while pulling conversation metrics. Try again once the workspace is ready."
            action={<Button onClick={() => void fetchAnalytics()}>Retry</Button>}
          />
        ) : data ? (
          <>
            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="bg-bb-cream border-[0.5px] border-bb-border rounded-lg p-6">
                <div className="bg-blue-100 text-blue-600 rounded-2xl w-12 h-12 flex items-center justify-center">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <p className="text-[20px] font-medium tracking-tight text-bb-text mt-2">
                  {data.totalConversations}
                </p>
                <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray mt-1">
                  Total Conversations
                </p>
              </div>

              <div className="bg-bb-cream border-[0.5px] border-bb-border rounded-lg p-6">
                <div className="bg-emerald-100 text-emerald-600 rounded-2xl w-12 h-12 flex items-center justify-center">
                  <Bot className="h-5 w-5" />
                </div>
                <p className="text-[20px] font-medium tracking-tight text-bb-text mt-2">
                  {containmentRate}%
                </p>
                <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray mt-1">
                  AI Containment
                </p>
                <p className="text-xs text-bb-muted">
                  {data.aiHandled} of {data.totalConversations}
                </p>
              </div>

              <div className="bg-bb-cream border-[0.5px] border-bb-border rounded-lg p-6">
                <div className="bg-amber-100 text-amber-600 rounded-2xl w-12 h-12 flex items-center justify-center">
                  <Clock className="h-5 w-5" />
                </div>
                <p className="text-[20px] font-medium tracking-tight text-bb-text mt-2">
                  {formatResponseTime(data.avgResponseTimeSeconds)}
                </p>
                <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray mt-1">
                  Avg Response Time
                </p>
              </div>

              <div className="bg-bb-cream border-[0.5px] border-bb-border rounded-lg p-6">
                <div className="bg-purple-100 text-purple-600 rounded-2xl w-12 h-12 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5" />
                </div>
                <p className="text-[20px] font-medium tracking-tight text-bb-text mt-2">
                  {data.resolutionRate.toFixed(1)}%
                </p>
                <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray mt-1">
                  Resolution Rate
                </p>
              </div>

              <div className="bg-bb-cream border-[0.5px] border-bb-border rounded-lg p-6">
                <div className="bg-blue-100 text-blue-600 rounded-2xl w-12 h-12 flex items-center justify-center">
                  <Star className="h-5 w-5" />
                </div>
                <p className="text-[20px] font-medium tracking-tight text-bb-text mt-2">
                  {data.avgCSAT ? `${data.avgCSAT.toFixed(1)}` : 'N/A'}
                </p>
                <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray mt-1">
                  Avg CSAT
                </p>
                <p className="text-xs text-bb-muted">{data.csatCount} ratings</p>
              </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* AI vs Human Pie Chart */}
              <div className="bg-bb-white rounded-lg border-[0.5px] border-bb-border p-6">
                <h3 className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray flex items-center gap-2 mb-4">
                  <Bot className="h-5 w-5 text-bb-warm-gray" />
                  AI vs Human Handled
                </h3>
                {handledData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={handledData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {handledData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[250px] flex items-center justify-center text-bb-muted">
                    No data available
                  </div>
                )}
              </div>

              {/* By Channel Pie Chart */}
              <div className="bg-bb-white rounded-lg border-[0.5px] border-bb-border p-6">
                <h3 className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray flex items-center gap-2 mb-4">
                  <MessageCircle className="h-5 w-5 text-bb-warm-gray" />
                  Conversations by Channel
                </h3>
                {data.byChannel.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={data.byChannel}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {data.byChannel.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[250px] flex items-center justify-center text-bb-muted">
                    No data available
                  </div>
                )}
              </div>
            </div>

            {/* Volume Over Time Line Chart */}
            <div className="bg-bb-white rounded-lg border-[0.5px] border-bb-border p-6">
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray flex items-center gap-2 mb-4">
                <TrendingUp className="h-5 w-5 text-bb-warm-gray" />
                Conversation Volume Over Time
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.volumeOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" />
                  <XAxis dataKey="date" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    name="Total"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="ai"
                    stroke="#10b981"
                    strokeWidth={2}
                    name="AI Handled"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="escalated"
                    stroke="#f97316"
                    strokeWidth={2}
                    name="Escalated"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Escalation Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-bb-cream border-[0.5px] border-bb-border rounded-lg p-6">
                <div className="text-center">
                  <p className="text-[20px] font-medium tracking-tight text-bb-text">
                    {data.aiHandled}
                  </p>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray mt-1">
                    AI Handled
                  </p>
                  <p className="text-xs text-bb-muted">Fully automated responses</p>
                </div>
              </div>
              <div className="bg-bb-cream border-[0.5px] border-bb-border rounded-lg p-6">
                <div className="text-center">
                  <p className="text-[20px] font-medium tracking-tight text-bb-text">
                    {data.escalated}
                  </p>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray mt-1">
                    Escalated
                  </p>
                  <p className="text-xs text-bb-muted">Required human review</p>
                </div>
              </div>
              <div className="bg-bb-cream border-[0.5px] border-bb-border rounded-lg p-6">
                <div className="text-center">
                  <p className="text-[20px] font-medium tracking-tight text-bb-text">
                    {data.humanHandled - data.escalated}
                  </p>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray mt-1">
                    Human Handled
                  </p>
                  <p className="text-xs text-bb-muted">Agent responses</p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <PanelNotice
            icon={TrendingUp}
            title="No analytics yet"
            description="Connect a channel and let BizzyBee process a few conversations. Once traffic starts moving, this page will fill with response time, containment, and volume trends."
            actionLabel="Open channels"
            actionTo="/channels"
          />
        )}
      </div>
    );
  }
}
