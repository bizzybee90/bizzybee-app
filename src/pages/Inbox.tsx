import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { InboxSidebar } from '@/components/inbox/InboxSidebar';
import { EmailList } from '@/components/inbox/EmailList';
import { ReadingPane } from '@/components/inbox/ReadingPane';
import { useInboxCounts, type InboxEmail } from '@/hooks/useInboxEmails';
import { useIsMobile } from '@/hooks/use-mobile';
import { type InboxFolder } from '@/lib/emailDirection';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const Inbox = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  
  const initialFolder = (searchParams.get('folder') as InboxFolder) || 'inbox';
  const [folder, setFolder] = useState<InboxFolder>(initialFolder);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<InboxEmail | null>(null);
  const { data: counts } = useInboxCounts();

  // Escape to deselect
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedEmail(null);
      // 'e' to mark handled
      if (e.key === 'e' && selectedEmail && !(e.target instanceof HTMLInputElement)) {
        // Handled by QuickActionsBar
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedEmail]);

  // Mobile: show reading pane full-screen when email selected
  if (isMobile) {
    if (selectedEmail) {
      return (
        <div className="h-screen flex flex-col bg-background">
          <ReadingPane
            selectedEmailId={selectedEmail.id}
            onBack={() => setSelectedEmail(null)}
          />
        </div>
      );
    }
    return (
      <div className="h-screen flex flex-col bg-background">
        <EmailList
          folder={folder}
          categoryFilter={categoryFilter}
          selectedEmailId={null}
          onSelectEmail={setSelectedEmail}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      {/* Stats Bar — glassmorphic */}
      <div className="absolute top-0 left-0 right-0 h-12 glass-header flex items-center px-4 gap-4 text-[13px] z-10" style={{ color: 'var(--text-secondary)' }}>
        <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-[13px]" style={{ color: 'var(--accent-primary)' }} onClick={() => navigate('/')}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <span className="font-semibold text-[17px]" style={{ color: 'var(--text-primary)' }}>Inbox</span>
        <div className="flex-1" />
        <span><strong style={{ color: 'var(--text-primary)' }}>{counts?.inbox?.toLocaleString() || 0}</strong> in inbox</span>
        <span style={{ color: 'var(--separator)' }}>·</span>
        <span><strong style={{ color: 'var(--text-primary)' }}>{counts?.needsReply?.toLocaleString() || 0}</strong> need reply</span>
        <span style={{ color: 'var(--separator)' }}>·</span>
        <span><strong style={{ color: 'var(--text-primary)' }}>{counts?.unread?.toLocaleString() || 0}</strong> unread</span>
      </div>

      {/* Main Layout below stats bar */}
      <div className="flex w-full h-full pt-12">
        <InboxSidebar
          activeFolder={folder}
          onFolderChange={setFolder}
          activeCategoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
        />
        <EmailList
          folder={folder}
          categoryFilter={categoryFilter}
          selectedEmailId={selectedEmail?.id || null}
          onSelectEmail={setSelectedEmail}
        />
        <ReadingPane selectedEmailId={selectedEmail?.id || null} />
      </div>
    </div>
  );
};

export default Inbox;
