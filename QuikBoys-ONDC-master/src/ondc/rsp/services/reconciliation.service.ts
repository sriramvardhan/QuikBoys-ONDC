import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  ReceiverReconRequest,
  ReconOrderItem,
  ReconciliationResult,
  MatchedOrder,
  DiscrepancyDetail,
} from '../dto/receiver-recon.dto';
import {
  ReconciliationStatus,
  ReconciliationMatchStatus,
  WalletTransactionType,
  WalletTransactionStatus,
  DiscrepancyType as PrismaDiscrepancyType,
  SettlementDiscrepancyStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * ReconciliationService - Core reconciliation logic
 * Matches ONDC transactions with internal records and detects discrepancies
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private readonly AMOUNT_TOLERANCE = new Decimal('0.01'); // ₹0.01 tolerance for rounding

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Process reconciliation data from ONDC network
   * Main entry point for reconciliation processing
   */
  async processReconciliationData(
    request: ReceiverReconRequest,
  ): Promise<ReconciliationResult> {
    const { context, message } = request;
    const { recon } = message;

    this.logger.log(
      `Processing reconciliation: ${recon.recon_id} for period ${recon.period.start_time} to ${recon.period.end_time}`,
    );

    const periodStart = new Date(recon.period.start_time);
    const periodEnd = new Date(recon.period.end_time);

    const matchedOrders: MatchedOrder[] = [];
    const discrepancies: DiscrepancyDetail[] = [];
    let reconciledAmount = 0;
    let discrepancyAmount = 0;

    // Process orders in parallel with chunking for better performance
    const CHUNK_SIZE = 10;
    const orderChunks: ReconOrderItem[][] = [];
    for (let i = 0; i < recon.orders.length; i += CHUNK_SIZE) {
      orderChunks.push(recon.orders.slice(i, i + CHUNK_SIZE));
    }

    for (const chunk of orderChunks) {
      const chunkResults = await Promise.all(
        chunk.map(async (ondcOrder) => {
          try {
            const matchResult = await this.matchTransaction(
              ondcOrder,
              periodStart,
              periodEnd,
            );

            // Store reconciliation record
            await this.createReconciliationRecord(
              recon.recon_id,
              ondcOrder,
              matchResult,
              periodStart,
              periodEnd,
              context.bap_id,
            );

            if (matchResult.matchStatus === 'MATCHED') {
              return { type: 'matched' as const, matchResult };
            } else {
              const discrepancy = await this.createDiscrepancy(
                ondcOrder,
                matchResult,
              );
              return { type: 'discrepancy' as const, matchResult, discrepancy };
            }
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Error processing order ${ondcOrder.order_id}: ${errorMessage}`,
            );
            return {
              type: 'error' as const,
              discrepancy: {
                order_id: ondcOrder.order_id,
                type: 'MISSING_TRANSACTION' as const,
                ondc_amount: ondcOrder.total_amount,
                internal_amount: '0',
                difference: ondcOrder.total_amount,
                reason: `Error processing order: ${errorMessage}`,
                severity: 'HIGH' as const,
              },
            };
          }
        }),
      );

      // Aggregate results from chunk
      for (const result of chunkResults) {
        if (result.type === 'matched') {
          matchedOrders.push(result.matchResult);
          reconciledAmount += result.matchResult.ondcAmount;
        } else if (result.type === 'discrepancy') {
          discrepancies.push(result.discrepancy);
          discrepancyAmount += Math.abs(
            result.matchResult.ondcAmount - result.matchResult.internalAmount,
          );
        } else {
          discrepancies.push(result.discrepancy);
        }
      }
    }

    // Determine overall status
    const status =
      discrepancies.length === 0
        ? 'ACCEPTED'
        : matchedOrders.length > 0
          ? 'PARTIAL'
          : 'REJECTED';

    return {
      reconId: recon.recon_id,
      periodStart,
      periodEnd,
      networkParticipantId: context.bap_id,
      receivedCount: recon.orders.length,
      matchedCount: matchedOrders.length,
      discrepancyCount: discrepancies.length,
      reconciledAmount,
      discrepancyAmount,
      matchedOrders,
      discrepancies,
      status,
    };
  }

  /**
   * Match ONDC transaction with internal order and wallet transaction
   * Core matching algorithm
   */
  private async matchTransaction(
    ondcOrder: ReconOrderItem,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<MatchedOrder> {
    const ondcOrderId = ondcOrder.order_id;
    const ondcAmount = parseFloat(ondcOrder.total_amount);

    this.logger.debug(`Matching order: ${ondcOrderId}, amount: ${ondcAmount}`);

    // Step 1: Find internal order by ONDC order ID
    const internalOrder = await this.prisma.order.findFirst({
      where: {
        ondcOrderId,
        createdAt: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
    });

    if (!internalOrder) {
      this.logger.warn(
        `No internal order found for ONDC order: ${ondcOrderId}`,
      );
      return {
        ondcOrderId,
        internalOrderId: '',
        ondcAmount,
        internalAmount: 0,
        matchStatus: 'PARTIAL_MATCH', // Order not found - treated as discrepancy
      };
    }

    // Step 2: Find wallet transaction for this order
    const walletTx = await this.prisma.walletTransaction.findFirst({
      where: {
        orderId: internalOrder.id,
        type: WalletTransactionType.DELIVERY_PAYMENT,
        status: WalletTransactionStatus.COMPLETED,
      },
    });

    if (!walletTx) {
      this.logger.warn(
        `No wallet transaction found for order: ${internalOrder.id}`,
      );
      return {
        ondcOrderId,
        internalOrderId: internalOrder.id,
        ondcAmount,
        internalAmount: 0,
        matchStatus: 'AMOUNT_MISMATCH',
      };
    }

    // Step 3: Compare amounts (with tolerance)
    const internalAmount = Number(walletTx.amount);
    const difference = new Decimal(ondcAmount)
      .minus(new Decimal(internalAmount))
      .abs();

    if (difference.greaterThan(this.AMOUNT_TOLERANCE)) {
      this.logger.warn(
        `Amount mismatch for order ${ondcOrderId}: ONDC=${ondcAmount}, Internal=${internalAmount}, Diff=${difference}`,
      );
      return {
        ondcOrderId,
        internalOrderId: internalOrder.id,
        ondcAmount,
        internalAmount,
        matchStatus: 'AMOUNT_MISMATCH',
      };
    }

    // Step 4: Successful match
    this.logger.debug(`Successfully matched order: ${ondcOrderId}`);
    return {
      ondcOrderId,
      internalOrderId: internalOrder.id,
      ondcAmount,
      internalAmount,
      matchStatus: 'MATCHED',
    };
  }

  /**
   * Create discrepancy record
   */
  private async createDiscrepancy(
    ondcOrder: ReconOrderItem,
    matchResult: MatchedOrder,
  ): Promise<DiscrepancyDetail> {
    const ondcAmount = matchResult.ondcAmount;
    const internalAmount = matchResult.internalAmount;
    const difference = ondcAmount - internalAmount;

    let discrepancyType: PrismaDiscrepancyType;
    let reason: string;
    let severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

    if (!matchResult.internalOrderId) {
      discrepancyType = PrismaDiscrepancyType.MISSING_TRANSACTION;
      reason = `Order ${ondcOrder.order_id} not found in internal records`;
      severity = 'HIGH';
    } else if (Math.abs(difference) > 0.01) {
      discrepancyType = PrismaDiscrepancyType.AMOUNT_MISMATCH;
      reason = `Amount mismatch: ONDC shows ₹${ondcAmount}, Internal shows ₹${internalAmount}`;
      severity = Math.abs(difference) > 100 ? 'CRITICAL' : 'HIGH';
    } else {
      discrepancyType = PrismaDiscrepancyType.STATUS_MISMATCH;
      reason = 'Status or data mismatch';
      severity = 'MEDIUM';
    }

    // Store in database
    await this.prisma.settlementDiscrepancy.create({
      data: {
        ondcOrderId: ondcOrder.order_id,
        internalOrderId: matchResult.internalOrderId || null,
        discrepancyType,
        ondcAmount: new Decimal(ondcAmount),
        internalAmount: new Decimal(internalAmount),
        differenceAmount: new Decimal(difference),
        status: SettlementDiscrepancyStatus.OPEN,
        metadata: JSON.parse(JSON.stringify({ ondcOrder, severity })),
      },
    });

    return {
      order_id: ondcOrder.order_id,
      type: discrepancyType,
      ondc_amount: ondcAmount.toString(),
      internal_amount: internalAmount.toString(),
      difference: difference.toString(),
      reason,
      severity,
    };
  }

  /**
   * Create reconciliation record in database
   */
  private async createReconciliationRecord(
    reconId: string,
    ondcOrder: ReconOrderItem,
    matchResult: MatchedOrder,
    periodStart: Date,
    periodEnd: Date,
    networkParticipantId: string,
  ): Promise<void> {
    await this.prisma.reconciliationRecord.create({
      data: {
        reconciliationId: `${reconId}-${ondcOrder.order_id}`,
        ondcTransactionId: ondcOrder.transaction_id,
        ondcOrderId: ondcOrder.order_id,
        networkParticipantId,
        periodStart,
        periodEnd,
        ondcAmount: new Decimal(ondcOrder.order_value),
        ondcTaxAmount: ondcOrder.tax ? new Decimal(ondcOrder.tax) : null,
        ondcCommission: ondcOrder.platform_fee
          ? new Decimal(ondcOrder.platform_fee)
          : null,
        ondcNetAmount: new Decimal(ondcOrder.total_amount),
        internalOrderId: matchResult.internalOrderId || null,
        internalAmount: matchResult.internalAmount
          ? new Decimal(matchResult.internalAmount)
          : null,
        status:
          matchResult.matchStatus === 'MATCHED'
            ? ReconciliationStatus.RECONCILED
            : ReconciliationStatus.PENDING,
        matchStatus:
          matchResult.matchStatus === 'MATCHED'
            ? ReconciliationMatchStatus.MATCHED
            : ReconciliationMatchStatus.AMOUNT_MISMATCH,
        discrepancyAmount:
          matchResult.matchStatus !== 'MATCHED'
            ? new Decimal(matchResult.ondcAmount - matchResult.internalAmount)
            : null,
        discrepancyReason:
          matchResult.matchStatus !== 'MATCHED'
            ? `Amount mismatch: ONDC=${matchResult.ondcAmount}, Internal=${matchResult.internalAmount}`
            : null,
        rawPayload: JSON.parse(JSON.stringify(ondcOrder)),
        reconciledAt: matchResult.matchStatus === 'MATCHED' ? new Date() : null,
      },
    });
  }

  /**
   * Get reconciliation records for a period
   */
  async getReconciliationRecords(
    networkParticipantId: string,
    periodStart: Date,
    periodEnd: Date,
  ) {
    return this.prisma.reconciliationRecord.findMany({
      where: {
        networkParticipantId,
        periodStart: {
          gte: periodStart,
        },
        periodEnd: {
          lte: periodEnd,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
