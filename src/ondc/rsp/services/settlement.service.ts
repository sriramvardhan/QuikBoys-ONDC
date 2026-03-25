import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  SettlementBatchStatus,
  ReconciliationMatchStatus,
  ReconciliationStatus,
  WalletTransactionType,
  TransactionCategory,
  WalletTransactionStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { DiscrepancyDetail } from '../dto/receiver-recon.dto';
import {
  CashfreePayoutService,
  PayoutBeneficiary,
  InitiatePayoutParams,
  PayoutMode,
} from './cashfree-payout.service';
import {
  BatchPayoutResultDto,
  SettlementPayoutResponseDto,
  PayoutStatus,
} from '../dto/payout.dto';

/**
 * SettlementService - Manages settlement batches and automatic processing
 * Handles creating batches from reconciled records and processing payouts
 * Now integrated with Cashfree Payout for NEFT/RTGS/IMPS/UPI transfers
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashfreePayoutService: CashfreePayoutService,
  ) {}

  /**
   * Create settlement batch from reconciled records
   * Automatically groups matched transactions for payout
   */
  async createSettlementBatch(
    networkParticipantId: string,
    periodStart: Date,
    periodEnd: Date,
  ) {
    this.logger.log(
      `Creating settlement batch for ${networkParticipantId} from ${periodStart.toISOString()} to ${periodEnd.toISOString()}`,
    );

    // Find all reconciled (matched) records for this period
    const reconciledRecords = await this.prisma.reconciliationRecord.findMany({
      where: {
        networkParticipantId,
        periodStart: {
          gte: periodStart,
        },
        periodEnd: {
          lte: periodEnd,
        },
        matchStatus: ReconciliationMatchStatus.MATCHED,
        status: ReconciliationStatus.RECONCILED,
        settlementBatchId: null, // Not yet assigned to a batch
      },
    });

    if (reconciledRecords.length === 0) {
      this.logger.warn(
        `No reconciled records found for settlement batch creation`,
      );
      return null;
    }

    // Calculate settlement amounts
    const { totalAmount, totalTransactions } =
      this.calculateSettlementAmounts(reconciledRecords);

    // Get discrepant records for held amount calculation
    const discrepantRecords = await this.prisma.reconciliationRecord.findMany({
      where: {
        networkParticipantId,
        periodStart: {
          gte: periodStart,
        },
        periodEnd: {
          lte: periodEnd,
        },
        matchStatus: {
          not: ReconciliationMatchStatus.MATCHED,
        },
      },
    });

    const discrepancyAmount = discrepantRecords.reduce(
      (sum, record) =>
        sum + (record.discrepancyAmount ? Number(record.discrepancyAmount) : 0),
      0,
    );

    // Generate batch ID
    const batchId = `SETTLE-${networkParticipantId}-${Date.now()}`;

    // Create settlement batch
    const batch = await this.prisma.settlementBatch.create({
      data: {
        batchId,
        networkParticipantId,
        periodStart,
        periodEnd,
        totalAmount: new Decimal(totalAmount),
        totalTransactions,
        reconciledAmount: new Decimal(totalAmount),
        discrepancyAmount: new Decimal(discrepancyAmount),
        status: SettlementBatchStatus.PENDING,
        metadata: {
          createdBy: 'ReconciliationService',
          automaticSettlement: true,
        },
      },
    });

    // Link reconciliation records to this batch
    await this.prisma.reconciliationRecord.updateMany({
      where: {
        id: {
          in: reconciledRecords.map((r) => r.id),
        },
      },
      data: {
        settlementBatchId: batch.id,
      },
    });

    this.logger.log(
      `Settlement batch created: ${batchId}, Amount: ₹${totalAmount}, Transactions: ${totalTransactions}`,
    );

    return batch;
  }

  /**
   * Calculate settlement amounts from reconciliation records
   */
  private calculateSettlementAmounts(records: unknown[]): {
    totalAmount: number;
    totalTransactions: number;
  } {
    let totalAmount = 0;

    for (const record of records) {
      const rec = record as Record<string, unknown>;
      // Use internal amount if available, otherwise ONDC amount
      const amount = rec.internalAmount
        ? Number(rec.internalAmount)
        : Number(rec.ondcNetAmount);
      totalAmount += amount;
    }

    return {
      totalAmount,
      totalTransactions: records.length,
    };
  }

  /**
   * Process automatic settlement for matched transactions
   * For partial settlement strategy - settle matched, hold discrepant
   * Initiates payouts via Cashfree Payment Gateway
   */
  async processAutomaticSettlement(
    batchId: string,
    preferredMode: PayoutMode = 'imps' as PayoutMode,
  ): Promise<SettlementPayoutResponseDto> {
    this.logger.log(`Processing automatic settlement for batch: ${batchId}`);

    const batch = await this.prisma.settlementBatch.findUnique({
      where: { id: batchId },
      include: {
        reconciliationRecords: true,
      },
    });

    if (!batch) {
      this.logger.error(`Settlement batch not found: ${batchId}`);
      return {
        settlementBatchId: batchId,
        success: false,
        totalAmount: 0,
        beneficiaryCount: 0,
        results: [],
        errorMessage: 'Settlement batch not found',
      };
    }

    if (batch.status !== SettlementBatchStatus.PENDING) {
      this.logger.warn(
        `Settlement batch ${batchId} is not in PENDING status: ${batch.status}`,
      );
      return {
        settlementBatchId: batchId,
        success: false,
        totalAmount: Number(batch.totalAmount),
        beneficiaryCount: 0,
        results: [],
        errorMessage: `Batch is not in PENDING status: ${batch.status}`,
      };
    }

    try {
      // Update batch status to PROCESSING
      await this.prisma.settlementBatch.update({
        where: { id: batchId },
        data: {
          status: SettlementBatchStatus.PROCESSING,
        },
      });

      // Group reconciliation records by driver for batch payouts
      const driverPayouts = await this.groupPayoutsByDriver(
        batch.reconciliationRecords,
      );

      if (driverPayouts.length === 0) {
        this.logger.warn(`No valid payouts found for batch: ${batchId}`);
        await this.prisma.settlementBatch.update({
          where: { id: batchId },
          data: {
            status: SettlementBatchStatus.COMPLETED,
            processedAt: new Date(),
            metadata: {
              ...(batch.metadata as object),
              noPayoutsReason: 'No valid driver payouts found',
            },
          },
        });
        return {
          settlementBatchId: batchId,
          success: true,
          totalAmount: 0,
          beneficiaryCount: 0,
          results: [],
        };
      }

      // Initiate batch payouts via Cashfree
      const payoutResults = await this.initiateDriverPayouts(
        batch.batchId,
        driverPayouts,
        preferredMode,
      );

      // Calculate success metrics
      const successCount = payoutResults.filter((r) => r.success).length;
      const failedCount = payoutResults.filter((r) => !r.success).length;
      const totalAmount = driverPayouts.reduce((sum, p) => sum + p.amount, 0);

      // Determine final batch status
      const finalStatus =
        successCount === driverPayouts.length
          ? SettlementBatchStatus.COMPLETED
          : successCount > 0
            ? SettlementBatchStatus.PARTIAL
            : SettlementBatchStatus.FAILED;

      // Update batch with results
      await this.prisma.settlementBatch.update({
        where: { id: batchId },
        data: {
          status: finalStatus,
          processedAt: new Date(),
          metadata: {
            ...(batch.metadata as object),
            payoutResults: {
              totalPayouts: driverPayouts.length,
              successCount,
              failedCount,
              totalAmount,
              processedAt: new Date().toISOString(),
            },
          },
        },
      });

      // Create wallet transactions for successful payouts
      await this.createWalletTransactionsForPayouts(
        payoutResults,
        driverPayouts,
      );

      this.logger.log(
        `Settlement batch ${batchId} processed: ${successCount}/${driverPayouts.length} payouts successful, ₹${totalAmount}`,
      );

      return {
        settlementBatchId: batchId,
        success: successCount > 0,
        totalAmount,
        beneficiaryCount: driverPayouts.length,
        batchPayoutId: batch.batchId,
        results: payoutResults,
      };
    } catch (error) {
      this.logger.error(
        `Error processing settlement batch ${batchId}: ${error.message}`,
      );

      // Update batch status to FAILED
      await this.prisma.settlementBatch.update({
        where: { id: batchId },
        data: {
          status: SettlementBatchStatus.FAILED,
          metadata: {
            ...(batch.metadata as object),
            error: error.message,
            failedAt: new Date().toISOString(),
          },
        },
      });

      return {
        settlementBatchId: batchId,
        success: false,
        totalAmount: Number(batch.totalAmount),
        beneficiaryCount: 0,
        results: [],
        errorMessage: error.message,
      };
    }
  }

  /**
   * Group reconciliation records by driver and calculate total payouts
   */
  private async groupPayoutsByDriver(records: unknown[]): Promise<
    Array<{
      driverId: string;
      amount: number;
      orderIds: string[];
    }>
  > {
    // Group by driver/network participant
    const driverAmounts = new Map<
      string,
      { amount: number; orderIds: string[] }
    >();

    for (const record of records) {
      const rec = record as Record<string, unknown>;
      // In ONDC context, networkParticipantId could map to driver
      // For internal orders, we'd use the driver from the order
      const driverId = rec.networkParticipantId as string;
      const amount = rec.internalAmount
        ? Number(rec.internalAmount)
        : Number(rec.ondcNetAmount);

      const existing = driverAmounts.get(driverId);
      if (existing) {
        existing.amount += amount;
        existing.orderIds.push(rec.ondcOrderId as string);
      } else {
        driverAmounts.set(driverId, {
          amount,
          orderIds: [rec.ondcOrderId as string],
        });
      }
    }

    return Array.from(driverAmounts.entries()).map(([driverId, data]) => ({
      driverId,
      amount: data.amount,
      orderIds: data.orderIds,
    }));
  }

  /**
   * Initiate payouts to drivers via Cashfree
   */
  private async initiateDriverPayouts(
    batchId: string,
    driverPayouts: Array<{
      driverId: string;
      amount: number;
      orderIds: string[];
    }>,
    preferredMode: PayoutMode,
  ): Promise<BatchPayoutResultDto[]> {
    const results: BatchPayoutResultDto[] = [];

    for (const payout of driverPayouts) {
      try {
        // Get driver's bank/UPI details
        const beneficiary = await this.getDriverBeneficiary(payout.driverId);

        if (!beneficiary) {
          this.logger.warn(
            `No payment details found for driver: ${payout.driverId}`,
          );
          results.push({
            transferId: `${batchId}-${payout.driverId}`,
            success: false,
            status: PayoutStatus.FAILED,
            errorMessage: 'No bank/UPI details found for driver',
          });
          continue;
        }

        // Determine transfer mode based on amount and beneficiary details
        const transferMode = this.determineTransferMode(
          payout.amount,
          beneficiary,
          preferredMode,
        );

        // Create payout params
        const payoutParams: InitiatePayoutParams = {
          transferId: `${batchId}-${payout.driverId}-${Date.now()}`,
          amount: payout.amount,
          beneficiary,
          transferMode,
          remarks: `ONDC Settlement - ${payout.orderIds.length} orders`,
        };

        // Initiate payout via Cashfree
        const payoutResult =
          await this.cashfreePayoutService.initiatePayout(payoutParams);

        results.push({
          transferId: payoutParams.transferId,
          success: payoutResult.success,
          referenceId: payoutResult.referenceId,
          status: payoutResult.status as PayoutStatus,
          errorMessage: payoutResult.success ? undefined : payoutResult.message,
        });

        // Small delay between payouts to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Error initiating payout for driver ${payout.driverId}: ${errorMessage}`,
        );
        results.push({
          transferId: `${batchId}-${payout.driverId}`,
          success: false,
          status: PayoutStatus.FAILED,
          errorMessage,
        });
      }
    }

    return results;
  }

  /**
   * Get driver's payment beneficiary details
   */
  private async getDriverBeneficiary(
    driverId: string,
  ): Promise<PayoutBeneficiary | null> {
    // First check if driverId is actually a network participant ID (ONDC)
    // In that case, we need to look up the driver from orders
    const driver = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: driverId }, { phone: driverId }],
      },
    });

    if (!driver) {
      return null;
    }

    const beneficiary: PayoutBeneficiary = {
      beneficiaryId: `DRV-${driver.id}`,
      name: driver.name || `${driver.firstName} ${driver.lastName}`.trim(),
      phone: driver.phone.replace('+91', ''),
      email: driver.email || undefined,
    };

    // Add bank details if available
    if (driver.bankDetails) {
      beneficiary.bankAccount = (driver.bankDetails as any).accountNumber;
      beneficiary.ifsc = (driver.bankDetails as any).ifscCode;
    }

    // Note: UPI VPA would need to be added to the schema
    // For now, drivers with bank accounts will use bank transfer

    return beneficiary;
  }

  /**
   * Determine the best transfer mode based on amount and beneficiary details
   */
  private determineTransferMode(
    amount: number,
    beneficiary: PayoutBeneficiary,
    preferredMode: PayoutMode,
  ): PayoutMode {
    // If beneficiary has UPI and amount is small, prefer UPI
    if (beneficiary.vpa && amount <= 100000) {
      return 'upi' as PayoutMode;
    }

    // If no bank account, must use UPI
    if (!beneficiary.bankAccount && beneficiary.vpa) {
      return 'upi' as PayoutMode;
    }

    // For large amounts (>2L), use RTGS
    if (amount >= 200000) {
      return 'rtgs' as PayoutMode;
    }

    // For medium amounts, use NEFT or IMPS based on preference
    if (
      preferredMode === ('neft' as PayoutMode) ||
      preferredMode === ('imps' as PayoutMode)
    ) {
      return preferredMode;
    }

    // Default to IMPS for instant transfer
    return 'imps' as PayoutMode;
  }

  /**
   * Create wallet transactions for successful payouts
   */
  private async createWalletTransactionsForPayouts(
    results: BatchPayoutResultDto[],
    driverPayouts: Array<{
      driverId: string;
      amount: number;
      orderIds: string[];
    }>,
  ): Promise<void> {
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const payout = driverPayouts[i];

      if (result.success) {
        try {
          // Update driver wallet - reduce pending balance, add to withdrawn
          await this.prisma.driverWallet.updateMany({
            where: { driverId: payout.driverId },
            data: {
              pendingBalance: {
                decrement: new Decimal(payout.amount),
              },
              totalWithdrawn: {
                increment: new Decimal(payout.amount),
              },
            },
          });

          // Get actual wallet for this driver
          const wallet = await this.prisma.driverWallet.findUnique({
            where: { driverId: payout.driverId },
          });

          if (wallet) {
            // Create wallet transaction record
            await this.prisma.walletTransaction.create({
              data: {
                walletId: wallet.id,
                type: WalletTransactionType.WITHDRAWAL,
                category: TransactionCategory.WITHDRAWALS,
                amount: new Decimal(payout.amount),
                balanceBefore: wallet.availableBalance,
                balanceAfter: new Decimal(
                  Number(wallet.availableBalance) - payout.amount,
                ),
                status: WalletTransactionStatus.COMPLETED,
                referenceId: result.transferId,
                externalRefId: result.referenceId,
                description: `ONDC Settlement Payout - ${payout.orderIds.length} orders`,
                metadata: {
                  payoutReferenceId: result.referenceId,
                  orderIds: payout.orderIds,
                  settlementType: 'ONDC_SETTLEMENT',
                },
              },
            });
          }
        } catch (error: unknown) {
          this.logger.error(
            `Error creating wallet transaction for driver ${payout.driverId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }
    }
  }

  /**
   * Hold discrepant amounts for review
   * Updates discrepancy records and marks them for manual review
   */
  async holdDiscrepantAmounts(
    discrepancies: DiscrepancyDetail[],
  ): Promise<void> {
    this.logger.log(
      `Holding ${discrepancies.length} discrepant amounts for review`,
    );

    for (const discrepancy of discrepancies) {
      // Discrepancy records are already created in ReconciliationService
      // Here we just log for tracking
      this.logger.debug(
        `Held amount for order ${discrepancy.order_id}: ₹${discrepancy.difference}`,
      );
    }

    // In a real implementation, this could:
    // 1. Create a notification for admin to review
    // 2. Update a dashboard with pending discrepancies
    // 3. Send alerts if discrepancy amount exceeds threshold
  }

  /**
   * Get settlement batches with filters
   */
  async getSettlementBatches(filters: {
    networkParticipantId?: string;
    status?: SettlementBatchStatus;
    periodStart?: Date;
    periodEnd?: Date;
  }) {
    return this.prisma.settlementBatch.findMany({
      where: {
        networkParticipantId: filters.networkParticipantId,
        status: filters.status,
        periodStart: filters.periodStart
          ? { gte: filters.periodStart }
          : undefined,
        periodEnd: filters.periodEnd ? { lte: filters.periodEnd } : undefined,
      },
      include: {
        reconciliationRecords: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Get settlement batch by ID
   */
  async getSettlementBatchById(batchId: string) {
    return this.prisma.settlementBatch.findUnique({
      where: { id: batchId },
      include: {
        reconciliationRecords: true,
      },
    });
  }

  /**
   * Get settlement summary for a period
   */
  async getSettlementSummary(
    networkParticipantId: string,
    periodStart: Date,
    periodEnd: Date,
  ) {
    const batches = await this.prisma.settlementBatch.findMany({
      where: {
        networkParticipantId,
        periodStart: { gte: periodStart },
        periodEnd: { lte: periodEnd },
      },
    });

    const summary = {
      totalBatches: batches.length,
      totalAmount: 0,
      reconciledAmount: 0,
      discrepancyAmount: 0,
      completedBatches: 0,
      pendingBatches: 0,
      failedBatches: 0,
    };

    for (const batch of batches) {
      summary.totalAmount += Number(batch.totalAmount);
      summary.reconciledAmount += Number(batch.reconciledAmount);
      summary.discrepancyAmount += Number(batch.discrepancyAmount);

      if (batch.status === SettlementBatchStatus.COMPLETED) {
        summary.completedBatches++;
      } else if (batch.status === SettlementBatchStatus.PENDING) {
        summary.pendingBatches++;
      } else if (batch.status === SettlementBatchStatus.FAILED) {
        summary.failedBatches++;
      }
    }

    return summary;
  }
}
