import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { PanelNotice } from '@/components/settings/PanelNotice';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAiPhoneConfig } from '@/hooks/useAiPhoneConfig';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
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

  if (entitlements && !entitlements.canUseAiPhone) {
    const lockedContent = (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-lg rounded-3xl border border-bb-border bg-bb-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-medium text-bb-text">AI Phone is an add-on</h1>
          <p className="mt-3 text-sm text-bb-warm-gray">
            This workspace does not have the AI Phone add-on enabled yet. Once it is active,
            BizzyBee will unlock phone provisioning, call handling, and the voice knowledge base
            here.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild>
              <Link to="/settings?category=connections&section=provider">Review add-ons</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/channels">Back to channels</Link>
            </Button>
          </div>
        </div>
      </div>
    );

    if (isMobile) {
      return <MobilePageLayout>{lockedContent}</MobilePageLayout>;
    }

    return <ThreeColumnLayout sidebar={<Sidebar />} main={lockedContent} />;
  }

  const content = (
    <div className="flex flex-col h-full">
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
