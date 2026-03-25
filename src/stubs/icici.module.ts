import { Module, Global } from '@nestjs/common';
import {
  IciciCompositePayStub,
  IciciCibStub,
  IciciPayoutOrchestratorStub,
  IciciConfigStub,
  IciciCompositePayService,
  IciciCibService,
  IciciPayoutOrchestratorService,
  IciciConfigService,
} from './icici.stub.js';

@Global()
@Module({
  providers: [
    {
      provide: IciciCompositePayStub,
      useClass: IciciCompositePayStub,
    },
    {
      provide: IciciCibStub,
      useClass: IciciCibStub,
    },
    {
      provide: IciciPayoutOrchestratorStub,
      useClass: IciciPayoutOrchestratorStub,
    },
    {
      provide: IciciConfigStub,
      useClass: IciciConfigStub,
    },
    // Also provide aliases just in case
    {
      provide: IciciCompositePayService,
      useClass: IciciCompositePayStub,
    },
    {
      provide: IciciCibService,
      useClass: IciciCibStub,
    },
    {
      provide: IciciPayoutOrchestratorService,
      useClass: IciciPayoutOrchestratorStub,
    },
    {
      provide: IciciConfigService,
      useClass: IciciConfigStub,
    },
  ],
  exports: [
    IciciCompositePayStub,
    IciciCibStub,
    IciciPayoutOrchestratorStub,
    IciciConfigStub,
    IciciCompositePayService,
    IciciCibService,
    IciciPayoutOrchestratorService,
    IciciConfigService,
  ],
})
export class IciciModule {}
