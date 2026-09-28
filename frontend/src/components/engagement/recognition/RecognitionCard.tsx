'use client';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Trash2 } from 'lucide-react';
import type { Recognition } from '@/lib/api-recognition';

function fullName(person?: { firstName: string; lastName: string } | null): string {
  if (!person) return 'Someone';
  return `${person.firstName} ${person.lastName}`.trim();
}

function recipientNames(recognition: Recognition): string {
  const names = recognition.recipients.map((r) => fullName(r.employee));
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

interface RecognitionCardProps {
  recognition: Recognition;
  canDelete?: boolean;
  onDelete?: (id: string) => void;
}

/** One kudos on the wall: who gave it, who got it, the badge, message and points. */
export function RecognitionCard({ recognition, canDelete, onDelete }: RecognitionCardProps) {
  return (
    <div data-testid={`recognition-card-${recognition.id}`}>
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="font-medium text-warm-900">
              {fullName(recognition.giver)}{' '}
              <span className="text-warm-500">recognised</span> {recipientNames(recognition)}
              {recognition.badge && (
                <span className="ml-2">
                  {recognition.badge.icon} {recognition.badge.name}
                </span>
              )}
            </p>
            <p className="mt-1 text-warm-700">{recognition.message}</p>
            <p className="mt-2 text-xs text-warm-500">
              {new Date(recognition.createdAt).toLocaleString()}
              {recognition.pointsPerRecipient > 0 && (
                <> · {recognition.pointsPerRecipient} points each</>
              )}
            </p>
          </div>
          {canDelete && (
            <Button
              variant="danger"
              size="sm"
              aria-label="Delete recognition"
              onClick={() => onDelete?.(recognition.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
