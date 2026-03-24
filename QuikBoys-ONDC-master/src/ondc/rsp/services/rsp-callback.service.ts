import { Injectable, Logger } from '@nestjs/common';
import { BecknContext } from '../../interfaces/beckn-context.interface';
import { BecknError } from '../../interfaces/beckn-message.interface';
import { CallbackService } from '../../services/callback.service';
import {
  ReconciliationResult,
  OnReceiverReconMessage,
  ReconciliationAcknowledgement,
} from '../dto/receiver-recon.dto';

/**
 * RspCallbackService - Handles sending on_receiver_recon callbacks
 * Reuses existing CallbackService for HTTP communication and retry logic
 */
@Injectable()
export class RspCallbackService {
  private readonly logger = new Logger(RspCallbackService.name);

  constructor(private readonly callbackService: CallbackService) {}

  /**
   * Send on_receiver_recon callback to ONDC network
   * Reports reconciliation results back to the BAP
   */
  async sendReconciliationCallback(
    originalContext: BecknContext,
    result: ReconciliationResult | null,
    error?: BecknError,
  ): Promise<boolean> {
    this.logger.log(
      `Sending on_receiver_recon callback for recon: ${result?.reconId || 'error'}`,
    );

    if (error) {
      // Send error callback
      return this.callbackService.sendCallback(originalContext, null, error);
    }

    if (!result) {
      this.logger.error('No result provided for callback');
      return false;
    }

    // Build on_receiver_recon message
    const message = this.buildOnReceiverReconMessage(result);

    // Use existing CallbackService to send (handles retry logic)
    return this.callbackService.sendCallback(originalContext, message);
  }

  /**
   * Build on_receiver_recon message from reconciliation result
   */
  private buildOnReceiverReconMessage(
    result: ReconciliationResult,
  ): OnReceiverReconMessage {
    const acknowledgement: ReconciliationAcknowledgement = {
      recon_id: result.reconId,
      status: result.status,
      received_count: result.receivedCount,
      matched_count: result.matchedCount,
      discrepancy_count: result.discrepancyCount,
      settled_amount: result.reconciledAmount.toFixed(2),
      held_amount: result.discrepancyAmount.toFixed(2),
      timestamp: new Date().toISOString(),
    };

    // Include discrepancies if any exist
    const message: OnReceiverReconMessage = {
      acknowledgement,
    };

    if (result.discrepancies && result.discrepancies.length > 0) {
      message.discrepancies = result.discrepancies.map((d) => ({
        ...d,
        severity: d.severity || 'MEDIUM',
      }));
    }

    return message;
  }

  /**
   * Build callback context for on_receiver_recon
   * Reuses the callback context builder from CallbackService
   */
  private buildCallbackContext(originalContext: BecknContext): BecknContext {
    // The CallbackService handles building the callback context
    // with proper action mapping (receiver_recon -> on_receiver_recon)
    return {
      ...originalContext,
      action: 'on_receiver_recon',
      timestamp: new Date().toISOString(),
    };
  }
}
