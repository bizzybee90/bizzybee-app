import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border text-[13px] font-medium ring-offset-background transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-bb-gold text-bb-espresso shadow-sm hover:brightness-[0.98] active:scale-[0.98]',
        destructive:
          'border-bb-danger/15 bg-transparent text-bb-danger hover:bg-bb-danger-bg active:scale-[0.98]',
        outline:
          'border-bb-border bg-transparent text-bb-text-secondary hover:bg-bb-cream hover:text-bb-text',
        secondary:
          'border-bb-border bg-bb-white text-bb-text-secondary hover:bg-bb-cream hover:text-bb-text',
        ghost:
          'border-transparent bg-transparent text-bb-text-secondary hover:bg-bb-cream hover:text-bb-text',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 py-1.5 text-[12px]',
        lg: 'h-10 px-5 py-2.5 text-[13px]',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
