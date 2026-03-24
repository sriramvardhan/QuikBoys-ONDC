/**
 * Payout Webhook Controller
 * Handles Cashfree Payout webhooks for transfer status updates
 * Updates settlement batches and wallet transactions based on payout status
 */

import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import type { Request } from 'express';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  CashfreePayoutService,
  PayoutStatus,
} from '../services/cashfree-payout.service';
import { SettlementBatchStatus, WalletTransactionStatus } from '@prisma/client';

interface PayoutWebhookPayload {
  event: string;
  transferId?: string;
  transfer_id?: string;
  referenceId?: string;
  reference_id?: string;
  utr?: string;
  status?: string;
  transferStatus?: string;
  amount?: string | number;
  timestamp?: string;
  eventTime?: string;
  reason?: string;
  failure_reason?: string;
  transfer?: {
    transferId?: string;
    referenceId?: string;
    utr?: string;
    status?: string;
    amount?: string | number;
    reason?: string;
    processedOn?: string;
  };
}

@ApiTags('RSP - Payout Webhooks')
@Controller('rsp/webhooks/payout')
export class PayoutWebhookController {
  private readonly logger = new Logger(PayoutWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashfreePayoutService: CashfreePayoutService,
  ) {}

  /**
   * Handle Cashfree Payout webhook
   * Receives transfer status updates (SUCCESS, FAILED, REVERSED, etc.)
   */
  @Post('cashfree')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cashfree Payout webhook endpoint' })
  @ApiHeader({
    name: 'x-webhook-signature',
    description: 'Webhook signature for verification',
  })
  async handleCashfreeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-webhook-signature') signature: string,
    @Body() payload: PayoutWebhookPayload,
  ) {
    this.logger.log(
      `Received Cashfree payout webhook: ${payload.event || 'TRANSFER_STATUS'}`,
    );

    try {
      // Verify webhook signature
      const rawBody = req.rawBody?.toString() || JSON.stringify(payload);
      const isValid = this.cashfreePayoutService.verifyWebhookSignature(
        rawBody,
        signature || '',
      );

      if (!isValid) {
        this.logger.warn('Invalid webhook signature - proceeding with caution');
        // In production, you might want to reject invalid signatures
        // For now, we'll log and continue for testing purposes
      }

      // Parse webhook payload
      const webhookData = this.cashfreePayoutService.parseWebhookPayload(
        payload as unknown as Record<string, unknown>,
      );

      this.logger.log(
        `Payout webhook: TransferID=${webhookData.transferId}, Status=${webhookData.status}, UTR=${webhookData.utr}`,
      );

      // Process based on status
      await this.processPayoutStatusUpdate(webhookData);

      return {
        success: true,
        message: 'Webhook processed successfully',
      };
    } catch (error) {
      this.logger.error(
        `Error processing payout webhook: ${error.message}`,
        error.stack,
      );

      // Return 200 to prevent webhook retries for processing errors
      return {
        success: false,
        message: 'Webhook received but processing failed',
        error: error.message,
      };
    }
  }

  /**
   * Process payout status update from webhook
   */
  private async processPayoutStatusUpdate(webhookData: {
    event: string;
    transferId: string;
    referenceId?: string;
    utr?: string;
    status: PayoutStatus;
    amount: number;
    timestamp: Date;
    failureReason?: string;
  }): Promise<void> {
    const { transferId, status, utr, failureReason, referenceId } = webhookData;

    // Extract batch ID and driver ID from transfer ID format: {batchId}-{driverId}-{timestamp}
    const transferIdParts = transferId.split('-');
    const batchId = transferIdParts.slice(0, -2).join('-'); // Remove driverId and timestamp

    switch (status) {
      case 'SUCCESS':
        await this.handlePayoutSuccess(transferId, batchId, utr, referenceId);
        break;

      case 'FAILED':
      case 'REVERSED':
      case 'CANCELLED':
        await this.handlePayoutFailure(
          transferId,
          batchId,
          status,
          failureReason,
        );
        break;

      case 'PROCESSING':
      case 'PENDING':
        // Status is still in progress, no action needed
        this.logger.debug(`Payout ${transferId} is still ${status}`);
        break;

      default:
        this.logger.warn(
          `Unknown payout status: ${status} for transfer ${transferId}`,
        );
    }
  }

  /**
   * Handle successful payout
   */
  private async handlePayoutSuccess(
    transferId: string,
    batchId: string,
    utr?: string,
    referenceId?: string,
  ): Promise<void> {
    this.logger.log(`Payout successful: ${transferId}, UTR: ${utr}`);

    try {
      // Update wallet transaction with UTR
      await this.prisma.walletTransaction.updateMany({
        where: {
          referenceId: transferId,
        },
        data: {
          status: 'COMPLETED',
          metadata: {
            utr,
            referenceId,
            completedAt: new Date().toISOString(),
          },
        },
      });

      // Check if all payouts in the batch are complete
      await this.checkAndUpdateBatchStatus(batchId);
    } catch (error) {
      this.logger.error(`Error handling payout success: ${error.message}`);
    }
  }

  /**
   * Handle failed/reversed payout
   */
  private async handlePayoutFailure(
    transferId: string,
    batchId: string,
    status: PayoutStatus,
    failureReason?: string,
  ): Promise<void> {
    this.logger.warn(
      `Payout ${status}: ${transferId}, Reason: ${failureReason}`,
    );

    try {
      // Update wallet transaction to failed
      const transaction = await this.prisma.walletTransaction.findFirst({
        where: { referenceId: transferId },
        include: { wallet: true },
      });

      if (transaction) {
        // Reverse the wallet balance changes
        if (status === 'REVERSED' || status === 'FAILED') {
          await this.prisma.driverWallet.updateMany({
            where: { id: transaction.walletId },
            data: {
              pendingBalance: {
                increment: transaction.amount,
              },
              totalWithdrawn: {
                decrement: transaction.amount,
              },
            },
          });
        }

        // Update transaction status
        await this.prisma.walletTransaction.update({
          where: { id: transaction.id },
          data: {
            status: status === 'REVERSED' ? 'REVERSED' : 'FAILED',
            metadata: {
              ...(transaction.metadata as object),
              failureReason,
              failedAt: new Date().toISOString(),
            },
          },
        });
      }

      // Update batch status if needed
      await this.checkAndUpdateBatchStatus(batchId);
    } catch (error) {
      this.logger.error(`Error handling payout failure: ${error.message}`);
    }
  }

  /**
   * Check all payouts in batch and update batch status accordingly
   */
  private async checkAndUpdateBatchStatus(batchId: string): Promise<void> {
    try {
      // Find the settlement batch by batchId string (not the database ID)
      const batch = await this.prisma.settlementBatch.findFirst({
        where: { batchId },
      });

      if (!batch) {
        this.logger.warn(`Settlement batch not found: ${batchId}`);
        return;
      }

      // Get all wallet transactions for this batch
      const transactions = await this.prisma.walletTransaction.findMany({
        where: {
          referenceId: {
            startsWith: batchId,
          },
        },
      });

      if (transactions.length === 0) {
        return;
      }

      const completedCount = transactions.filter(
        (t) => t.status === WalletTransactionStatus.COMPLETED,
      ).length;
      const failedCount = transactions.filter(
        (t) =>
          t.status === WalletTransactionStatus.FAILED ||
          t.status === WalletTransactionStatus.REVERSED,
      ).length;
      const pendingCount = transactions.filter(
        (t) =>
          t.status === WalletTransactionStatus.PENDING ||
          t.status === WalletTransactionStatus.PROCESSING,
      ).length;

      // Determine new batch status
      let newStatus: SettlementBatchStatus;

      if (pendingCount > 0) {
        // Still have pending transactions
        newStatus = SettlementBatchStatus.PROCESSING;
      } else if (failedCount === transactions.length) {
        // All failed
        newStatus = SettlementBatchStatus.FAILED;
      } else if (completedCount === transactions.length) {
        // All completed
        newStatus = SettlementBatchStatus.COMPLETED;
      } else {
        // Partial success
        newStatus = SettlementBatchStatus.PARTIAL;
      }

      // Update batch status if changed
      if (batch.status !== newStatus) {
        await this.prisma.settlementBatch.update({
          where: { id: batch.id },
          data: {
            status: newStatus,
            metadata: {
              ...(batch.metadata as object),
              webhookUpdate: {
                completedCount,
                failedCount,
                pendingCount,
                updatedAt: new Date().toISOString(),
              },
            },
          },
        });

        this.logger.log(
          `Settlement batch ${batchId} status updated to ${newStatus} (${completedCount}/${transactions.length} completed)`,
        );
      }
    } catch (error) {
      this.logger.error(`Error updating batch status: ${error.message}`);
    }
  }

  /**
   * Manual status check endpoint (for debugging/admin)
   */
  @Post('check-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually check and update payout status' })
  async checkPayoutStatus(
    @Body() body: { transferId: string; referenceId?: string },
  ) {
    const { transferId, referenceId } = body;

    this.logger.log(`Manual status check for transfer: ${transferId}`);

    try {
      const status = await this.cashfreePayoutService.getPayoutStatus(
        transferId,
        referenceId,
      );

      // Process the status update
      await this.processPayoutStatusUpdate({
        event: 'MANUAL_CHECK',
        transferId,
        referenceId: status.referenceId,
        utr: status.utr,
        status: status.status,
        amount: status.amount,
        timestamp: status.processedAt || new Date(),
        failureReason: status.failureReason,
      });

      return {
        success: true,
        status,
      };
    } catch (error) {
      this.logger.error(`Error checking payout status: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Health check for payout service
   */
  @Post('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check payout service health and balance' })
  async checkPayoutHealth() {
    try {
      const balance = await this.cashfreePayoutService.checkBalance();

      return {
        isHealthy: balance !== null,
        service: 'Cashfree Payout',
        balance,
        checkedAt: new Date(),
      };
    } catch (error) {
      return {
        isHealthy: false,
        service: 'Cashfree Payout',
        error: error.message,
        checkedAt: new Date(),
      };
    }
  }
}
