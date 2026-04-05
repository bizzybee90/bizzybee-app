import type { ReactNode } from 'react';

interface ConversationRowProps {
  name: string;
  preview: string;
  time: string;
  badge?: ReactNode;
  initials: string;
  variant?: 'default' | 'escalated';
  onClick?: () => void;
}

export function ConversationRow({
  name,
  preview,
  time,
  badge,
  initials,
  variant = 'default',
  onClick,
}: ConversationRowProps) {
  const avatarClasses =
    variant === 'escalated'
      ? 'bg-bb-warning-bg text-bb-warning'
      : 'bg-bb-cream text-bb-text-secondary';

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-bb-border-light px-3 py-2.5 text-left transition-colors duration-100 last:border-b-0 hover:bg-bb-cream"
    >
      <div
        className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${avatarClasses}`}
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-bb-text">{name}</p>
        <p className="truncate text-[11px] text-bb-warm-gray">{preview}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[10px] text-bb-muted">{time}</span>
        {badge}
      </div>
    </button>
  );
}
