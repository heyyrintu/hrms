'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { employeesApi } from '@/lib/api';
import { recognitionApi, type Badge } from '@/lib/api-recognition';
import { useAuth } from '@/contexts/AuthContext';
import { currentEmployeeId } from '@/lib/current-employee';
import toast from 'react-hot-toast';

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode?: string;
}

function errorMessage(err: unknown, fallback: string): string {
  const axiosError = err as { response?: { data?: { message?: string } } };
  return axiosError.response?.data?.message || fallback;
}

interface GiveRecognitionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGiven: () => void;
}

/** Give recognition: pick 1-10 employees, an optional badge, a message and (when on) points. */
export function GiveRecognitionModal({ isOpen, onClose, onGiven }: GiveRecognitionModalProps) {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [pointsEnabled, setPointsEnabled] = useState(false);
  const [remainingThisMonth, setRemainingThisMonth] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [badgeId, setBadgeId] = useState('');
  const [points, setPoints] = useState('0');
  const [saving, setSaving] = useState(false);

  const selfId = currentEmployeeId(user);

  const loadContext = useCallback(async () => {
    try {
      const [employeesRes, badgesRes, meRes] = await Promise.all([
        employeesApi.getAll({ status: 'ACTIVE', limit: 500 }),
        recognitionApi.badges(),
        recognitionApi.me(),
      ]);
      const list: EmployeeOption[] = employeesRes.data?.data ?? employeesRes.data ?? [];
      setEmployees(list.filter((e) => e.id !== selfId));
      setBadges(badgesRes.data?.data ?? badgesRes.data ?? []);
      setPointsEnabled(!!meRes.data?.pointsEnabled);
      setRemainingThisMonth(meRes.data?.remainingThisMonth ?? null);
    } catch {
      toast.error('Failed to load employees and badges');
    }
  }, [selfId]);

  useEffect(() => {
    if (isOpen) {
      setRecipientIds([]);
      setMessage('');
      setBadgeId('');
      setPoints('0');
      setSearch('');
      loadContext();
    }
  }, [isOpen, loadContext]);

  const toggleRecipient = (id: string) => {
    setRecipientIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : prev.length >= 10 ? prev : [...prev, id],
    );
  };

  const filteredEmployees = employees.filter((e) =>
    `${e.firstName} ${e.lastName} ${e.employeeCode ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  );

  const submit = async () => {
    if (recipientIds.length === 0) {
      toast.error('Pick at least one employee');
      return;
    }
    if (!message.trim()) {
      toast.error('Write a message');
      return;
    }
    setSaving(true);
    try {
      await recognitionApi.give({
        recipientIds,
        message: message.trim(),
        badgeId: badgeId || undefined,
        points: pointsEnabled ? Number(points) || 0 : undefined,
      });
      toast.success('Recognition sent');
      onGiven();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to send recognition'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Give Recognition" size="lg">
      <div className="space-y-4">
        <div>
          <label htmlFor="recognition-employee-search" className="mb-1 block text-sm font-medium text-warm-700">
            Recipients * (up to 10)
          </label>
          <Input
            id="recognition-employee-search"
            placeholder="Search employees…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-warm-200 p-2">
            {filteredEmployees.map((emp) => (
              <label
                key={emp.id}
                data-testid={`employee-option-${emp.id}`}
                className="flex items-center gap-2 rounded px-2 py-1 hover:bg-warm-50"
              >
                <input
                  type="checkbox"
                  checked={recipientIds.includes(emp.id)}
                  onChange={() => toggleRecipient(emp.id)}
                />
                <span>
                  {emp.firstName} {emp.lastName}
                  {emp.employeeCode && (
                    <span className="ml-1 text-xs text-warm-400">({emp.employeeCode})</span>
                  )}
                </span>
              </label>
            ))}
            {filteredEmployees.length === 0 && (
              <p className="px-2 py-1 text-sm text-warm-400">No employees match</p>
            )}
          </div>
          <p className="mt-1 text-xs text-warm-500">{recipientIds.length} selected</p>
        </div>

        <div>
          <label htmlFor="recognition-badge" className="mb-1 block text-sm font-medium text-warm-700">
            Badge
          </label>
          <Select
            id="recognition-badge"
            value={badgeId}
            onChange={(e) => setBadgeId(e.target.value)}
            placeholder="No badge"
            options={badges.map((b) => ({ value: b.id, label: `${b.icon} ${b.name}` }))}
          />
        </div>

        <div>
          <label htmlFor="recognition-message" className="mb-1 block text-sm font-medium text-warm-700">
            Message *
          </label>
          <textarea
            id="recognition-message"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            className="w-full resize-none rounded-lg border border-warm-300 px-3 py-2"
            placeholder="What did they do?"
          />
        </div>

        {pointsEnabled && (
          <div>
            <Input
              label="Points per recipient"
              type="number"
              min={0}
              max={1000}
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
            {remainingThisMonth !== null && (
              <p className="mt-1 text-xs text-warm-500">
                {remainingThisMonth} points left this month
              </p>
            )}
          </div>
        )}
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving}>
          Send Recognition
        </Button>
      </ModalFooter>
    </Modal>
  );
}
