import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Send, Loader2, User, Bot, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CategoryLabel } from '@/components/shared/CategoryLabel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { sendReply } from '@/lib/api/sendReply';

interface Message {
  id: string;
  body: string;
  actor_type: string;
  actor_name?: string;
  direction: string;
  created_at: string;
}

interface ConversationDetails {
  id: string;
  workspace_id: string;
  title: string;
  ai_draft_response: string;
  email_classification?: string;
  urgency?: string;
  customer: {
    name?: string;
    email?: string;
  } | null;
}

interface DraftPreviewSheetProps {
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent?: () => void;
}

export function DraftPreviewSheet({
  conversationId,
  open,
  onOpenChange,
  onSent,
}: DraftPreviewSheetProps) {
  const { workspace } = useWorkspace();
  const [conversation, setConversation] = useState<ConversationDetails | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draftText, setDraftText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!conversationId || !open) {
      setConversation(null);
      setMessages([]);
      setDraftText('');
      return;
    }

    const fetchConversation = async () => {
      setLoading(true);
      try {
        // Fetch conversation details
        const { data: convData, error: convError } = await supabase
          .from('conversations')
          .select(
            `
            id,
            workspace_id,
            title,
            ai_draft_response,
            email_classification,
            urgency,
            customers(name, email)
          `,
          )
          .eq('id', conversationId)
          .single();

        if (convError) throw convError;

        // Fetch messages
        const { data: msgData, error: msgError } = await supabase
          .from('messages')
          .select('id, body, actor_type, actor_name, direction, created_at')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true });

        if (msgError) throw msgError;

        setConversation({
          id: convData.id,
          workspace_id: convData.workspace_id,
          title: convData.title || 'Untitled',
          ai_draft_response: convData.ai_draft_response || '',
          email_classification: convData.email_classification,
          urgency: convData.urgency,
          customer: convData.customers as { name?: string; email?: string } | null,
        });
        setMessages(msgData || []);
        setDraftText(convData.ai_draft_response || '');
      } catch (error) {
        console.error('Error fetching conversation:', error);
        toast({
          title: 'Error',
          description: 'Failed to load conversation',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchConversation();
  }, [conversationId, open]);

  const handleSend = async () => {
    if (!conversation || !draftText.trim()) return;

    setSending(true);
    try {
      await sendReply({
        conversationId: conversation.id,
        workspaceId: workspace?.id || conversation.workspace_id,
        content: draftText,
        statusAfterSend: 'resolved',
      });

      // Update conversation
      await supabase
        .from('conversations')
        .update({
          final_response: draftText,
          ai_draft_response: draftText,
          human_edited: draftText !== conversation.ai_draft_response,
        })
        .eq('id', conversation.id);

      // Mark the email as read in Gmail/Outlook
      supabase.functions
        .invoke('mark-email-read', {
          body: { conversationId: conversation.id, markAsRead: true },
        })
        .catch((err) => console.error('Failed to mark email as read:', err));

      toast({
        title: 'Message sent',
        description: 'Your response has been sent successfully',
      });

      onOpenChange(false);
      onSent?.();
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: 'Failed to send',
        description: 'Could not send your message. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="flex items-center justify-between gap-2">
            <span className="truncate">{conversation?.title || 'Loading...'}</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <CategoryLabel classification={conversation?.email_classification} size="sm" />
              {conversation?.urgency && (
                <Badge variant={conversation.urgency === 'high' ? 'destructive' : 'secondary'}>
                  {conversation.urgency}
                </Badge>
              )}
            </div>
          </SheetTitle>
          {conversation?.customer && (
            <p className="text-sm text-muted-foreground">
              {conversation.customer.name || conversation.customer.email}
            </p>
          )}
        </SheetHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Message thread */}
            <ScrollArea className="flex-1 px-6 py-4">
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn('flex gap-3', msg.direction === 'outbound' && 'flex-row-reverse')}
                  >
                    <div
                      className={cn(
                        'h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0',
                        msg.direction === 'outbound'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {msg.actor_type === 'ai' ? (
                        <Bot className="h-4 w-4" />
                      ) : (
                        <User className="h-4 w-4" />
                      )}
                    </div>
                    <div
                      className={cn(
                        'flex-1 max-w-[80%]',
                        msg.direction === 'outbound' && 'text-right',
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium">
                          {msg.actor_name || (msg.direction === 'outbound' ? 'You' : 'Customer')}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <div
                        className={cn(
                          'rounded-lg p-3 text-sm',
                          msg.direction === 'outbound'
                            ? 'bg-primary text-primary-foreground ml-auto'
                            : 'bg-muted',
                        )}
                      >
                        <p className="whitespace-pre-wrap">{msg.body}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <Separator />

            {/* Draft editor */}
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Bot className="h-4 w-4" />
                <span>AI Draft Response</span>
                {draftText !== conversation?.ai_draft_response && (
                  <Badge variant="outline" className="text-xs">
                    Edited
                  </Badge>
                )}
              </div>
              <Textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder="Edit your response..."
                className="min-h-[120px] resize-none"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSend}
                  disabled={sending || !draftText.trim()}
                  className="gap-2"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Send
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
