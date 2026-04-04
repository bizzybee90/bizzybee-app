import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Send, Paperclip, X, Sparkles, Trash2, Reply, Minimize2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useIsTablet } from '@/hooks/use-tablet';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

interface ReplyAreaProps {
  conversationId: string;
  channel: string;
  aiDraftResponse?: string;
  onSend: (body: string, isInternal: boolean) => Promise<void>;
  externalDraftText?: string;
  onDraftTextCleared?: () => void;
  onDraftChange?: (text: string) => void;
  senderName?: string;
}

export const ReplyArea = ({
  conversationId,
  channel,
  aiDraftResponse,
  onSend,
  externalDraftText,
  onDraftTextCleared,
  onDraftChange,
  senderName,
}: ReplyAreaProps) => {
  const [replyBody, setReplyBody] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [selectedChannel, setSelectedChannel] = useState(channel);
  const [sending, setSending] = useState(false);
  const [draftUsed, setDraftUsed] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const { toast } = useToast();
  const isTablet = useIsTablet();
  const isMobile = useIsMobile();
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  const adjustTextareaHeight = (textarea: HTMLTextAreaElement | null) => {
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  };

  // Load saved draft when conversation changes
  useEffect(() => {
    const savedDraft = localStorage.getItem(`draft-${conversationId}`);
    setReplyBody(savedDraft || '');
    setDraftUsed(false);
    setIsCollapsed(true);
  }, [conversationId]);

  // Handle AI-generated draft from "Use Draft" button
  useEffect(() => {
    if (externalDraftText && externalDraftText !== replyBody && !draftUsed) {
      setReplyBody(externalDraftText);
      setDraftUsed(true);
      setTimeout(() => adjustTextareaHeight(replyTextareaRef.current), 0);
    }
  }, [draftUsed, externalDraftText, replyBody]);

  // Adjust textarea height when content changes
  useEffect(() => {
    adjustTextareaHeight(replyTextareaRef.current);
  }, [replyBody]);

  useEffect(() => {
    adjustTextareaHeight(noteTextareaRef.current);
  }, [noteBody]);

  const handleUseDraft = () => {
    if (aiDraftResponse) {
      setReplyBody(aiDraftResponse);
      setDraftUsed(true);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter((file) => {
      if (file.size > 20 * 1024 * 1024) {
        toast({
          title: 'File too large',
          description: `${file.name} exceeds 20MB limit`,
          variant: 'destructive',
        });
        return false;
      }
      return true;
    });

    setAttachments((prev) => [...prev, ...validFiles].slice(0, 10));
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadAttachments = useCallback(async () => {
    if (attachments.length === 0) return [];

    setUploading(true);
    const uploadedFiles = [];

    try {
      for (const file of attachments) {
        const fileName = `${conversationId}/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage.from('message-attachments').upload(fileName, file);

        if (error) throw error;

        uploadedFiles.push({
          name: file.name,
          path: fileName,
          type: file.type,
          size: file.size,
        });
      }
    } catch (error) {
      logger.error('Error uploading attachments', error);
      toast({
        title: 'Upload failed',
        description: 'Some attachments could not be uploaded',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }

    return uploadedFiles;
  }, [attachments, conversationId, toast]);

  const handleSendReply = useCallback(async () => {
    if (!replyBody.trim() && attachments.length === 0) {
      toast({
        title: 'Error',
        description: 'Please enter a message or attach a file',
        variant: 'destructive',
      });
      return;
    }

    if (attachments.length > 0) {
      toast({
        title: 'Attachments not supported yet',
        description: 'Remove attachments before sending. Delivery is text-only for now.',
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    try {
      await uploadAttachments();
      await onSend(replyBody, false);
      setReplyBody('');
      setAttachments([]);
      setDraftUsed(false);
      localStorage.removeItem(`draft-${conversationId}`);
      onDraftTextCleared?.();
    } finally {
      setSending(false);
    }
  }, [
    attachments.length,
    conversationId,
    onDraftTextCleared,
    onSend,
    replyBody,
    toast,
    uploadAttachments,
  ]);

  // Keyboard shortcuts for sending
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (replyBody.trim()) {
          void handleSendReply();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSendReply, replyBody]);

  const handleSendNote = async () => {
    if (!noteBody.trim()) return;
    setSending(true);
    try {
      await onSend(noteBody, true);
      setNoteBody('');
    } finally {
      setSending(false);
    }
  };

  // Use mobile styling for both mobile and tablet
  const useMobileStyle = isMobile || isTablet;

  // Collapsed pill state — show when no draft and user hasn't expanded
  if (isCollapsed) {
    return (
      <div className="flex-shrink-0 px-4 pb-4">
        <button
          onClick={() => setIsCollapsed(false)}
          className="mt-auto rounded-full py-3 px-4 cursor-text bg-card flex items-center gap-3 w-full text-left text-sm transition-all duration-200 border border-border/40 shadow-sm text-muted-foreground"
        >
          <Reply className="w-4 h-4" />
          Reply to {senderName || 'sender'}...
        </button>
      </div>
    );
  }

  return (
    <div
      className={
        useMobileStyle ? 'p-3 m-3 bg-card/80 rounded-[22px] backdrop-blur-sm' : 'px-5 pb-4 pt-2'
      }
    >
      <div
        className={cn(
          'relative',
          !useMobileStyle && 'bg-card rounded-2xl',
          !useMobileStyle &&
            'ring-1 ring-inset ring-border shadow-sm focus-within:ring-2 focus-within:ring-primary/30 transition-all',
        )}
      >
        {/* Collapse toggle */}
        <button
          onClick={() => setIsCollapsed(true)}
          className="absolute top-4 right-4 bg-card rounded-md p-1 z-10 transition-colors duration-200 text-muted-foreground/70"
          title="Collapse"
        >
          <Minimize2 className="w-4 h-4" />
        </button>

        <Tabs defaultValue="reply" orientation={isMobile ? 'vertical' : 'horizontal'}>
          <div className={isMobile ? 'flex flex-col gap-2' : 'p-3'}>
            <div className="flex items-center gap-2 mb-2">
              <TabsList
                className={
                  isMobile ? 'w-full h-auto grid grid-cols-2 bg-muted/50' : 'h-9 bg-muted/50'
                }
              >
                <TabsTrigger
                  value="reply"
                  className="text-sm rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm transition-all duration-150"
                >
                  Reply
                </TabsTrigger>
                <TabsTrigger
                  value="note"
                  className="text-sm rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm transition-all duration-150"
                >
                  Note
                </TabsTrigger>
              </TabsList>
              {replyBody && draftUsed && (
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-blue-500" />
                  <span className="text-[11px] font-medium text-blue-500">AI pre-filled draft</span>
                </div>
              )}
            </div>

            <TabsContent value="reply" className="mt-0">
              <div className="space-y-2">
                <div className="flex items-end gap-2 rounded-xl transition-all duration-200">
                  <Textarea
                    ref={replyTextareaRef}
                    placeholder="Type your reply..."
                    value={replyBody}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setReplyBody(newValue);
                      if (newValue.trim()) {
                        localStorage.setItem(`draft-${conversationId}`, newValue);
                      } else {
                        localStorage.removeItem(`draft-${conversationId}`);
                      }
                      onDraftChange?.(newValue);
                    }}
                    className={cn(
                      useMobileStyle ? 'min-h-[80px] text-sm' : 'min-h-[56px] text-base',
                      'w-full resize-none rounded-xl border-0 bg-muted/30 focus-visible:ring-1 focus-visible:ring-primary/20 leading-relaxed placeholder:text-muted-foreground/50 transition-all duration-200 flex-1 overflow-y-auto',
                    )}
                  />
                  <div className="flex flex-col gap-1 mb-1">
                    {replyBody && draftUsed && (
                      <Button
                        onClick={() => {
                          setReplyBody('');
                          setDraftUsed(false);
                          onDraftTextCleared?.();
                        }}
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive flex-shrink-0"
                        title="Discard draft"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      onClick={handleSendReply}
                      disabled={
                        sending || uploading || (!replyBody.trim() && attachments.length === 0)
                      }
                      className="rounded-full text-white px-5 py-2.5 font-medium flex-shrink-0 gap-1.5 bg-primary shadow-sm"
                    >
                      <Send className="h-3.5 w-3.5" />
                      {draftUsed ? 'Approve & Send' : 'Send'}
                    </Button>
                  </div>
                </div>

                {attachments.length > 0 && (
                  <div className="space-y-1 px-1">
                    {attachments.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-sm bg-muted/50 rounded-lg px-3 py-2"
                      >
                        <Paperclip className="h-3 w-3 text-muted-foreground" />
                        <span className="flex-1 truncate">{file.name}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeAttachment(idx)}
                          className="h-6 w-6 p-0"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 px-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || attachments.length >= 10}
                    className="h-6 px-2 text-xs text-muted-foreground"
                  >
                    <Paperclip className="h-3 w-3 mr-1" />
                    Attach
                  </Button>
                  <span className="text-[10px] text-muted-foreground/60 ml-auto">
                    ⌘+Enter to send
                  </span>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="note" className="mt-0">
              <div className="flex items-end gap-2">
                <Textarea
                  ref={noteTextareaRef}
                  placeholder="Add an internal note..."
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  className={cn(
                    useMobileStyle ? 'min-h-[80px] text-sm' : 'min-h-[56px] text-base',
                    'w-full resize-none rounded-xl border-0 bg-warning/5 focus-visible:ring-1 focus-visible:ring-warning/30 leading-relaxed placeholder:text-muted-foreground/50 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] transition-all duration-200 flex-1 overflow-y-auto',
                  )}
                />
                <Button
                  onClick={handleSendNote}
                  disabled={sending || !noteBody.trim()}
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-[12px] border-warning/20 bg-warning/10 text-warning hover:bg-warning/20 mb-1 flex-shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
};
