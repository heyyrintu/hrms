import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { HolidaysService } from './holidays.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { CreateHolidayDto, UpdateHolidayDto, HolidayQueryDto } from './dto/holiday.dto';

describe('HolidaysService', () => {
  let service: HolidaysService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HolidaysService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get<HolidaysService>(HolidaysService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    const dto: CreateHolidayDto = {
      name: 'New Year',
      date: '2025-01-01',
      type: 'NATIONAL' as any,
      isOptional: false,
      description: 'Happy New Year',
    };

    it('should create a holiday when no duplicate exists', async () => {
      prisma.holiday.findFirst.mockResolvedValue(null);
      const created = { id: 'h1', tenantId: 'tenant-1', name: dto.name, date: new Date(dto.date) };
      prisma.holiday.create.mockResolvedValue(created);

      const result = await service.create('tenant-1', dto);

      expect(prisma.holiday.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          date: new Date(dto.date),
          name: dto.name,
        },
      });
      expect(prisma.holiday.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          name: dto.name,
          date: new Date(dto.date),
          type: dto.type,
          region: undefined,
          isOptional: false,
          description: dto.description,
        },
      });
      expect(result).toEqual(created);
    });

    it('should throw ConflictException when holiday already exists', async () => {
      prisma.holiday.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.create('tenant-1', dto)).rejects.toThrow(ConflictException);
      await expect(service.create('tenant-1', dto)).rejects.toThrow(
        `Holiday "${dto.name}" already exists on ${dto.date}`,
      );
    });

    it('should default isOptional to false when not provided', async () => {
      const dtoNoOptional: CreateHolidayDto = { name: 'Test', date: '2025-06-15' };
      prisma.holiday.findFirst.mockResolvedValue(null);
      prisma.holiday.create.mockResolvedValue({ id: 'h2' });

      await service.create('tenant-1', dtoNoOptional);

      expect(prisma.holiday.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isOptional: false }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // bulkCreate
  // ---------------------------------------------------------------------------
  describe('bulkCreate', () => {
    it('should process multiple holidays and return results', async () => {
      const holidays: CreateHolidayDto[] = [
        { name: 'New Year', date: '2025-01-01' },
        { name: 'Christmas', date: '2025-12-25' },
      ];

      prisma.holiday.findFirst
        .mockResolvedValueOnce(null)   // first is unique
        .mockResolvedValueOnce(null);  // second is unique
      prisma.holiday.create
        .mockResolvedValueOnce({ id: 'h1', name: 'New Year' })
        .mockResolvedValueOnce({ id: 'h2', name: 'Christmas' });

      const result = await service.bulkCreate('tenant-1', holidays);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ success: true, holiday: { id: 'h1', name: 'New Year' } });
      expect(result[1]).toEqual({ success: true, holiday: { id: 'h2', name: 'Christmas' } });
    });

    it('should capture errors for individual holidays without failing the batch', async () => {
      const holidays: CreateHolidayDto[] = [
        { name: 'New Year', date: '2025-01-01' },
        { name: 'Duplicate', date: '2025-03-01' },
      ];

      prisma.holiday.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing' }); // duplicate
      prisma.holiday.create.mockResolvedValueOnce({ id: 'h1' });

      const result = await service.bulkCreate('tenant-1', holidays);

      expect(result).toHaveLength(2);
      expect(result[0].success).toBe(true);
      expect(result[1].success).toBe(false);
      expect(result[1]).toHaveProperty('error');
    });
  });

  // ---------------------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------------------
  describe('findAll', () => {
    it('should return holidays with default filter (isActive: true)', async () => {
      const holidays = [{ id: 'h1' }];
      prisma.holiday.findMany.mockResolvedValue(holidays);

      const result = await service.findAll('tenant-1', {} as HolidayQueryDto);

      expect(prisma.holiday.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', isActive: true },
        orderBy: { date: 'asc' },
      });
      expect(result).toEqual(holidays);
    });

    it('should filter by year when provided', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);

      await service.findAll('tenant-1', { year: 2025 } as HolidayQueryDto);

      const callArg = prisma.holiday.findMany.mock.calls[0][0];
      expect(callArg.where.date).toEqual({
        gte: new Date('2025-01-01'),
        lte: new Date('2025-12-31'),
      });
    });

    it('should filter by type when provided', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);

      await service.findAll('tenant-1', { type: 'NATIONAL' } as any);

      const callArg = prisma.holiday.findMany.mock.calls[0][0];
      expect(callArg.where.type).toBe('NATIONAL');
    });

    it('should filter by isOptional when provided', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);

      await service.findAll('tenant-1', { isOptional: true } as HolidayQueryDto);

      const callArg = prisma.holiday.findMany.mock.calls[0][0];
      expect(callArg.where.isOptional).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // findUpcoming
  // ---------------------------------------------------------------------------
  describe('findUpcoming', () => {
    it('should return upcoming holidays with default limit', async () => {
      const upcoming = [{ id: 'h1' }, { id: 'h2' }];
      prisma.holiday.findMany.mockResolvedValue(upcoming);

      const result = await service.findUpcoming('tenant-1');

      expect(prisma.holiday.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            isActive: true,
            date: expect.objectContaining({ gte: expect.any(Date) }),
          }),
          orderBy: { date: 'asc' },
          take: 5,
        }),
      );
      expect(result).toEqual(upcoming);
    });

    it('should respect custom limit', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);

      await service.findUpcoming('tenant-1', 10);

      expect(prisma.holiday.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findById
  // ---------------------------------------------------------------------------
  describe('findById', () => {
    it('should return a holiday by id and tenantId', async () => {
      const holiday = { id: 'h1', tenantId: 'tenant-1', name: 'New Year' };
      prisma.holiday.findFirst.mockResolvedValue(holiday);

      const result = await service.findById('tenant-1', 'h1');

      expect(prisma.holiday.findFirst).toHaveBeenCalledWith({
        where: { id: 'h1', tenantId: 'tenant-1' },
      });
      expect(result).toEqual(holiday);
    });

    it('should throw NotFoundException when holiday does not exist', async () => {
      prisma.holiday.findFirst.mockResolvedValue(null);

      await expect(service.findById('tenant-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findById('tenant-1', 'nonexistent')).rejects.toThrow(
        'Holiday not found',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    const updateDto: UpdateHolidayDto = { name: 'Updated Holiday', date: '2025-07-04' };

    it('should update an existing holiday', async () => {
      prisma.holiday.findFirst.mockResolvedValue({ id: 'h1', tenantId: 'tenant-1' });
      const updated = { id: 'h1', name: 'Updated Holiday', date: new Date('2025-07-04') };
      prisma.holiday.update.mockResolvedValue(updated);

      const result = await service.update('tenant-1', 'h1', updateDto);

      expect(prisma.holiday.update).toHaveBeenCalledWith({
        where: { id: 'h1' },
        data: {
          ...updateDto,
          date: new Date('2025-07-04'),
        },
      });
      expect(result).toEqual(updated);
    });

    it('should not transform date when date is not provided in dto', async () => {
      const dtoNoDate: UpdateHolidayDto = { name: 'Renamed' };
      prisma.holiday.findFirst.mockResolvedValue({ id: 'h1', tenantId: 'tenant-1' });
      prisma.holiday.update.mockResolvedValue({ id: 'h1', name: 'Renamed' });

      await service.update('tenant-1', 'h1', dtoNoDate);

      expect(prisma.holiday.update).toHaveBeenCalledWith({
        where: { id: 'h1' },
        data: {
          ...dtoNoDate,
          date: undefined,
        },
      });
    });

    it('should throw NotFoundException if holiday does not exist', async () => {
      prisma.holiday.findFirst.mockResolvedValue(null);

      await expect(
        service.update('tenant-1', 'nonexistent', updateDto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // delete (soft delete)
  // ---------------------------------------------------------------------------
  describe('delete', () => {
    it('should soft-delete a holiday by setting isActive to false', async () => {
      prisma.holiday.findFirst.mockResolvedValue({ id: 'h1', tenantId: 'tenant-1' });
      prisma.holiday.update.mockResolvedValue({ id: 'h1', isActive: false });

      const result = await service.delete('tenant-1', 'h1');

      expect(prisma.holiday.update).toHaveBeenCalledWith({
        where: { id: 'h1' },
        data: { isActive: false },
      });
      expect(result).toEqual({ id: 'h1', isActive: false });
    });

    it('should throw NotFoundException if holiday does not exist', async () => {
      prisma.holiday.findFirst.mockResolvedValue(null);

      await expect(service.delete('tenant-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // isHoliday
  // ---------------------------------------------------------------------------
  describe('isHoliday', () => {
    const testDate = new Date('2025-01-01');

    it('should return true when a mandatory holiday exists on the date', async () => {
      prisma.holiday.findFirst.mockResolvedValue({ id: 'h1', name: 'New Year' });

      const result = await service.isHoliday('tenant-1', testDate);

      expect(prisma.holiday.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          date: testDate,
          isActive: true,
          isOptional: false,
        },
      });
      expect(result).toBe(true);
    });

    it('should return false when no mandatory holiday exists on the date', async () => {
      prisma.holiday.findFirst.mockResolvedValue(null);

      const result = await service.isHoliday('tenant-1', testDate);

      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getHolidaysBetween
  // ---------------------------------------------------------------------------
  describe('getHolidaysBetween', () => {
    const startDate = new Date('2025-01-01');
    const endDate = new Date('2025-12-31');

    it('should return mandatory holidays within the date range', async () => {
      const holidays = [{ id: 'h1' }, { id: 'h2' }];
      prisma.holiday.findMany.mockResolvedValue(holidays);

      const result = await service.getHolidaysBetween('tenant-1', startDate, endDate);

      expect(prisma.holiday.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          isActive: true,
          isOptional: false,
          date: { gte: startDate, lte: endDate },
        },
        orderBy: { date: 'asc' },
      });
      expect(result).toEqual(holidays);
    });

    it('should return empty array when no holidays exist in range', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);

      const result = await service.getHolidaysBetween('tenant-1', startDate, endDate);

      expect(result).toEqual([]);
    });
  });
});
