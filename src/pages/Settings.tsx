import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { BackButton } from '@/components/shared/BackButton';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { useWorkspace } from '@/hooks/useWorkspace';
import {
  Bot,
  Plug,
  Shield,
  Layout,
  Code,
  ChevronRight,
  ExternalLink,
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
  content: React.ReactNode;
}

export default function Settings() {
  const [searchParams] = useSearchParams();
  const [openCategory, setOpenCategory] = useState<string | null>(searchParams.get('category'));
  const isMobile = useIsMobile();
  const { workspace } = useWorkspace();
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
      content: (
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
      id: 'ai',
      icon: Bot,
      title: 'BizzyBee AI',
      description: 'Agent configuration, knowledge base, and learning',
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
      content: (
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
    setOpenCategory(openCategory === categoryId ? null : categoryId);
  };

  const content = (
    <div className="container mx-auto py-4 md:py-6 px-4 max-w-3xl">
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

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

      <div className="space-y-3">
        {settingsCategories.map((category) => {
          const Icon = category.icon;
          const isOpen = openCategory === category.id;

          return (
            <Collapsible
              key={category.id}
              open={isOpen}
              onOpenChange={() => handleToggle(category.id)}
            >
              <Card
                className={cn(
                  'transition-all duration-200 border-[0.5px] border-bb-border bg-bb-cream',
                  isOpen && 'ring-2 ring-bb-gold/20',
                )}
              >
                <CollapsibleTrigger className="w-full text-left">
                  <CardHeader className="flex flex-row items-center justify-between py-4">
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          'p-2 rounded-lg',
                          isOpen ? 'bg-bb-gold text-white' : 'bg-bb-linen text-bb-warm-gray',
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-[14px] font-medium text-bb-text">
                          {category.title}
                        </CardTitle>
                        <CardDescription className="text-[12px] text-bb-warm-gray">
                          {category.description}
                        </CardDescription>
                      </div>
                    </div>
                    <ChevronRight
                      className={cn(
                        'h-5 w-5 text-bb-warm-gray transition-transform duration-200',
                        isOpen && 'rotate-90',
                      )}
                    />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 pb-6">
                    <div className="border-t border-bb-border-light pt-4">{category.content}</div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );

  if (isMobile) {
    return <MobilePageLayout>{content}</MobilePageLayout>;
  }

  return (
    <ThreeColumnLayout
      sidebar={<Sidebar />}
      main={<ScrollArea className="h-screen">{content}</ScrollArea>}
    />
  );
}
