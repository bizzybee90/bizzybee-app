import { format } from 'date-fns';
import { Mail, ArrowLeft, Reply, Forward, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { getCategoryInfo, isOutbound } from '@/lib/emailDirection';
import {
  useEmailDetail,
  useEmailThread,
  useFetchEmailBody,
  type InboxEmail,
} from '@/hooks/useInboxEmails';
import { useWorkspace } from '@/hooks/useWorkspace';
import { QuickActionsBar } from './QuickActionsBar';
import DOMPurify from 'dompurify';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface ReadingPaneProps {
  selectedEmailId: string | null;
  onBack?: () => void;
}

const sanitizeHtml = (html: string): string => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'table',
      'tr',
      'td',
      'th',
      'tbody',
      'thead',
      'div',
      'span',
      'img',
      'a',
      'b',
      'i',
      'strong',
      'em',
      'br',
      'p',
      'hr',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'font',
      'center',
      'u',
      's',
      'small',
      'style',
    ],
    ALLOWED_ATTR: [
      'style',
      'class',
      'href',
      'src',
      'alt',
      'width',
      'height',
      'align',
      'valign',
      'bgcolor',
      'color',
      'target',
    ],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
  });
};

const EmailBody = ({ email, fetchedHtml }: { email: InboxEmail; fetchedHtml?: string | null }) => {
  const html = fetchedHtml || email.body_html;

  if (html) {
    const sanitized = sanitizeHtml(html);
    const styledHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #1a1a1a; background: #fff; padding: 16px; margin: 0; max-width: 100%; overflow-x: hidden; }
      img { max-width: 100%; height: auto; }
      a { color: #2563eb; }
      table { max-width: 100%; }
    </style></head><body>${sanitized}</body></html>`;

    return (
      <iframe
        srcDoc={styledHtml}
        sandbox="allow-same-origin"
        className="w-full border-0 bg-white rounded h-full"
        title="Email content"
      />
    );
  }

  return (
    <div className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed p-4">
      {email.body || '(No content)'}
    </div>
  );
};

const ThreadEmail = ({
  email,
  isExpanded,
  fetchedHtml,
}: {
  email: InboxEmail;
  isExpanded: boolean;
  fetchedHtml?: string | null;
}) => {
  const [open, setOpen] = useState(isExpanded);
  const outbound = isOutbound(email.from_email);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            'w-full text-left px-4 py-3 border-b border-border/50 transition-colors',
            outbound ? 'bg-primary/5' : 'bg-card',
            'hover:bg-accent/30',
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground truncate">
              {email.from_name || email.from_email}
            </span>
            <span className="text-xs text-muted-foreground">
              {email.received_at ? format(new Date(email.received_at), 'd MMM, HH:mm') : ''}
            </span>
          </div>
          {!open && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {(email.body || '').slice(0, 100)}
            </p>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(outbound ? 'bg-primary/5' : 'bg-card')}>
        <EmailBody email={email} fetchedHtml={fetchedHtml} />
      </CollapsibleContent>
    </Collapsible>
  );
};

export const ReadingPane = ({ selectedEmailId, onBack }: ReadingPaneProps) => {
  const { workspace } = useWorkspace();
  const { data: email, isLoading } = useEmailDetail(selectedEmailId);
  const { data: threadEmails } = useEmailThread(email?.thread_id ?? null);
  const { fetchBody } = useFetchEmailBody();
  const queryClient = useQueryClient();
  const hasThread = (threadEmails?.length ?? 0) > 1;

  // On-demand HTML body fetching
  const [fetchingBody, setFetchingBody] = useState(false);
  const [fetchedHtml, setFetchedHtml] = useState<string | null>(null);

  // Reset fetched html when email changes
  useEffect(() => {
    setFetchedHtml(null);
  }, [selectedEmailId]);

  // Auto-fetch HTML body if not available
  useEffect(() => {
    if (!email || email.body_html || fetchedHtml || fetchingBody) return;

    setFetchingBody(true);
    fetchBody(email.id)
      .then((html) => {
        if (html) {
          setFetchedHtml(html);
          // Update the cache so it persists
          queryClient.invalidateQueries({ queryKey: ['inbox-email-detail', email.id] });
        }
      })
      .catch((err) => {
        console.error('Failed to fetch email body:', err);
      })
      .finally(() => setFetchingBody(false));
  }, [email, fetchedHtml, fetchingBody, fetchBody, queryClient]);

  if (!selectedEmailId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Mail className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm">Select an email to read</p>
          <p className="text-xs mt-1">
            Use <kbd className="px-1 py-0.5 bg-muted rounded text-[10px] font-mono">j</kbd> /{' '}
            <kbd className="px-1 py-0.5 bg-muted rounded text-[10px] font-mono">k</kbd> to navigate
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !email) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const catInfo = getCategoryInfo(email.category);

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="p-4 border-b border-border space-y-2 flex-shrink-0">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 -ml-2 mb-1">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        )}
        <h2 className="text-lg font-semibold text-foreground leading-tight">
          {email.subject || '(no subject)'}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {email.from_name || email.from_email}
            </span>
            {email.from_name && <span className="ml-1">&lt;{email.from_email}&gt;</span>}
          </span>
          <span className="text-xs text-muted-foreground">→</span>
          <span className="text-xs text-muted-foreground">{email.to_emails?.join(', ')}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">
            {email.received_at ? format(new Date(email.received_at), 'EEE, d MMM yyyy, HH:mm') : ''}
          </span>
          {email.category && (
            <Badge
              variant="outline"
              className={cn('text-[10px] px-1.5 py-0', catInfo.bg, catInfo.text)}
            >
              {catInfo.label}
            </Badge>
          )}
          {email.confidence != null && (
            <span
              className={cn(
                'text-[10px] font-medium',
                email.confidence >= 0.9
                  ? 'text-emerald-600'
                  : email.confidence >= 0.7
                    ? 'text-amber-600'
                    : 'text-red-500',
              )}
            >
              {Math.round(email.confidence * 100)}%
            </span>
          )}
          {email.requires_reply && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
              Needs Reply
            </Badge>
          )}
        </div>
      </div>

      {/* Loading indicator for HTML body fetch */}
      {fetchingBody && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading full email...
        </div>
      )}

      {/* Body / Thread */}
      <div className="flex-1 overflow-y-auto">
        {hasThread ? (
          <div>
            {threadEmails?.map((te, i) => (
              <ThreadEmail
                key={te.id}
                email={te}
                isExpanded={i === threadEmails.length - 1}
                fetchedHtml={te.id === email.id ? fetchedHtml : undefined}
              />
            ))}
          </div>
        ) : (
          <EmailBody email={email} fetchedHtml={fetchedHtml} />
        )}
      </div>

      {/* Quick Actions */}
      {workspace?.id && <QuickActionsBar emailId={email.id} workspaceId={workspace.id} />}

      {/* Universal Reply Pill */}
      <div className="sticky bottom-4 mx-4 mt-auto pt-4 z-20">
        <button className="w-full bg-white/90 backdrop-blur-md border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.08)] rounded-full py-3.5 px-5 text-slate-500 text-left hover:border-purple-300 transition-all font-medium flex items-center group">
          <Reply className="w-4 h-4 mr-3 text-purple-400 group-hover:text-purple-600 transition-colors" />
          Reply manually...
        </button>
      </div>
    </div>
  );
};
