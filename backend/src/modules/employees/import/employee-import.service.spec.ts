import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { WebhookDispatcherService } from '../../webhooks/webhook-dispatcher.service';
import { createMockPrismaService } from '../../../test/helpers';
import { EmployeeImportService } from './employee-import.service';
import { parseCsv } from './csv-parser';

const TENANT = 'tenant-1';
const USER = 'user-1';

const HEADER =
  'employeeCode,firstName,lastName,email,joinDate,departmentCode,designationName,branchName,managerEmployeeCode,employmentType,phone,dateOfBirth,gender,role';

function csv(...rows: string[]) {
  return [HEADER, ...rows].join('\n');
}

describe('parseCsv', () => {
  it('splits plain rows on commas and newlines', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quoted fields with commas, quotes and newlines', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
    ]);
    expect(parseCsv('a\n"line1\nline2"')).toEqual([['a'], ['line1\nline2']]);
  });

  it('handles CRLF and strips a UTF-8 BOM', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('throws on an unterminated quoted field', () => {
    expect(() => parseCsv('a\n"oops')).toThrow(/Unterminated/);
  });
});

/** Let fire-and-forget work queued by the service run to its next await. */
const flushBackground = () => new Promise((resolve) => setImmediate(resolve));

describe('EmployeeImportService', () => {
  let service: EmployeeImportService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let audit: { log: jest.Mock };
  let webhooks: { dispatch: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    audit = { log: jest.fn().mockResolvedValue({}) };
    webhooks = { dispatch: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: WebhookDispatcherService, useValue: webhooks },
      ],
    }).compile();

    service = module.get(EmployeeImportService);

    // Empty tenant by default.
    (prisma.employee.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.department.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.designation.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.branch.findMany as jest.Mock).mockResolvedValue([]);
  });

  const dryRun = (text: string) =>
    service.importFromCsv(TENANT, USER, text, { dryRun: true });

  describe('header handling', () => {
    it('matches header names case-insensitively and ignores surrounding space', async () => {
      const text = ' EMPLOYEECODE , FirstName ,lastname,EMAIL,JoinDate\nE1,Asha,Rao,a@x.com,2026-03-15';
      const result = await dryRun(text);
      expect(result.totalRows).toBe(1);
      expect(result.invalidRows).toBe(0);
      expect(result.errors).toEqual([]);
    });

    // The columns resolve Designation and Branch by name, not by any code
    // column — those models have none — so the headers were renamed. A file
    // written against the first release must keep importing.
    it('still accepts the retired designationCode / branchCode spellings', async () => {
      (prisma.designation.findMany as jest.Mock).mockResolvedValue([{ id: 'g1', name: 'SDE' }]);
      (prisma.branch.findMany as jest.Mock).mockResolvedValue([{ id: 'b1', name: 'HQ' }]);

      const text = [
        'employeeCode,firstName,lastName,email,joinDate,designationCode,branchCode',
        'E1,Asha,Rao,a@x.com,2026-03-15,SDE,HQ',
      ].join('\n');

      const result = await dryRun(text);

      expect(result.errors).toEqual([]);
      expect(prisma.designation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT, name: { in: ['SDE'] } } }),
      );
      expect(prisma.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT, name: { in: ['HQ'] } } }),
      );
    });

    it('rejects a header missing a required column', async () => {
      await expect(dryRun('employeeCode,firstName,lastName,email\nE1,A,B,a@x.com')).rejects.toThrow(
        /missing required column\(s\): joinDate/,
      );
    });

    it('rejects an empty file', async () => {
      await expect(dryRun('\n\n')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('row validation', () => {
    it('flags missing required fields against the 1-based data row number', async () => {
      const result = await dryRun(csv(',Asha,Rao,a@x.com,2026-03-15', 'E2,,Rao,b@x.com,2026-03-15'));

      expect(result.totalRows).toBe(2);
      expect(result.validRows).toBe(0);
      expect(result.invalidRows).toBe(2);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          { row: 1, field: 'employeeCode', message: 'employeeCode is required' },
          { row: 2, field: 'firstName', message: 'firstName is required' },
        ]),
      );
    });

    it('flags bad dates, emails, employmentType and role', async () => {
      const result = await dryRun(
        csv(
          'E1,Asha,Rao,not-an-email,2026-13-45,,,,,WIZARD,,2026-02-31,,GOD',
        ),
      );

      const fields = result.errors.map((e) => e.field).sort();
      expect(fields).toEqual(
        ['dateOfBirth', 'email', 'employmentType', 'joinDate', 'role'].sort(),
      );
      expect(result.invalidRows).toBe(1);
    });

    it('accepts valid enum values in any case', async () => {
      const result = await dryRun(csv('E1,Asha,Rao,a@x.com,2026-03-15,,,,,contract,,,,hr_admin'));
      expect(result.errors).toEqual([]);
    });
  });

  describe('duplicate detection', () => {
    it('flags employeeCode and email duplicated inside the file', async () => {
      const result = await dryRun(
        csv('E1,Asha,Rao,a@x.com,2026-03-15', 'E1,Bina,Sen,A@X.com,2026-03-16'),
      );

      expect(result.invalidRows).toBe(1);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ row: 2, field: 'employeeCode', message: expect.stringContaining('duplicated') }),
          expect.objectContaining({ row: 2, field: 'email', message: expect.stringContaining('duplicated') }),
        ]),
      );
    });

    it('flags an employeeCode or email already present in the tenant', async () => {
      (prisma.employee.findMany as jest.Mock).mockResolvedValue([
        { id: 'e-old', employeeCode: 'E1', email: 'old@x.com' },
      ]);
      (prisma.user.findMany as jest.Mock).mockResolvedValue([{ email: 'b@x.com' }]);

      const result = await dryRun(
        csv('E1,Asha,Rao,a@x.com,2026-03-15', 'E2,Bina,Sen,b@x.com,2026-03-15'),
      );

      expect(result.invalidRows).toBe(2);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ row: 1, field: 'employeeCode', message: expect.stringContaining('already exists') }),
          expect.objectContaining({ row: 2, field: 'email', message: expect.stringContaining('already exists') }),
        ]),
      );
    });

    // Postgres equality and @@unique([tenantId, email]) are both
    // case-sensitive, so an exact lookup would miss the existing row and the
    // importer would create a second account nobody can log in to.
    it('catches an existing address that differs only in case', async () => {
      (prisma.employee.findMany as jest.Mock).mockResolvedValue([
        { id: 'e-old', employeeCode: 'E9', email: 'John.Doe@acme.com' },
      ]);

      const result = await dryRun(csv('E1,John,Doe,john.doe@acme.com,2026-03-15'));

      expect(result.invalidRows).toBe(1);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            row: 1,
            field: 'email',
            message: expect.stringContaining('already exists'),
          }),
        ]),
      );
    });

    it('asks the database for emails case-insensitively', async () => {
      await dryRun(csv('E1,John,Doe,John.Doe@acme.com,2026-03-15'));

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT,
            OR: [{ email: { equals: 'John.Doe@acme.com', mode: 'insensitive' } }],
          },
        }),
      );
      expect((prisma.employee.findMany as jest.Mock).mock.calls[0][0].where.OR).toEqual(
        expect.arrayContaining([
          { email: { equals: 'John.Doe@acme.com', mode: 'insensitive' } },
        ]),
      );
    });

    it('scopes every validation lookup to the caller tenant', async () => {
      await dryRun(csv('E1,Asha,Rao,a@x.com,2026-03-15,ENG,SDE,HQ,M1'));

      // Every read that decides whether a row is valid must be tenant-scoped,
      // or one tenant's codes could satisfy another tenant's import.
      const models = ['employee', 'user', 'department', 'designation', 'branch'] as const;
      for (const model of models) {
        const mock = prisma[model].findMany as jest.Mock;
        expect(mock).toHaveBeenCalled();
        for (const [args] of mock.mock.calls) {
          expect(args.where.tenantId).toBe(TENANT);
        }
      }
    });
  });

  describe('lookups', () => {
    it('resolves department, designation and branch codes', async () => {
      (prisma.department.findMany as jest.Mock).mockResolvedValue([{ id: 'd1', code: 'ENG' }]);
      (prisma.designation.findMany as jest.Mock).mockResolvedValue([{ id: 'g1', name: 'SDE' }]);
      (prisma.branch.findMany as jest.Mock).mockResolvedValue([{ id: 'b1', name: 'HQ' }]);

      const result = await dryRun(csv('E1,Asha,Rao,a@x.com,2026-03-15,ENG,SDE,HQ'));
      expect(result.errors).toEqual([]);
    });

    it('flags codes that resolve to nothing', async () => {
      const result = await dryRun(csv('E1,Asha,Rao,a@x.com,2026-03-15,NOPE,ALSO,GONE'));
      expect(result.errors.map((e) => e.field).sort()).toEqual([
        'branchName',
        'departmentCode',
        'designationName',
      ]);
    });

    it('resolves managerEmployeeCode against an existing tenant employee', async () => {
      (prisma.employee.findMany as jest.Mock).mockResolvedValue([
        { id: 'mgr-1', employeeCode: 'M1', email: 'm@x.com' },
      ]);
      const result = await dryRun(csv('E1,Asha,Rao,a@x.com,2026-03-15,,,,M1'));
      expect(result.errors).toEqual([]);
    });

    it('resolves managerEmployeeCode against an earlier row of the same file', async () => {
      const result = await dryRun(
        csv('M1,Meera,Nair,m@x.com,2026-01-01', 'E1,Asha,Rao,a@x.com,2026-03-15,,,,M1'),
      );
      expect(result.errors).toEqual([]);
      expect(result.validRows).toBe(2);
    });

    it('rejects a manager defined only on a later row', async () => {
      const result = await dryRun(
        csv('E1,Asha,Rao,a@x.com,2026-03-15,,,,M1', 'M1,Meera,Nair,m@x.com,2026-01-01'),
      );
      expect(result.errors).toEqual([
        expect.objectContaining({ row: 1, field: 'managerEmployeeCode' }),
      ]);
    });
  });

  describe('limits', () => {
    it('rejects more than 2000 data rows', async () => {
      const rows = Array.from({ length: 2001 }, (_, i) => `E${i},A,B,a${i}@x.com,2026-03-15`);
      await expect(dryRun(csv(...rows))).rejects.toThrow(/maximum is 2000/);
    });

    it('accepts exactly 2000 data rows', async () => {
      const rows = Array.from({ length: 2000 }, (_, i) => `E${i},A,B,a${i}@x.com,2026-03-15`);
      const result = await dryRun(csv(...rows));
      expect(result.totalRows).toBe(2000);
      expect(result.invalidRows).toBe(0);
    });

    it('rejects a file larger than 2 MB', async () => {
      const big = csv(`E1,Asha,Rao,a@x.com,2026-03-15,,,,,,,,${'x'.repeat(2 * 1024 * 1024 + 10)}`);
      await expect(dryRun(big)).rejects.toThrow(/larger than 2 MB/);
    });
  });

  describe('dry run', () => {
    it('creates nothing and reports counts', async () => {
      const result = await dryRun(
        csv('E1,Asha,Rao,a@x.com,2026-03-15', ',Bad,Row,b@x.com,2026-03-15'),
      );

      expect(result).toMatchObject({ totalRows: 2, validRows: 1, invalidRows: 1, created: 0 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.employee.create).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
      expect(webhooks.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('real run', () => {
    const realRun = (text: string, initialPassword = 'initial-secret') =>
      service.importFromCsv(TENANT, USER, text, { dryRun: false, initialPassword });

    beforeEach(() => {
      (prisma.employee.create as jest.Mock).mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `emp-${data.employeeCode}`, ...data }),
      );
      (prisma.user.create as jest.Mock).mockResolvedValue({ id: 'u1' });
    });

    // EmployeesService.create writes the address verbatim and AuthService
    // .login matches it exactly, so normalising here would produce an account
    // whose owner can never sign in.
    it('stores the address exactly as the CSV spelled it', async () => {
      await realRun(csv('E1,John,Doe, John.Doe@Acme.com ,2026-03-15'));

      expect((prisma.employee.create as jest.Mock).mock.calls[0][0].data.email).toBe(
        'John.Doe@Acme.com',
      );
      expect((prisma.user.create as jest.Mock).mock.calls[0][0].data.email).toBe(
        'John.Doe@Acme.com',
      );
    });

    it('creates employees and users inside one transaction', async () => {
      const result = await realRun(csv('E1,Asha,Rao,a@x.com,2026-03-15,,,,,CONTRACT,+91,1990-05-02,F,MANAGER'));

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result.created).toBe(1);

      const empData = (prisma.employee.create as jest.Mock).mock.calls[0][0].data;
      expect(empData).toMatchObject({
        tenantId: TENANT,
        employeeCode: 'E1',
        firstName: 'Asha',
        email: 'a@x.com',
        employmentType: 'CONTRACT',
        gender: 'F',
        phone: '+91',
        status: 'ACTIVE',
      });
      expect(empData.joinDate.toISOString()).toBe('2026-03-15T12:00:00.000Z');
      expect(empData.dateOfBirth.toISOString()).toBe('1990-05-02T12:00:00.000Z');

      const userData = (prisma.user.create as jest.Mock).mock.calls[0][0].data;
      expect(userData).toMatchObject({
        tenantId: TENANT,
        email: 'a@x.com',
        role: 'MANAGER',
        employeeId: 'emp-E1',
        isActive: true,
        mustChangePassword: true,
      });
      expect(userData.passwordHash).not.toBe('initial-secret');    });

    it('defaults employmentType to PERMANENT and role to EMPLOYEE', async () => {
      await realRun(csv('E1,Asha,Rao,a@x.com,2026-03-15'));
      expect((prisma.employee.create as jest.Mock).mock.calls[0][0].data.employmentType).toBe(
        'PERMANENT',
      );
      expect((prisma.user.create as jest.Mock).mock.calls[0][0].data.role).toBe('EMPLOYEE');
    });

    it('links a manager created by an earlier row of the same file', async () => {
      await realRun(csv('M1,Meera,Nair,m@x.com,2026-01-01', 'E1,Asha,Rao,a@x.com,2026-03-15,,,,M1'));

      const second = (prisma.employee.create as jest.Mock).mock.calls[1][0].data;
      expect(second.managerId).toBe('emp-M1');
    });

    it('rejects the whole file when any row is invalid and creates nothing', async () => {
      const text = csv('E1,Asha,Rao,a@x.com,2026-03-15', 'E2,Bina,Sen,bad-email,2026-03-15');

      await expect(realRun(text)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.employee.create).not.toHaveBeenCalled();

      await realRun(text).catch((err) => {
        expect(err.getResponse()).toMatchObject({
          totalRows: 2,
          validRows: 1,
          invalidRows: 1,
          created: 0,
          errors: [expect.objectContaining({ row: 2, field: 'email' })],
        });
      });
    });

    it('requires an initialPassword of at least 8 characters', async () => {
      await expect(realRun(csv('E1,Asha,Rao,a@x.com,2026-03-15'), 'short')).rejects.toThrow(
        /initialPassword/,
      );
      expect(prisma.employee.create).not.toHaveBeenCalled();
    });

    it('scopes every creation-time lookup to the caller tenant', async () => {
      (prisma.department.findMany as jest.Mock).mockResolvedValue([{ id: 'd1', code: 'ENG' }]);
      (prisma.designation.findMany as jest.Mock).mockResolvedValue([{ id: 'g1', name: 'SDE' }]);
      (prisma.branch.findMany as jest.Mock).mockResolvedValue([{ id: 'b1', name: 'HQ' }]);
      (prisma.employee.findMany as jest.Mock).mockResolvedValue([
        { id: 'mgr-1', employeeCode: 'M1', email: 'm@x.com' },
      ]);

      await realRun(csv('E1,Asha,Rao,a@x.com,2026-03-15,ENG,SDE,HQ,M1'));

      // createAll re-reads the lookup tables to turn codes into ids, including
      // the manager lookup; each of those reads must be tenant-scoped too.
      const models = ['employee', 'department', 'designation', 'branch'] as const;
      for (const model of models) {
        const mock = prisma[model].findMany as jest.Mock;
        expect(mock.mock.calls.length).toBeGreaterThanOrEqual(2);
        for (const [args] of mock.mock.calls) {
          expect(args.where.tenantId).toBe(TENANT);
        }
      }

      // The manager resolved to the existing tenant employee, not a stranger.
      expect((prisma.employee.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
        tenantId: TENANT,
        managerId: 'mgr-1',
        departmentId: 'd1',
        designationId: 'g1',
        branchId: 'b1',
      });
    });

    it('writes one audit log entry for the import', async () => {
      await realRun(csv('E1,Asha,Rao,a@x.com,2026-03-15'));
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          userId: USER,
          action: 'CREATE',
          entityType: 'EmployeeImport',
          newValues: expect.objectContaining({ created: 1, employeeCodes: ['E1'] }),
        }),
        expect.anything(),
      );
    });

    it('writes the audit entry inside the import transaction, through the tx client', async () => {
      const tx = prisma; // the mock hands itself to the callback as the tx client
      let inTx = false;
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (fn: any) => {
        inTx = true;
        try {
          return await fn(tx);
        } finally {
          inTx = false;
        }
      });
      audit.log.mockImplementation(async () => {
        expect(inTx).toBe(true);
        return {};
      });

      await realRun(csv('E1,Asha,Rao,a@x.com,2026-03-15'));

      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log.mock.calls[0][1]).toBe(tx);
    });

    it('fails the import when the audit write fails, and fires no webhooks', async () => {
      audit.log.mockRejectedValue(new Error('audit down'));

      await expect(realRun(csv('E1,Asha,Rao,a@x.com,2026-03-15'))).rejects.toThrow('audit down');
      expect(webhooks.dispatch).not.toHaveBeenCalled();
    });

    it('fires employee.created once per created employee after the transaction commits', async () => {
      (prisma.department.findMany as jest.Mock).mockResolvedValue([{ id: 'd1', code: 'ENG' }]);
      (prisma.designation.findMany as jest.Mock).mockResolvedValue([{ id: 'g1', name: 'SDE' }]);
      let committed = false;
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (fn: any) => {
        const out = await fn(prisma);
        committed = true;
        return out;
      });
      webhooks.dispatch.mockImplementation(async () => {
        expect(committed).toBe(true);
      });

      await realRun(
        csv(
          'M1,Meera,Nair,m@x.com,2026-01-01,ENG,SDE',
          'E1,Asha,Rao,a@x.com,2026-03-15,,,,M1,,+91,1990-05-02,F',
        ),
      );
      // Delivered one after another in the background: let the loop drain.
      await flushBackground();

      expect(webhooks.dispatch).toHaveBeenCalledTimes(2);
      expect(webhooks.dispatch).toHaveBeenNthCalledWith(1, TENANT, 'employee.created', {
        employeeId: 'emp-M1',
        employeeCode: 'M1',
        firstName: 'Meera',
        lastName: 'Nair',
        email: 'm@x.com',
        departmentId: 'd1',
        designationId: 'g1',
        dateOfJoining: '2026-01-01',
        source: 'import',
      });
      const second = webhooks.dispatch.mock.calls[1][2];
      expect(second).toMatchObject({ employeeId: 'emp-E1', employeeCode: 'E1', source: 'import' });
      // Minimal PII: no phone, date of birth or gender on the wire.
      expect(second).not.toHaveProperty('phone');
      expect(second).not.toHaveProperty('dateOfBirth');
      expect(second).not.toHaveProperty('gender');
    });

    it('does not wait for webhook delivery before returning', async () => {
      webhooks.dispatch.mockReturnValue(new Promise(() => {}));

      const result = await realRun(csv('E1,Asha,Rao,a@x.com,2026-03-15'));

      expect(result.created).toBe(1);
      expect(webhooks.dispatch).toHaveBeenCalledTimes(1);
    });

    it('dispatches one employee at a time, never the whole file at once', async () => {
      // A 2,000-row import used to start 2,000 concurrent dispatches, each
      // with its own lookups, POSTs, retries and log writes.
      const releases: Array<() => void> = [];
      let inFlight = 0;
      let maxInFlight = 0;
      webhooks.dispatch.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            releases.push(() => {
              inFlight--;
              resolve();
            });
          }),
      );

      const result = await realRun(
        csv(
          'E1,Asha,Rao,a@x.com,2026-03-15',
          'E2,Bina,Sen,b@x.com,2026-03-15',
          'E3,Chitra,Iyer,c@x.com,2026-03-15',
        ),
      );
      expect(result.created).toBe(3);

      // The request returned while the first delivery is still in flight.
      await flushBackground();
      expect(webhooks.dispatch).toHaveBeenCalledTimes(1);

      releases[0]();
      await flushBackground();
      expect(webhooks.dispatch).toHaveBeenCalledTimes(2);

      releases[1]();
      await flushBackground();
      releases[2]();
      await flushBackground();

      expect(webhooks.dispatch).toHaveBeenCalledTimes(3);
      expect(maxInFlight).toBe(1);
      expect(webhooks.dispatch.mock.calls.map((c) => c[2].employeeCode)).toEqual([
        'E1',
        'E2',
        'E3',
      ]);
    });

    it('keeps delivering the rest when one dispatch rejects or throws', async () => {
      webhooks.dispatch
        .mockRejectedValueOnce(new Error('endpoint down'))
        .mockImplementationOnce(() => {
          throw new Error('boom');
        })
        .mockResolvedValue(undefined);

      const result = await realRun(
        csv(
          'E1,Asha,Rao,a@x.com,2026-03-15',
          'E2,Bina,Sen,b@x.com,2026-03-15',
          'E3,Chitra,Iyer,c@x.com,2026-03-15',
        ),
      );
      await flushBackground();

      expect(result.created).toBe(3);
      expect(webhooks.dispatch).toHaveBeenCalledTimes(3);
      expect(webhooks.dispatch.mock.calls[2][2]).toMatchObject({ employeeCode: 'E3' });
    });

    it('fires no webhooks when the file is rejected', async () => {
      await expect(
        realRun(csv('E1,Asha,Rao,a@x.com,2026-03-15', 'E2,Bina,Sen,bad-email,2026-03-15')),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(webhooks.dispatch).not.toHaveBeenCalled();
    });
  });
});
