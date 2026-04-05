import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-bb-neutral-bg text-bb-neutral',
        secondary: 'border-transparent bg-bb-cream text-bb-text-secondary',
        destructive: 'border-transparent bg-bb-danger-bg text-bb-danger',
        outline: 'border-bb-border text-bb-text-secondary bg-transparent',
        'priority-urgent': 'border-transparent bg-bb-danger-bg text-bb-danger',
        'priority-high': 'border-transparent bg-bb-warning-bg text-bb-warning',
        'priority-medium': 'border-transparent bg-bb-warning-bg text-bb-warning',
        'priority-low': 'border-transparent bg-bb-neutral-bg text-bb-neutral',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
