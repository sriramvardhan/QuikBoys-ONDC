import { Module, Global } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module.js';

// Core ONDC Services that are shared across modules
import { CallbackService } from './services/callback.service';
import { SignatureService } from './services/signature.service';
import { RegistryService } from './services/registry.service';
import { NetworkObservabilityService } from './services/network-observability.service';

/**
 * SharedOndcServicesModule - Provides shared ONDC services as singletons
 *
 * This module ensures that services like NetworkObservabilityService
 * are only instantiated once, preventing Prometheus metric registration errors.
 *
 * Services provided:
 * - CallbackService: Handles ONDC callback responses
 * - SignatureService: Signs/verifies ONDC messages
 * - RegistryService: Interacts with ONDC registry
 * - NetworkObservabilityService: Tracks response times for N.O. compliance
 */
@Global()
@Module({
  imports: [
    DatabaseModule,
    ConfigModule,
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 3,
    }),
  ],
  providers: [
    CallbackService,
    SignatureService,
    RegistryService,
    NetworkObservabilityService,
  ],
  exports: [
    CallbackService,
    SignatureService,
    RegistryService,
    NetworkObservabilityService,
  ],
})
export class SharedOndcServicesModule {}
