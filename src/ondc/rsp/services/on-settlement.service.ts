// ============================================
// On-Settlement Service
// File: src/ondc/rsp/services/on-settlement.service.ts
// ONDC RSF 2.0 - Settlement acknowledgement handler
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { CallbackService } from '../../services/callback.service';
import { BecknContext } from '../../interfaces/beckn-context.interface';
import {
  SettlementRequest,
  SettlementDetails,
  OnSettlementMessage,
  SettlementRejection,
} from '../dto/settlement.dto';
import { SettlementBatchStatus, ReconciliationStatus } from '@prisma/client';

/**
 * OnSettlementService - ONDC RSF 2.0 Settlement Handler
 *
 * Handles:
 * 1. Processing settlement notifications from ONDC network
 * 2. Updating internal settlement records
 * 3. Sending on_settlement acknowledgement callbacks
 */
@Injectable()
export class OnSettlementService {
  private readonly logger = new Logger(OnSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly callbackService: CallbackService,
  ) {}

  /**
   * Process settlement notification from ONDC network
   * Updates internal records and sends acknowledgement
   */
  async processSettlement(request: SettlementRequest): Promise<void> {
    const { context, message } = request;
    const { settlement } = message;

    this.logger.log(`Processing settlement: ${settlement.settlement_id}`);

    try {
      // Process settlement and update records
      const result = await this.processSettlementDetails(settlement);

      // Build and send on_settlement callback
      const onSettlementMessage = this.buildOnSettlementMessage(
        settlement,
        result,
      );
      await this.sendOnSettlementCallback(context, onSettlementMessage);

      this.logger.log(
        `Settlement processed: ${settlement.settlement_id}, Status: ${result.status}`,
      );
    } catch (error) {
      this.logger.error(`Settlement processing failed: ${error.message}`);

      // Send error callback
      await this.callbackService.sendCallback(context, null, {
        type: 'DOMAIN-ERROR',
        code: '50001',
        message: `Settlement processing failed: ${error.message}`,
      });
    }
  }

  /**
   * Process settlement details and update internal records
   */
  private async processSettlementDetails(
    settlement: SettlementDetails,
  ): Promise<{
    status: 'ACCEPTED' | 'REJECTED' | 'PARTIAL';
    acceptedCount: number;
    rejectedCount: number;
    totalAmount: number;
    rejections: SettlementRejection[];
  }> {
    let acceptedCount = 0;
    let rejectedCount = 0;
    let totalAmount = 0;
    const rejections: SettlementRejection[] = [];

    // Process each order in settlement
    for (const orderItem of settlement.orders) {
      try {
        // Find matching reconciliation record
        const reconRecord = await this.prisma.reconciliationRecord.findFirst({
          where: {
            ondcOrderId: orderItem.order_id,
            ondcTransactionId: orderItem.transaction_id,
          },
        });

        if (!reconRecord) {
          this.logger.warn(
            `No reconciliation record found for order: ${orderItem.order_id}`,
          );
          rejections.push({
            order_id: orderItem.order_id,
            reason_code: 'ORDER_NOT_FOUND',
            reason_message: 'Order not found in reconciliation records',
          });
          rejectedCount++;
          continue;
        }

        // Verify amount matches
        const settlementAmount = parseFloat(orderItem.settlement_amount);
        const expectedAmount = Number(reconRecord.ondcNetAmount);

        if (Math.abs(settlementAmount - expectedAmount) > 0.01) {
          this.logger.warn(
            `Amount mismatch for order ${orderItem.order_id}: expected ₹${expectedAmount}, got ₹${settlementAmount}`,
          );
          rejections.push({
            order_id: orderItem.order_id,
            reason_code: 'AMOUNT_MISMATCH',
            reason_message: `Expected ₹${expectedAmount}, received ₹${settlementAmount}`,
          });
          rejectedCount++;
          continue;
        }

        // Update reconciliation record with settlement status
        // Note: Settlement details are stored in rawPayload as the schema doesn't have a separate metadata field
        const existingPayload = (reconRecord.rawPayload as object) || {};
        await this.prisma.reconciliationRecord.update({
          where: { id: reconRecord.id },
          data: {
            status:
              orderItem.settlement_status === 'PAID'
                ? ReconciliationStatus.SETTLED
                : ReconciliationStatus.PENDING,
            reconciledAt:
              orderItem.settlement_status === 'PAID'
                ? new Date()
                : reconRecord.reconciledAt,
            rawPayload: {
              ...existingPayload,
              settlementDetails: {
                settlement_id: settlement.settlement_id,
                settlement_reference_no: settlement.settlement_reference_no,
                utr_number: settlement.utr_number,
                settlement_timestamp: settlement.settlement_timestamp,
                order_settlement_status: orderItem.settlement_status,
                order_settlement_reference: orderItem.settlement_reference,
              },
            },
          },
        });

        totalAmount += settlementAmount;
        acceptedCount++;
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Error processing order ${orderItem.order_id}: ${errorMessage}`,
        );
        rejections.push({
          order_id: orderItem.order_id,
          reason_code: 'PROCESSING_ERROR',
          reason_message: errorMessage,
        });
        rejectedCount++;
      }
    }

    // Update settlement batch if exists
    await this.updateSettlementBatch(settlement, acceptedCount, rejectedCount);

    // Determine overall status
    const status =
      rejectedCount === 0
        ? 'ACCEPTED'
        : acceptedCount === 0
          ? 'REJECTED'
          : 'PARTIAL';

    return {
      status,
      acceptedCount,
      rejectedCount,
      totalAmount,
      rejections,
    };
  }

  /**
   * Update settlement batch with ONDC settlement confirmation
   */
  private async updateSettlementBatch(
    settlement: SettlementDetails,
    acceptedCount: number,
    rejectedCount: number,
  ): Promise<void> {
    // Find settlement batch by reference
    const batch = await this.prisma.settlementBatch.findFirst({
      where: {
        OR: [
          { batchId: settlement.settlement_id },
          { batchId: { contains: settlement.settlement_reference_no } },
        ],
      },
    });

    if (batch) {
      const newStatus =
        settlement.settlement_status === 'PAID'
          ? SettlementBatchStatus.COMPLETED
          : settlement.settlement_status === 'FAILED'
            ? SettlementBatchStatus.FAILED
            : SettlementBatchStatus.PROCESSING;

      await this.prisma.settlementBatch.update({
        where: { id: batch.id },
        data: {
          status: newStatus,
          processedAt:
            settlement.settlement_status === 'PAID'
              ? new Date()
              : batch.processedAt,
          metadata: {
            ...((batch.metadata as object) || {}),
            ondcSettlement: {
              settlement_id: settlement.settlement_id,
              settlement_reference_no: settlement.settlement_reference_no,
              utr_number: settlement.utr_number,
              settlement_status: settlement.settlement_status,
              settlement_timestamp: settlement.settlement_timestamp,
              accepted_orders: acceptedCount,
              rejected_orders: rejectedCount,
            },
          },
        },
      });

      this.logger.log(
        `Settlement batch ${batch.batchId} updated with ONDC confirmation`,
      );
    }
  }

  /**
   * Build on_settlement callback message
   */
  private buildOnSettlementMessage(
    settlement: SettlementDetails,
    result: {
      status: 'ACCEPTED' | 'REJECTED' | 'PARTIAL';
      acceptedCount: number;
      rejectedCount: number;
      totalAmount: number;
      rejections: SettlementRejection[];
    },
  ): OnSettlementMessage {
    const message: OnSettlementMessage = {
      settlement_id: settlement.settlement_id,
      status: result.status === 'ACCEPTED' ? 'ACCEPTED' : result.status,
      acknowledgement: {
        received_count: settlement.orders.length,
        accepted_count: result.acceptedCount,
        rejected_count: result.rejectedCount,
        total_amount: result.totalAmount.toFixed(2),
        timestamp: new Date().toISOString(),
      },
    };

    if (result.rejections.length > 0) {
      message.rejections = result.rejections;
    }

    return message;
  }

  /**
   * Send on_settlement callback to ONDC network
   */
  private async sendOnSettlementCallback(
    originalContext: BecknContext,
    message: OnSettlementMessage,
  ): Promise<boolean> {
    this.logger.log(
      `Sending on_settlement callback for: ${message.settlement_id}`,
    );

    const callbackContext: BecknContext = {
      ...originalContext,
      action: 'on_settlement',
      timestamp: new Date().toISOString(),
    };

    return this.callbackService.sendCallback(callbackContext, message);
  }

  /**
   * Get settlement status for internal tracking
   */
  async getSettlementStatus(settlementId: string) {
    // Query using rawPayload JSON path for settlement details
    const records = await this.prisma.reconciliationRecord.findMany({
      where: {
        rawPayload: {
          path: ['settlementDetails', 'settlement_id'],
          equals: settlementId,
        },
      },
    });

    if (records.length === 0) {
      return null;
    }

    const settled = records.filter(
      (r) => r.status === ReconciliationStatus.SETTLED,
    );
    const pending = records.filter(
      (r) => r.status === ReconciliationStatus.PENDING,
    );

    return {
      settlementId,
      totalOrders: records.length,
      settledOrders: settled.length,
      pendingOrders: pending.length,
      totalAmount: records.reduce((sum, r) => sum + Number(r.ondcNetAmount), 0),
    };
  }
}
