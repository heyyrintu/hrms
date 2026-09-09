import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { BiometricService } from './biometric.service';
import { RegisterDeviceDto, UpdateDeviceDto, SetBiometricUserIdDto } from './dto/biometric.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

@ApiTags('biometric')
@ApiBearerAuth()
@Controller('biometric')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class BiometricAdminController {
  constructor(private biometricService: BiometricService) {}

  /**
   * Register a biometric device for this tenant.
   * POST /api/biometric/devices
   *
   * Get the SN from the device web interface or label on the device.
   * After registering, configure the device to push to:
   *   http(s)://your-server/iclock
   */
  @Post('devices')
  @ApiOperation({ summary: 'Register a biometric device' })
  registerDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.biometricService.registerDevice(user.tenantId, dto);
  }

  /**
   * List all registered devices for this tenant.
   * GET /api/biometric/devices
   */
  @Get('devices')
  @ApiOperation({ summary: 'List registered biometric devices' })
  listDevices(@CurrentUser() user: AuthenticatedUser) {
    return this.biometricService.listDevices(user.tenantId);
  }

  /**
   * Update device name or active status.
   * PATCH /api/biometric/devices/:deviceId
   */
  @Patch('devices/:deviceId')
  @ApiOperation({ summary: 'Update device settings' })
  updateDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId') deviceId: string,
    @Body() dto: UpdateDeviceDto,
  ) {
    return this.biometricService.updateDevice(user.tenantId, deviceId, dto);
  }

  /**
   * View raw punch logs from a device (for debugging).
   * GET /api/biometric/devices/:deviceId/logs
   */
  @Get('devices/:deviceId/logs')
  @ApiOperation({ summary: 'View raw device attendance logs' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getDeviceLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId') deviceId: string,
    @Query('limit') limit?: number,
  ) {
    return this.biometricService.getDeviceLogs(user.tenantId, deviceId, limit);
  }

  /**
   * Assign a biometric user ID to an employee.
   * PATCH /api/biometric/employees/:employeeId
   *
   * The biometricUserId must match the user ID enrolled in the device.
   * e.g., if employee is enrolled as user "42" in the device, set biometricUserId="42"
   */
  @Patch('employees/:employeeId')
  @ApiOperation({ summary: 'Set biometric device user ID for an employee' })
  setEmployeeBiometricId(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Body() dto: SetBiometricUserIdDto,
  ) {
    return this.biometricService.setEmployeeBiometricId(
      user.tenantId,
      employeeId,
      dto.biometricUserId,
    );
  }
}
