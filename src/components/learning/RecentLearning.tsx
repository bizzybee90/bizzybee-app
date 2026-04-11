import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, Sparkles, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface LearningEvent {
  id: string;
  type: 'correction' | 'confirmation' | 'rule';
  description: string;
  timestamp: string;
  conversationId?: string;
  ruleId?: string;
}

const formatClassification = (str: string) =>
  str.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

const eventConfig = {
  correction: { emoji: '', bg: 'bg-amber-50', text: 'text-amber-800' },
  confirmation: { emoji: '', bg: 'bg-emerald-50', text: 'text-emerald-800' },
  rule: { emoji: '', bg: 'bg-blue-50', text: 'text-blue-800' },
};

interface RecentLearningProps {
  onHighlightRule?: (ruleId: string) => void;
}

export const RecentLearning = ({ onHighlightRule }: RecentLearningProps) => {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const [events, setEvents] = useState<LearningEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!workspace?.id) return;

      const [rules, reviews] = await Promise.all([
        supabase
          .from('sender_rules')
          .select('id, sender_pattern, default_classification, created_at')
          .eq('workspace_id', workspace.id)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('conversations')
          .select(
            `
            id,
            title,
            email_classification,
            reviewed_at,
            review_outcome,
            customer:customers(email)
          `,
          )
          .eq('workspace_id', workspace.id)
          .eq('training_reviewed', true)
          .not('reviewed_at', 'is', null)
          .order('reviewed_at', { ascending: false })
          .limit(15),
      ]);

      const all: LearningEvent[] = [];

      (rules.data || []).forEach(r => {
        all.push({
          id: `rule-${r.id}`,
          type: 'rule',
          description: `New rule: auto-handle ${r.sender_pattern} as ${formatClassification(r.default_classification || 'unknown')}`,
          timestamp: r.created_at || '',
          ruleId: r.id,
        });
      });

      (reviews.data || []).forEach(r => {
        const customerJoin = Array.isArray(r.customer) ? r.customer[0] : r.customer;

        if (r.review_outcome === 'changed') {
          all.push({
            id: `corr-${r.id}`,
            type: 'correction',
            description: `Updated ${customerJoin?.email || r.title || 'this conversation'} to ${formatClassification(r.email_classification || 'unknown')}`,
            timestamp: r.reviewed_at || '',
            conversationId: r.id,
          });
        } else if (r.review_outcome === 'confirmed') {
          all.push({
            id: `rev-${r.id}`,
            type: 'confirmation',
            description: `Confirmed: ${r.title || 'an email'} is ${formatClassification(r.email_classification || 'unknown')}`,
            timestamp: r.reviewed_at || '',
            conversationId: r.id,
          });
        }
      });

      all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEvents(all.slice(0, 15));
      setLoading(false);
    };
    fetchData();
  }, [workspace?.id]);

  const handleClick = (event: LearningEvent) => {
    if (event.type === 'rule' && event.ruleId && onHighlightRule) {
      onHighlightRule(event.ruleId);
    } else if (event.conversationId) {
      if (event.type === 'correction') {
        navigate(`/review`);
      } else {
        navigate(`/conversation/${event.conversationId}`);
      }
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-3xl ring-1 ring-slate-900/5 shadow-sm p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl ring-1 ring-slate-900/5 shadow-sm p-6 flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-4 w-4 text-slate-500" />
        <h2 className="font-semibold text-slate-900">Recent learning</h2>
      </div>

      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center flex-1">
          <p className="text-sm text-slate-500 max-w-[260px] leading-relaxed">
            Start reviewing emails in the Teach queue to help BizzyBee learn. Your confirmations and corrections appear here.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 text-slate-700"
            onClick={() => navigate('/review')}
          >
            Go to Teach queue <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Button>
        </div>
      ) : (
        <div className="flex-1 space-y-0.5">
          {events.map(event => {
            const config = eventConfig[event.type];
            return (
              <div
                key={event.id}
                onClick={() => handleClick(event)}
                className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 hover:bg-slate-50 transition-all cursor-pointer group"
              >
                <span className={cn(
                  'text-xs w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5',
                  config.bg
                )}>
                  {config.emoji}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 leading-snug">{event.description}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {event.timestamp ? formatDistanceToNow(new Date(event.timestamp), { addSuffix: true }) : ''}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
