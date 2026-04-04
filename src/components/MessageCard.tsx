import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MessageSquare, Phone, Mail, MessageCircle, Globe, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface MessageCardProps {
  message: {
    id: string;
    channel: string;
    customer_name: string | null;
    customer_identifier: string;
    message_content: string;
    body?: string;
    conversation_context: any;
    priority: string;
    status: string;
    escalated_at: string;
    n8n_workflow_id: string | null;
    metadata?: any;
  };
  onRespond: (messageId: string) => void;
}

const channelIcons = {
  sms: MessageSquare,
  phone: Phone,
  email: Mail,
  whatsapp: MessageCircle,
  webchat: Globe,
};

const channelColors = {
  sms: 'bg-channel-sms',
  phone: 'bg-channel-phone',
  email: 'bg-channel-email',
  whatsapp: 'bg-channel-whatsapp',
  webchat: 'bg-channel-webchat',
};

const priorityColors = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-warning text-warning-foreground',
  high: 'bg-urgent text-urgent-foreground',
};

const statusColors = {
  pending: 'bg-warning text-warning-foreground',
  in_progress: 'bg-primary text-primary-foreground',
  responded: 'bg-success text-success-foreground',
  escalated: 'bg-urgent text-urgent-foreground',
};

export const MessageCard = ({ message, onRespond }: MessageCardProps) => {
  const ChannelIcon = channelIcons[message.channel as keyof typeof channelIcons] || MessageSquare;
  const channelColor = channelColors[message.channel as keyof typeof channelColors] || 'bg-primary';

  return (
    <Card className="transition-all hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`rounded-lg p-2 ${channelColor} text-white`}>
              <ChannelIcon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">
                {message.customer_name || 'Unknown Customer'}
              </h3>
              <p className="text-sm text-muted-foreground">{message.customer_identifier}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge
              variant="outline"
              className={priorityColors[message.priority as keyof typeof priorityColors]}
            >
              {message.priority} priority
            </Badge>
            <Badge
              variant="outline"
              className={statusColors[message.status as keyof typeof statusColors]}
            >
              {message.status.replace('_', ' ')}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {message.body || message.message_content}
          </p>
        </div>

        {message.conversation_context && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Conversation History</p>
            <div className="space-y-2 rounded-lg bg-muted/50 p-3 max-h-60 overflow-y-auto">
              {Array.isArray(message.conversation_context) ? (
                message.conversation_context.map((msg: any, idx: number) => (
                  <div
                    key={idx}
                    className={`p-2 rounded text-sm ${
                      msg.role === 'ai'
                        ? 'bg-primary/10 border-l-2 border-primary'
                        : 'bg-background border-l-2 border-muted-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-xs font-semibold ${
                          msg.role === 'ai' ? 'text-primary' : 'text-foreground'
                        }`}
                      >
                        {msg.role === 'ai' ? '🤖 Claude AI' : '👤 Customer'}
                      </span>
                    </div>
                    <p className="text-foreground/90">{msg.content || msg.message}</p>
                  </div>
                ))
              ) : (
                <pre className="text-xs overflow-auto">
                  {JSON.stringify(message.conversation_context, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}

        {message.metadata && (message.metadata as Record<string, unknown>).ai_draft_response && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">AI Draft Response</p>
            <div className="rounded-lg bg-primary/5 border-l-4 border-primary p-3">
              <p className="text-sm text-foreground/90 whitespace-pre-wrap">
                {String((message.metadata as Record<string, unknown>).ai_draft_response)}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>{formatDistanceToNow(new Date(message.escalated_at), { addSuffix: true })}</span>
          </div>
          {message.status === 'pending' && (
            <Button onClick={() => onRespond(message.id)} size="sm">
              Respond
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
