import { Module } from '@nestjs/common';
import { AutoDispatchStub } from './auto-dispatch.stub.js';

/**
 * Stub OrdersModule for standalone ONDC development.
 * Provides AutoDispatchService via stub implementation.
 */
@Module({
  providers: [
    {
      provide: 'AutoDispatchService',
      useClass: AutoDispatchStub,
    },
    AutoDispatchStub,
  ],
  exports: ['AutoDispatchService', AutoDispatchStub],
})
export class OrdersModule {}
