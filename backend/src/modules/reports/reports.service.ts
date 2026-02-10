import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '@prisma/client';
import {
  AttendanceReportDto,
  LeaveReportDto,
  EmployeeReportDto,
  ReportFormat,
} from './dto/report.dto';
import * as ExcelJS from 'exceljs';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // ============================================================
  // ATTENDANCE REPORT
  // ============================================================

  async generateAttendanceReport(
    tenantId: string,
    dto: AttendanceReportDto,
    role?: UserRole,
    employeeId?: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const where: Record<string, unknown> = {
      tenantId,
      date: { gte: new Date(dto.from), lte: new Date(dto.to) },
    };
    if (dto.employeeId) where.employeeId = dto.employeeId;
    if (dto.departmentId) {
      where.employee = { ...(where.employee as Record<string, unknown> || {}), departmentId: dto.departmentId };
    }
    // Scope MANAGER to direct reports only
    if (role === UserRole.MANAGER && employeeId) {
      where.employee = { ...(where.employee as Record<string, unknown> || {}), managerId: employeeId };
    }

    const records = await this.prisma.attendanceRecord.findMany({
      where,
      include: {
        employee: {
          select: {
            employeeCode: true,
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
          },
        },
      },
      orderBy: [{ date: 'asc' }, { employee: { firstName: 'asc' } }],
    });

    const rows = records.map((r) => ({
      'Employee Code': r.employee.employeeCode,
      'Employee Name': `${r.employee.firstName} ${r.employee.lastName}`,
      Department: r.employee.department?.name || '—',
      Date: new Date(r.date).toLocaleDateString('en-IN'),
      Status: r.status,
      'Clock In': r.clockInTime
        ? new Date(r.clockInTime).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—',
      'Clock Out': r.clockOutTime
        ? new Date(r.clockOutTime).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—',
      'Worked Hours': this.minutesToHours(r.workedMinutes),
      'Break Mins': r.breakMinutes,
      'Standard Hours': this.minutesToHours(r.standardWorkMinutes),
      'OT Calculated': this.minutesToHours(r.otMinutesCalculated),
      'OT Approved': r.otMinutesApproved != null
        ? this.minutesToHours(r.otMinutesApproved)
        : '—',
      Remarks: r.remarks || '',
    }));

    const format = dto.format || ReportFormat.XLSX;
    const dateRange = `${dto.from}_to_${dto.to}`;
    return this.buildFile(rows, `attendance_report_${dateRange}`, format, 'Attendance Report');
  }

  // ============================================================
  // LEAVE REPORT
  // ============================================================

  async generateLeaveReport(
    tenantId: string,
    dto: LeaveReportDto,
    role?: UserRole,
    employeeId?: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const year = dto.year ? parseInt(dto.year, 10) : new Date().getFullYear();

    const where: Record<string, unknown> = { tenantId, year };
    if (dto.employeeId) where.employeeId = dto.employeeId;
    if (dto.departmentId) {
      where.employee = { ...(where.employee as Record<string, unknown> || {}), departmentId: dto.departmentId };
    }
    // Scope MANAGER to direct reports only
    if (role === UserRole.MANAGER && employeeId) {
      where.employee = { ...(where.employee as Record<string, unknown> || {}), managerId: employeeId };
    }

    const balances = await this.prisma.leaveBalance.findMany({
      where,
      include: {
        employee: {
          select: {
            employeeCode: true,
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
          },
        },
        leaveType: { select: { name: true, code: true } },
      },
      orderBy: [
        { employee: { firstName: 'asc' } },
        { leaveType: { name: 'asc' } },
      ],
    });

    const rows = balances.map((b) => ({
      'Employee Code': b.employee.employeeCode,
      'Employee Name': `${b.employee.firstName} ${b.employee.lastName}`,
      Department: b.employee.department?.name || '—',
      Year: b.year,
      'Leave Type': b.leaveType.name,
      'Leave Code': b.leaveType.code,
      'Total Days': b.totalDays,
      'Used Days': b.usedDays,
      'Pending Days': b.pendingDays,
      'Carried Over': b.carriedOver,
      'Available': Number(b.totalDays) - Number(b.usedDays) - Number(b.pendingDays),
    }));

    const format = dto.format || ReportFormat.XLSX;
    return this.buildFile(rows, `leave_report_${year}`, format, 'Leave Balances');
  }

  // ============================================================
  // EMPLOYEE REPORT
  // ============================================================

  async generateEmployeeReport(
    tenantId: string,
    dto: EmployeeReportDto,
    role?: UserRole,
    employeeId?: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const where: Record<string, unknown> = { tenantId };
    if (dto.departmentId) where.departmentId = dto.departmentId;
    if (dto.status) where.status = dto.status;
    if (dto.employmentType) where.employmentType = dto.employmentType;
    // Scope MANAGER to direct reports only
    if (role === UserRole.MANAGER && employeeId) {
      where.managerId = employeeId;
    }

    const employees = await this.prisma.employee.findMany({
      where,
      include: {
        department: { select: { name: true } },
        manager: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    const rows = employees.map((e) => ({
      'Employee Code': e.employeeCode,
      'First Name': e.firstName,
      'Last Name': e.lastName,
      Email: e.email,
      Phone: e.phone || '—',
      Department: e.department?.name || '—',
      Designation: e.designation || '—',
      'Employment Type': e.employmentType,
      'Pay Type': e.payType,
      Status: e.status,
      'Join Date': new Date(e.joinDate).toLocaleDateString('en-IN'),
      'Exit Date': e.exitDate
        ? new Date(e.exitDate).toLocaleDateString('en-IN')
        : '—',
      Manager: e.manager
        ? `${e.manager.firstName} ${e.manager.lastName}`
        : '—',
      'Hourly Rate': e.hourlyRate != null ? Number(e.hourlyRate) : '—',
      'OT Multiplier': Number(e.otMultiplier),
    }));

    const format = dto.format || ReportFormat.XLSX;
    return this.buildFile(rows, 'employee_report', format, 'Employees');
  }

  // ============================================================
  // FILE BUILDER
  // ============================================================

  private async buildFile(
    rows: Record<string, unknown>[],
    baseName: string,
    format: ReportFormat,
    sheetName: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    if (format === ReportFormat.CSV) {
      return this.buildCsv(rows, baseName);
    }
    return this.buildXlsx(rows, baseName, sheetName);
  }

  private buildCsv(
    rows: Record<string, unknown>[],
    baseName: string,
  ): { buffer: Buffer; filename: string; contentType: string } {
    if (rows.length === 0) {
      return {
        buffer: Buffer.from('No data found', 'utf-8'),
        filename: `${baseName}.csv`,
        contentType: 'text/csv',
      };
    }

    const headers = Object.keys(rows[0]);
    const csvLines = [
      headers.map((h) => `"${h}"`).join(','),
      ...rows.map((row) =>
        headers
          .map((h) => {
            const val = row[h];
            if (val == null) return '';
            const str = String(val).replace(/"/g, '""');
            return `"${str}"`;
          })
          .join(','),
      ),
    ];

    return {
      buffer: Buffer.from(csvLines.join('\n'), 'utf-8'),
      filename: `${baseName}.csv`,
      contentType: 'text/csv',
    };
  }

  private async buildXlsx(
    rows: Record<string, unknown>[],
    baseName: string,
    sheetName: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'HRMS';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(sheetName);

    if (rows.length === 0) {
      sheet.addRow(['No data found']);
    } else {
      const headers = Object.keys(rows[0]);

      // Header row
      const headerRow = sheet.addRow(headers);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' },
        };
        cell.alignment = { horizontal: 'center' };
        cell.border = {
          bottom: { style: 'thin' },
        };
      });

      // Data rows
      for (const row of rows) {
        const values = headers.map((h) => {
          const val = row[h];
          if (val == null) return '';
          return val;
        });
        sheet.addRow(values);
      }

      // Auto-fit column widths
      sheet.columns.forEach((column) => {
        let maxWidth = 10;
        column.eachCell?.({ includeEmpty: false }, (cell) => {
          const cellLength = cell.value ? String(cell.value).length : 0;
          maxWidth = Math.max(maxWidth, Math.min(cellLength + 2, 40));
        });
        column.width = maxWidth;
      });

      // Add auto-filter
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      filename: `${baseName}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private minutesToHours(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
}
