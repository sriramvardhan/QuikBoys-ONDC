import { Global, Module } from '@nestjs/common';
import { ResilienceService } from './resilience.service.js';

@Global()
@Module({
  providers: [ResilienceService],
  exports: [ResilienceService],
})
export class ResilienceModule {}
