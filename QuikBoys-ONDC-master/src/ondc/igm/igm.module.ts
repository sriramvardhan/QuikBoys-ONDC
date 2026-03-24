import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { IgmController } from './igm.controller';
import { IgmService } from './igm.service';
import { DatabaseModule } from '../../database/database.module.js';
import { SharedOndcServicesModule } from '../shared-ondc-services.module';

/**
 * IGM Module - Issue & Grievance Management for ONDC
 *
 * This module handles:
 * - Receiving issues from BAPs via /issue endpoint
 * - Processing issue status requests via /issue_status endpoint
 * - Sending on_issue and on_issue_status callbacks
 * - Internal APIs for issue management
 *
 * ONDC IGM Flow:
 * 1. BAP sends /issue when customer raises complaint
 * 2. BPP (QuikBoys) acknowledges with on_issue callback
 * 3. BPP updates issue status internally
 * 4. BAP can query status via /issue_status
 * 5. BPP responds with on_issue_status callback
 * 6. Issue goes through: OPEN -> ACKNOWLEDGED -> PROCESSING -> RESOLVED -> CLOSED
 */
@Module({
  imports: [
    ConfigModule,
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 3,
    }),
    DatabaseModule,
    SharedOndcServicesModule, // Provides SignatureService and other shared services
  ],
  controllers: [IgmController],
  providers: [IgmService],
  exports: [IgmService],
})
export class IgmModule {}
