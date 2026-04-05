import { cn } from '@/lib/utils';
import { getChannelDefinitionsForSurface } from '@/lib/channels';

const conversationChannelOptions = getChannelDefinitionsForSurface('conversation')
  .filter((definition) => definition.module === 'channels')
  .map((definition) => ({
    label: definition.shortLabel,
    value: definition.key,
  }));

interface ConversationFiltersProps {
  statusFilter: string[];
  setStatusFilter: (value: string[]) => void;
  priorityFilter: string[];
  setPriorityFilter: (value: string[]) => void;
  channelFilter: string[];
  setChannelFilter: (value: string[]) => void;
  categoryFilter: string[];
  setCategoryFilter: (value: string[]) => void;
  conversationTypeFilter?: string[];
  setConversationTypeFilter?: (value: string[]) => void;
}

export const ConversationFilters = ({
  statusFilter,
  setStatusFilter,
  priorityFilter,
  setPriorityFilter,
  channelFilter,
  setChannelFilter,
  categoryFilter,
  setCategoryFilter,
  conversationTypeFilter,
  setConversationTypeFilter,
}: ConversationFiltersProps) => {
  const toggleFilter = (
    currentValues: string[],
    value: string,
    onChange: (values: string[]) => void,
  ) => {
    if (currentValues.includes(value)) {
      onChange(currentValues.filter((v) => v !== value));
    } else {
      onChange([...currentValues, value]);
    }
  };

  const filters = [
    {
      label: 'Status',
      value: statusFilter,
      onChange: setStatusFilter,
      options: [
        { label: 'All', value: '__all__', isAll: true },
        { label: 'New', value: 'new' },
        { label: 'Open', value: 'open' },
        { label: 'Waiting', value: 'waiting_customer' },
        { label: 'Resolved', value: 'resolved' },
      ],
    },
    {
      label: 'Priority',
      value: priorityFilter,
      onChange: setPriorityFilter,
      options: [
        { label: 'All', value: '__all__', isAll: true },
        { label: 'High', value: 'high' },
        { label: 'Medium', value: 'medium' },
        { label: 'Low', value: 'low' },
      ],
    },
    {
      label: 'Channel',
      value: channelFilter,
      onChange: setChannelFilter,
      options: [{ label: 'All', value: '__all__', isAll: true }, ...conversationChannelOptions],
    },
    {
      label: 'Category',
      value: categoryFilter,
      onChange: setCategoryFilter,
      options: [
        { label: 'All', value: '__all__', isAll: true },
        { label: 'Billing', value: 'billing_payment' },
        { label: 'Technical', value: 'technical_support' },
        { label: 'Account', value: 'account_management' },
        { label: 'Product', value: 'product_inquiry' },
        { label: 'Complaint', value: 'complaint' },
        { label: 'Other', value: 'other' },
      ],
    },
  ];

  // Add conversation type filter if provided
  if (conversationTypeFilter && setConversationTypeFilter) {
    filters.push({
      label: 'Type',
      value: conversationTypeFilter,
      onChange: setConversationTypeFilter,
      options: [
        { label: 'All', value: '__all__', isAll: true },
        { label: '🤖 AI', value: 'ai_handled' },
        { label: '🧑 Escalated', value: 'escalated' },
      ],
    });
  }

  return (
    <div className="space-y-6">
      {filters.map((filter) => (
        <div key={filter.label}>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">
            {filter.label}
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {filter.options.map((option) => {
              const isSelected = option.isAll
                ? filter.value.length === 0
                : filter.value.includes(option.value);

              const handleClick = () => {
                if (option.isAll) {
                  filter.onChange([]);
                } else {
                  toggleFilter(filter.value, option.value, filter.onChange);
                }
              };

              return (
                <button
                  key={option.value}
                  onClick={handleClick}
                  className={cn(
                    'h-[36px] rounded-lg text-[13px] font-medium transition-all duration-200',
                    'active:scale-95 border',
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-muted/50 text-muted-foreground border-border/50 hover:border-primary/30 hover:bg-muted',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
