import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OtCalculationService } from '../attendance/ot-calculation.service';
import { RegisterDeviceDto, UpdateDeviceDto } from './dto/biometric.dto';
import { isPrismaError, PRISMA_UNIQUE_VIOLATION } from '../../common/utils/prisma-errors';

@Injectable()
export class BiometricService {
  private readonly logger = new Logger(BiometricService.name);

  constructor(
    private prisma: PrismaService,
    private otCalculation: OtCalculationService,
  ) {}

  // ─────────────────────────────────────────────
  // ICLOCK PROTOCOL HANDLERS (called by device)
  // ─────────────────────────────────────────────

  /**
   * Handle device registration / handshake.
   * ZKTeco devices call GET /iclock/cdata?SN={SN}&options=all on startup.
   */
  async handleHandshake(serialNumber: string): Promise<string> {
    const device = await this.prisma.biometricDevice.findUnique({
      where: { serialNumber },
    });

    if (device) {
      await this.prisma.biometricDevice.update({
        where: { serialNumber },
        data: { lastSeenAt: new Date() },
      });
      this.logger.log(`Device handshake: SN=${serialNumber} (registered, tenant=${device.tenantId})`);
    } else {
      this.logger.warn(`Device handshake from unknown SN=${serialNumber} — register it via admin API`);
    }

    // ZKTeco ICLOCK v2 response format
    return `GET OPTION FROM: ${serialNumber}\nATTLOGSTAMP=9999\nOPERLOGSTAMP=9999\nATTPHOTO=0\nErrorDelay=30\nDelay=10\nTransTimes=00:00;14:05\nTransInterval=1\nTransFlag=TransData AttLog\nTimeZone=8\nRealtime=1\nEncrypt=None\n`;
  }

  /**
   * Handle attendance log push.
   * ZKTeco devices POST to /iclock/cdata?SN={SN}&table=ATTLOG with body:
   *   UserID\tDateTime\tVerifyType\tAttStatus\tWorkCode\tReserved\r\n
   *
   * Returns "OK: {count}" where count is the number of records actually saved.
   * The device uses this count to decide which records to remove from its buffer.
   */
  async handleAttendancePush(serialNumber: string, body: string): Promise<string> {
    const device = await this.prisma.biometricDevice.findUnique({
      where: { serialNumber },
    });

    if (!device) {
      this.logger.error(`Attendance push from unregistered device SN=${serialNumber}`);
      return 'OK: 0';
    }

    if (!device.isActive) {
      this.logger.warn(`Attendance push from inactive device SN=${serialNumber}`);
      return 'OK: 0';
    }

    await this.prisma.biometricDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });

    const lines = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // Only count lines that were successfully saved (so device retries failed ones)
    let savedCount = 0;
    for (const line of lines) {
      const saved = await this.processLogLine(device.id, device.tenantId, line);
      if (saved) savedCount++;
    }

    this.logger.log(`Saved ${savedCount}/${lines.length} punch records from SN=${serialNumber}`);
    return `OK: ${savedCount}`;
  }

  /**
   * Parse a single log line and create/update the attendance record.
   * Format: UserID\tDateTime\tVerifyType\tPunchType\tWorkCode\tReserved
   *
   * Returns true if the raw log was saved to DB (even if attendance processing failed).
   * Returns false only if parsing fails before we can save the raw log.
   */
  private async processLogLine(
    deviceId: string,
    tenantId: string,
    rawLine: string,
  ): Promise<boolean> {
    const parts = rawLine.split('\t');
    if (parts.length < 4) {
      this.logger.warn(`Skipping malformed log line: "${rawLine}"`);
      return false;
    }

    const [deviceUserId, dateTimeStr, verifyTypeStr, punchTypeStr] = parts;
    const verifyType = parseInt(verifyTypeStr, 10);
    const punchType = parseInt(punchTypeStr, 10);

    // Parse device timestamp as local time.
    // ZKTeco sends "YYYY-MM-DD HH:MM:SS" in device local time (no timezone suffix).
    // new Date("YYYY-MM-DDTHH:MM:SS") would be parsed as UTC — so we parse components
    // explicitly to get correct local Date object.
    const punchTime = this.parseLocalDateTime(dateTimeStr);
    if (!punchTime) {
      this.logger.warn(`Invalid timestamp in log line: "${rawLine}"`);
      return false;
    }

    // Save raw log (audit trail). This counts as "saved" regardless of processing outcome,
    // so the device clears it from its buffer. Processing errors are stored in `error` field.
    let log;
    try {
      log = await this.prisma.deviceAttendanceLog.create({
        data: {
          tenantId,
          deviceId,
          deviceUserId,
          punchTime,
          punchType,
          verifyType,
          rawData: rawLine,
        },
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_UNIQUE_VIOLATION)) {
        // The device re-sent a punch we already stored (our OK was lost).
        // Acknowledge it so the device clears its buffer, but do not process twice.
        this.logger.debug(`Duplicate punch ignored: user=${deviceUserId} at ${dateTimeStr} type=${punchType}`);
        return true;
      }
      throw err;
    }

    // Look up employee by biometricUserId within this tenant
    const employee = await this.prisma.employee.findFirst({
      where: {
        tenantId,
        biometricUserId: deviceUserId,
        status: 'ACTIVE',
      },
    });

    if (!employee) {
      await this.prisma.deviceAttendanceLog.update({
        where: { id: log.id },
        data: { error: `No active employee with biometricUserId="${deviceUserId}" in tenant` },
      });
      this.logger.warn(`No employee found for deviceUserId=${deviceUserId}, tenantId=${tenantId}`);
      return true; // raw log was saved; device should not retry
    }

    // Attendance date = calendar date of the punch in local time
    const punchDate = new Date(
      punchTime.getFullYear(),
      punchTime.getMonth(),
      punchTime.getDate(),
    );

    let attendanceId: string | undefined;
    let error: string | undefined;

    try {
      if (punchType === 0) {
        attendanceId = await this.processClockIn(tenantId, employee.id, punchDate, punchTime);
      } else if (punchType === 1) {
        attendanceId = await this.processClockOut(tenantId, employee.id, punchDate, punchTime);
      } else {
        // Punch types 2-5 (break-out, break-in, OT-in, OT-out) — log but skip
        this.logger.debug(`Unsupported punchType=${punchType} for employee=${employee.id}, skipping`);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to process punch for employee=${employee.id}: ${error}`);
    }

    await this.prisma.deviceAttendanceLog.update({
      where: { id: log.id },
      data: {
        processed: true,
        processedAt: new Date(),
        employeeId: employee.id,
        attendanceId: attendanceId ?? null,
        error: error ?? null,
      },
    });

    return true;
  }

  /**
   * Parse "YYYY-MM-DD HH:MM:SS" from device as local time (not UTC).
   * Returns null if the string is malformed.
   */
  private parseLocalDateTime(dateTimeStr: string): Date | null {
    const match = dateTimeStr.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/,
    );
    if (!match) return null;

    const [, year, month, day, hour, minute, second] = match.map(Number);
    const dt = new Date(year, month - 1, day, hour, minute, second);
    return isNaN(dt.getTime()) ? null : dt;
  }

  private async processClockIn(
    tenantId: string,
    employeeId: string,
    punchDate: Date,
    punchTime: Date,
  ): Promise<string> {
    let attendance = await this.prisma.attendanceRecord.findUnique({
      where: { tenantId_employeeId_date: { tenantId, employeeId, date: punchDate } },
      include: { sessions: true },
    });

    if (attendance) {
      const openSession = attendance.sessions.find((s) => !s.outTime);
      if (openSession) {
        throw new Error('Already clocked in — duplicate punch ignored');
      }

      await this.prisma.attendanceSession.create({
        data: { tenantId, attendanceId: attendance.id, inTime: punchTime },
      });

      return attendance.id;
    }

    // Create new attendance record with first session
    attendance = await this.prisma.attendanceRecord.create({
      data: {
        tenantId,
        employeeId,
        date: punchDate,
        clockInTime: punchTime,
        status: 'PRESENT',
        source: 'BIOMETRIC',
        standardWorkMinutes: 480,
        sessions: { create: { tenantId, inTime: punchTime } },
      },
      include: { sessions: true },
    });

    return attendance.id;
  }

  private async processClockOut(
    tenantId: string,
    employeeId: string,
    punchDate: Date,
    punchTime: Date,
  ): Promise<string> {
    // First try the exact punch date. For overnight shifts, fall back to the previous day.
    let attendance = await this.prisma.attendanceRecord.findUnique({
      where: { tenantId_employeeId_date: { tenantId, employeeId, date: punchDate } },
      include: { sessions: true },
    });

    // Overnight shift fallback: if no open session found on punch date, check previous day
    if (!attendance || !attendance.sessions.find((s) => !s.outTime)) {
      const previousDay = new Date(punchDate);
      previousDay.setDate(previousDay.getDate() - 1);

      const previousAttendance = await this.prisma.attendanceRecord.findUnique({
        where: { tenantId_employeeId_date: { tenantId, employeeId, date: previousDay } },
        include: { sessions: true },
      });

      if (previousAttendance?.sessions.find((s) => !s.outTime)) {
        this.logger.log(
          `Overnight shift detected for employee=${employeeId}: clock-out on ${punchDate.toDateString()} closing session from ${previousDay.toDateString()}`,
        );
        attendance = previousAttendance;
      }
    }

    if (!attendance) {
      throw new Error('Clock-out received but no clock-in record found for this date');
    }

    const openSession = attendance.sessions.find((s) => !s.outTime);
    if (!openSession) {
      throw new Error('No open session found — duplicate clock-out ignored');
    }

    const sessionMinutes = Math.floor(
      (punchTime.getTime() - openSession.inTime.getTime()) / (1000 * 60),
    );

    await this.prisma.attendanceSession.update({
      where: { id: openSession.id },
      data: { outTime: punchTime, sessionMinutes },
    });

    // Sum all CLOSED sessions (exclude any other unclosed ones to avoid zero-contribution bugs)
    const allSessions = await this.prisma.attendanceSession.findMany({
      where: { attendanceId: attendance.id },
    });

    const totalWorkedMinutes = allSessions.reduce((sum, s) => {
      if (s.id === openSession.id) return sum + sessionMinutes;
      if (!s.outTime) return sum; // skip other unclosed sessions
      return sum + s.sessionMinutes;
    }, 0);

    const netWorkedMinutes = Math.max(0, totalWorkedMinutes - attendance.breakMinutes);

    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    const otRule = employee
      ? await this.otCalculation.getOtRule(tenantId, employee.employmentType)
      : null;

    const otMinutesCalculated = this.otCalculation.calculateOtMinutes(
      netWorkedMinutes,
      attendance.standardWorkMinutes,
      otRule,
    );

    await this.prisma.attendanceRecord.update({
      where: { id: attendance.id },
      data: {
        clockOutTime: punchTime,
        workedMinutes: netWorkedMinutes,
        otMinutesCalculated,
        source: 'BIOMETRIC',
      },
    });

    return attendance.id;
  }

  // ─────────────────────────────────────────────
  // ADMIN OPERATIONS
  // ─────────────────────────────────────────────

  async registerDevice(tenantId: string, dto: RegisterDeviceDto) {
    const existing = await this.prisma.biometricDevice.findUnique({
      where: { serialNumber: dto.serialNumber },
    });

    if (existing && existing.tenantId !== tenantId) {
      throw new BadRequestException(
        `Device SN=${dto.serialNumber} is already registered to a different tenant`,
      );
    }

    if (existing) {
      return this.prisma.biometricDevice.update({
        where: { serialNumber: dto.serialNumber },
        data: { name: dto.name, deviceType: dto.deviceType ?? existing.deviceType, isActive: true },
      });
    }

    return this.prisma.biometricDevice.create({
      data: {
        tenantId,
        serialNumber: dto.serialNumber,
        name: dto.name,
        deviceType: dto.deviceType ?? 'ESSL_ICLOCK',
      },
    });
  }

  async listDevices(tenantId: string) {
    return this.prisma.biometricDevice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateDevice(tenantId: string, deviceId: string, dto: UpdateDeviceDto) {
    const device = await this.prisma.biometricDevice.findFirst({
      where: { id: deviceId, tenantId },
    });
    if (!device) throw new NotFoundException('Device not found');

    return this.prisma.biometricDevice.update({
      where: { id: deviceId },
      data: dto,
    });
  }

  async getDeviceLogs(tenantId: string, deviceId: string, limit?: number) {
    const device = await this.prisma.biometricDevice.findFirst({
      where: { id: deviceId, tenantId },
    });
    if (!device) throw new NotFoundException('Device not found');

    const take = Math.min(limit ?? 100, 500);

    return this.prisma.deviceAttendanceLog.findMany({
      where: { deviceId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async setEmployeeBiometricId(tenantId: string, employeeId: string, biometricUserId: string) {
    const conflict = await this.prisma.employee.findFirst({
      where: { tenantId, biometricUserId, NOT: { id: employeeId } },
    });
    if (conflict) {
      throw new BadRequestException(
        `biometricUserId "${biometricUserId}" is already assigned to another employee`,
      );
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    return this.prisma.employee.update({
      where: { id: employeeId },
      data: { biometricUserId },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, biometricUserId: true },
    });
  }
}
