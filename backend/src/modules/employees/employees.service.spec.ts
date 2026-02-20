import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { createMockPrismaService, createMockEmailService } from '../../test/helpers';

describe('EmployeesService', () => {
  let service: EmployeesService;
  let prisma: any;

  const tenantId = 'test-tenant';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: EmailService, useValue: createMockEmailService() },
      ],
    }).compile();

    service = module.get<EmployeesService>(EmployeesService);
    prisma = module.get(PrismaService);

    // The shared mock helper lists "attendance" but the Prisma schema model is
    // "AttendanceRecord" (accessed as prisma.attendanceRecord). Add it manually
    // so the get360View tests work correctly.
    if (!prisma.attendanceRecord) {
      prisma.attendanceRecord = {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      };
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Shared fixtures
  // ---------------------------------------------------------------------------

  const mockEmployee = {
    id: 'emp-1',
    tenantId,
    employeeCode: 'EMP001',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@test.com',
    status: 'ACTIVE',
    employmentType: 'PERMANENT',
    joinDate: new Date('2024-01-15'),
    exitDate: null,
    department: { id: 'dept-1', name: 'Engineering' },
    manager: { id: 'mgr-1', firstName: 'Jane', lastName: 'Smith', email: 'jane@test.com' },
    directReports: [],
  };

  const createDto = {
    employeeCode: 'EMP001',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@test.com',
    joinDate: '2024-01-15',
  } as any;

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  describe('create', () => {
    beforeEach(() => {
      // Mock tenant lookup for welcome email
      prisma.tenant.findUnique.mockResolvedValue({ name: 'Test Corp' });
    });

    it('should create an employee successfully', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      // $transaction calls the callback with the mock itself
      prisma.employee.create.mockResolvedValue(mockEmployee);

      const result = await service.create(tenantId, createDto);

      expect(result).toEqual(mockEmployee);
      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId,
          OR: [
            { employeeCode: 'EMP001' },
            { email: 'john@test.com' },
          ],
        },
      });
    });

    it('should throw ConflictException when employee code already exists', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        ...mockEmployee,
        employeeCode: 'EMP001',
      });

      await expect(service.create(tenantId, createDto)).rejects.toThrow(ConflictException);
      await expect(service.create(tenantId, createDto)).rejects.toThrow(
        'Employee code already exists',
      );
    });

    it('should throw ConflictException when email already exists', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        ...mockEmployee,
        employeeCode: 'EMP999', // different code so the message branch picks email
      });

      await expect(service.create(tenantId, createDto)).rejects.toThrow(ConflictException);
      await expect(service.create(tenantId, createDto)).rejects.toThrow('Email already exists');
    });

    it('should throw ConflictException when user email already exists during user creation', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue({ id: 'existing-user' });

      const dtoWithUser = {
        ...createDto,
        createUser: true,
        userEmail: 'john@test.com',
        userPassword: 'password123',
      };

      await expect(service.create(tenantId, dtoWithUser)).rejects.toThrow(ConflictException);
      await expect(service.create(tenantId, dtoWithUser)).rejects.toThrow(
        'User email already exists',
      );
    });

    it('should create employee with user account when createUser is true', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.employee.create.mockResolvedValue(mockEmployee);
      prisma.user.create.mockResolvedValue({ id: 'new-user' });

      const dtoWithUser = {
        ...createDto,
        createUser: true,
        userEmail: 'john@test.com',
        userPassword: 'password123',
        userRole: 'EMPLOYEE',
      };

      const result = await service.create(tenantId, dtoWithUser);

      expect(result).toEqual(mockEmployee);
      // Verify user.create was called inside the transaction
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          email: 'john@test.com',
          role: 'EMPLOYEE',
          employeeId: 'emp-1',
          isActive: true,
        }),
      });
    });
  });

  // ---------------------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------------------

  describe('findAll', () => {
    const mockEmployees = [mockEmployee];

    it('should return paginated employees with default params', async () => {
      prisma.employee.findMany.mockResolvedValue(mockEmployees);
      prisma.employee.count.mockResolvedValue(1);

      const result = await service.findAll(tenantId, {});

      expect(result).toEqual({
        data: mockEmployees,
        meta: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        },
      });

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId },
          skip: 0,
          take: 20,
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should apply search filter', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.employee.count.mockResolvedValue(0);

      await service.findAll(tenantId, { search: 'john' });

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            OR: expect.arrayContaining([
              { firstName: { contains: 'john', mode: 'insensitive' } },
              { lastName: { contains: 'john', mode: 'insensitive' } },
              { email: { contains: 'john', mode: 'insensitive' } },
              { employeeCode: { contains: 'john', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
    });

    it('should apply departmentId, status, and employmentType filters', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.employee.count.mockResolvedValue(0);

      await service.findAll(tenantId, {
        departmentId: 'dept-1',
        status: 'ACTIVE' as any,
        employmentType: 'PERMANENT' as any,
      });

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            departmentId: 'dept-1',
            status: 'ACTIVE',
            employmentType: 'PERMANENT',
          }),
        }),
      );
    });

    it('should paginate correctly with custom page and limit', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.employee.count.mockResolvedValue(50);

      const result = await service.findAll(tenantId, { page: 3, limit: 10 });

      expect(result.meta).toEqual({
        total: 50,
        page: 3,
        limit: 10,
        totalPages: 5,
      });

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------------------

  describe('findOne', () => {
    it('should return employee by id', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);

      const result = await service.findOne(tenantId, 'emp-1');

      expect(result).toEqual(mockEmployee);
      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: 'emp-1', tenantId },
        include: expect.objectContaining({
          department: true,
          manager: expect.any(Object),
          directReports: expect.any(Object),
        }),
      });
    });

    it('should throw NotFoundException when employee does not exist', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(service.findOne(tenantId, 'non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.findOne(tenantId, 'non-existent')).rejects.toThrow(
        'Employee not found',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // get360View
  // ---------------------------------------------------------------------------

  describe('get360View', () => {
    const mockAttendanceRecords = [
      { status: 'PRESENT', workedMinutes: 480, otMinutesCalculated: 60, otMinutesApproved: 30 },
      { status: 'PRESENT', workedMinutes: 450, otMinutesCalculated: 30, otMinutesApproved: 0 },
      { status: 'ABSENT', workedMinutes: 0, otMinutesCalculated: 0, otMinutesApproved: null },
      { status: 'LEAVE', workedMinutes: 0, otMinutesCalculated: 0, otMinutesApproved: null },
      { status: 'WFH', workedMinutes: 480, otMinutesCalculated: 0, otMinutesApproved: null },
    ];

    const mockLeaveBalances = [
      { id: 'lb-1', leaveType: { name: 'Annual Leave' }, total: 20, used: 5, balance: 15 },
    ];

    it('should return 360 view with aggregated data', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.attendanceRecord.findMany.mockResolvedValue(mockAttendanceRecords);
      prisma.leaveBalance.findMany.mockResolvedValue(mockLeaveBalances);
      prisma.leaveRequest.count.mockResolvedValue(2);

      const result = await service.get360View(tenantId, 'emp-1');

      expect(result.employee).toEqual(mockEmployee);
      expect(result.attendanceSummary).toEqual({
        presentDays: 2,
        absentDays: 1,
        leaveDays: 1,
        wfhDays: 1,
        totalWorkedMinutes: 1410,
        totalOtMinutes: 90,
        totalApprovedOtMinutes: 30,
      });
      expect(result.leaveBalances).toEqual(mockLeaveBalances);
      expect(result.pendingLeaveRequests).toBe(2);

      expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tenantId,
          employeeId: 'emp-1',
          date: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        }),
      });

      expect(prisma.leaveBalance.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tenantId,
          employeeId: 'emp-1',
          year: new Date().getFullYear(),
        }),
        include: { leaveType: true },
      });

      expect(prisma.leaveRequest.count).toHaveBeenCalledWith({
        where: {
          tenantId,
          employeeId: 'emp-1',
          status: 'PENDING',
        },
      });
    });

    it('should throw NotFoundException when employee does not exist', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(service.get360View(tenantId, 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------

  describe('update', () => {
    const updateDto = { firstName: 'Johnny', email: 'johnny@test.com' } as any;

    const updatedEmployee = { ...mockEmployee, firstName: 'Johnny', email: 'johnny@test.com' };

    it('should update employee successfully', async () => {
      prisma.employee.findFirst
        .mockResolvedValueOnce(mockEmployee) // findOne check
        .mockResolvedValueOnce(null); // email conflict check
      prisma.employee.update.mockResolvedValue(updatedEmployee);

      const result = await service.update(tenantId, 'emp-1', updateDto);

      expect(result).toEqual(updatedEmployee);
      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: expect.objectContaining({
          firstName: 'Johnny',
          email: 'johnny@test.com',
        }),
        include: expect.objectContaining({
          department: true,
          manager: expect.any(Object),
        }),
      });
    });

    it('should throw NotFoundException when employee does not exist', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(service.update(tenantId, 'non-existent', updateDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when email conflicts with another employee', async () => {
      prisma.employee.findFirst
        .mockResolvedValueOnce(mockEmployee) // findOne passes
        .mockResolvedValueOnce({ id: 'emp-other', email: 'johnny@test.com' }); // email conflict

      await expect(service.update(tenantId, 'emp-1', updateDto)).rejects.toThrow(
        'Email already exists',
      );
    });

    it('should skip email conflict check when email is not in dto', async () => {
      const nameOnlyDto = { firstName: 'Johnny' } as any;
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.employee.update.mockResolvedValue({ ...mockEmployee, firstName: 'Johnny' });

      await service.update(tenantId, 'emp-1', nameOnlyDto);

      // findFirst should be called only once (for findOne), not for email conflict
      expect(prisma.employee.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // remove
  // ---------------------------------------------------------------------------

  describe('remove', () => {
    it('should soft delete employee by setting status to INACTIVE', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.employee.update.mockResolvedValue({
        ...mockEmployee,
        status: 'INACTIVE',
        exitDate: expect.any(Date),
      });

      const result = await service.remove(tenantId, 'emp-1');

      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: {
          status: 'INACTIVE',
          exitDate: expect.any(Date),
        },
      });
    });

    it('should throw NotFoundException when employee does not exist', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(service.remove(tenantId, 'non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // getDirectReports
  // ---------------------------------------------------------------------------

  describe('getDirectReports', () => {
    const mockDirectReports = [
      { id: 'emp-2', firstName: 'Alice', lastName: 'Wonderland', department: { name: 'Engineering' } },
      { id: 'emp-3', firstName: 'Bob', lastName: 'Builder', department: { name: 'Engineering' } },
    ];

    it('should return active direct reports for a manager', async () => {
      prisma.employee.findMany.mockResolvedValue(mockDirectReports);

      const result = await service.getDirectReports(tenantId, 'mgr-1');

      expect(result).toEqual(mockDirectReports);
      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          managerId: 'mgr-1',
          status: 'ACTIVE',
        },
        include: {
          department: true,
        },
      });
    });

    it('should return empty array when manager has no reports', async () => {
      prisma.employee.findMany.mockResolvedValue([]);

      const result = await service.getDirectReports(tenantId, 'mgr-no-reports');

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getOrgChart
  // ---------------------------------------------------------------------------
  describe('getOrgChart', () => {
    it('should build a tree from flat employee list', async () => {
      const employees = [
        {
          id: 'ceo',
          firstName: 'Alice',
          lastName: 'Boss',
          employeeCode: 'CEO001',
          designation: { name: 'CEO' },
          department: { name: 'Executive' },
          managerId: null,
          email: 'alice@test.com',
        },
        {
          id: 'mgr1',
          firstName: 'Bob',
          lastName: 'Manager',
          employeeCode: 'MGR001',
          designation: { name: 'Director' },
          department: { name: 'Engineering' },
          managerId: 'ceo',
          email: 'bob@test.com',
        },
        {
          id: 'dev1',
          firstName: 'Charlie',
          lastName: 'Dev',
          employeeCode: 'DEV001',
          designation: { name: 'Developer' },
          department: { name: 'Engineering' },
          managerId: 'mgr1',
          email: 'charlie@test.com',
        },
      ];
      prisma.employee.findMany.mockResolvedValue(employees);

      const result = await service.getOrgChart(tenantId);

      // Should have one root node (CEO)
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alice Boss');
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children[0].name).toBe('Bob Manager');
      expect(result[0].children[0].children).toHaveLength(1);
      expect(result[0].children[0].children[0].name).toBe('Charlie Dev');
    });

    it('should return empty array when no employees exist', async () => {
      prisma.employee.findMany.mockResolvedValue([]);

      const result = await service.getOrgChart(tenantId);

      expect(result).toEqual([]);
    });

    it('should handle multiple root nodes (no manager)', async () => {
      const employees = [
        {
          id: 'a',
          firstName: 'A',
          lastName: 'Root',
          employeeCode: 'A001',
          designation: null,
          department: null,
          managerId: null,
          email: 'a@test.com',
        },
        {
          id: 'b',
          firstName: 'B',
          lastName: 'Root',
          employeeCode: 'B001',
          designation: null,
          department: null,
          managerId: null,
          email: 'b@test.com',
        },
      ];
      prisma.employee.findMany.mockResolvedValue(employees);

      const result = await service.getOrgChart(tenantId);

      expect(result).toHaveLength(2);
    });

    it('should treat employees with manager outside tenant as roots', async () => {
      const employees = [
        {
          id: 'orphan',
          firstName: 'Orphan',
          lastName: 'Node',
          employeeCode: 'ORP001',
          designation: null,
          department: null,
          managerId: 'external-manager-id',
          email: 'orphan@test.com',
        },
      ];
      prisma.employee.findMany.mockResolvedValue(employees);

      const result = await service.getOrgChart(tenantId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Orphan Node');
    });
  });
});
