import { Pencil, Trash2 } from 'lucide-react';
import { BBToggle } from './BBToggle';
import { BBBadge } from './BBBadge';

interface RuleRowProps {
  title: string;
  description?: string;
  category?: string;
  active: boolean;
  onToggle: (active: boolean) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function RuleRow({
  title,
  description,
  category,
  active,
  onToggle,
  onEdit,
  onDelete,
}: RuleRowProps) {
  return (
    <div className="group flex items-center gap-3 border-b border-bb-border-light px-3 py-2.5 last:border-b-0">
      <BBToggle checked={active} onChange={onToggle} />
      <div className="min-w-0 flex-1">
        <p className={`text-[12px] font-medium ${active ? 'text-bb-text' : 'text-bb-muted'}`}>
          {title}
        </p>
        {description && (
          <p className={`text-[11px] ${active ? 'text-bb-warm-gray' : 'text-bb-muted'}`}>
            {description}
          </p>
        )}
      </div>
      {category && <BBBadge label={category} variant="gray" />}
      <div className="flex items-center gap-1 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1 text-bb-warm-gray transition-colors hover:bg-bb-cream hover:text-bb-text"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md p-1 text-bb-warm-gray transition-colors hover:bg-bb-danger-bg hover:text-bb-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
