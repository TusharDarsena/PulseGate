import React, { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-lg font-semibold transition-all active:scale-95",
          {
            'bg-primary text-on-primary hover:brightness-110 shadow-[0_0_15px_rgba(124,92,255,0.2)]': variant === 'primary',
            'bg-surface-container text-on-surface border border-outline-dim hover:bg-outline-dim': variant === 'secondary',
            'bg-transparent text-on-surface-variant hover:text-on-surface hover:bg-outline-dim': variant === 'ghost',
            'px-3 py-1.5 text-xs': size === 'sm',
            'px-5 py-2.5 text-sm': size === 'md',
            'px-6 py-3 text-base': size === 'lg',
          },
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
