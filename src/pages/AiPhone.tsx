import { useState } from 'react';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { PanelNotice } from '@/components/settings/PanelNotice';
import { ModuleGateNotice, resolveModuleLockState } from '@/components/ProtectedRoute';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAiPhoneConfig } from '@/hooks/useAiPhoneConfig';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BarChart3, Settings, BookOpen } from 'lucide-react';
import { StatsBar } from '@/components/ai-phone/StatsBar';
import { CallLogTable } from '@/components/ai-phone/CallLogTable';
import { OnboardingWizard } from '@/components/ai-phone/OnboardingWizard';
import { PhoneSettingsForm } from '@/components/ai-phone/PhoneSettingsForm';
import { KnowledgeBaseEditor } from '@/components/ai-phone/KnowledgeBaseEditor';

type TabId = 'dashboard' | 'setup' | 'knowledge-base';

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 className="h-4 w-4" /> },
  { id: 'setup', label: 'Setup', icon: <Settings className="h-4 w-4" /> },
  { id: 'knowledge-base', label: 'Knowledge Base', icon: <BookOpen className="h-4 w-4" /> },
];

const AiPhone = () => {
  const { workspace, entitlements } = useWorkspace();
  const isMobile = useIsMobile();
  const { config, isLoading } = useAiPhoneConfig();
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const aiPhoneDecision = entitlements?.decisions.capabilities.aiPhone;
  const aiPhoneLockState = resolveModuleLockState({
    isAllowed: aiPhoneDecision?.isAllowed ?? (entitlements ? entitlements.canUseAiPhone : true),
    wouldBlock: aiPhoneDecision?.wouldBlock ?? false,
    workspaceId: workspace?.id ?? null,
    entitlements,
  });

  if (!workspace?.id) {
    const lockedContent = (
      <PanelNotice
        icon={Settings}
        title="Finish workspace setup first"
        description="BizzyBee needs an active workspace before the AI Phone module can provision a number, load call logs, or manage the voice knowledge base."
        actionLabel="Open onboarding"
        actionTo="/onboarding?reset=true"
      />
    );

    if (isMobile) {
      return <MobilePageLayout>{lockedContent}</MobilePageLayout>;
    }

    return <ThreeColumnLayout sidebar={<Sidebar />} main={lockedContent} />;
  }

  if (aiPhoneLockState.state === 'locked') {
    const lockedContent = (
      <ModuleGateNotice
        icon={Settings}
        moduleName="AI Phone"
        lockState={aiPhoneLockState}
        lockedTitle="AI Phone is an add-on"
        lockedDescription="AI Phone is billed as an add-on. Upgrade this workspace to unlock number provisioning, call handling, and the voice knowledge base."
        shadowDescription="AI Phone would be blocked for this workspace when hard billing enforcement is enabled."
        primaryActionLabel="Review add-ons"
        primaryActionTo="/settings?category=connections&section=provider"
        secondaryActionLabel="Back to channels"
        secondaryActionTo="/channels"
      />
    );

    if (isMobile) {
      return <MobilePageLayout>{lockedContent}</MobilePageLayout>;
    }

    return <ThreeColumnLayout sidebar={<Sidebar />} main={lockedContent} />;
  }

  const content = (
    <div className="flex flex-col h-full">
      {aiPhoneLockState.state === 'shadow-preview' ? (
        <div className="px-6 pt-5">
          <ModuleGateNotice
            icon={Settings}
            moduleName="AI Phone"
            lockState={aiPhoneLockState}
            lockedDescription=""
            shadowDescription="This workspace does not have AI Phone in its current plan. Shadow mode keeps it open for testing, but this route would lock once enforcement moves to hard mode."
            primaryActionLabel=""
            primaryActionTo="/settings"
          />
        </div>
      ) : null}

      {/* Tab bar */}
      <div className="border-b border-[0.5px] border-bb-border px-6 pt-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-medium text-bb-text">AI Phone</h1>
        </div>
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-full transition-all duration-200 ${
                activeTab === tab.id
                  ? 'bg-bb-gold text-bb-espresso'
                  : 'bg-transparent text-bb-warm-gray hover:bg-bb-cream'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <ScrollArea className="flex-1">
        <div className="p-6">
          {activeTab === 'dashboard' && (
            <>
              <StatsBar />
              <CallLogTable />
            </>
          )}
          {activeTab === 'setup' && (
            <>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-bb-gold border-t-transparent" />
                </div>
              ) : config ? (
                <PhoneSettingsForm />
              ) : (
                <OnboardingWizard />
              )}
            </>
          )}
          {activeTab === 'knowledge-base' && <KnowledgeBaseEditor />}
        </div>
      </ScrollArea>
    </div>
  );

  if (isMobile) {
    return <MobilePageLayout>{content}</MobilePageLayout>;
  }

  return <ThreeColumnLayout sidebar={<Sidebar />} main={content} />;
};

export default AiPhone;
