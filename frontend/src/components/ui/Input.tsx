'use client';

import { cn } from '@/lib/utils';
import { forwardRef, useId } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    // A label without `htmlFor` is decoration: a screen reader announces the
    // field as unlabelled and clicking the text does nothing. `useId` rather
    // than a slug of the label, because two fields can legitimately share a
    // label and a duplicate id points both labels at the first field.
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="label">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn('input', error && 'border-red-400 focus:ring-red-500/20 focus:border-red-500', className)}
          {...props}
        />
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
