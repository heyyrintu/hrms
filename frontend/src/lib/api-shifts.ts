/**
 * Shift types and helpers. The shift HTTP calls themselves stay on
 * `shiftsApi` in `@/lib/api`; this module adds what the admin page needs to
 * reason about night shifts.
 */

/** Mirrors the backend `Shift` row. */
export interface Shift {
    id: string;
    name: string;
    code: string;
    /** "HH:mm" */
    startTime: string;
    /** "HH:mm"; at or before `startTime` means the shift ends the next day. */
    endTime: string;
    breakMinutes: number;
    standardWorkMinutes: number;
    graceMinutes: number;
    /**
     * Derived by the server from the times. Rows created before the column
     * existed may still read false, so prefer `isOvernightShift(start, end)`.
     */
    isOvernight?: boolean;
    isActive: boolean;
}

/**
 * The editable fields. `isOvernight` is deliberately absent: the server
 * derives it from the times and rejects a value that disagrees with them.
 */
export type ShiftInput = Pick<
    Shift,
    | 'name'
    | 'code'
    | 'startTime'
    | 'endTime'
    | 'breakMinutes'
    | 'standardWorkMinutes'
    | 'graceMinutes'
>;

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(value: string | null | undefined): number | null {
    const match = HH_MM.exec((value ?? '').trim());
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Same rule as the server: an end at or before the start crosses midnight
 * (an equal pair is a 24-hour shift). False while either time is incomplete.
 */
export function isOvernightShift(
    startTime: string | null | undefined,
    endTime: string | null | undefined,
): boolean {
    const start = toMinutes(startTime);
    const end = toMinutes(endTime);
    return start !== null && end !== null && end <= start;
}
