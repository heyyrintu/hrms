import { Controller, Get, Post, Query, Req, Res, Logger, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { BiometricService } from './biometric.service';
import { DeviceIpGuard } from './device-ip.guard';

/**
 * Implements the ZKTeco/ESSL ICLOCK push protocol.
 *
 * The device is configured to push to http(s)://your-server/iclock
 *
 * Protocol flow:
 *   1. Device startup:  GET /iclock/cdata?SN=XXX&options=all
 *   2. Attendance push: POST /iclock/cdata?SN=XXX&table=ATTLOG&Stamp=YYY
 *   3. Command polling: GET /iclock/getrequest?SN=XXX
 *
 * NOTE: This controller is intentionally excluded from the global `/api` prefix
 * (configured in main.ts) so the device can reach it at /iclock/cdata directly.
 * No JWT authentication — the device is identified by its serial number (SN),
 * which is not a secret. DeviceIpGuard restricts pushes to BIOMETRIC_ALLOWED_IPS.
 */
@Controller('iclock')
@UseGuards(DeviceIpGuard)
export class IclockController {
  private readonly logger = new Logger(IclockController.name);

  constructor(private biometricService: BiometricService) {}

  /**
   * Device registration / handshake.
   * Called by the device on startup to synchronize options.
   */
  @Get('cdata')
  async handleHandshake(
    @Query('SN') serialNumber: string,
    @Query('table') table: string,
    @Res() res: Response,
  ) {
    if (!serialNumber) {
      return res.status(400).send('Missing SN');
    }

    this.logger.debug(`ICLOCK handshake SN=${serialNumber}, table=${table}`);
    const response = await this.biometricService.handleHandshake(serialNumber);
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(response);
  }

  /**
   * Attendance log push.
   * Called by the device to push new punch records.
   * Body is plain text: UserID\tDateTime\tVerifyType\tPunchType\tWorkCode\tReserved\n
   */
  @Post('cdata')
  async handleAttendancePush(
    @Query('SN') serialNumber: string,
    @Query('table') table: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!serialNumber) {
      return res.status(400).send('Missing SN');
    }

    if (table !== 'ATTLOG') {
      // Other tables (OPERLOG, PHOTO, etc.) — acknowledge without processing
      this.logger.debug(`Received table=${table} from SN=${serialNumber}, skipping`);
      return res.status(200).send('OK: 0');
    }

    const body = req.body as string;
    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      this.logger.warn(`Empty body from SN=${serialNumber}`);
      return res.status(200).send('OK: 0');
    }

    this.logger.log(`Attendance push from SN=${serialNumber}, ${body.split('\n').filter(Boolean).length} lines`);

    try {
      const result = await this.biometricService.handleAttendancePush(serialNumber, body);
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(result);
    } catch (err) {
      this.logger.error(`Error processing push from SN=${serialNumber}: ${err}`);
      return res.status(200).send('OK: 0');
    }
  }

  /**
   * Command polling endpoint.
   * The device polls this to receive commands (e.g., time sync, user enroll).
   * We respond with OK (no pending commands) for now.
   */
  @Get('getrequest')
  handleGetRequest(
    @Query('SN') serialNumber: string,
    @Res() res: Response,
  ) {
    this.logger.debug(`Command poll from SN=${serialNumber}`);
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send('OK');
  }
}
