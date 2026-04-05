import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

interface BBButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive';
  loading?: boolean;
}

const variants = {
  primary: 'bg-bb-gold text-bb-espresso hover:opacity-90 active:scale-[0.98]',
  secondary:
    'bg-transparent border-[0.5px] border-bb-border text-bb-text-secondary hover:bg-bb-cream',
  destructive:
    'bg-transparent border-[0.5px] border-bb-danger-bg text-bb-danger hover:bg-bb-danger-bg',
};

export const BBButton = forwardRef<HTMLButtonElement, BBButtonProps>(
  ({ variant = 'primary', loading, disabled, children, className = '', ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-all duration-100 disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${className}`}
        {...props}
      >
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {children}
      </button>
    );
  },
);

BBButton.displayName = 'BBButton';
