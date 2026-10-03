import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UserRole } from '@prisma/client';
import { UtilisationController } from './utilisation.controller';
import { UtilisationQueryDto } from './dto/utilisation.dto';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

const user: AuthenticatedUser = {
  userId: 'u',
  email: 'x@test.com',
  tenantId: 't',
  role: UserRole.HR_ADMIN,
};

describe('UtilisationController', () => {
  it('sets the CSV content type and a descriptive filename', async () => {
    const service = { exportCsv: jest.fn().mockResolvedValue('a,b') };
    const controller = new UtilisationController(service as any);
    const res = { setHeader: jest.fn() };
    const query = { from: '2026-03-01', to: '2026-03-31', groupBy: 'employee' } as UtilisationQueryDto;

    const body = await controller.exportCsv(user, query, res as any);

    expect(body).toBe('a,b');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="utilisation-2026-03-01-2026-03-31-employee.csv"',
    );
  });
});

describe('UtilisationQueryDto', () => {
  const parse = (raw: Record<string, unknown>) => plainToInstance(UtilisationQueryDto, raw);

  it('accepts a valid query and turns includeSubmitted=true into a boolean', async () => {
    const dto = parse({
      from: '2026-03-01',
      to: '2026-03-31',
      groupBy: 'project',
      includeSubmitted: 'true',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.includeSubmitted).toBe(true);
  });

  it('treats includeSubmitted=false as false', () => {
    expect(parse({ from: 'a', to: 'b', groupBy: 'employee', includeSubmitted: 'false' }).includeSubmitted).toBe(
      false,
    );
  });

  it('rejects an unknown groupBy and a bad date', async () => {
    const errors = await validate(parse({ from: 'nope', to: '2026-03-31', groupBy: 'team' }));
    expect(errors.map((e) => e.property).sort()).toEqual(['from', 'groupBy']);
  });
});
