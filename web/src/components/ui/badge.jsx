import { cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground shadow',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        success: 'border-transparent bg-emerald-500/15 text-emerald-200',
        warning: 'border-transparent bg-amber-500/15 text-amber-200',
        danger: 'border-transparent bg-destructive/20 text-destructive-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const Badge = forwardRef(({ className, variant, ...props }, ref) => (
  <span className={cn(badgeVariants({ variant }), className)} ref={ref} {...props} />
));
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
