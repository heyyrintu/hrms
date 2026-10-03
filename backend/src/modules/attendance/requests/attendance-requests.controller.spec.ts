import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { AttendanceRequestsController } from './attendance-requests.controller';

describe('AttendanceRequestsController', () => {
  const user: any = {
    userId: 'u1',
    tenantId: 't1',
    role: UserRole.MANAGER,
    employeeId: 'e1',
  };
  let svc: Record<string, jest.Mock>;
  let controller: AttendanceRequestsController;

  beforeEach(() => {
    svc = {
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
      listMine: jest.fn().mockResolvedValue([]),
      listPendingApprovals: jest.fn().mockResolvedValue([]),
      listAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      approve: jest.fn().mockResolvedValue({}),
      reject: jest.fn().mockResolvedValue({}),
      cancel: jest.fn().mockResolvedValue({}),
    };
    controller = new AttendanceRequestsController(svc as any);
  });

  const roles = (method: keyof AttendanceRequestsController) =>
    Reflect.getMetadata(ROLES_KEY, AttendanceRequestsController.prototype[method]);

  it('delegates create, listMine and cancel with the actor', async () => {
    const dto: any = { type: 'WFH' };
    await controller.create(user, dto);
    await controller.listMine(user, { status: 'PENDING' as any });
    await controller.cancel(user, 'r1');
    expect(svc.create).toHaveBeenCalledWith(user, dto);
    expect(svc.listMine).toHaveBeenCalledWith(user, { status: 'PENDING' });
    expect(svc.cancel).toHaveBeenCalledWith(user, 'r1');
  });

  it('approve and reject pass the note', async () => {
    await controller.approve(user, 'r1', { note: 'ok' });
    await controller.reject(user, 'r1', { note: 'no' });
    expect(svc.approve).toHaveBeenCalledWith(user, 'r1', 'ok');
    expect(svc.reject).toHaveBeenCalledWith(user, 'r1', 'no');
  });

  it('listAll is scoped to the caller tenant', async () => {
    await controller.listAll(user, { type: 'WFH' as any });
    expect(svc.listAll).toHaveBeenCalledWith('t1', { type: 'WFH' });
  });

  it('restricts routes by role', () => {
    expect(roles('approve')).toEqual([UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN]);
    expect(roles('reject')).toEqual([UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN]);
    expect(roles('pendingApprovals')).toEqual([
      UserRole.MANAGER,
      UserRole.HR_ADMIN,
      UserRole.SUPER_ADMIN,
    ]);
    expect(roles('listAll')).toEqual([UserRole.HR_ADMIN, UserRole.SUPER_ADMIN]);
    expect(roles('create')).toBeUndefined();
    expect(roles('cancel')).toBeUndefined();
  });
});
