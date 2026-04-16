import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { MessageSquare, Loader2, Sparkles, RotateCw } from 'lucide-react';

interface TestConversationProps {
  workspaceId: string;
  onComplete: () => void;
}

export const TestConversation = ({ workspaceId, onComplete }: TestConversationProps) => {
  const [status, setStatus] = useState<'idle' | 'generating' | 'complete'>('idle');
  const [result, setResult] = useState<{
    inquiry: string;
    draft: string;
    voice_summary: string;
  } | null>(null);
  const [customMessage, setCustomMessage] = useState('');

  const generateResponse = async (message?: string) => {
    setStatus('generating');
    try {
      // test-conversation edge function removed
      toast.info('Test conversation now runs through the native automation pipeline');
      setStatus('idle');
      return;
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate response');
      setStatus('idle');
    }
  };

  if (status === 'complete' && result) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2">
            <span role="img" aria-label="BizzyBee" className="text-2xl leading-none">
              🐝
            </span>
            See BizzyBee in Action!
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Customer inquiry */}
          <div className="bg-muted/50 rounded-lg p-4">
            <p className="text-sm font-medium text-muted-foreground mb-2">Customer:</p>
            <p className="text-sm">{result.inquiry}</p>
          </div>

          {/* AI response */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
            <p className="text-sm font-medium text-primary mb-2">
              BizzyBee&apos;s Draft (sounds like you!):
            </p>
            <p className="text-sm whitespace-pre-wrap">{result.draft}</p>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setStatus('idle');
                setResult(null);
              }}
              className="flex-1"
            >
              <RotateCw className="h-4 w-4 mr-2" />
              Try Another
            </Button>
            <Button onClick={onComplete} className="flex-1">
              Complete Setup
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="flex items-center justify-center gap-2">
          <MessageSquare className="h-6 w-6" />
          Test Your AI Assistant
        </CardTitle>
        <CardDescription>
          See how BizzyBee responds to customer inquiries in YOUR voice
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'idle' && (
          <>
            <Button onClick={() => generateResponse()} className="w-full">
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Sample Response
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or try your own</span>
              </div>
            </div>

            <Textarea
              placeholder="Type a customer message to test..."
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              rows={3}
            />
            <Button
              variant="outline"
              onClick={() => generateResponse(customMessage)}
              disabled={!customMessage.trim()}
              className="w-full"
            >
              Test Custom Message
            </Button>
          </>
        )}

        {status === 'generating' && (
          <div className="text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="font-medium">Generating response...</p>
            <p className="text-sm text-muted-foreground mt-2">Claude is writing in your voice</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
