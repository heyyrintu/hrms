import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { TenantInfoController } from './tenant-info.controller';
import { LogoController } from './logo.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [CompaniesController, TenantInfoController, LogoController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
