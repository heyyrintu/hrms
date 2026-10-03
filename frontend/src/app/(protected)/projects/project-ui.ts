import type { ProjectStatus } from "@/lib/api-projects";

/** Mirrors the backend rule: 2-20 characters of A-Z, 0-9 and "-". */
export const PROJECT_CODE_RE = /^[A-Z0-9-]{2,20}$/;
export const CODE_ERROR = "Code must be 2-20 characters: letters, digits or '-'";

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export const PROJECT_STATUS_VARIANT: Record<
  ProjectStatus,
  "success" | "warning" | "info" | "gray"
> = {
  ACTIVE: "success",
  ON_HOLD: "warning",
  COMPLETED: "info",
  ARCHIVED: "gray",
};

export function apiErrorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string | string[] } } };
  const message = e?.response?.data?.message;
  if (Array.isArray(message)) return message.join("; ");
  return message || fallback;
}

export interface EmployeeOption {
  id: string;
  label: string;
}

interface RawEmployee {
  id: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
}

/** Normalises the paginated employees list response into picker options. */
export function toEmployeeOptions(body: unknown): EmployeeOption[] {
  const list: RawEmployee[] = Array.isArray(body)
    ? body
    : ((body as { data?: RawEmployee[] } | undefined)?.data ?? []);
  return list.map((e) => ({
    id: e.id,
    label:
      `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() +
      (e.employeeCode ? ` (${e.employeeCode})` : ""),
  }));
}

export function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function monthStartIso(): string {
  return `${todayIso().slice(0, 8)}01`;
}
