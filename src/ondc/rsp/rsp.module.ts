import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module.js';

// Controllers
import { RspWebhookController } from './controllers/rsp-webhook.controller';
import { PayoutWebhookController } from './controllers/payout-webhook.controller';
import { RsfManagementController } from './controllers/rsf-management.controller';
// ICICIBankWebhookController replaced by IciciWebhookController in IciciModule

// Services
import { ReconciliationService } from './services/reconciliation.service';
import { SettlementService } from './services/settlement.service';
import { RspCallbackService } from './services/rsp-callback.service';
import { CashfreePayoutService } from './services/cashfree-payout.service';
import { ICICIPayoutService } from './services/icici-payout.service';

// RSF 2.0 Services
import { NBBLIntegrationService } from './services/nbbl-integration.service';
import { PayoutReconciliationService } from './services/payout-reconciliation.service';
import { OnSettlementService } from './services/on-settlement.service';
import { GstInvoiceService } from './services/gst-invoice.service';

// Processors
import { ReceiverReconProcessor } from './processors/receiver-recon.processor';

// Shared ONDC Services Module
import { SharedOndcServicesModule } from '../shared-ondc-services.module';

/**
 * RspModule - ONDC Reconciliation, Settlement & Payouts Module
 * RSF 2.0 compliant implementation with:
 * - NBBL bank account integration
 * - Annexure 2 format reconciliation files
 * - on_settlement API support
 * - GST invoice generation
 * Integrated with Cashfree Payout for NEFT/RTGS/IMPS/UPI driver payouts
 */
@Module({
  imports: [
    DatabaseModule,
    ConfigModule,
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 3,
    }),
    SharedOndcServicesModule, // Import shared services (CallbackService, SignatureService, etc.)
    // IciciModule is registered globally in AppModule (provides IciciPayoutOrchestratorService)
  ],
  controllers: [
    RspWebhookController,
    PayoutWebhookController,
    RsfManagementController,
    // ICICIBankWebhookController removed -- replaced by IciciWebhookController in IciciModule
  ],
  providers: [
    // RSP Services
    ReconciliationService,
    SettlementService,
    RspCallbackService,

    // RSF 2.0 Services
    NBBLIntegrationService,
    PayoutReconciliationService,
    OnSettlementService,
    GstInvoiceService,

    // Payment Gateway Services
    CashfreePayoutService,
    ICICIPayoutService,

    // Processor
    ReceiverReconProcessor,
  ],
  exports: [
    ReconciliationService,
    SettlementService,
    RspCallbackService,
    CashfreePayoutService,
    ICICIPayoutService,
    // RSF 2.0 exports
    NBBLIntegrationService,
    PayoutReconciliationService,
    OnSettlementService,
    GstInvoiceService,
  ],
})
export class RspModule {}
