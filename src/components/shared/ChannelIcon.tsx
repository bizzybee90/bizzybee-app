import { MessageSquare, Mail, Phone, MessageCircle, Globe, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizeChannelKey } from '@/lib/channels';

interface ChannelIconProps {
  channel: string;
  className?: string;
}

export const ChannelIcon = ({ channel, className }: ChannelIconProps) => {
  const getChannelConfig = () => {
    switch (normalizeChannelKey(channel)) {
      case 'sms':
        return { Icon: MessageSquare, color: 'text-channel-sms', label: 'SMS' };
      case 'whatsapp':
        return { Icon: MessageCircle, color: 'text-channel-whatsapp', label: 'WhatsApp' };
      case 'email':
        return { Icon: Mail, color: 'text-channel-email', label: 'Email' };
      case 'phone':
        return { Icon: Phone, color: 'text-channel-phone', label: 'Phone' };
      case 'webchat':
        return { Icon: Globe, color: 'text-channel-webchat', label: 'Web Chat' };
      case 'facebook':
        return { Icon: MessageCircle, color: 'text-sky-600', label: 'Facebook Messenger' };
      case 'instagram':
        return { Icon: MessageCircle, color: 'text-pink-600', label: 'Instagram DMs' };
      case 'google_business':
        return { Icon: MapPin, color: 'text-amber-600', label: 'Google Business' };
      default:
        return { Icon: MessageSquare, color: 'text-muted-foreground', label: channel };
    }
  };

  const { Icon, color } = getChannelConfig();

  return <Icon className={cn('h-3 w-3', color, className)} />;
};
