import React, { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'success' | 'warning' | 'destructive' | 'outline';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded px-2 py-1 text-[10px] font-bold tracking-wider uppercase transition-colors",
        {
          'bg-primary/10 text-primary': variant === 'default',
          'bg-green-500/10 text-green-400': variant === 'success',
          'bg-yellow-500/10 text-yellow-400': variant === 'warning',
          'bg-error/10 text-error': variant === 'destructive',
          'border border-outline-dim text-on-surface-variant': variant === 'outline',
        },
        className
      )}
      {...props}
    />
  );
}
