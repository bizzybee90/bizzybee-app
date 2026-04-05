import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import type { Conversation } from '@/lib/types';
import { useIsMobile } from '@/hooks/use-mobile';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { useWorkspace } from '@/hooks/useWorkspace';

export default function ConversationView() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isMobile = useIsMobile();
  const { workspace } = useWorkspace();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const conversationId = useMemo(() => id ?? '', [id]);

  useEffect(() => {
    document.title = 'Conversation • Inbox';
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!conversationId || !workspace?.id) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('workspace_id', workspace.id)
        .single();

      if (fetchError) {
        setError(fetchError.message);
      } else if (data) {
        setConversation(data as Conversation);
      }

      setLoading(false);
    };

    run();
  }, [conversationId, workspace?.id]);

  if (loading) {
    return (
      <div className="h-screen w-full bg-bb-linen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-bb-warm-gray" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="h-screen w-full bg-bb-linen flex items-center justify-center p-6">
        <Card className="w-full max-w-lg p-6 space-y-3 bg-bb-white border-bb-border">
          <h1 className="text-lg font-medium text-bb-text">Conversation not found</h1>
          <p className="text-sm text-bb-warm-gray">
            This conversation may have been removed or you may not have access.
          </p>
          <Button onClick={() => navigate(-1)}>Go back</Button>
        </Card>
      </div>
    );
  }

  if (isMobile) {
    return (
      <MobilePageLayout showBackButton onBackClick={() => navigate(-1)} backToText="Back">
        <div className="flex-1 flex flex-col overflow-hidden">
          <ConversationThread
            conversation={conversation}
            onUpdate={() => {}}
            onBack={() => navigate(-1)}
          />
        </div>
      </MobilePageLayout>
    );
  }

  return (
    <ThreeColumnLayout
      sidebar={<Sidebar />}
      main={
        <div className="flex flex-col h-screen overflow-hidden">
          <ConversationThread
            conversation={conversation}
            onUpdate={() => {}}
            onBack={() => navigate(-1)}
          />
        </div>
      }
    />
  );
}
