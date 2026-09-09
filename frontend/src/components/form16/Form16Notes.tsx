'use client';

import { Info } from 'lucide-react';

interface Form16NotesProps {
  /** Notes from the certificate, and from the quarterly summary when fetched. */
  notes: string[];
}

/**
 * The caveats the payroll service attached to this certificate: the standing
 * TRACES note, and any warning about declared amounts that were not ceiling
 * checked or about tax slabs that were never configured. They are never
 * dropped — a caveat that is not shown is a caveat nobody acted on.
 */
export function Form16Notes({ notes }: Form16NotesProps) {
  const unique = notes.filter((note, index) => note && notes.indexOf(note) === index);

  if (unique.length === 0) return null;

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
      <div className="flex items-start gap-3">
        <Info className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
        <div className="w-full">
          <p className="text-sm font-semibold text-sky-900">
            Notes from the payroll service on this certificate
          </p>
          <ul className="mt-2 space-y-1.5 list-disc list-outside pl-4">
            {unique.map((note) => (
              <li key={note} className="text-sm text-sky-800">
                {note}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
