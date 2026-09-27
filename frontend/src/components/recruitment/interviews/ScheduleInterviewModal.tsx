'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { employeesApi } from '@/lib/api';
import {
  recruitmentApi,
  type EmployeeSummary,
  type Interview,
  type InterviewMode,
  type InterviewPayload,
} from '@/lib/api-recruitment';
import { INTERVIEW_MODE_LABELS, apiErrorMessage } from '../offers/offerFormat';

export const MAX_PANELISTS = 10;

const pad = (n: number) => String(n).padStart(2, '0');
/** Local YYYY-MM-DD and HH:mm of an ISO instant. */
function localParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  applicationId: string;
  /** Reschedule / edit mode when set. */
  interview?: Interview | null;
  onSaved: (interview: Interview) => void;
}

/** Schedule or reschedule an interview with a 1–10 person panel. */
export function ScheduleInterviewModal({ isOpen, onClose, applicationId, interview, onSaved }: Props) {
  const [roundName, setRoundName] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [mode, setMode] = useState<InterviewMode>('VIDEO');
  const [location, setLocation] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [notes, setNotes] = useState('');
  const [panel, setPanel] = useState<EmployeeSummary[]>([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<EmployeeSummary[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (interview) {
      const start = localParts(interview.scheduledStart);
      setRoundName(interview.roundName);
      setDate(start.date);
      setStartTime(start.time);
      setEndTime(localParts(interview.scheduledEnd).time);
      setMode(interview.mode);
      setLocation(interview.location ?? '');
      setMeetingLink(interview.meetingLink ?? '');
      setNotes(interview.notes ?? '');
      setPanel(interview.panel);
    } else {
      setRoundName('');
      setDate('');
      setStartTime('10:00');
      setEndTime('11:00');
      setMode('VIDEO');
      setLocation('');
      setMeetingLink('');
      setNotes('');
      setPanel([]);
    }
    setSearch('');
  }, [isOpen, interview]);

  // Employee picker: active employees, searched on the server.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      employeesApi
        .getAll({ status: 'ACTIVE', limit: 25, ...(search.trim() ? { search: search.trim() } : {}) })
        .then((res) => {
          if (cancelled) return;
          const raw = res.data as unknown;
          const rows = (Array.isArray(raw) ? raw : ((raw as { data?: unknown[] })?.data ?? [])) as EmployeeSummary[];
          setResults(
            rows.map((e) => ({ id: e.id, employeeCode: e.employeeCode, firstName: e.firstName, lastName: e.lastName })),
          );
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, search]);

  const selectedIds = useMemo(() => new Set(panel.map((p) => p.id)), [panel]);

  const toggle = (employee: EmployeeSummary) => {
    setPanel((current) => {
      if (current.some((p) => p.id === employee.id)) return current.filter((p) => p.id !== employee.id);
      if (current.length >= MAX_PANELISTS) {
        toast.error(`A panel has at most ${MAX_PANELISTS} interviewers`);
        return current;
      }
      return [...current, employee];
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roundName.trim()) return toast.error('Name the round');
    if (!date) return toast.error('Pick a date');
    const start = new Date(`${date}T${startTime}`);
    const end = new Date(`${date}T${endTime}`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return toast.error('The interview must end after it starts');
    }
    if (panel.length === 0) return toast.error('Add at least one interviewer');

    const payload: InterviewPayload = {
      roundName: roundName.trim(),
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
      mode,
      location: location.trim() || null,
      meetingLink: meetingLink.trim() || null,
      notes: notes.trim() || null,
      panelEmployeeIds: panel.map((p) => p.id),
    };
    setSaving(true);
    try {
      const res = interview
        ? await recruitmentApi.updateInterview(interview.id, payload)
        : await recruitmentApi.scheduleInterview(applicationId, payload);
      toast.success(interview ? 'Interview updated' : 'Interview scheduled; the panel has been notified');
      onSaved(res.data);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to save the interview'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={interview ? 'Edit interview' : 'Schedule interview'} size="2xl">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Round" value={roundName} maxLength={100} onChange={(e) => setRoundName(e.target.value)} required />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <Input label="Start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          <Input label="End" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            id="interview-mode"
            label="Mode"
            options={(Object.keys(INTERVIEW_MODE_LABELS) as InterviewMode[]).map((m) => ({
              value: m,
              label: INTERVIEW_MODE_LABELS[m],
            }))}
            value={mode}
            onChange={(e) => setMode(e.target.value as InterviewMode)}
          />
          {mode === 'IN_PERSON' ? (
            <Input label="Location" value={location} maxLength={300} onChange={(e) => setLocation(e.target.value)} />
          ) : (
            <Input
              label="Meeting link"
              value={meetingLink}
              maxLength={500}
              onChange={(e) => setMeetingLink(e.target.value)}
            />
          )}
        </div>

        <div className="space-y-2">
          <p className="label">
            Panel ({panel.length}/{MAX_PANELISTS})
          </p>
          {panel.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {panel.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => toggle(p)}
                  className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100"
                  aria-label={`Remove ${p.firstName} ${p.lastName}`}
                >
                  {p.firstName} {p.lastName} ×
                </button>
              ))}
            </div>
          )}
          <Input
            aria-label="Search employees"
            placeholder="Search employees by name or code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul className="max-h-40 overflow-y-auto rounded-lg border border-warm-200" role="listbox" aria-label="Employees">
            {results.length === 0 && <li className="px-3 py-2 text-sm text-warm-500">No employees found</li>}
            {results.map((e) => (
              <li key={e.id} className="border-b border-warm-100 last:border-0">
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-warm-50">
                  <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggle(e)} />
                  {e.firstName} {e.lastName}
                  <span className="text-warm-400">{e.employeeCode}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="interview-notes" className="label">
            Notes for the panel
          </label>
          <textarea
            id="interview-notes"
            className="input min-h-[72px]"
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {interview ? 'Save changes' : 'Schedule'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
