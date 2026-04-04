import { useCallLogs } from '@/hooks/useCallLogs';
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Phone, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CallTranscript } from './CallTranscript';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { AiPhoneCallLog } from '@/lib/types';

// ---------- helpers ----------

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const timeStr = date.toLocaleTimeString('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (isToday) return timeStr;

  const dateStr = date.toLocaleDateString('en-GB', {
    month: 'short',
    day: 'numeric',
  });

  return `${dateStr}, ${timeStr}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === 0) return '--';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatPhoneNumber(number: string | null): string {
  if (!number) return 'Unknown';
  // UK-style: 07700 900123
  if (number.startsWith('+44') && number.length >= 13) {
    const local = number.slice(3);
    return `0${local.slice(0, 4)} ${local.slice(4)}`;
  }
  return number;
}

function truncate(text: string | null, max: number): string {
  if (!text) return '--';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

// ---------- outcome badge ----------

const outcomeConfig: Record<string, { label: string; className: string }> = {
  resolved: {
    label: 'Resolved',
    className: 'bg-green-50 text-green-700 border-green-200',
  },
  booking_made: {
    label: 'Booking Made',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  message_taken: {
    label: 'Message Taken',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  transferred: {
    label: 'Transferred',
    className: 'bg-gray-50 text-gray-600 border-gray-200',
  },
  abandoned: {
    label: 'Abandoned',
    className: 'bg-orange-50 text-orange-700 border-orange-200',
  },
  error: {
    label: 'Error',
    className: 'bg-red-50 text-red-700 border-red-200',
  },
};

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <span className="text-muted-foreground">--</span>;
  const cfg = outcomeConfig[outcome] ?? {
    label: outcome,
    className: 'bg-gray-50 text-gray-600 border-gray-200',
  };
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', cfg.className)}>
      {cfg.label}
    </Badge>
  );
}

// ---------- sentiment ----------

const sentimentEmoji: Record<string, string> = {
  positive: '\u{1F60A}',
  neutral: '\u{1F610}',
  negative: '\u{1F620}',
};

// ---------- direction icon ----------

function DirectionIcon({ direction }: { direction: 'inbound' | 'outbound' }) {
  return direction === 'inbound' ? (
    <PhoneIncoming className="w-3.5 h-3.5 text-green-500" />
  ) : (
    <PhoneOutgoing className="w-3.5 h-3.5 text-blue-500" />
  );
}

// ---------- expanded row ----------

interface ExpandedRowProps {
  call: AiPhoneCallLog;
}

function ExpandedRow({ call }: ExpandedRowProps) {
  return (
    <tr>
      <td colSpan={7} className="px-4 py-4 bg-muted">
        <div className="space-y-4 max-w-3xl">
          {/* Transcript */}
          <CallTranscript
            transcriptObject={
              (
                call as unknown as {
                  transcript_object?: Array<{ role: 'agent' | 'user'; content: string }> | null;
                }
              ).transcript_object ?? null
            }
            transcriptText={typeof call.transcript === 'string' ? call.transcript : null}
          />

          {/* Meta grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {call.outcome_details && Object.keys(call.outcome_details).length > 0 && (
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Outcome Details</p>
                <p className="text-foreground">{JSON.stringify(call.outcome_details)}</p>
              </div>
            )}
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Cost</p>
              <p className="text-foreground font-medium">{call.cost_cents}p</p>
            </div>
            {call.followup_notes && (
              <div className="col-span-2">
                <p className="text-muted-foreground text-xs mb-0.5">Follow-up Notes</p>
                <p className="text-foreground">{call.followup_notes}</p>
              </div>
            )}
          </div>

          {call.requires_followup && (
            <Badge className="bg-red-50 text-red-700 border border-red-200 text-xs">
              Requires Follow-up
            </Badge>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------- loading skeleton ----------

function TableSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-4 items-center">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-6" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-6" />
        </div>
      ))}
    </div>
  );
}

// ---------- empty state ----------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mb-4">
        <Phone className="w-5 h-5 text-amber-600" />
      </div>
      <p className="text-base font-medium text-foreground mb-1">No calls yet</p>
      <p className="text-sm text-muted-foreground max-w-xs">
        Set up your AI Phone to get started. Calls will appear here in real time.
      </p>
    </div>
  );
}

// ---------- main component ----------

export const CallLogTable = () => {
  const { calls, isLoading, filters, setFilters } = useCallLogs();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleRow = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="bg-white border border-border rounded-xl overflow-hidden">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-border">
        <Select
          value={filters.dateRange}
          onValueChange={(v) =>
            setFilters((prev) => ({
              ...prev,
              dateRange: v as typeof prev.dateRange,
            }))
          }
        >
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="Date range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.outcome ?? 'all'}
          onValueChange={(v) =>
            setFilters((prev) => ({
              ...prev,
              outcome: v === 'all' ? null : v,
            }))
          }
        >
          <SelectTrigger className="w-[150px] h-8 text-xs">
            <SelectValue placeholder="Outcome" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Outcomes</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="booking_made">Booking Made</SelectItem>
            <SelectItem value="message_taken">Message Taken</SelectItem>
            <SelectItem value="transferred">Transferred</SelectItem>
            <SelectItem value="abandoned">Abandoned</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.sentiment ?? 'all'}
          onValueChange={(v) =>
            setFilters((prev) => ({
              ...prev,
              sentiment: v === 'all' ? null : v,
            }))
          }
        >
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="Sentiment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sentiment</SelectItem>
            <SelectItem value="positive">Positive</SelectItem>
            <SelectItem value="neutral">Neutral</SelectItem>
            <SelectItem value="negative">Negative</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton />
      ) : calls.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Time
                </th>
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Caller
                </th>
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Duration
                </th>
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Outcome
                </th>
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider w-12">
                  Mood
                </th>
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Summary
                </th>
                <th className="px-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => {
                const isExpanded = expandedId === call.id;
                return (
                  <Fragment key={call.id}>
                    <tr
                      className={cn(
                        'border-b border-border hover:bg-gray-50/50 cursor-pointer transition-colors',
                        isExpanded && 'bg-gray-50/50',
                      )}
                      onClick={() => toggleRow(call.id)}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <DirectionIcon direction={call.direction} />
                          <span className="text-foreground">{formatTime(call.start_time)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-foreground font-mono text-xs">
                        {formatPhoneNumber(call.caller_number)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {formatDuration(call.duration_seconds)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <OutcomeBadge outcome={call.outcome} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {call.sentiment ? (sentimentEmoji[call.sentiment] ?? '--') : '--'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[240px]">
                        {truncate(call.summary, 60)}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                        </Button>
                      </td>
                    </tr>
                    {isExpanded && <ExpandedRow call={call} />}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
