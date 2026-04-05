import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { IntegrationsPanel } from '@/components/settings/IntegrationsPanel';
import { EmailSettingsPanel } from '@/components/settings/EmailSettingsPanel';
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
import { BackButton } from '@/components/shared/BackButton';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { useWorkspace } from '@/hooks/useWorkspace';
import { Bot, Plug, Shield, Layout, Code, ChevronRight, ExternalLink, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsCategory {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  content: React.ReactNode;
}

export default function Settings() {
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { workspace } = useWorkspace();

  const settingsCategories: SettingsCategory[] = [
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
      title: 'Connections',
      description: 'Email accounts, channels, and integrations',
      content: (
        <div className="space-y-3">
          <SettingsSection
            title="Email Settings"
            description="Connected email accounts"
            defaultOpen
          >
            <EmailSettingsPanel />
          </SettingsSection>
          <SettingsSection title="Channels" description="Manage communication channels">
            <ChannelManagementPanel />
          </SettingsSection>
          <SettingsSection title="Integrations" description="Third-party connections">
            <IntegrationsPanel />
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

          {workspace?.id && (
            <SettingsSection title="Re-run Setup Wizard" description="Start onboarding again">
              <OnboardingTriggerPanel workspaceId={workspace.id} />
            </SettingsSection>
          )}

          {workspace?.id && (
            <SettingsSection title="Data Reset" description="Reset data and re-onboard">
              <DataResetPanel workspaceId={workspace.id} />
            </SettingsSection>
          )}
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
        <h1 className="text-[18px] font-medium text-bb-text mt-2">Settings</h1>
        <p className="text-[12px] text-bb-warm-gray mt-1">
          Manage your workspace configuration and preferences.
        </p>
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
