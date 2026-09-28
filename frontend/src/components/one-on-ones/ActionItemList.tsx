'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import type { ActionItem } from '@/lib/api-one-on-ones';
import { Trash2 } from 'lucide-react';

interface ActionItemListProps {
  items: ActionItem[];
  meId: string;
  counterpartId: string;
  counterpartName: string;
  busy?: boolean;
  onAdd: (data: { text: string; assigneeId: string; dueDate?: string }) => void | Promise<void>;
  onToggle: (item: ActionItem) => void | Promise<void>;
  onRemove: (itemId: string) => void | Promise<void>;
}

const formatDueDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

/** Action items for a one-on-one. The assignee is always one of the two participants. */
export function ActionItemList({
  items,
  meId,
  counterpartId,
  counterpartName,
  busy = false,
  onAdd,
  onToggle,
  onRemove,
}: ActionItemListProps) {
  const [text, setText] = useState('');
  const [assigneeId, setAssigneeId] = useState(meId);
  const [dueDate, setDueDate] = useState('');

  const nameFor = (assignee: string) => (assignee === meId ? 'Me' : counterpartName);

  const submit = async () => {
    if (!text.trim()) {
      return;
    }
    await onAdd({ text: text.trim(), assigneeId, dueDate: dueDate || undefined });
    setText('');
    setDueDate('');
  };

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-warm-600">No action items yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-warm-200 p-2.5"
            >
              <input
                type="checkbox"
                aria-label={`Mark "${item.text}" done`}
                checked={item.isDone}
                disabled={busy}
                onChange={() => onToggle(item)}
              />
              <div className="flex-1">
                <p className={item.isDone ? 'text-sm text-warm-400 line-through' : 'text-sm text-warm-900'}>
                  {item.text}
                </p>
                <p className="text-xs text-warm-500">
                  {nameFor(item.assigneeId)}
                  {formatDueDate(item.dueDate) ? ` · Due ${formatDueDate(item.dueDate)}` : ''}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Remove "${item.text}"`}
                disabled={busy}
                onClick={() => onRemove(item.id)}
                className="text-warm-400 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 pt-2">
        <div className="flex-1 min-w-[160px]">
          <Input
            label="Add an action item"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="w-40">
          <Select
            label="Assignee"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            options={[
              { value: meId, label: 'Me' },
              { value: counterpartId, label: counterpartName },
            ]}
          />
        </div>
        <div className="w-40">
          <Input
            type="date"
            label="Due date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
        <Button onClick={submit} disabled={busy || !text.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}
