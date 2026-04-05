import { forwardRef } from 'react';

type BBInputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const BBInput = forwardRef<HTMLInputElement, BBInputProps>(
  ({ className = '', ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`h-10 w-full rounded-lg border-[0.5px] border-bb-border bg-bb-cream px-3 text-[13px] text-bb-text placeholder:text-bb-muted focus:border-bb-gold focus:outline-none focus:ring-[3px] focus:ring-[rgba(201,168,76,0.15)] ${className}`}
        {...props}
      />
    );
  },
);

BBInput.displayName = 'BBInput';
