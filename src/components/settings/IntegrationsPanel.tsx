import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PanelNotice } from './PanelNotice';
import { Bot, Mail, MessageSquare, Phone, Store } from 'lucide-react';

const providerCards = [
  {
    title: 'Email',
    description: 'Connect Gmail, Outlook, Apple Mail, or IMAP through the Channels section.',
    icon: Mail,
    status: 'Managed in Channels',
  },
  {
    title: 'SMS & WhatsApp',
    description:
      'Twilio-backed delivery is supported, but provider credentials still need to be configured outside this screen.',
    icon: MessageSquare,
    status: 'Requires provider setup',
  },
  {
    title: 'Facebook, Instagram & Google Business',
    description:
      'Inbound and outbound channel support exists, but account linking is still part of the broader channel setup work.',
    icon: Store,
    status: 'Channel setup in progress',
  },
  {
    title: 'AI Phone',
    description:
      'Voice support is handled separately from written channels and uses its own provisioning flow.',
    icon: Phone,
    status: 'Separate provisioning',
  },
];

export const IntegrationsPanel = () => {
  return (
    <div className="space-y-4">
      <PanelNotice
        icon={Bot}
        title="This screen is now truthful about provider setup"
        description="Provider-level secrets and external account linking are not fully managed from this panel yet. Use Channels for customer-facing channel enablement, and treat the items below as the current operational status."
      />

      <div className="grid gap-3 md:grid-cols-2">
        {providerCards.map((card) => {
          const Icon = card.icon;

          return (
            <Card key={card.title} className="border-[0.5px] border-bb-border bg-bb-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-bb-linen p-2 text-bb-gold">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-bb-text">{card.title}</h3>
                    <p className="mt-1 text-sm text-bb-warm-gray">{card.description}</p>
                  </div>
                </div>
                <Badge variant="outline" className="border-bb-border text-bb-warm-gray">
                  {card.status}
                </Badge>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
