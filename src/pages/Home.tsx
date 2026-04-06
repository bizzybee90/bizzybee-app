import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNavigate } from 'react-router-dom';
import {
  Mail,
  Flame,
  CheckCircle2,
  Clock,
  Sparkles,
  Activity,
  FileEdit,
  Users,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { DraftMessages } from '@/components/dashboard/DraftMessages';
import { HumanAIActivityLog } from '@/components/dashboard/HumanAIActivityLog';
import { LearningInsightsWidget } from '@/components/dashboard/LearningInsightsWidget';
import { InsightsWidget } from '@/components/dashboard/InsightsWidget';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { isPreviewModeEnabled } from '@/lib/previewMode';

interface HomeStats {
  clearedToday: number;
  toReplyCount: number;
  atRiskCount: number;
  reviewCount: number;
  draftCount: number;
  lastHandled: Date | null;
}

export const Home = () => {
  const { workspace, needsOnboarding } = useWorkspace();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const previewOnboardingPath = isPreviewModeEnabled() ? '/onboarding?preview=1' : '/onboarding';
  const [stats, setStats] = useState<HomeStats>({
    clearedToday: 0,
    toReplyCount: 0,
    atRiskCount: 0,
    reviewCount: 0,
    draftCount: 0,
    lastHandled: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      if (!workspace?.id || workspace.id === 'preview-workspace' || needsOnboarding) {
        setLoading(false);
        setStats({
          clearedToday: 0,
          toReplyCount: 0,
          atRiskCount: 0,
          reviewCount: 0,
          draftCount: 0,
          lastHandled: null,
        });
        return;
      }

      try {
        setLoading(true);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [
          clearedResult,
          toReplyResult,
          atRiskResult,
          reviewResult,
          draftResult,
          lastHandledResult,
        ] = await Promise.all([
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .or('decision_bucket.eq.auto_handled,status.eq.resolved')
            .gte('updated_at', today.toISOString()),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .eq('requires_reply', true)
            .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated'])
            .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .eq('decision_bucket', 'act_now')
            .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated']),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .eq('training_reviewed', false)
            .not('email_classification', 'is', null),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .not('ai_draft_response', 'is', null)
            .is('final_response', null)
            .in('status', ['new', 'open', 'ai_handling'])
            .in('decision_bucket', ['quick_win', 'act_now'])
            .eq('requires_reply', true),
          supabase
            .from('conversations')
            .select('auto_handled_at')
            .eq('workspace_id', workspace.id)
            .eq('decision_bucket', 'auto_handled')
            .order('auto_handled_at', { ascending: false })
            .limit(1),
        ]);

        setStats({
          clearedToday: clearedResult.count || 0,
          toReplyCount: toReplyResult.count || 0,
          atRiskCount: atRiskResult.count || 0,
          reviewCount: reviewResult.count || 0,
          draftCount: draftResult.count || 0,
          lastHandled: lastHandledResult.data?.[0]?.auto_handled_at
            ? new Date(lastHandledResult.data[0].auto_handled_at)
            : null,
        });
      } catch (error) {
        console.error('Error fetching home stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();

    const channel = supabase
      .channel('home-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `workspace_id=eq.${workspace?.id}`,
        },
        () => {
          fetchStats();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [needsOnboarding, workspace?.id]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  // Metric card config — all identical card styling, colour only in icons
  const metrics = [
    {
      label: 'Urgent',
      count: stats.atRiskCount,
      icon: Flame,
      iconColor: 'var(--bb-danger)',
      onClick: () => navigate('/needs-action?filter=at-risk'),
    },
    {
      label: 'To reply',
      count: stats.toReplyCount,
      icon: Mail,
      iconColor: 'var(--bb-text-secondary)',
      onClick: () => navigate('/needs-action?filter=needs-action'),
    },
    {
      label: 'Drafts',
      count: stats.draftCount,
      icon: FileEdit,
      iconColor: 'var(--bb-gold)',
      onClick: () => navigate('/needs-action?filter=drafts'),
    },
    {
      label: 'Training',
      count: stats.reviewCount,
      icon: Sparkles,
      iconColor: 'var(--bb-success)',
      onClick: () => navigate('/review'),
    },
  ];

  const mainContent = (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="mx-auto min-h-full max-w-[1120px] space-y-6 bg-bb-linen p-4 md:p-6">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-28 rounded-2xl" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-32 rounded-2xl" />
            </div>
          </div>
        ) : (
          <>
            {(!workspace?.id || needsOnboarding) && (
              <div className="rounded-[24px] border border-bb-border bg-bb-cream p-6 shadow-[0_10px_24px_rgba(28,21,16,0.04)]">
                <p className="text-[18px] font-medium text-bb-text">
                  Finish onboarding to unlock BizzyBee
                </p>
                <p className="mt-2 max-w-xl text-[13px] text-bb-text-secondary">
                  BizzyBee is live, but this account still needs onboarding before inbox data,
                  training, and channels can load correctly.
                </p>
                <div className="mt-4">
                  <Button onClick={() => navigate(previewOnboardingPath)}>
                    Continue onboarding
                  </Button>
                </div>
              </div>
            )}

            {/* ── Greeting ── */}
            <div className="mb-2">
              <h1 className="text-[18px] font-medium tracking-[-0.022em] text-bb-text">
                {getGreeting()}
              </h1>
              <p className="text-[13px] mt-1 text-bb-text-secondary">
                {stats.atRiskCount > 0
                  ? `You have ${stats.atRiskCount} urgent item${stats.atRiskCount !== 1 ? 's' : ''} that need attention.`
                  : stats.toReplyCount > 0
                    ? `${stats.toReplyCount} conversation${stats.toReplyCount !== 1 ? 's' : ''} waiting for your reply.`
                    : 'Nothing needs your attention right now.'}
              </p>
            </div>

            {/* ── Stat Cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {metrics.map((m) => {
                const Icon = m.icon;
                return (
                  <div
                    key={m.label}
                    onClick={m.onClick}
                    className="bg-bb-cream cursor-pointer transition-all duration-200 p-5 hover:shadow-md hover:-translate-y-0.5 rounded-2xl border-[0.5px] border-bb-border"
                  >
                    <Icon className="h-5 w-5" style={{ color: m.iconColor }} />
                    <p className="text-[20px] font-medium tracking-tight mt-3 mb-1 text-bb-text">
                      {m.count}
                    </p>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray">
                      {m.label}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* ── All caught up ── */}
            {!needsOnboarding &&
              stats.toReplyCount === 0 &&
              stats.reviewCount === 0 &&
              stats.atRiskCount === 0 && (
                <div className="flex flex-col items-center justify-center h-[60vh] text-center">
                  <Sparkles className="w-8 h-8 mb-4 text-bb-muted" />
                  <h3 className="text-[15px] font-medium text-bb-text">You're all caught up</h3>
                  <p className="text-[13px] mt-1 max-w-sm mx-auto text-bb-text-secondary">
                    BizzyBee is actively monitoring your inbox.
                  </p>
                </div>
              )}

            {/* ── Widget Grid ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Pending Drafts */}
              <div className="bg-bb-cream p-5 flex flex-col rounded-2xl border-[0.5px] border-bb-border">
                <div className="flex items-center gap-2 mb-4">
                  <h2 className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray">
                    Pending Drafts
                  </h2>
                </div>
                <div className="flex-1">
                  <DraftMessages onNavigate={handleNavigate} maxItems={4} />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-3 text-bb-text-secondary"
                  onClick={() => navigate('/needs-action?filter=drafts')}
                >
                  View all drafts
                </Button>
              </div>

              {/* Recent Activity */}
              <div className="bg-bb-cream p-5 flex flex-col rounded-2xl border-[0.5px] border-bb-border">
                <div className="flex items-center gap-2 mb-4">
                  <h2 className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray">
                    Recent Activity
                  </h2>
                </div>
                <div className="flex-1">
                  <ActivityFeed onNavigate={handleNavigate} maxItems={6} />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-3 text-bb-text-secondary"
                  onClick={() => navigate('/activity')}
                >
                  View all activity
                </Button>
              </div>

              {/* Right Column */}
              <div className="space-y-6">
                {workspace?.id && <InsightsWidget workspaceId={workspace.id} />}
                <LearningInsightsWidget />
              </div>
            </div>

            {/* System Status Footer */}
            <div className="flex items-center justify-center gap-2 text-[11px] pt-4 text-bb-muted">
              <CheckCircle2 className="h-3 w-3 text-bb-success" />
              <span>System active</span>
              <span>·</span>
              <Clock className="h-3 w-3" />
              <span>Checking every minute</span>
            </div>
          </>
        )}
      </div>
    </ScrollArea>
  );

  if (isMobile) {
    return <MobilePageLayout>{mainContent}</MobilePageLayout>;
  }

  return <ThreeColumnLayout sidebar={<Sidebar />} main={mainContent} />;
};

export default Home;
