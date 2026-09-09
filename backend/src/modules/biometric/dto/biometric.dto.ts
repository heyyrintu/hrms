import { IsString, IsOptional, IsBoolean, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'Device serial number (SN) as shown in device settings' })
  @IsString()
  @IsNotEmpty()
  serialNumber: string;

  @ApiProperty({ description: 'Friendly name for this device, e.g. "Main Entrance"' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Device type', default: 'ESSL_ICLOCK' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  deviceType?: string;
}

export class UpdateDeviceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetBiometricUserIdDto {
  @ApiProperty({ description: 'The user ID enrolled in the biometric device (e.g. "42")' })
  @IsString()
  @IsNotEmpty()
  biometricUserId: string;
}
