import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { Clock, Loader2 } from 'lucide-react';

interface Stats {
  autoHandled: number;
  totalEmails: number;
  correctionsCount: number;
  totalReviewed: number;
}

export const HowBizzyBeeIsDoing = () => {
  const { workspace } = useWorkspace();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!workspace?.id) return;
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const [autoHandled, totalEmails, corrections, reviewed] = await Promise.all([
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .eq('decision_bucket', 'auto_handled')
          .gte('created_at', weekAgo.toISOString()),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .gte('created_at', weekAgo.toISOString()),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .eq('review_outcome', 'changed')
          .not('reviewed_at', 'is', null)
          .gte('reviewed_at', weekAgo.toISOString()),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .not('reviewed_at', 'is', null)
          .gte('reviewed_at', weekAgo.toISOString()),
      ]);

      setStats({
        autoHandled: autoHandled.count || 0,
        totalEmails: totalEmails.count || 0,
        correctionsCount: corrections.count || 0,
        totalReviewed: reviewed.count || 0,
      });
      setLoading(false);
    };
    fetchData();
  }, [workspace?.id]);

  if (loading || !stats) {
    return (
      <div className="bg-white rounded-xl ring-1 ring-slate-900/5 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  const automationPct = stats.totalEmails > 0
    ? Math.round((stats.autoHandled / stats.totalEmails) * 100)
    : 0;
  const accuracyPct = stats.totalReviewed > 0
    ? Math.round(((stats.totalReviewed - stats.correctionsCount) / stats.totalReviewed) * 100)
    : 100;
  const timeSavedMinutes = stats.autoHandled * 2;
  const timeSavedDisplay = timeSavedMinutes >= 60
    ? `~${Math.round(timeSavedMinutes / 60)} hour${Math.round(timeSavedMinutes / 60) !== 1 ? 's' : ''}`
    : `~${timeSavedMinutes} min`;

  // SVG progress ring
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (automationPct / 100) * circumference;

  return (
    <div className="w-full bg-gradient-to-r from-purple-50/50 via-white to-emerald-50/40 rounded-3xl p-8 ring-1 ring-slate-900/5 shadow-sm mb-8">
      <h2 className="text-base font-semibold text-slate-900 mb-6">How BizzyBee is doing</h2>

      <div className="flex flex-col md:flex-row gap-8 items-center justify-between">
        {/* Automation rate with progress ring */}
        <div className="flex items-center gap-4">
          <div className="relative flex-shrink-0">
            <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-90">
              <circle
                cx="42" cy="42" r={radius}
                fill="none"
                stroke="hsl(var(--muted))"
                strokeWidth="6"
              />
              <circle
                cx="42" cy="42" r={radius}
                fill="none"
                stroke="hsl(270 60% 55%)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                className="transition-all duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-bold text-slate-900">{automationPct}%</span>
            </div>
          </div>
          <div>
            <p className="text-sm text-slate-500 font-medium">Emails handled automatically</p>
            <p className="text-5xl font-extrabold tracking-tight text-slate-900 mt-0.5">
              {stats.autoHandled} <span className="text-lg font-medium text-slate-400">of {stats.totalEmails}</span>
            </p>
          </div>
        </div>

        {/* Accuracy */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
          </div>
          <div>
            <p className="text-sm text-slate-500 font-medium">Accuracy</p>
            <p className="text-5xl font-extrabold tracking-tight text-slate-900 mt-0.5">{accuracyPct}%</p>
            <p className="text-xs text-slate-400">
              {stats.correctionsCount === 0
                ? '0 corrections needed'
                : `${stats.correctionsCount} correction${stats.correctionsCount !== 1 ? 's' : ''} this week`}
            </p>
          </div>
        </div>

        {/* Time saved */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Clock className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <p className="text-sm text-slate-500 font-medium">Time saved this week</p>
            <p className="text-5xl font-extrabold tracking-tight text-slate-900 mt-0.5">{timeSavedDisplay}</p>
          </div>
        </div>
      </div>

      <p className="text-sm text-slate-500 mt-6 leading-relaxed">
        BizzyBee is handling most of your email automatically. The more you review, the smarter it gets.
      </p>
    </div>
  );
};
