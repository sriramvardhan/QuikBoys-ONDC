import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { httpsKeepAliveAgent } from '../common/http/keep-alive-agent.js';

// Controllers
import { WebhookController } from './controllers/webhook.controller';
import { OndcVerificationController } from './controllers/verification.controller';
import { OndcRedirectController } from './controllers/ondc-redirect.controller';

// Shared Services Module (singleton services)
import { SharedOndcServicesModule } from './shared-ondc-services.module';

// Services
import { CatalogService } from './services/catalog.service';
import { OrderMappingService } from './services/order-mapping.service';
import { QuoteService } from './services/quote.service';
import { TrackingService } from './services/tracking.service';
import { EncryptionService } from './services/encryption.service';
import { SubscriptionService } from './services/subscription.service';

// Phase 1 ONDC Compliance Services
import { AWBService } from './services/awb.service';
import { ConfirmationCodeService } from './services/confirmation-code.service';
import { CancellationTermsService } from './services/cancellation-terms.service';

// Phase 2 ONDC Compliance Services
import { WeightDifferentialService } from './services/weight-differential.service';
import { EWaybillService } from './services/ewaybill.service';
import { ShippingLabelService } from './services/shipping-label.service';
import { RTOService } from './services/rto.service';

// Phase 3 ONDC Compliance Services - Hyperlocal & Multi-Modal
import { MultiModalTransportService } from './services/multimodal-transport.service';
import { HyperlocalOptimizationService } from './services/hyperlocal-optimization.service';
import { DeliverySlotService } from './services/delivery-slot.service';
import { SurgePricingService } from './services/surge-pricing.service';
import { AnalyticsReportingService } from './services/analytics-reporting.service';
import { EWaybillAPIService } from './services/ewaybill-api.service';

// Processors
import { SearchProcessor } from './processors/search.processor';
import { SelectProcessor } from './processors/select.processor';
import { InitProcessor } from './processors/init.processor';
import { ConfirmProcessor } from './processors/confirm.processor';
import { StatusProcessor } from './processors/status.processor';
import { TrackProcessor } from './processors/track.processor';
import { CancelProcessor } from './processors/cancel.processor';
import { UpdateProcessor } from './processors/update.processor';

// IGM (Issue & Grievance Management)
import { IgmModule } from './igm/igm.module';

// Database
import { DatabaseModule } from '../database/database.module.js';

// Location Module for tracking (stub in standalone mode)
import { LocationModule } from '../stubs/location.module.js';

// Hubs Module for load balancing (stub in standalone mode)
import { HubsModule } from '../stubs/hubs.module.js';

// Orders Module for auto-dispatch (stub in standalone mode)
import { OrdersModule } from '../stubs/orders.module.js';

// RSP Module (Reconciliation, Settlement & Payouts)
import { RspModule } from './rsp/rsp.module';

// Config
import { ondcConfig } from './config/ondc.config';

@Module({
  imports: [
    ConfigModule.forFeature(ondcConfig),
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 3,
      httpsAgent: httpsKeepAliveAgent,
    }),
    DatabaseModule,
    LocationModule,
    HubsModule, // Hub load balancing for order assignment
    OrdersModule, // Auto-dispatch on order creation
    SharedOndcServicesModule, // Shared singleton services (CallbackService, SignatureService, etc.)
    IgmModule, // IGM Module for Issue & Grievance Management
    RspModule, // RSP Module for Reconciliation, Settlement & Payouts
  ],
  controllers: [WebhookController, OndcVerificationController, OndcRedirectController],
  providers: [
    // Module-specific Services
    CatalogService,
    OrderMappingService,
    QuoteService,
    TrackingService,
    EncryptionService,
    SubscriptionService,

    // Phase 1 ONDC Compliance Services
    AWBService,
    ConfirmationCodeService,
    CancellationTermsService,

    // Phase 2 ONDC Compliance Services
    WeightDifferentialService,
    EWaybillService,
    ShippingLabelService,
    RTOService,

    // Phase 3 ONDC Compliance Services - Hyperlocal & Multi-Modal
    MultiModalTransportService,
    HyperlocalOptimizationService,
    DeliverySlotService,
    SurgePricingService,
    AnalyticsReportingService,
    EWaybillAPIService,

    // Processors
    SearchProcessor,
    SelectProcessor,
    InitProcessor,
    ConfirmProcessor,
    StatusProcessor,
    TrackProcessor,
    CancelProcessor,
    UpdateProcessor,
  ],
  exports: [
    // Re-export SharedOndcServicesModule for modules that import OndcModule
    SharedOndcServicesModule,
    OrderMappingService,
    TrackingService,
    SubscriptionService,
    // Phase 1 Services
    AWBService,
    ConfirmationCodeService,
    CancellationTermsService,
    // Phase 2 Services
    WeightDifferentialService,
    EWaybillService,
    ShippingLabelService,
    RTOService,
    // Phase 3 Services - Hyperlocal & Multi-Modal
    MultiModalTransportService,
    HyperlocalOptimizationService,
    DeliverySlotService,
    SurgePricingService,
    AnalyticsReportingService,
    EWaybillAPIService,
    IgmModule, // Export IGM Module
  ],
})
export class OndcModule {}
