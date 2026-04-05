import { BBButton } from './BBButton';

interface SuggestionCardProps {
  title: string;
  context?: string;
  onSave: () => void;
  onEdit?: () => void;
  onDismiss: () => void;
}

export function SuggestionCard({ title, context, onSave, onEdit, onDismiss }: SuggestionCardProps) {
  return (
    <div className="rounded-[10px] border-[0.5px] border-bb-gold-border bg-bb-gold-light p-4">
      <p className="mb-1 text-[10px] font-medium text-bb-warning">Suggested rule</p>
      <p className="text-[12px] font-medium text-bb-text">{title}</p>
      {context && <p className="mt-1 text-[11px] text-bb-warm-gray">{context}</p>}
      <div className="mt-3 flex items-center gap-2">
        <BBButton variant="primary" onClick={onSave}>
          Save rule
        </BBButton>
        {onEdit && (
          <BBButton variant="secondary" onClick={onEdit}>
            Edit first
          </BBButton>
        )}
        <BBButton variant="secondary" onClick={onDismiss}>
          Dismiss
        </BBButton>
      </div>
    </div>
  );
}
