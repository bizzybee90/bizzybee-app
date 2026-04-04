import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Loader2, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { DraftVerificationBadge } from './DraftVerificationBadge';
import { useWorkspace } from '@/hooks/useWorkspace';
import { sendReply } from '@/lib/api/sendReply';

interface DraftReplyEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  conversationTitle: string;
  customerEmail: string;
  aiDraft: string;
  workspaceId?: string;
  onSent?: () => void;
}

export function DraftReplyEditor({
  open,
  onOpenChange,
  conversationId,
  conversationTitle,
  customerEmail,
  aiDraft,
  workspaceId,
  onSent,
}: DraftReplyEditorProps) {
  const [draft, setDraft] = useState(aiDraft);
  const [verificationStatus, setVerificationStatus] = useState<
    'pending' | 'passed' | 'failed' | 'needs_review' | null
  >(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { workspace } = useWorkspace();

  // Reset draft when opened
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setDraft(aiDraft);
      setVerificationStatus(null);
    }
    onOpenChange(isOpen);
  };

  const sendMutation = useMutation({
    mutationFn: async () => {
      const activeWorkspaceId = workspaceId || workspace?.id;
      if (!activeWorkspaceId) {
        throw new Error('Workspace is required to send this reply.');
      }

      // Call edge function to send response
      await sendReply({
        conversationId,
        workspaceId: activeWorkspaceId,
        content: draft,
        statusAfterSend: 'resolved',
      });

      // Update conversation status
      const { error: updateError } = await supabase
        .from('conversations')
        .update({
          final_response: draft,
          needs_review: false,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', conversationId);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      toast({
        title: 'Reply sent',
        description: 'Your email has been sent successfully.',
      });
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      onOpenChange(false);
      onSent?.();
    },
    onError: (error) => {
      toast({
        title: 'Failed to send',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-2xl w-full flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Edit & Send Reply
            {workspaceId && (
              <DraftVerificationBadge
                conversationId={conversationId}
                workspaceId={workspaceId}
                draft={draft}
                verificationStatus={verificationStatus}
                onUseCorrectedDraft={(corrected) => setDraft(corrected)}
                onVerificationComplete={(result) => {
                  setVerificationStatus(
                    result.status as 'pending' | 'passed' | 'failed' | 'needs_review',
                  );
                }}
              />
            )}
          </SheetTitle>
          <SheetDescription>
            <span className="font-medium">To:</span> {customerEmail}
            <br />
            <span className="font-medium">Re:</span> {conversationTitle}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 mt-4">
          <Textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              // Reset verification when draft changes
              if (verificationStatus) setVerificationStatus(null);
            }}
            placeholder="Write your reply..."
            className="min-h-[300px] resize-none"
          />
        </div>

        <SheetFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sendMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={sendMutation.isPending || !draft.trim()}
            className="bg-green-600 hover:bg-green-700"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send Reply
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
