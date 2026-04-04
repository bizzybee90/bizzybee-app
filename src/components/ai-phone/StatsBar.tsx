import { useCallStats } from '@/hooks/useCallStats';
import { Phone, Clock, CheckCircle2, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function rateColor(rate: number): string {
  if (rate >= 80) return 'text-green-600';
  if (rate >= 50) return 'text-amber-600';
  return 'text-red-600';
}

function rateIconBg(rate: number): string {
  if (rate >= 80) return 'bg-green-50 text-green-600';
  if (rate >= 50) return 'bg-amber-50 text-amber-600';
  return 'bg-red-50 text-red-600';
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  subtitle?: string;
  iconBg: string;
}

function StatCard({ icon, label, value, subtitle, iconBg }: StatCardProps) {
  return (
    <div className="bg-white border border-border rounded-xl p-4 flex items-start gap-3">
      <div className={cn('flex items-center justify-center w-9 h-9 rounded-lg shrink-0', iconBg)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-foreground leading-tight mt-0.5">{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="bg-white border border-border rounded-xl p-4 flex items-start gap-3">
      <Skeleton className="w-9 h-9 rounded-lg shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

export const StatsBar = () => {
  const { stats, isLoading } = useCallStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
    );
  }

  if (!stats) return null;

  const minutesPct =
    stats.included_minutes > 0
      ? Math.min((stats.minutes_used / stats.included_minutes) * 100, 100)
      : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Calls Today */}
      <StatCard
        icon={<Phone className="w-4 h-4" />}
        iconBg="bg-amber-50 text-amber-600"
        label="Calls Today"
        value={stats.calls_today}
        subtitle={`${stats.calls_this_week} this week`}
      />

      {/* Minutes Used */}
      <div className="bg-white border border-border rounded-xl p-4 flex items-start gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0 bg-amber-50 text-amber-600">
          <Clock className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Minutes Used
          </p>
          <p className="text-2xl font-bold text-foreground leading-tight mt-0.5">
            {Math.round(stats.minutes_used)}
            <span className="text-sm font-normal text-muted-foreground">
              {' '}
              / {stats.included_minutes}
            </span>
          </p>
          <div className="mt-2 w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-500"
              style={{ width: `${minutesPct}%` }}
            />
          </div>
          {stats.overage_minutes > 0 && (
            <p className="text-xs text-red-500 mt-1">
              +{Math.round(stats.overage_minutes)} overage minutes
            </p>
          )}
        </div>
      </div>

      {/* Resolution Rate */}
      <StatCard
        icon={<CheckCircle2 className="w-4 h-4" />}
        iconBg={rateIconBg(stats.resolution_rate)}
        label="Resolution Rate"
        value={
          <span className={rateColor(stats.resolution_rate)}>
            {Math.round(stats.resolution_rate)}%
          </span>
        }
        subtitle={
          stats.resolution_rate >= 80
            ? 'Great performance'
            : stats.resolution_rate >= 50
              ? 'Room to improve'
              : 'Needs attention'
        }
      />

      {/* Avg Duration */}
      <StatCard
        icon={<Timer className="w-4 h-4" />}
        iconBg="bg-blue-50 text-blue-600"
        label="Avg Duration"
        value={formatDuration(stats.avg_duration_seconds)}
        subtitle="Per call average"
      />
    </div>
  );
};
