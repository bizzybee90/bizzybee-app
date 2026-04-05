interface StatCardProps {
  label: string;
  value: string | number;
  variant?: 'default' | 'gold' | 'danger';
}

export function StatCard({ label, value, variant = 'default' }: StatCardProps) {
  const valueColor =
    variant === 'gold' ? 'text-bb-gold' : variant === 'danger' ? 'text-bb-danger' : 'text-bb-text';

  return (
    <div className="rounded-lg bg-bb-cream px-3 py-2.5">
      <p className="text-[11px] font-medium text-bb-warm-gray">{label}</p>
      <p className={`mt-1 text-[20px] font-medium ${valueColor}`}>{value}</p>
    </div>
  );
}
