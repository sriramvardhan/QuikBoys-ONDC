import { Module } from '@nestjs/common';
import { HubLoadBalancingStub } from './hub-load-balancing.stub.js';

/**
 * Stub HubsModule for standalone ONDC development.
 * Provides HubLoadBalancingService via stub implementation.
 */
@Module({
  providers: [
    {
      provide: 'HubLoadBalancingService',
      useClass: HubLoadBalancingStub,
    },
    HubLoadBalancingStub,
  ],
  exports: ['HubLoadBalancingService', HubLoadBalancingStub],
})
export class HubsModule {}
