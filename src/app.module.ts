import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

// Core infrastructure
import { DatabaseModule } from './database/database.module.js';
import { ResilienceModule } from './common/resilience/resilience.module.js';

// Stub modules (replace with real implementations when integrating with monolith)
import { LocationModule } from './stubs/location.module.js';
import { HubsModule } from './stubs/hubs.module.js';
import { OrdersModule } from './stubs/orders.module.js';
import { IciciModule } from './stubs/icici.module.js';

// ONDC Module (the real deal)
import { OndcModule } from './ondc/ondc.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
    }),
    DatabaseModule,
    ResilienceModule,
    LocationModule,
    HubsModule,
    OrdersModule,
    IciciModule,
    OndcModule,
  ],
})
export class AppModule {}
