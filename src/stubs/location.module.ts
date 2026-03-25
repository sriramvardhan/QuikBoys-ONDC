import { Module } from '@nestjs/common';

/**
 * Stub LocationModule for standalone ONDC development.
 * The real LocationModule provides GPS tracking, accuracy pipeline, etc.
 * ONDC's TrackingService uses it to get driver's current location.
 *
 * TODO: ONDC team should implement location tracking interfaces as needed.
 */
@Module({
  providers: [],
  exports: [],
})
export class LocationModule {}
