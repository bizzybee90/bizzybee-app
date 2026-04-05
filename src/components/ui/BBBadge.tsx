interface BBBadgeProps {
  label: string;
  variant?: 'gold' | 'green' | 'red' | 'gray' | 'neutral';
}

const variants = {
  gold: 'bg-bb-warning-bg text-bb-warning',
  green: 'bg-bb-success-bg text-bb-success',
  red: 'bg-bb-danger-bg text-bb-danger',
  gray: 'bg-bb-neutral-bg text-bb-neutral',
  neutral: 'bg-bb-neutral-bg text-bb-neutral',
};

export function BBBadge({ label, variant = 'neutral' }: BBBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-bb-pill px-2 py-0.5 text-[10px] font-medium ${variants[variant]}`}
      style={{ borderRadius: '20px' }}
    >
      {label}
    </span>
  );
}
