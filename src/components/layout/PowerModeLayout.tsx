import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { JaceStyleInbox } from '@/components/conversations/JaceStyleInbox';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { Conversation } from '@/lib/types';
import { X, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileHeader } from '@/components/sidebar/MobileHeader';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';
import { supabase } from '@/integrations/supabase/client';
import { BackButton } from '@/components/shared/BackButton';
import { SearchInput } from '@/components/conversations/SearchInput';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';

interface PowerModeLayoutProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'awaiting-reply' | 'completed' | 'sent' | 'high-priority' | 'vip-customers' | 'escalations' | 'triaged' | 'needs-me' | 'snoozed' | 'cleared' | 'fyi' | 'unread' | 'drafts-ready';
  channelFilter?: string;
}

const getFilterTitle = (filter: string) => {
  switch (filter) {
    case 'needs-me': return 'Needs Action';
    case 'all-open': return 'Inbox';
    case 'cleared': return 'Cleared';
    case 'snoozed': return 'Snoozed';
    case 'sent': return 'Sent';
    case 'unread': return 'Unread';
    case 'drafts-ready': return 'Drafts';
    case 'fyi': return 'FYI';
    default: return 'Inbox';
  }
};

export const PowerModeLayout = ({ filter = 'all-open', channelFilter }: PowerModeLayoutProps) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();

  // Clear selected conversation when filter changes (folder navigation)
  useEffect(() => {
    setSelectedConversation(null);
    setCustomerPanelOpen(false);
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('conversation');
    setSearchParams(newParams, { replace: true });
  }, [filter, channelFilter]);

  // Handle conversation query parameter to auto-select
  useEffect(() => {
    const conversationId = searchParams.get('conversation');
    if (conversationId && !selectedConversation) {
      const fetchConversation = async () => {
        const { data } = await supabase
          .from('conversations')
          .select('*, customer:customers(*), assigned_user:users!conversations_assigned_to_fkey(*)')
          .eq('id', conversationId)
          .single();
        
        if (data) {
          setSelectedConversation(data as Conversation);
        }
      };
      fetchConversation();
    }
  }, [searchParams, selectedConversation]);

  const handleUpdate = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleSelectConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    const newParams = new URLSearchParams(searchParams);
    newParams.set('conversation', conversation.id);
    setSearchParams(newParams, { replace: true });
  };

  const handleBack = () => {
    setSelectedConversation(null);
    setCustomerPanelOpen(false);
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('conversation');
    setSearchParams(newParams, { replace: true });
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['jace-inbox'] });
  };

  // Mobile layout — unchanged
  if (isMobile) {
    return (
      <div className="flex h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
        <MobileHeader onMenuClick={() => setSidebarOpen(true)} />
        <MobileSidebarSheet open={sidebarOpen} onOpenChange={setSidebarOpen} />

        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedConversation ? (
            <div className="flex-1 flex overflow-hidden gap-4 p-4">
              <main className="flex-1 bg-card overflow-hidden flex flex-col" style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
                <JaceStyleInbox
                  filter={filter}
                  selectedId={selectedConversation?.id}
                  onSelect={handleSelectConversation}
                />
              </main>
            </div>
          ) : (
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 bg-white overflow-hidden flex flex-col relative">
                <ConversationThread
                  key={refreshKey}
                  conversation={selectedConversation}
                  onUpdate={handleUpdate}
                  onBack={handleBack}
                  hideBackButton={false}
                />
              </div>
            </div>
          )}
        </div>

        {/* Customer Info Overlay Drawer */}
        {customerPanelOpen && selectedConversation && (
          <>
            <div 
              className="fixed inset-0 bg-black/20 z-40 transition-opacity"
              onClick={() => setCustomerPanelOpen(false)}
            />
            <div className="fixed top-0 right-0 h-full w-[380px] max-w-[90vw] z-50 bg-card shadow-2xl border-l border-border/50 flex flex-col animate-in slide-in-from-right duration-300">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <span className="text-sm font-medium text-muted-foreground">Customer Info</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCustomerPanelOpen(false)}
                  className="h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                <CustomerContext conversation={selectedConversation} onUpdate={handleUpdate} />
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // Desktop layout — matches Review.tsx pattern
  return (
    <div className="flex h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar — glassmorphic */}
        <div className="px-6 py-2.5 flex-shrink-0 flex items-center justify-between glass-header">
          <div className="flex items-center gap-3">
            <BackButton to="/" label="Home" />
            <h1 className="text-base font-semibold">{getFilterTitle(filter)}</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-64">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search conversations..."
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              className="h-8 w-8 p-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Content area */}
        {!selectedConversation ? (
          <div className="flex-1 flex overflow-hidden gap-4 p-4">
            <main className="w-[350px] min-w-[350px] flex-shrink-0 overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
              <JaceStyleInbox
                filter={filter}
                selectedId={selectedConversation?.id}
                onSelect={handleSelectConversation}
                hideHeader
              />
            </main>
            {/* Empty state right pane */}
            <div className="flex-1 bg-card overflow-hidden flex flex-col relative items-center justify-center" style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
              <div className="text-center">
                <p className="text-[17px] font-semibold" style={{ color: 'var(--text-primary)' }}>Select a conversation</p>
                <p className="text-[15px] mt-1" style={{ color: 'var(--text-secondary)' }}>Choose from the list to get started</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden gap-4 p-4">
            {/* Middle Pane (Message List Column) */}
            <div className="w-[350px] min-w-[350px] flex-shrink-0 overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
              <JaceStyleInbox
                filter={filter}
                selectedId={selectedConversation?.id}
                onSelect={handleSelectConversation}
                hideHeader
              />
            </div>

            {/* Right Pane (Reading/Preview Column) */}
            <div className="flex-1 bg-card overflow-hidden flex flex-col relative" style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
              <ConversationThread
                key={refreshKey}
                conversation={selectedConversation}
                onUpdate={handleUpdate}
                onBack={handleBack}
                hideBackButton={false}
              />
            </div>
          </div>
        )}
      </div>

      {/* Customer Info Overlay Drawer */}
      {customerPanelOpen && selectedConversation && (
        <>
          <div 
            className="fixed inset-0 bg-black/20 z-40 transition-opacity"
            onClick={() => setCustomerPanelOpen(false)}
          />
          <div className="fixed top-0 right-0 h-full w-[380px] max-w-[90vw] z-50 bg-card shadow-2xl border-l border-border/50 flex flex-col animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <span className="text-sm font-medium text-muted-foreground">Customer Info</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCustomerPanelOpen(false)}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <CustomerContext conversation={selectedConversation} onUpdate={handleUpdate} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
