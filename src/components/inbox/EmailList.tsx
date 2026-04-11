import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmailListItem } from './EmailListItem';
import { useInboxEmails, type InboxEmail } from '@/hooks/useInboxEmails';
import type { InboxFolder } from '@/lib/emailDirection';

interface EmailListProps {
  folder: InboxFolder;
  categoryFilter: string | null;
  selectedEmailId: string | null;
  onSelectEmail: (email: InboxEmail) => void;
}

export const EmailList = ({
  folder,
  categoryFilter,
  selectedEmailId,
  onSelectEmail,
}: EmailListProps) => {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page on filter change
  useEffect(() => {
    setPage(0);
  }, [folder, categoryFilter, debouncedSearch]);

  const { data, isLoading } = useInboxEmails({
    folder,
    categoryFilter,
    search: debouncedSearch,
    page,
  });
  const emails = useMemo(() => data?.emails ?? [], [data?.emails]);
  const total = data?.total || 0;
  const hasMore = (page + 1) * 50 < total;

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      const currentIdx = emails.findIndex((em) => em.id === selectedEmailId);
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = currentIdx < emails.length - 1 ? currentIdx + 1 : 0;
        if (emails[next]) onSelectEmail(emails[next]);
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = currentIdx > 0 ? currentIdx - 1 : emails.length - 1;
        if (emails[prev]) onSelectEmail(emails[prev]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [emails, selectedEmailId, onSelectEmail]);

  return (
    <div className="w-[350px] flex-shrink-0 border-r border-border flex flex-col h-full bg-card">
      {/* Search */}
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Search emails... (press /)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm bg-background"
          />
        </div>
        <div className="text-[11px] text-muted-foreground mt-1 px-1">
          {total.toLocaleString()} {total === 1 ? 'email' : 'emails'}
        </div>
      </div>

      {/* Email List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-3 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : emails.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-medium text-foreground">No messages match these filters</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try a different folder, clear the search, or wait for new mail to arrive.
            </p>
          </div>
        ) : (
          <>
            {emails.map((email) => (
              <EmailListItem
                key={email.id}
                email={email}
                isSelected={email.id === selectedEmailId}
                onClick={() => onSelectEmail(email)}
              />
            ))}
            {hasMore && (
              <div className="p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => setPage((p) => p + 1)}
                >
                  Load more ({total - (page + 1) * 50} remaining)
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
