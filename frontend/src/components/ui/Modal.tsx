'use client';

import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}

const sizeClasses = {
  sm: 'max-w-[calc(100vw-2rem)] sm:max-w-sm',
  md: 'max-w-[calc(100vw-2rem)] sm:max-w-md',
  lg: 'max-w-[calc(100vw-2rem)] sm:max-w-lg',
  xl: 'max-w-[calc(100vw-2rem)] sm:max-w-xl',
  '2xl': 'max-w-[calc(100vw-2rem)] sm:max-w-2xl',
};

export function Modal({ isOpen, onClose, title, children, size = 'md', className }: ModalProps) {
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-warm-900/30 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-end sm:items-center justify-center p-0 sm:p-4">
        <div
          className={cn(
            'relative w-full bg-white rounded-t-2xl sm:rounded-2xl shadow-dropdown border border-warm-200 transform transition-all animate-scale-in',
            'max-h-[90vh] sm:max-h-[85vh] flex flex-col',
            sizeClasses[size],
            className
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          {title && (
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-warm-200 flex-shrink-0">
              <h3 className="text-base sm:text-lg font-semibold text-warm-900">{title}</h3>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-warm-400 hover:text-warm-600 hover:bg-warm-100 transition-colors active:scale-95"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Content */}
          <div className="p-4 sm:p-5 overflow-y-auto overscroll-contain flex-1">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ModalFooterProps {
  children: ReactNode;
  className?: string;
}

export function ModalFooter({ children, className }: ModalFooterProps) {
  return (
    <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 mt-4 pt-4 border-t border-warm-200', className)}>
      {children}
    </div>
  );
}
