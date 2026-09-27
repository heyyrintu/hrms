import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../../common/email/email.service';
import {
  createMockEmailService,
  createMockNotificationsService,
  createMockPrismaService,
  mockEmployee,
  mockHrAdmin,
  mockManager,
} from '../../test/helpers';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { InterviewsService } from './interviews.service';

const TENANT = 'test-tenant';
const START = new Date('2026-03-15T09:00:00Z');
const END = new Date('2026-03-15T10:00:00Z');

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    status: 'ACTIVE',
    candidate: { id: 'cand-1', firstName: 'Asha', lastName: 'Rao' },
    jobOpening: { id: 'open-1', title: 'Backend Engineer', hiringManagerId: 'emp-manager' },
    ...overrides,
  };
}

function interviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'int-1',
    tenantId: TENANT,
    applicationId: 'app-1',
    roundName: 'Technical',
    scheduledStart: START,
    scheduledEnd: END,
    mode: 'VIDEO',
    location: null,
    meetingLink: 'https://meet.example/x',
    status: 'SCHEDULED',
    notes: null,
    createdById: 'hr-admin-id',
    application: application(),
    panel: [
      {
        employeeId: 'emp-p1',
        employee: { id: 'emp-p1', employeeCode: 'E1', firstName: 'Pan', lastName: 'One', email: 'p1@test.com' },
      },
      {
        employeeId: 'emp-p2',
        employee: { id: 'emp-p2', employeeCode: 'E2', firstName: 'Pan', lastName: 'Two', email: 'p2@test.com' },
      },
    ],
    feedback: [] as Array<{ interviewerEmployeeId: string }>,
    ...overrides,
  };
}

const panelist1: AuthenticatedUser = { ...mockEmployee, userId: 'user-p1', employeeId: 'emp-p1' };
const panelist2: AuthenticatedUser = { ...mockEmployee, userId: 'user-p2', employeeId: 'emp-p2' };

function feedbackRow(employeeId: string) {
  return {
    id: `fb-${employeeId}`,
    interviewId: 'int-1',
    interviewerEmployeeId: employeeId,
    overallRating: 4,
    recommendation: 'HIRE',
    scores: [{ criterion: 'Design', rating: 4, comment: null }],
    strengths: 'Clear',
    concerns: null,
    submittedAt: new Date('2026-03-15T12:00:00Z'),
    interviewer: { id: employeeId, employeeCode: 'E', firstName: 'Pan', lastName: 'X' },
  };
}

describe('InterviewsService', () => {
  let service: InterviewsService;
  let prisma: any;
  let notifications: ReturnType<typeof createMockNotificationsService>;
  let email: ReturnType<typeof createMockEmailService>;

  const scheduleDto = {
    roundName: 'Technical',
    scheduledStart: START.toISOString(),
    scheduledEnd: END.toISOString(),
    panelEmployeeIds: ['emp-p1', 'emp-p2'],
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    notifications = createMockNotificationsService();
    email = createMockEmailService();
    const moduleRef = await Test.createTestingModule({
      providers: [
        InterviewsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://hr.example') } },
      ],
    }).compile();
    service = moduleRef.get(InterviewsService);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-p1' }, { id: 'user-p2' }]);
  });

  describe('schedule', () => {
    beforeEach(() => {
      prisma.jobApplication.findFirst.mockResolvedValue(application());
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-p1' }, { id: 'emp-p2' }]);
      prisma.interview.create.mockResolvedValue(interviewRow());
    });

    it('creates the interview with its panel, scoped to the tenant', async () => {
      const view = await service.schedule(mockHrAdmin, 'app-1', scheduleDto);

      expect(prisma.jobApplication.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'app-1', tenantId: TENANT } }),
      );
      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, id: { in: ['emp-p1', 'emp-p2'] }, status: 'ACTIVE' },
        }),
      );
      const data = prisma.interview.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        tenantId: TENANT,
        applicationId: 'app-1',
        roundName: 'Technical',
        createdById: 'hr-admin-id',
        panel: {
          create: [
            { tenantId: TENANT, employeeId: 'emp-p1' },
            { tenantId: TENANT, employeeId: 'emp-p2' },
          ],
        },
      });
      expect(view).toMatchObject({
        id: 'int-1',
        candidate: { id: 'cand-1', firstName: 'Asha', lastName: 'Rao' },
        jobOpening: { id: 'open-1', title: 'Backend Engineer' },
        scheduledStart: START.toISOString(),
        panel: [
          { id: 'emp-p1', employeeCode: 'E1', firstName: 'Pan', lastName: 'One' },
          { id: 'emp-p2', employeeCode: 'E2', firstName: 'Pan', lastName: 'Two' },
        ],
        feedbackSubmittedBy: [],
        myFeedbackDue: false,
      });
      // Panel e-mail addresses never leak into the view.
      expect(JSON.stringify(view)).not.toContain('p1@test.com');
    });

    it('notifies and e-mails every panelist', async () => {
      await service.schedule(mockHrAdmin, 'app-1', scheduleDto);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, employeeId: { in: ['emp-p1', 'emp-p2'] }, isActive: true },
        }),
      );
      const notes = notifications.createMany.mock.calls[0][0];
      expect(notes).toHaveLength(2);
      expect(notes[0]).toMatchObject({ tenantId: TENANT, type: 'INTERVIEW_SCHEDULED', link: '/recruitment/interviews' });
      expect(email.sendEmail).toHaveBeenCalledTimes(2);
      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'p1@test.com', template: 'interview-scheduled' }),
      );
    });

    it('lets the opening hiring manager schedule', async () => {
      await expect(service.schedule(mockManager, 'app-1', scheduleDto)).resolves.toBeDefined();
    });

    it('forbids a manager who is not the hiring manager', async () => {
      prisma.jobApplication.findFirst.mockResolvedValue(
        application({ jobOpening: { id: 'open-1', title: 'X', hiringManagerId: 'emp-other' } }),
      );
      await expect(service.schedule(mockManager, 'app-1', scheduleDto)).rejects.toThrow(ForbiddenException);
    });

    it('forbids a manager without an employee link', async () => {
      await expect(
        service.schedule({ ...mockManager, employeeId: undefined }, 'app-1', scheduleDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('forbids employees', async () => {
      await expect(service.schedule(mockEmployee, 'app-1', scheduleDto)).rejects.toThrow(ForbiddenException);
    });

    it('404s an application of another tenant', async () => {
      prisma.jobApplication.findFirst.mockResolvedValue(null);
      await expect(service.schedule(mockHrAdmin, 'app-x', scheduleDto)).rejects.toThrow(NotFoundException);
    });

    it('refuses an application that is not ACTIVE', async () => {
      prisma.jobApplication.findFirst.mockResolvedValue(application({ status: 'REJECTED' }));
      await expect(service.schedule(mockHrAdmin, 'app-1', scheduleDto)).rejects.toThrow(BadRequestException);
    });

    it('requires the end after the start', async () => {
      await expect(
        service.schedule(mockHrAdmin, 'app-1', { ...scheduleDto, scheduledEnd: START.toISOString() }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.interview.create).not.toHaveBeenCalled();
    });

    it('requires every panelist to be an active employee of the tenant', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-p1' }]);
      await expect(service.schedule(mockHrAdmin, 'app-1', scheduleDto)).rejects.toThrow(BadRequestException);
      expect(prisma.interview.create).not.toHaveBeenCalled();
    });

    it('refuses an empty or oversized panel', async () => {
      await expect(
        service.schedule(mockHrAdmin, 'app-1', { ...scheduleDto, panelEmployeeIds: [] }),
      ).rejects.toThrow(BadRequestException);
      const eleven = Array.from({ length: 11 }, (_, i) => `emp-${i}`);
      await expect(
        service.schedule(mockHrAdmin, 'app-1', { ...scheduleDto, panelEmployeeIds: eleven }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('reschedules and replaces the panel', async () => {
      prisma.interview.findFirst
        .mockResolvedValueOnce(interviewRow())
        .mockResolvedValueOnce(interviewRow());
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-p1' }, { id: 'emp-p3' }]);
      prisma.interview.update.mockResolvedValue({});
      prisma.interviewPanelist.deleteMany.mockResolvedValue({ count: 1 });
      prisma.interviewPanelist.createMany.mockResolvedValue({ count: 1 });

      await service.update(mockHrAdmin, 'int-1', {
        scheduledStart: '2026-03-16T09:00:00Z',
        scheduledEnd: '2026-03-16T10:00:00Z',
        panelEmployeeIds: ['emp-p1', 'emp-p3'],
      });

      expect(prisma.interviewPanelist.deleteMany).toHaveBeenCalledWith({
        where: { interviewId: 'int-1', employeeId: { in: ['emp-p2'] } },
      });
      expect(prisma.interviewPanelist.createMany).toHaveBeenCalledWith({
        data: [{ tenantId: TENANT, interviewId: 'int-1', employeeId: 'emp-p3' }],
        skipDuplicates: true,
      });
      expect(prisma.interview.update.mock.calls[0][0].data).toMatchObject({
        scheduledStart: new Date('2026-03-16T09:00:00Z'),
        scheduledEnd: new Date('2026-03-16T10:00:00Z'),
      });
    });

    it('will not drop a panelist who has already given feedback', async () => {
      prisma.interview.findFirst.mockResolvedValue(
        interviewRow({ feedback: [{ interviewerEmployeeId: 'emp-p2' }] }),
      );
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-p1' }]);
      await expect(
        service.update(mockHrAdmin, 'int-1', { panelEmployeeIds: ['emp-p1'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('checks the end stays after the start', async () => {
      prisma.interview.findFirst.mockResolvedValue(interviewRow());
      await expect(
        service.update(mockHrAdmin, 'int-1', { scheduledEnd: '2026-03-15T08:00:00Z' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('only edits SCHEDULED interviews', async () => {
      prisma.interview.findFirst.mockResolvedValue(interviewRow({ status: 'COMPLETED' }));
      await expect(service.update(mockHrAdmin, 'int-1', { roundName: 'x' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('setStatus', () => {
    it('moves a SCHEDULED interview with a guarded update', async () => {
      prisma.interview.findFirst
        .mockResolvedValueOnce(interviewRow())
        .mockResolvedValueOnce(interviewRow({ status: 'COMPLETED' }));
      prisma.interview.updateMany.mockResolvedValue({ count: 1 });

      const view = await service.setStatus(mockHrAdmin, 'int-1', 'COMPLETED');

      expect(prisma.interview.updateMany).toHaveBeenCalledWith({
        where: { id: 'int-1', tenantId: TENANT, status: 'SCHEDULED' },
        data: { status: 'COMPLETED' },
      });
      expect(view.status).toBe('COMPLETED');
    });

    it('409s when another request changed it first', async () => {
      prisma.interview.findFirst.mockResolvedValue(interviewRow());
      prisma.interview.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.setStatus(mockHrAdmin, 'int-1', 'CANCELLED')).rejects.toThrow(ConflictException);
    });

    it('refuses terminal interviews', async () => {
      prisma.interview.findFirst.mockResolvedValue(interviewRow({ status: 'CANCELLED' }));
      await expect(service.setStatus(mockHrAdmin, 'int-1', 'NO_SHOW')).rejects.toThrow(BadRequestException);
    });

    it('forbids a non hiring manager', async () => {
      prisma.interview.findFirst.mockResolvedValue(
        interviewRow({ application: application({ jobOpening: { id: 'o', title: 't', hiringManagerId: 'emp-x' } }) }),
      );
      await expect(service.setStatus(mockManager, 'int-1', 'CANCELLED')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('mine', () => {
    it('returns [] without an employee link and never queries', async () => {
      await expect(service.mine({ ...mockEmployee, employeeId: undefined })).resolves.toEqual([]);
      expect(prisma.interview.findMany).not.toHaveBeenCalled();
    });

    it("lists the actor's panel interviews with myFeedbackDue", async () => {
      prisma.interview.findMany.mockResolvedValue([
        interviewRow(),
        interviewRow({ id: 'int-2', feedback: [{ interviewerEmployeeId: 'emp-p1' }] }),
      ]);

      const views = await service.mine(panelist1);

      expect(prisma.interview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, panel: { some: { employeeId: 'emp-p1' } } },
        }),
      );
      expect(views.map((v) => v.myFeedbackDue)).toEqual([true, false]);
      expect(views[1].feedbackSubmittedBy).toEqual(['emp-p1']);
    });
  });

  describe('listFeedback', () => {
    beforeEach(() => {
      prisma.interviewFeedback.findMany.mockResolvedValue([feedbackRow('emp-p2')]);
    });

    it('shows everything to HR', async () => {
      prisma.interview.findFirst.mockResolvedValue(interviewRow({ feedback: [{ interviewerEmployeeId: 'emp-p2' }] }));
      const res = await service.listFeedback(mockHrAdmin, 'int-1');
      expect(res.visible).toBe(true);
      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toMatchObject({
        interviewer: { id: 'emp-p2' },
        scores: [{ criterion: 'Design', rating: 4, comment: null }],
        submittedAt: '2026-03-15T12:00:00.000Z',
      });
    });

    it('shows everything to the hiring manager', async () => {
      prisma.interview.findFirst.mockResolvedValue(interviewRow());
      const res = await service.listFeedback(mockManager, 'int-1');
      expect(res.visible).toBe(true);
    });

    it("hides others' feedback from a panelist who has not submitted", async () => {
      prisma.interview.findFirst.mockResolvedValue(interviewRow({ feedback: [{ interviewerEmployeeId: 'emp-p2' }] }));
      const res = await service.listFeedback(panelist1, 'int-1');
      expect(res).toEqual({ visible: false, items: [] });
      expect(prisma.interviewFeedback.findMany).not.toHaveBeenCalled();
    });

    it('shows it to a panelist after they submitted', async () => {
      prisma.interview.findFirst.mockResolvedValue(interviewRow({ feedback: [{ interviewerEmployeeId: 'emp-p2' }] }));
      const res = await service.listFeedback(panelist2, 'int-1');
      expect(res.visible).toBe(true);
    });

    it('forbids anyone else', async () => {
      prisma.interview.findFirst.mockResolvedValue(interviewRow());
      await expect(service.listFeedback(mockEmployee, 'int-1')).rejects.toThrow(ForbiddenException);
      await expect(
        service.listFeedback({ ...mockEmployee, employeeId: undefined }, 'int-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('404s an interview of another tenant', async () => {
      prisma.interview.findFirst.mockResolvedValue(null);
      await expect(service.listFeedback(mockHrAdmin, 'int-x')).rejects.toThrow(NotFoundException);
      expect(prisma.interview.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'int-x', tenantId: TENANT } }),
      );
    });
  });

  describe('submitFeedback', () => {
    const dto = {
      overallRating: 4,
      recommendation: 'HIRE' as const,
      scores: [{ criterion: ' Design ', rating: 4 }],
      strengths: 'Clear',
    };

    beforeEach(() => {
      prisma.interview.findFirst.mockResolvedValue(interviewRow());
      prisma.interviewFeedback.findUnique.mockResolvedValue(null);
      prisma.interviewFeedback.upsert.mockResolvedValue(feedbackRow('emp-p1'));
    });

    it('lets a panelist submit once and notifies HR and the hiring manager', async () => {
      const view = await service.submitFeedback(panelist1, 'int-1', dto);

      const args = prisma.interviewFeedback.upsert.mock.calls[0][0];
      expect(args.where).toEqual({
        interviewId_interviewerEmployeeId: { interviewId: 'int-1', interviewerEmployeeId: 'emp-p1' },
      });
      expect(args.create).toMatchObject({
        tenantId: TENANT,
        interviewId: 'int-1',
        interviewerEmployeeId: 'emp-p1',
        overallRating: 4,
        recommendation: 'HIRE',
        scores: [{ criterion: 'Design', rating: 4, comment: null }],
        strengths: 'Clear',
        concerns: null,
      });
      expect(view.interviewer.id).toBe('emp-p1');
      expect(notifications.notifyByRole).toHaveBeenCalledWith(
        TENANT,
        ['HR_ADMIN'],
        'INTERVIEW_FEEDBACK_SUBMITTED',
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        TENANT,
        'emp-manager',
        'INTERVIEW_FEEDBACK_SUBMITTED',
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
    });

    it('allows the same panelist to update without notifying again', async () => {
      prisma.interviewFeedback.findUnique.mockResolvedValue({ id: 'fb-emp-p1' });
      await service.submitFeedback(panelist1, 'int-1', dto);
      expect(prisma.interviewFeedback.upsert).toHaveBeenCalled();
      expect(notifications.notifyByRole).not.toHaveBeenCalled();
    });

    it('forbids a non-panelist, even HR', async () => {
      await expect(service.submitFeedback(mockHrAdmin, 'int-1', dto)).rejects.toThrow(ForbiddenException);
      await expect(
        service.submitFeedback({ ...mockEmployee, employeeId: undefined }, 'int-1', dto),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.interviewFeedback.upsert).not.toHaveBeenCalled();
    });

    it('closes feedback once the application left ACTIVE', async () => {
      prisma.interview.findFirst.mockResolvedValue(interviewRow({ application: application({ status: 'HIRED' }) }));
      await expect(service.submitFeedback(panelist1, 'int-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('refuses feedback on a cancelled interview', async () => {
      prisma.interview.findFirst.mockResolvedValue(interviewRow({ status: 'CANCELLED' }));
      await expect(service.submitFeedback(panelist1, 'int-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('refuses more than 20 score rows', async () => {
      const scores = Array.from({ length: 21 }, (_, i) => ({ criterion: `c${i}`, rating: 3 }));
      await expect(service.submitFeedback(panelist1, 'int-1', { ...dto, scores })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
