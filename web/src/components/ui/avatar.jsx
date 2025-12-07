import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Avatar = forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border bg-muted',
      className,
    )}
    {...props}
  />
));
Avatar.displayName = 'Avatar';

const AvatarImage = forwardRef(({ className, ...props }, ref) => (
  <img ref={ref} className={cn('aspect-square h-full w-full object-cover', className)} {...props} />
));
AvatarImage.displayName = 'AvatarImage';

const AvatarFallback = forwardRef(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex h-full w-full items-center justify-center bg-muted text-sm font-semibold text-foreground/80',
      className,
    )}
    {...props}
  >
    {children}
  </div>
));
AvatarFallback.displayName = 'AvatarFallback';

export { Avatar, AvatarFallback, AvatarImage };
