import { Injectable, Logger } from '@nestjs/common';
import { ReceiverReconRequest } from '../dto/receiver-recon.dto';
import { ReconciliationService } from '../services/reconciliation.service';
import { SettlementService } from '../services/settlement.service';
import { RspCallbackService } from '../services/rsp-callback.service';
import { CallbackService } from '../../services/callback.service';
import { OndcTransactionStatus } from '@prisma/client';
import { buildRspError, RspErrorCode } from '../constants/rsp-error-codes';
import { getErrorMessage } from '../../../common/utils/error.utils.js';

/**
 * ReceiverReconProcessor - Handles async processing of reconciliation requests
 * Orchestrates reconciliation, settlement, and callback flow
 */
@Injectable()
export class ReceiverReconProcessor {
  private readonly logger = new Logger(ReceiverReconProcessor.name);

  constructor(
    private readonly reconciliationService: ReconciliationService,
    private readonly settlementService: SettlementService,
    private readonly rspCallbackService: RspCallbackService,
    private readonly callbackService: CallbackService,
  ) {}

  /**
   * Process receiver_recon request asynchronously
   * Main orchestration method
   */
  async process(request: ReceiverReconRequest): Promise<void> {
    const { context, message } = request;
    const reconId = message.recon.recon_id;
    const transactionId = context.transaction_id;

    this.logger.log(`Processing receiver_recon: ${reconId}`);

    try {
      // Update transaction status to PROCESSING
      await this.callbackService.updateTransactionStatus(
        transactionId,
        OndcTransactionStatus.PROCESSING,
      );

      // Step 1: Process reconciliation data
      this.logger.debug(`Step 1: Processing reconciliation data`);
      const result =
        await this.reconciliationService.processReconciliationData(request);

      this.logger.log(
        `Reconciliation completed: Received=${result.receivedCount}, Matched=${result.matchedCount}, Discrepancies=${result.discrepancyCount}`,
      );

      // Step 2: Create settlement batch for matched transactions
      if (result.matchedCount > 0) {
        this.logger.debug(`Step 2: Creating settlement batch`);

        const batch = await this.settlementService.createSettlementBatch(
          context.bap_id,
          new Date(message.recon.period.start_time),
          new Date(message.recon.period.end_time),
        );

        if (batch) {
          // Step 3: Auto-process settlement for matched transactions
          this.logger.debug(
            `Step 3: Processing automatic settlement for batch ${batch.batchId}`,
          );

          const settled =
            await this.settlementService.processAutomaticSettlement(batch.id);

          if (settled) {
            this.logger.log(
              `Settlement batch ${batch.batchId} processed successfully`,
            );
          } else {
            this.logger.warn(
              `Settlement batch ${batch.batchId} processing failed`,
            );
          }
        }
      } else {
        this.logger.warn('No matched transactions to settle');
      }

      // Step 4: Hold discrepant amounts for review
      if (result.discrepancyCount > 0) {
        this.logger.debug(
          `Step 4: Holding ${result.discrepancyCount} discrepant amounts`,
        );

        await this.settlementService.holdDiscrepantAmounts(
          result.discrepancies,
        );
      }

      // Step 5: Send on_receiver_recon callback
      this.logger.debug(`Step 5: Sending on_receiver_recon callback`);

      const sent = await this.rspCallbackService.sendReconciliationCallback(
        context,
        result,
      );

      if (sent) {
        this.logger.log(
          `on_receiver_recon callback sent successfully for recon ${reconId}`,
        );

        // Update transaction status to COMPLETED
        await this.callbackService.updateTransactionStatus(
          transactionId,
          OndcTransactionStatus.COMPLETED,
        );
      } else {
        this.logger.warn(
          `on_receiver_recon callback failed for recon ${reconId}`,
        );

        // Mark as completed even if callback failed (we retried already)
        await this.callbackService.updateTransactionStatus(
          transactionId,
          OndcTransactionStatus.COMPLETED,
        );
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(
        `Receiver recon processing error for ${reconId}: ${errorMessage}`,
      );

      // Update transaction status to FAILED
      await this.callbackService.updateTransactionStatus(
        transactionId,
        OndcTransactionStatus.FAILED,
        undefined,
        RspErrorCode.RECONCILIATION_FAILED,
        errorMessage,
      );

      // Send error callback
      await this.rspCallbackService.sendReconciliationCallback(
        context,
        null,
        buildRspError(RspErrorCode.RECONCILIATION_FAILED, errorMessage),
      );
    }
  }

  /**
   * Validate reconciliation request before processing
   * (Additional validation beyond controller level)
   */
  private validateReconRequest(request: ReceiverReconRequest): string | null {
    const { message } = request;

    if (!message?.recon?.orders || message.recon.orders.length === 0) {
      return 'No orders provided for reconciliation';
    }

    if (!message.recon.period?.start_time || !message.recon.period?.end_time) {
      return 'Invalid reconciliation period';
    }

    // Validate period is not in the future
    const periodStart = new Date(message.recon.period.start_time);
    const periodEnd = new Date(message.recon.period.end_time);
    const now = new Date();

    if (periodStart > now || periodEnd > now) {
      return 'Reconciliation period cannot be in the future';
    }

    // Validate period is not too long (e.g., max 1 month)
    const periodDays =
      (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24);
    if (periodDays > 31) {
      return 'Reconciliation period cannot exceed 31 days';
    }

    return null;
  }
}
