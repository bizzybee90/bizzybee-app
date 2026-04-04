import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Conversation } from '@/lib/types';

type SLAConversation = Conversation & {
  customer?: {
    name: string | null;
  } | null;
};

export const useSLANotifications = () => {
  const { toast } = useToast();

  useEffect(() => {
    const checkSLAStatus = async () => {
      const { data: conversations } = await supabase
        .from('conversations')
        .select('*, customer:customers(*)')
        .in('status', ['new', 'open', 'waiting_customer', 'waiting_internal'])
        .not('sla_due_at', 'is', null);

      if (!conversations) return;

      const now = new Date();
      (conversations as SLAConversation[]).forEach((conv) => {
        if (!conv.sla_due_at) return;

        const dueAt = new Date(conv.sla_due_at);
        const minutesRemaining = (dueAt.getTime() - now.getTime()) / 1000 / 60;

        // Warn at 15 minutes
        if (minutesRemaining > 0 && minutesRemaining <= 15 && minutesRemaining > 14) {
          toast({
            title: 'SLA Warning',
            description: `${conv.customer?.name || 'Conversation'} will breach SLA in ${Math.round(minutesRemaining)} minutes`,
            variant: 'destructive',
          });

          // Browser notification
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('SLA Warning', {
              body: `${conv.customer?.name || 'Conversation'} will breach SLA soon`,
              icon: '/favicon.ico',
            });
          }
        }

        // Alert on breach
        if (minutesRemaining <= 0 && minutesRemaining > -1) {
          toast({
            title: 'SLA BREACHED',
            description: `${conv.customer?.name || 'Conversation'} has breached SLA!`,
            variant: 'destructive',
          });
        }
      });
    };

    // Check every minute
    const interval = setInterval(checkSLAStatus, 60000);
    checkSLAStatus(); // Check immediately

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => clearInterval(interval);
  }, [toast]);
};
