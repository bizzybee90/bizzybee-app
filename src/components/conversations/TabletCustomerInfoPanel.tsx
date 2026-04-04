import { Conversation } from '@/lib/types';
import { Mail, Phone, Clock, Tag } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface TabletCustomerInfoPanelProps {
  conversation: Conversation;
  isOpen: boolean;
}

export const TabletCustomerInfoPanel = ({ conversation, isOpen }: TabletCustomerInfoPanelProps) => {
  if (!isOpen) return null;

  const metadata = conversation.metadata ?? {};
  const customerEmail = conversation.customer?.email || metadata.customer_email;
  const customerPhone = conversation.customer?.phone || metadata.customer_phone;

  return (
    <div className="animate-in slide-in-from-top-2 duration-200">
      <div className="mx-6 mb-4 rounded-2xl bg-gradient-to-br from-card to-card/50 border border-border/50 shadow-lg p-6 space-y-5">
        {/* Contact Info */}
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Contact Information
          </h3>
          <div className="space-y-3">
            {customerEmail && (
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="text-sm font-medium truncate">{customerEmail}</p>
                </div>
              </div>
            )}
            {customerPhone && (
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-success/10 flex items-center justify-center flex-shrink-0">
                  <Phone className="h-4 w-4 text-success" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <p className="text-sm font-medium">{customerPhone}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recent History */}
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Recent History
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
              <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm">
                  Created{' '}
                  {formatDistanceToNow(new Date(conversation.created_at || ''), {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </div>
            {conversation.first_response_at && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    First response{' '}
                    {formatDistanceToNow(new Date(conversation.first_response_at), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tags/Category */}
        {conversation.category && (
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Category
            </h3>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-accent flex items-center justify-center flex-shrink-0">
                <Tag className="h-4 w-4 text-accent-foreground" />
              </div>
              <span className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium capitalize">
                {conversation.category}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
