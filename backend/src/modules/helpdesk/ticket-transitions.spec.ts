import { TicketStatus } from '@prisma/client';
import { canTransition, allowedNextStatuses, TicketActor } from './ticket-transitions';

/**
 * The transition table is the one piece of helpdesk policy that has no
 * database in it, so it is tested exhaustively: every (from, to, actor)
 * triple is asserted, not just the happy paths.
 */
describe('ticket-transitions', () => {
  const statuses = Object.values(TicketStatus);
  const actors: TicketActor[] = ['HR', 'ASSIGNEE', 'OWNER'];

  /** The transitions HR and the assignee may drive, per the spec. */
  const staffTransitions: Array<[TicketStatus, TicketStatus]> = [
    [TicketStatus.OPEN, TicketStatus.IN_PROGRESS],
    [TicketStatus.IN_PROGRESS, TicketStatus.WAITING_ON_EMPLOYEE],
    [TicketStatus.WAITING_ON_EMPLOYEE, TicketStatus.IN_PROGRESS],
    [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED],
    [TicketStatus.WAITING_ON_EMPLOYEE, TicketStatus.RESOLVED],
    [TicketStatus.RESOLVED, TicketStatus.CLOSED],
    [TicketStatus.RESOLVED, TicketStatus.IN_PROGRESS],
  ];

  /** The owner of a ticket may only accept the resolution or reopen it. */
  const ownerTransitions: Array<[TicketStatus, TicketStatus]> = [
    [TicketStatus.RESOLVED, TicketStatus.CLOSED],
    [TicketStatus.RESOLVED, TicketStatus.IN_PROGRESS],
  ];

  const allowedFor = (actor: TicketActor) =>
    actor === 'OWNER' ? ownerTransitions : staffTransitions;

  describe('canTransition', () => {
    it.each(actors)('allows exactly the listed transitions for %s', (actor) => {
      const allowed = allowedFor(actor);
      for (const from of statuses) {
        for (const to of statuses) {
          const expected = allowed.some(([f, t]) => f === from && t === to);
          expect({ from, to, actor, result: canTransition(from, to, actor) }).toEqual({
            from,
            to,
            actor,
            result: expected,
          });
        }
      }
    });

    it('never allows a no-op transition', () => {
      for (const status of statuses) {
        for (const actor of actors) {
          expect(canTransition(status, status, actor)).toBe(false);
        }
      }
    });

    it('never lets any actor move out of CLOSED', () => {
      for (const to of statuses) {
        for (const actor of actors) {
          expect(canTransition(TicketStatus.CLOSED, to, actor)).toBe(false);
        }
      }
    });

    it('does not let the owner take a ticket from OPEN to IN_PROGRESS', () => {
      expect(canTransition(TicketStatus.OPEN, TicketStatus.IN_PROGRESS, 'OWNER')).toBe(false);
      expect(canTransition(TicketStatus.OPEN, TicketStatus.IN_PROGRESS, 'HR')).toBe(true);
    });

    it('does not let the owner resolve their own ticket', () => {
      expect(canTransition(TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED, 'OWNER')).toBe(false);
      expect(canTransition(TicketStatus.WAITING_ON_EMPLOYEE, TicketStatus.RESOLVED, 'OWNER')).toBe(
        false,
      );
    });

    it('lets the owner close or reopen a resolved ticket', () => {
      expect(canTransition(TicketStatus.RESOLVED, TicketStatus.CLOSED, 'OWNER')).toBe(true);
      expect(canTransition(TicketStatus.RESOLVED, TicketStatus.IN_PROGRESS, 'OWNER')).toBe(true);
    });
  });

  describe('allowedNextStatuses', () => {
    it('lists what HR may do with an open ticket', () => {
      expect(allowedNextStatuses(TicketStatus.OPEN, 'HR')).toEqual([TicketStatus.IN_PROGRESS]);
    });

    it('lists both branches out of IN_PROGRESS for the assignee', () => {
      expect(allowedNextStatuses(TicketStatus.IN_PROGRESS, 'ASSIGNEE').sort()).toEqual(
        [TicketStatus.RESOLVED, TicketStatus.WAITING_ON_EMPLOYEE].sort(),
      );
    });

    it('gives the owner nothing to do on an open ticket', () => {
      expect(allowedNextStatuses(TicketStatus.OPEN, 'OWNER')).toEqual([]);
    });

    it('gives the owner close and reopen on a resolved ticket', () => {
      expect(allowedNextStatuses(TicketStatus.RESOLVED, 'OWNER').sort()).toEqual(
        [TicketStatus.CLOSED, TicketStatus.IN_PROGRESS].sort(),
      );
    });

    it('gives nobody anything to do on a closed ticket', () => {
      for (const actor of actors) {
        expect(allowedNextStatuses(TicketStatus.CLOSED, actor)).toEqual([]);
      }
    });
  });
});
