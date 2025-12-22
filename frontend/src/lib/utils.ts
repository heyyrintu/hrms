import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatMinutesToHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    PRESENT: 'badge-success',
    ABSENT: 'badge-danger',
    LEAVE: 'badge-info',
    HALF_DAY: 'badge-warning',
    WFH: 'badge-info',
    HOLIDAY: 'badge-gray',
    PENDING: 'badge-warning',
    APPROVED: 'badge-success',
    REJECTED: 'badge-danger',
    CANCELLED: 'badge-gray',
    ACTIVE: 'badge-success',
    INACTIVE: 'badge-gray',
  };
  return colors[status] || 'badge-gray';
}

export function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}
