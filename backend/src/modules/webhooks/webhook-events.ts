/**
 * The catalogue of events a webhook may subscribe to.
 *
 * This is the single source of truth: the controller validates subscriptions
 * against it, `GET /webhooks/events` serves it to the admin UI so the checkbox
 * list can never drift from what the dispatcher will actually fire, and the
 * dispatcher itself only ever emits names from this list.
 *
 * Adding an event here is safe. Renaming or removing one silently orphans the
 * subscriptions already stored in `webhooks.events`, so treat it as a breaking
 * change to every customer endpoint that subscribed to it.
 */
export const WEBHOOK_EVENTS = [
  'employee.created',
  'employee.updated',
  'employee.terminated',
  'leave.requested',
  'leave.approved',
  'leave.rejected',
  'leave.cancelled',
  'loan.approved',
  'ticket.created',
  'attendance.clocked_in',
  'attendance.clocked_out',
  'attendance.regularized',
  'expense.submitted',
  'expense.approved',
  'expense.rejected',
  'payroll.run_completed',
  'payroll.approved',
  'payroll.payslip_published',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}
