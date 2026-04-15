import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataExportPanel } from '@/components/settings/DataExportPanel';
import { DataDeletionPanel } from '@/components/settings/DataDeletionPanel';
import { AuditLogPanel } from '@/components/settings/AuditLogPanel';
import { RetentionPolicyPanel } from '@/components/settings/RetentionPolicyPanel';
import { GDPRDashboard } from '@/components/settings/GDPRDashboard';
import { WorkspaceGDPRSettingsPanel } from '@/components/settings/WorkspaceGDPRSettingsPanel';
import { CustomerMergePanel } from '@/components/settings/CustomerMergePanel';
import { ChannelManagementPanel } from '@/components/settings/ChannelManagementPanel';
import { AISettingsCard } from '@/components/settings/AISettingsCard';
import { ConversationOrderingPanel } from '@/components/settings/ConversationOrderingPanel';
import { KnowledgeBasePanel } from '@/components/settings/KnowledgeBasePanel';
import { BusinessContextPanel } from '@/components/settings/BusinessContextPanel';
import { SenderRulesPanel } from '@/components/settings/SenderRulesPanel';
import { HouseRulesPanel } from '@/components/settings/HouseRulesPanel';
import { TriageLearningPanel } from '@/components/settings/TriageLearningPanel';
import { LearningSystemPanel } from '@/components/settings/LearningSystemPanel';
import { BehaviorStatsPanel } from '@/components/settings/BehaviorStatsPanel';
import { NotificationPreferencesPanel } from '@/components/settings/NotificationPreferencesPanel';
import { LowConfidenceWizard } from '@/components/settings/LowConfidenceWizard';
import { LearningAnalyticsDashboard } from '@/components/settings/LearningAnalyticsDashboard';
import { InboxLearningInsightsPanel } from '@/components/settings/InboxLearningInsightsPanel';
import { DataResetPanel } from '@/components/settings/DataResetPanel';
import { OnboardingTriggerPanel } from '@/components/settings/OnboardingTriggerPanel';
import { WorkspaceAccessPanel } from '@/components/settings/WorkspaceAccessPanel';
import { PanelNotice } from '@/components/settings/PanelNotice';
import { BillingPanel } from '@/components/settings/BillingPanel';
import { BackButton } from '@/components/shared/BackButton';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { useWorkspace } from '@/hooks/useWorkspace';
import { isPreviewModeEnabled } from '@/lib/previewMode';
import {
  Bot,
  Plug,
  Shield,
  Layout,
  Code,
  ChevronRight,
  ExternalLink,
  CreditCard,
  Star,
  Wrench,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsCategory {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  eyebrow: string;
  iconTone: string;
  accentTone: string;
  highlights: string[];
  content: React.ReactNode;
}

export default function Settings() {
  const [searchParams] = useSearchParams();
  const [openCategory, setOpenCategory] = useState<string>(
    searchParams.get('category') ?? 'workspace',
  );
  const isMobile = useIsMobile();
  const { workspace } = useWorkspace();
  const previewMode = isPreviewModeEnabled();
  const settingsModuleLinks = [
    {
      title: 'Workspace',
      description: 'Permissions, onboarding, and ownership',
      to: '/settings?category=workspace',
      icon: Users,
      tone: 'bg-bb-gold/10 text-bb-espresso',
    },
    {
      title: 'Knowledge',
      description: 'What BizzyBee knows and uses to answer',
      to: '/knowledge-base',
      icon: Star,
      tone: 'bg-emerald-100 text-emerald-700',
    },
    {
      title: 'Channels',
      description: 'Provider setup and channel readiness',
      to: '/channels',
      icon: Plug,
      tone: 'bg-blue-100 text-blue-700',
    },
    {
      title: 'Billing',
      description: 'Plans, add-ons, and the future Stripe portal',
      to: '/settings?category=billing',
      icon: CreditCard,
      tone: 'bg-emerald-100 text-emerald-700',
    },
    {
      title: 'Reviews',
      description: 'Google profile & review workflow',
      to: '/reviews',
      icon: Star,
      tone: 'bg-amber-100 text-amber-700',
    },
  ];

  useEffect(() => {
    const requestedCategory = searchParams.get('category');
    if (requestedCategory) {
      setOpenCategory(requestedCategory);
    }
  }, [searchParams]);

  const settingsCategories: SettingsCategory[] = [
    {
      id: 'workspace',
      icon: Users,
      title: 'Workspace & Access',
      description: 'Team permissions, onboarding, and core setup',
      eyebrow: 'Workspace control',
      iconTone: 'bg-bb-gold/10 text-bb-espresso',
      accentTone: 'from-bb-gold/10 to-bb-white',
      highlights: ['Roles & ownership', 'Launch readiness', 'Onboarding reset'],
      content: previewMode ? (
        <PanelNotice
          icon={Users}
          title="Workspace access is read-only in local preview"
          description="Preview mode is best for layout review and product walkthroughs. Team roles, ownership, and workspace reset should be tested on a real signed-in workspace."
          action={
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link to="/auth?preview=0">Open real sign-in</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/onboarding?reset=true&preview=1">Re-run preview onboarding</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-3">
          <SettingsSection
            title="Workspace Access"
            description="See who is in the workspace and manage roles"
            defaultOpen
          >
            <WorkspaceAccessPanel />
          </SettingsSection>
          <SettingsSection
            title="Re-run Setup Wizard"
            description="Go back through onboarding when your setup changes"
          >
            <OnboardingTriggerPanel />
          </SettingsSection>
          {workspace?.id && (
            <SettingsSection
              title="Data Reset"
              description="Reset workspace data before setting BizzyBee up again"
            >
              <DataResetPanel workspaceId={workspace.id} />
            </SettingsSection>
          )}
        </div>
      ),
    },
    {
      id: 'billing',
      icon: CreditCard,
      title: 'Billing & Plans',
      description: 'Pricing, add-ons, invoices, and portal readiness',
      eyebrow: 'Revenue setup',
      iconTone: 'bg-emerald-100 text-emerald-700',
      accentTone: 'from-emerald-100/70 to-bb-white',
      highlights: ['Current plan', 'Add-ons', 'Stripe portal readiness'],
      content: (
        <div className="space-y-3">
          <SettingsSection
            title="Billing overview"
            description="Current state and launch status"
            defaultOpen
          >
            <BillingPanel />
          </SettingsSection>
        </div>
      ),
    },
    {
      id: 'ai',
      icon: Bot,
      title: 'BizzyBee AI',
      description: 'Agent configuration, knowledge base, and learning',
      eyebrow: 'Agent control',
      iconTone: 'bg-bb-gold/10 text-bb-espresso',
      accentTone: 'from-bb-gold/10 to-bb-white',
      highlights: ['Knowledge rules', 'Inbox learning', 'Low-confidence flows'],
      content: (
        <div className="space-y-3">
          {workspace?.id && (
            <SettingsSection
              title="AI Behavior"
              description="Configure automation and confidence thresholds"
              defaultOpen
            >
              <AISettingsCard workspaceId={workspace.id} />
            </SettingsSection>
          )}
          <SettingsSection
            title="Brand Rules"
            description="Rules your AI will always follow"
            defaultOpen={false}
          >
            <HouseRulesPanel />
          </SettingsSection>
          <SettingsSection title="Knowledge Base" description="FAQs, pricing, and business facts">
            <KnowledgeBasePanel />
          </SettingsSection>
          <SettingsSection
            title="Inbox Learning Insights"
            description="What BizzyBee learned from your emails"
          >
            <InboxLearningInsightsPanel />
          </SettingsSection>
          <SettingsSection title="Learning Analytics" description="Track AI improvement over time">
            <LearningAnalyticsDashboard />
          </SettingsSection>
          <SettingsSection
            title="Low Confidence Wizard"
            description="Handle uncertain classifications"
          >
            <LowConfidenceWizard />
          </SettingsSection>
          <SettingsSection title="Learning System" description="Autonomous learning settings">
            <LearningSystemPanel />
          </SettingsSection>
          <SettingsSection title="Behavior Stats" description="Sender behavior patterns">
            <BehaviorStatsPanel />
          </SettingsSection>
          <SettingsSection title="Business Context" description="Company-specific context">
            <BusinessContextPanel />
          </SettingsSection>
          <SettingsSection title="Sender Rules" description="Rules for specific senders">
            <SenderRulesPanel />
          </SettingsSection>
          <SettingsSection title="Triage Learning" description="Learn from corrections">
            <TriageLearningPanel />
          </SettingsSection>
        </div>
      ),
    },
    {
      id: 'connections',
      icon: Plug,
      title: 'Channels & Integrations',
      description: 'Email, messaging channels, and provider setup',
      eyebrow: 'Channel readiness',
      iconTone: 'bg-blue-100 text-blue-700',
      accentTone: 'from-blue-100/70 to-bb-white',
      highlights: ['Email setup', 'Channel health', 'Reviews handoff'],
      content: (
        <div className="space-y-3">
          <SettingsSection
            title="Channel Setup"
            description="Connect email, enable messaging channels, and review provider readiness"
            defaultOpen
          >
            <ChannelManagementPanel />
          </SettingsSection>
          <SettingsSection
            title="Reviews"
            description="Google profile and review management lives in its own module"
          >
            <PanelNotice
              icon={Star}
              title="Open the dedicated Reviews module"
              description="Any legacy Google message routing stays in Channels. Public reviews, profile identity, reply workflow, alerts, and reputation analytics now belong to Reviews."
              actionLabel="Open Reviews"
              actionTo="/reviews"
            />
          </SettingsSection>
        </div>
      ),
    },
    {
      id: 'data',
      icon: Shield,
      title: 'Data & Privacy',
      description: 'GDPR compliance, exports, and retention',
      eyebrow: 'Compliance',
      iconTone: 'bg-emerald-100 text-emerald-700',
      accentTone: 'from-emerald-100/70 to-bb-white',
      highlights: ['GDPR controls', 'Retention', 'Customer self-service portal'],
      content: previewMode ? (
        <PanelNotice
          icon={Shield}
          title="Compliance controls need a real workspace"
          description="Preview mode is perfect for reviewing layout and copy, but GDPR status, retention, exports, and audit logs only make sense against real customer data."
          action={
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link to="/auth?preview=0">Sign in to test compliance</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/gdpr-portal" target="_blank">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open public GDPR portal
                </Link>
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-3">
          <SettingsSection title="GDPR Dashboard" description="Compliance overview" defaultOpen>
            <GDPRDashboard />
          </SettingsSection>
          <SettingsSection title="GDPR Settings" description="DPA and privacy configuration">
            <WorkspaceGDPRSettingsPanel />
          </SettingsSection>
          <SettingsSection
            title="Self-Service GDPR Portal"
            description="Customer-facing data rights portal"
          >
            <div className="space-y-4">
              <p className="text-[13px] text-bb-text">
                Allow your customers to request data exports or deletion directly through a
                self-service portal. Share this link with customers who want to exercise their GDPR
                rights.
              </p>
              <div className="flex items-center gap-3">
                <code className="flex-1 px-3 py-2 bg-bb-linen rounded-md text-[13px] font-mono truncate text-bb-text-secondary">
                  {window.location.origin}/gdpr-portal
                </code>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/gdpr-portal" target="_blank">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open Portal
                  </Link>
                </Button>
              </div>
            </div>
          </SettingsSection>
          <SettingsSection title="Data Export" description="Export customer data">
            <DataExportPanel />
          </SettingsSection>
          <SettingsSection title="Data Deletion" description="Handle deletion requests">
            <DataDeletionPanel />
          </SettingsSection>
          <SettingsSection title="Retention Policy" description="Data retention settings">
            <RetentionPolicyPanel />
          </SettingsSection>
          <SettingsSection title="Audit Logs" description="Data access history">
            <AuditLogPanel />
          </SettingsSection>
        </div>
      ),
    },
    {
      id: 'display',
      icon: Layout,
      title: 'Display & Behavior',
      description: 'Ordering preferences and notifications',
      eyebrow: 'Workspace experience',
      iconTone: 'bg-violet-100 text-violet-700',
      accentTone: 'from-violet-100/70 to-bb-white',
      highlights: ['Notification timing', 'Conversation ordering'],
      content: (
        <div className="space-y-3">
          <SettingsSection
            title="Conversation Ordering"
            description="Sort and prioritize conversations"
            defaultOpen
          >
            <ConversationOrderingPanel />
          </SettingsSection>
          <SettingsSection title="Notifications" description="Notification preferences">
            <NotificationPreferencesPanel />
          </SettingsSection>
        </div>
      ),
    },
    {
      id: 'developer',
      icon: Code,
      title: 'Developer Tools',
      description: 'Testing, cleanup, and diagnostics',
      eyebrow: 'Operator tools',
      iconTone: 'bg-slate-100 text-slate-700',
      accentTone: 'from-slate-100/70 to-bb-white',
      highlights: ['DevOps dashboard', 'Manual tools', 'Duplicate cleanup'],
      content: (
        <div className="space-y-3">
          {/* Admin Dashboards */}
          <SettingsSection
            title="Admin Dashboards"
            description="DevOps monitoring and testing tools"
            defaultOpen
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Card className="bg-bb-linen hover:bg-bb-cream transition-colors border-[0.5px] border-bb-border">
                <CardContent className="p-4">
                  <Link to="/admin/devops" className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-bb-gold/10">
                      <Wrench className="h-5 w-5 text-bb-gold" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-[14px] text-bb-text">DevOps Dashboard</p>
                      <p className="text-[12px] text-bb-warm-gray">
                        System health, jobs, logs & triggers
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-bb-warm-gray" />
                  </Link>
                </CardContent>
              </Card>
            </div>
          </SettingsSection>
          <SettingsSection title="Customer Merge" description="Merge duplicate customers">
            <CustomerMergePanel />
          </SettingsSection>
        </div>
      ),
    },
  ];

  const handleToggle = (categoryId: string) => {
    setOpenCategory(categoryId);
  };

  const activeCategory =
    settingsCategories.find((category) => category.id === openCategory) ?? settingsCategories[0];
  const ActiveIcon = activeCategory.icon;

  const content = (
    <div className="w-full px-4 py-4 md:px-6 md:py-6 xl:px-8">
      <div className="mb-6">
        <BackButton to="/" label="Back to Dashboard" />
        <div className="mt-2 rounded-[28px] border border-bb-border bg-bb-white px-5 py-5 shadow-[0_18px_40px_rgba(28,21,16,0.05)]">
          <div className="space-y-2">
            <Badge className="w-fit border-bb-gold/25 bg-bb-gold/10 text-bb-espresso hover:bg-bb-gold/10">
              Workspace control
            </Badge>
            <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-bb-text">Settings</h1>
            <p className="text-[13px] leading-6 text-bb-warm-gray">
              Configure the parts of BizzyBee that power your workspace. Settings should support
              first-class modules, not replace them.
            </p>
            {workspace?.name && (
              <p className="text-[12px] text-bb-text-secondary">
                Current workspace:{' '}
                <span className="font-medium text-bb-text">{workspace.name}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {settingsModuleLinks.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.title}
              to={item.to}
              className="rounded-2xl border border-bb-border bg-bb-white p-4 transition-colors hover:bg-bb-linen/60"
            >
              <div className="flex items-start justify-between gap-3">
                <div className={`rounded-xl p-2 ${item.tone}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <ChevronRight className="h-4 w-4 text-bb-warm-gray" />
              </div>
              <p className="mt-4 text-sm font-medium text-bb-text">{item.title}</p>
              <p className="mt-1 text-xs leading-5 text-bb-warm-gray">{item.description}</p>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="h-fit rounded-[28px] border-[0.5px] border-bb-border bg-bb-white p-3 shadow-[0_18px_40px_rgba(28,21,16,0.04)] xl:sticky xl:top-6">
          <div className="px-3 pb-3 pt-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-bb-warm-gray">
              Settings lanes
            </p>
            <p className="mt-2 text-sm leading-6 text-bb-text-secondary">
              Choose one area and work in a single full canvas instead of one long stack.
            </p>
          </div>
          <div className="space-y-2">
            {settingsCategories.map((category) => {
              const Icon = category.icon;
              const isActive = activeCategory.id === category.id;

              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => handleToggle(category.id)}
                  className={cn(
                    'w-full rounded-[22px] border px-4 py-4 text-left transition-all',
                    isActive
                      ? 'border-bb-gold/30 bg-bb-linen shadow-[0_14px_24px_rgba(28,21,16,0.06)]'
                      : 'border-transparent bg-transparent hover:border-bb-border hover:bg-bb-linen/50',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className={cn('rounded-xl p-2', category.iconTone)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-bb-text">{category.title}</p>
                        <p className="mt-1 text-xs leading-5 text-bb-warm-gray">
                          {category.description}
                        </p>
                      </div>
                    </div>
                    <ChevronRight
                      className={cn(
                        'mt-1 h-4 w-4 text-bb-warm-gray transition-transform',
                        isActive && 'translate-x-0.5 text-bb-espresso',
                      )}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="space-y-5">
          <Card
            className={cn(
              'rounded-[32px] border-[0.5px] border-bb-border bg-gradient-to-br p-6 shadow-[0_20px_48px_rgba(28,21,16,0.06)]',
              activeCategory.accentTone,
            )}
          >
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <Badge className="border-bb-gold/25 bg-bb-white/80 text-bb-espresso hover:bg-bb-white/80">
                  {activeCategory.eyebrow}
                </Badge>
                <div className="mt-4 flex items-start gap-3">
                  <div className={cn('rounded-2xl p-3 shadow-sm', activeCategory.iconTone)}>
                    <ActiveIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-[26px] font-semibold tracking-[-0.03em] text-bb-text">
                      {activeCategory.title}
                    </h2>
                    <p className="mt-2 text-sm leading-7 text-bb-warm-gray">
                      {activeCategory.description}
                    </p>
                    {workspace?.name && (
                      <p className="mt-3 text-xs uppercase tracking-[0.18em] text-bb-text-secondary">
                        Current workspace: <span className="text-bb-text">{workspace.name}</span>
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:max-w-[420px]">
                {activeCategory.highlights.map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-bb-border/70 bg-bb-white/70 px-4 py-3 text-sm text-bb-text"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <div className="space-y-4">{activeCategory.content}</div>
        </div>
      </div>
    </div>
  );

  if (isMobile) {
    return <MobilePageLayout>{content}</MobilePageLayout>;
  }

  return <ThreeColumnLayout sidebar={<Sidebar />} main={content} />;
}
