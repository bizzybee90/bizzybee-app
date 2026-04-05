import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getChannelDefinitionsForSurface } from '@/lib/channels';

const conversationChannelOptions = getChannelDefinitionsForSurface('conversation').filter(
  (definition) => definition.module === 'channels',
);

interface TabletFiltersProps {
  statusFilter: string[];
  priorityFilter: string[];
  channelFilter: string[];
  categoryFilter: string[];
  onStatusChange: (value: string[]) => void;
  onPriorityChange: (value: string[]) => void;
  onChannelChange: (value: string[]) => void;
  onCategoryChange: (value: string[]) => void;
}

export const TabletFilters = ({
  statusFilter,
  priorityFilter,
  channelFilter,
  categoryFilter,
  onStatusChange,
  onPriorityChange,
  onChannelChange,
  onCategoryChange,
}: TabletFiltersProps) => {
  return (
    <div className="flex gap-2 flex-wrap">
      {/* Removed unnecessary styling */}
      {/* Status Filter */}
      <Select
        value={statusFilter[0] || 'all'}
        onValueChange={(value) => onStatusChange(value === 'all' ? [] : [value])}
      >
        <SelectTrigger className="w-32">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="new">New</SelectItem>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="waiting">Waiting</SelectItem>
          <SelectItem value="resolved">Resolved</SelectItem>
        </SelectContent>
      </Select>

      {/* Priority Filter */}
      <Select
        value={priorityFilter[0] || 'all'}
        onValueChange={(value) => onPriorityChange(value === 'all' ? [] : [value])}
      >
        <SelectTrigger className="w-32">
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Priority</SelectItem>
          <SelectItem value="high">High</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="low">Low</SelectItem>
        </SelectContent>
      </Select>

      {/* Channel Filter */}
      <Select
        value={channelFilter[0] || 'all'}
        onValueChange={(value) => onChannelChange(value === 'all' ? [] : [value])}
      >
        <SelectTrigger className="w-32">
          <SelectValue placeholder="Channel" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Channels</SelectItem>
          {conversationChannelOptions.map((channel) => (
            <SelectItem key={channel.key} value={channel.key}>
              {channel.shortLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Category Filter */}
      <Select
        value={categoryFilter[0] || 'all'}
        onValueChange={(value) => onCategoryChange(value === 'all' ? [] : [value])}
      >
        <SelectTrigger className="w-32">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          <SelectItem value="billing">Billing</SelectItem>
          <SelectItem value="technical">Technical</SelectItem>
          <SelectItem value="general">General</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};
