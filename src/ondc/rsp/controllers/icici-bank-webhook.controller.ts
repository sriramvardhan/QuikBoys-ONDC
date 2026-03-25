/**
 * ICICI Bank Webhook Controller
 * Handles ICICI Bank API callbacks for:
 * - CIB Payment API (NEFT/RTGS/IMPS) status updates
 * - High TPS Payment API (IMPS/UPI) status updates
 * - UPI Collect API status updates
 * - Beneficiary validation responses
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
import { ICICIPayoutService } from '../services/icici-payout.service';

/**
 * ICICI Bank webhook payload structure
 * This may vary based on the specific API - adjust as per ICICI documentation
 */
interface ICICIWebhookPayload {
  // Common fields
  RESPONSE?: string;
  STATUS?: string;
  MESSAGE?: string;

  // CIB Payment API response fields
  UTRNUMBER?: string;
  REQID?: string;
  BENEID?: string;
  BANKREFNO?: string;
  TRANDATE?: string;
  DEBITACC?: string;

  // High TPS Payment API response fields
  UTR?: string;
  PAYEEVPA?: string;
  TRANSACTIONID?: string;
  AMOUNT?: string | number;
  STATUSCODE?: string;
  STATUSDESC?: string;

  // UPI Collect response fields
  txnId?: string;
  txnRef?: string;
  payerVpa?: string;
  payeeVpa?: string;
  amount?: string | number;
  status?: string;
  responseCode?: string;
  responseMessage?: string;

  // Generic fields
  [key: string]: unknown;
}

@ApiTags('RSP - ICICI Bank Webhooks')
@Controller('rsp/webhooks/icici')
export class ICICIBankWebhookController {
  private readonly logger = new Logger(ICICIBankWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly iciciPayoutService: ICICIPayoutService,
  ) {}

  /**
   * Handle ICICI CIB Payment API webhook (NEFT/RTGS/IMPS payouts)
   * Endpoint: POST /rsp/webhooks/icici/cib-payment
   */
  @Post('cib-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ICICI CIB Payment API webhook (NEFT/RTGS/IMPS)' })
  @ApiHeader({
    name: 'Authorization',
    description: 'ICICI API authorization token',
  })
  @ApiHeader({
    name: 'X-ICICI-Signature',
    description: 'Request signature for verification',
  })
  async handleCIBPaymentWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('authorization') authorization: string,
    @Headers('x-icici-signature') signature: string,
    @Body() payload: ICICIWebhookPayload,
  ) {
    this.logger.log(
      `Received ICICI CIB Payment webhook: STATUS=${payload.STATUS}, REQID=${payload.REQID}`,
    );

    try {
      // Verify webhook signature
      const rawBody = req.rawBody?.toString() || JSON.stringify(payload);
      const isValid = this.iciciPayoutService.verifyWebhookSignature(
        rawBody,
        signature || '',
      );

      if (!isValid) {
        this.logger.warn(
          'Invalid ICICI webhook signature - proceeding with caution',
        );
        // In production, you may want to reject invalid signatures
      }

      // Process the payout status update
      await this.processCIBPaymentStatus(payload);

      return {
        success: true,
        message: 'Webhook processed successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Error processing ICICI CIB Payment webhook: ${error.message}`,
        error.stack,
      );

      // Return 200 to prevent webhook retries
      return {
        success: false,
        message: 'Webhook received but processing failed',
        error: error.message,
      };
    }
  }

  /**
   * Handle ICICI High TPS Payment API webhook (IMPS/UPI instant payouts)
   * Endpoint: POST /rsp/webhooks/icici/high-tps
   */
  @Post('high-tps')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ICICI High TPS Payment API webhook (IMPS/UPI)' })
  @ApiHeader({
    name: 'Authorization',
    description: 'ICICI API authorization token',
  })
  @ApiHeader({
    name: 'X-ICICI-Signature',
    description: 'Request signature for verification',
  })
  async handleHighTPSWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('authorization') authorization: string,
    @Headers('x-icici-signature') signature: string,
    @Body() payload: ICICIWebhookPayload,
  ) {
    this.logger.log(
      `Received ICICI High TPS webhook: STATUS=${payload.STATUS || payload.status}, TRANSACTIONID=${payload.TRANSACTIONID || payload.txnId}`,
    );

    try {
      // Verify webhook signature
      const rawBody = req.rawBody?.toString() || JSON.stringify(payload);
      const isValid = this.iciciPayoutService.verifyWebhookSignature(
        rawBody,
        signature || '',
      );

      if (!isValid) {
        this.logger.warn(
          'Invalid ICICI webhook signature - proceeding with caution',
        );
      }

      // Process the high TPS payout status
      await this.processHighTPSPaymentStatus(payload);

      return {
        success: true,
        message: 'Webhook processed successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Error processing ICICI High TPS webhook: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        message: 'Webhook received but processing failed',
        error: error.message,
      };
    }
  }

  /**
   * Handle ICICI UPI Collect API webhook (COD collection from drivers)
   * Endpoint: POST /rsp/webhooks/icici/upi-collect
   */
  @Post('upi-collect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ICICI UPI Collect API webhook (COD collection)' })
  @ApiHeader({
    name: 'Authorization',
    description: 'ICICI API authorization token',
  })
  @ApiHeader({
    name: 'X-ICICI-Signature',
    description: 'Request signature for verification',
  })
  async handleUPICollectWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('authorization') authorization: string,
    @Headers('x-icici-signature') signature: string,
    @Body() payload: ICICIWebhookPayload,
  ) {
    this.logger.log(
      `Received ICICI UPI Collect webhook: status=${payload.status}, txnId=${payload.txnId}`,
    );

    try {
      // Verify webhook signature
      const rawBody = req.rawBody?.toString() || JSON.stringify(payload);
      const isValid = this.iciciPayoutService.verifyWebhookSignature(
        rawBody,
        signature || '',
      );

      if (!isValid) {
        this.logger.warn(
          'Invalid ICICI webhook signature - proceeding with caution',
        );
      }

      // Process the UPI collect status
      await this.processUPICollectStatus(payload);

      return {
        success: true,
        message: 'Webhook processed successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Error processing ICICI UPI Collect webhook: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        message: 'Webhook received but processing failed',
        error: error.message,
      };
    }
  }

  /**
   * Process CIB Payment (NEFT/RTGS/IMPS) status update
   */
  private async processCIBPaymentStatus(
    payload: ICICIWebhookPayload,
  ): Promise<void> {
    const {
      STATUS,
      REQID,
      UTRNUMBER,
      BANKREFNO,
      MESSAGE,
    } = payload;

    const status = this.mapICICIStatusToInternal(STATUS || '');
    const transferId = REQID || '';

    this.logger.log(
      `Processing CIB Payment: TransferID=${transferId}, Status=${status}, UTR=${UTRNUMBER}`,
    );

    switch (status) {
      case 'SUCCESS':
        await this.handlePayoutSuccess(transferId, UTRNUMBER, BANKREFNO);
        break;

      case 'FAILED':
      case 'REJECTED':
        await this.handlePayoutFailure(transferId, status, MESSAGE);
        break;

      case 'PENDING':
      case 'PROCESSING':
        this.logger.debug(`Payout ${transferId} is still ${status}`);
        break;

      default:
        this.logger.warn(`Unknown ICICI status: ${STATUS} for ${transferId}`);
    }
  }

  /**
   * Process High TPS Payment (IMPS/UPI) status update
   */
  private async processHighTPSPaymentStatus(
    payload: ICICIWebhookPayload,
  ): Promise<void> {
    const {
      STATUS,
      STATUSCODE,
      STATUSDESC,
      TRANSACTIONID,
      UTR,
    } = payload;

    const status = this.mapICICIStatusToInternal(STATUS || STATUSCODE || '');
    const transferId = TRANSACTIONID || '';

    this.logger.log(
      `Processing High TPS Payment: TransferID=${transferId}, Status=${status}, UTR=${UTR}`,
    );

    switch (status) {
      case 'SUCCESS':
        await this.handlePayoutSuccess(transferId, UTR);
        break;

      case 'FAILED':
      case 'REJECTED':
        await this.handlePayoutFailure(transferId, status, STATUSDESC);
        break;

      case 'PENDING':
      case 'PROCESSING':
        this.logger.debug(`High TPS payout ${transferId} is still ${status}`);
        break;

      default:
        this.logger.warn(
          `Unknown ICICI High TPS status: ${STATUS || STATUSCODE} for ${transferId}`,
        );
    }
  }

  /**
   * Process UPI Collect status update (COD collection)
   */
  private async processUPICollectStatus(
    payload: ICICIWebhookPayload,
  ): Promise<void> {
    const {
      status,
      txnId,
      txnRef,
      payerVpa,
      amount,
      responseCode,
      responseMessage,
    } = payload;

    const internalStatus = this.mapUPIStatusToInternal(status || '');
    const collectionId = txnRef || txnId || '';

    this.logger.log(
      `Processing UPI Collect: CollectionID=${collectionId}, Status=${internalStatus}, PayerVPA=${payerVpa}`,
    );

    try {
      // Find the payment collection record
      const collection = await this.prisma.paymentCollection.findFirst({
        where: {
          OR: [
            { pgOrderId: collectionId },
            { id: collectionId },
          ],
        },
      });

      if (!collection) {
        this.logger.warn(`Payment collection not found: ${collectionId}`);
        return;
      }

      // Update payment collection status
      const updateData: Record<string, unknown> = {
        webhookPayload: payload as Record<string, unknown>,
      };

      if (internalStatus === 'SUCCESS') {
        updateData.status = 'COMPLETED';
        updateData.paidAt = new Date();
        updateData.upiTransactionId = txnId;
        updateData.upiPayerVpa = payerVpa;
        updateData.metadata = {
          ...(collection.metadata as object),
          iciciResponseCode: responseCode,
          completedAt: new Date().toISOString(),
        };
      } else if (internalStatus === 'FAILED') {
        updateData.status = 'FAILED';
        updateData.failedAt = new Date();
        updateData.metadata = {
          ...(collection.metadata as object),
          iciciResponseCode: responseCode,
          failureReason: responseMessage,
          failedAt: new Date().toISOString(),
        };
      }

      await this.prisma.paymentCollection.update({
        where: { id: collection.id },
        data: updateData,
      });

      // If successful, update order payment status
      if (internalStatus === 'SUCCESS' && collection.orderId) {
        await this.prisma.order.update({
          where: { id: collection.orderId },
          data: {
            paymentStatus: 'COMPLETED',
          },
        });

        this.logger.log(
          `Order ${collection.orderId} payment status updated to PAID`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error processing UPI Collect status: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Handle successful payout
   */
  private async handlePayoutSuccess(
    transferId: string,
    utr?: string,
    bankRefNo?: string,
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
            bankRefNo,
            bankProvider: 'ICICI',
            completedAt: new Date().toISOString(),
          },
        },
      });

      // Extract batch ID from transfer ID if applicable
      const transferIdParts = transferId.split('-');
      if (transferIdParts.length > 2) {
        const batchId = transferIdParts.slice(0, -2).join('-');
        await this.checkAndUpdateBatchStatus(batchId);
      }
    } catch (error) {
      this.logger.error(`Error handling payout success: ${error.message}`);
    }
  }

  /**
   * Handle failed/rejected payout
   */
  private async handlePayoutFailure(
    transferId: string,
    status: string,
    failureReason?: string,
  ): Promise<void> {
    this.logger.warn(
      `Payout ${status}: ${transferId}, Reason: ${failureReason}`,
    );

    try {
      // Find and update the wallet transaction
      const transaction = await this.prisma.walletTransaction.findFirst({
        where: { referenceId: transferId },
        include: { wallet: true },
      });

      if (transaction) {
        // Reverse the wallet balance changes
        if (transaction.walletId) {
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
            status: 'FAILED',
            metadata: {
              ...(transaction.metadata as object),
              failureReason,
              bankProvider: 'ICICI',
              failedAt: new Date().toISOString(),
            },
          },
        });
      }

      // Update batch status if applicable
      const transferIdParts = transferId.split('-');
      if (transferIdParts.length > 2) {
        const batchId = transferIdParts.slice(0, -2).join('-');
        await this.checkAndUpdateBatchStatus(batchId);
      }
    } catch (error) {
      this.logger.error(`Error handling payout failure: ${error.message}`);
    }
  }

  /**
   * Check all payouts in batch and update batch status
   */
  private async checkAndUpdateBatchStatus(batchId: string): Promise<void> {
    try {
      const batch = await this.prisma.settlementBatch.findFirst({
        where: { batchId },
      });

      if (!batch) {
        this.logger.warn(`Settlement batch not found: ${batchId}`);
        return;
      }

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
        (t) => t.status === 'COMPLETED',
      ).length;
      const failedCount = transactions.filter(
        (t) => t.status === 'FAILED' || t.status === 'REVERSED',
      ).length;
      const pendingCount = transactions.filter(
        (t) => t.status === 'PENDING' || t.status === 'PROCESSING',
      ).length;

      let newStatus: string;

      if (pendingCount > 0) {
        newStatus = 'PROCESSING';
      } else if (failedCount === transactions.length) {
        newStatus = 'FAILED';
      } else if (completedCount === transactions.length) {
        newStatus = 'COMPLETED';
      } else {
        newStatus = 'PARTIAL';
      }

      if (batch.status !== newStatus) {
        await this.prisma.settlementBatch.update({
          where: { id: batch.id },
          data: {
            status: newStatus as never,
            metadata: {
              ...(batch.metadata as object),
              iciciWebhookUpdate: {
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
   * Map ICICI status codes to internal status
   */
  private mapICICIStatusToInternal(iciciStatus: string): string {
    const statusMap: Record<string, string> = {
      // CIB Payment statuses
      'SUCCESS': 'SUCCESS',
      'SUCCESSFUL': 'SUCCESS',
      'S': 'SUCCESS',
      'FAILURE': 'FAILED',
      'FAILED': 'FAILED',
      'F': 'FAILED',
      'REJECTED': 'REJECTED',
      'R': 'REJECTED',
      'PENDING': 'PENDING',
      'P': 'PENDING',
      'IN_PROGRESS': 'PROCESSING',
      'PROCESSING': 'PROCESSING',
      // High TPS specific
      '00': 'SUCCESS',
      '01': 'PENDING',
      '02': 'FAILED',
      '03': 'REJECTED',
    };

    return statusMap[iciciStatus.toUpperCase()] || iciciStatus.toUpperCase();
  }

  /**
   * Map UPI status codes to internal status
   */
  private mapUPIStatusToInternal(upiStatus: string): string {
    const statusMap: Record<string, string> = {
      'SUCCESS': 'SUCCESS',
      'S': 'SUCCESS',
      'COMPLETED': 'SUCCESS',
      'PAID': 'SUCCESS',
      'FAILURE': 'FAILED',
      'FAILED': 'FAILED',
      'F': 'FAILED',
      'DECLINED': 'FAILED',
      'REJECTED': 'FAILED',
      'PENDING': 'PENDING',
      'P': 'PENDING',
      'INITIATED': 'PENDING',
      'EXPIRED': 'FAILED',
    };

    return statusMap[upiStatus.toUpperCase()] || upiStatus.toUpperCase();
  }

  /**
   * Health check endpoint for ICICI integration
   */
  @Post('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check ICICI Bank integration health' })
  async checkICICIHealth() {
    try {
      const isConfigured = this.iciciPayoutService.isConfigured();

      return {
        isHealthy: isConfigured,
        service: 'ICICI Bank API',
        configured: isConfigured,
        endpoints: {
          cibPayment: '/rsp/webhooks/icici/cib-payment',
          highTps: '/rsp/webhooks/icici/high-tps',
          upiCollect: '/rsp/webhooks/icici/upi-collect',
        },
        checkedAt: new Date(),
      };
    } catch (error) {
      return {
        isHealthy: false,
        service: 'ICICI Bank API',
        error: error.message,
        checkedAt: new Date(),
      };
    }
  }
}
