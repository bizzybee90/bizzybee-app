import * as React from 'react';

import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-lg border border-bb-border bg-bb-cream px-3 py-2 text-[13px] text-bb-text ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-bb-text placeholder:text-bb-muted focus-visible:outline-none focus-visible:border-bb-gold focus-visible:ring-[3px] focus-visible:ring-[rgba(201,168,76,0.15)] disabled:cursor-not-allowed disabled:opacity-50 transition-[border-color,box-shadow,background-color] duration-150',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
