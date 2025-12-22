import { cn } from '@/lib/utils';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-8 w-8 border-4',
};

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <div
      className={cn(
        'animate-spin rounded-full border-primary-600 border-t-transparent',
        sizeClasses[size],
        className
      )}
    />
  );
}

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = 'Loading...' }: LoadingScreenProps) {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center">
      <div className="text-center">
        <Spinner size="lg" className="mx-auto" />
        <p className="mt-3 text-sm text-gray-500">{message}</p>
      </div>
    </div>
  );
}

interface PageLoaderProps {
  message?: string;
}

export function PageLoader({ message = 'Loading...' }: PageLoaderProps) {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <Spinner size="lg" className="mx-auto" />
        <p className="mt-3 text-sm text-gray-500">{message}</p>
      </div>
    </div>
  );
}
