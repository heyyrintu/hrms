import { TicketStatus } from '@prisma/client';

/**
 * Who is driving a status change, ranked. A person can be more than one of
 * these at once (HR raising their own ticket, an assignee who also owns it);
 * the caller resolves that to the highest rank before asking this table,
 * because HR's rights are a superset of the assignee's and the assignee's of
 * the owner's.
 */
export type TicketActor = 'HR' | 'ASSIGNEE' | 'OWNER';

/**
 * The transitions HR and the assigned agent may drive.
 *
 * Deliberately not a general state machine: CLOSED is terminal, and there is
 * no path back to OPEN once work has started — a reopen lands in IN_PROGRESS
 * so the ticket stays owned by whoever was working it.
 */
const STAFF_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  [TicketStatus.OPEN]: [TicketStatus.IN_PROGRESS],
  [TicketStatus.IN_PROGRESS]: [TicketStatus.WAITING_ON_EMPLOYEE, TicketStatus.RESOLVED],
  [TicketStatus.WAITING_ON_EMPLOYEE]: [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED],
  [TicketStatus.RESOLVED]: [TicketStatus.CLOSED, TicketStatus.IN_PROGRESS],
  [TicketStatus.CLOSED]: [],
};

/**
 * What the person who raised the ticket may do: accept the resolution, or
 * say it is not fixed. They may not start, park or resolve their own ticket —
 * that would let anyone mark their own request done.
 */
const OWNER_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  [TicketStatus.OPEN]: [],
  [TicketStatus.IN_PROGRESS]: [],
  [TicketStatus.WAITING_ON_EMPLOYEE]: [],
  [TicketStatus.RESOLVED]: [TicketStatus.CLOSED, TicketStatus.IN_PROGRESS],
  [TicketStatus.CLOSED]: [],
};

const tableFor = (actor: TicketActor) =>
  actor === 'OWNER' ? OWNER_TRANSITIONS : STAFF_TRANSITIONS;

/**
 * Every status this actor may move the ticket to from `from`. Used by the API
 * so the UI can offer exactly the buttons the caller is allowed to press.
 */
export function allowedNextStatuses(
  from: TicketStatus,
  actor: TicketActor,
): TicketStatus[] {
  return [...(tableFor(actor)[from] ?? [])];
}

/**
 * Whether `actor` may move a ticket from `from` to `to`. A transition to the
 * status it is already in is never allowed, so a repeated request cannot
 * re-stamp `resolvedAt` or re-fire a notification.
 */
export function canTransition(
  from: TicketStatus,
  to: TicketStatus,
  actor: TicketActor,
): boolean {
  if (from === to) return false;
  return (tableFor(actor)[from] ?? []).includes(to);
}
