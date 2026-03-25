// ============================================
// Payout Reconciliation Service
// File: src/ondc/rsp/services/payout-reconciliation.service.ts
// ONDC RSF 2.0 - Annexure 2 Reconciliation File Generator
// Generates reconciliation files in ONDC-mandated format
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { SettlementBatchStatus } from '@prisma/client';
import * as ExcelJS from 'exceljs';

/**
 * ONDC RSF 2.0 Annexure 2 - Payout Reconciliation File Format
 * 23 mandatory fields as per ONDC specification
 */
export interface PayoutReconciliationRecord {
  // 1. Serial Number
  sr_no: number;
  // 2. Settlement ID (unique identifier)
  settlement_id: string;
  // 3. Transaction Reference Number
  txn_ref_no: string;
  // 4. Order ID (ONDC network order)
  order_id: string;
  // 5. Transaction ID
  transaction_id: string;
  // 6. Collector App ID (BAP)
  collector_app_id: string;
  // 7. Receiver App ID (BPP)
  receiver_app_id: string;
  // 8. Payer Name
  payer_name: string;
  // 9. Payer VPA/Account
  payer_account: string;
  // 10. Payee Name
  payee_name: string;
  // 11. Payee VPA/Account
  payee_account: string;
  // 12. Settlement Type (NEFT/RTGS/IMPS/UPI)
  settlement_type: string;
  // 13. Settlement Bank Reference
  settlement_bank_ref: string;
  // 14. Order Amount
  order_amount: string;
  // 15. Settlement Amount
  settlement_amount: string;
  // 16. Commission/TDR Amount
  commission_amount: string;
  // 17. Tax Amount (GST)
  tax_amount: string;
  // 18. Net Amount
  net_amount: string;
  // 19. Currency
  currency: string;
  // 20. Settlement Status
  settlement_status: string;
  // 21. Settlement Date
  settlement_date: string;
  // 22. UTR Number
  utr_number: string;
  // 23. Remarks
  remarks: string;
}

export interface ReconciliationFileResult {
  fileName: string;
  filePath?: string;
  fileBuffer?: Buffer;
  recordCount: number;
  totalAmount: number;
  generatedAt: Date;
}

/**
 * PayoutReconciliationService - ONDC RSF 2.0 Reconciliation File Generator
 *
 * Handles:
 * 1. Generation of Annexure 2 format reconciliation files
 * 2. Daily/periodic payout reconciliation reports
 * 3. Settlement status tracking for ONDC compliance
 */
@Injectable()
export class PayoutReconciliationService {
  private readonly logger = new Logger(PayoutReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate Payout Reconciliation File (Annexure 2 format)
   * Required for ONDC RSF 2.0 compliance
   */
  async generateReconciliationFile(
    periodStart: Date,
    periodEnd: Date,
    networkParticipantId?: string,
    format: 'xlsx' | 'csv' = 'xlsx',
  ): Promise<ReconciliationFileResult> {
    this.logger.log(
      `Generating reconciliation file for period ${periodStart.toISOString()} to ${periodEnd.toISOString()}`,
    );

    // Fetch settlement batches with records
    const batches = await this.prisma.settlementBatch.findMany({
      where: {
        periodStart: { gte: periodStart },
        periodEnd: { lte: periodEnd },
        networkParticipantId: networkParticipantId || undefined,
        status: {
          in: [SettlementBatchStatus.COMPLETED, SettlementBatchStatus.PARTIAL],
        },
      },
      include: {
        reconciliationRecords: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Build reconciliation records in Annexure 2 format
    const records: PayoutReconciliationRecord[] = [];
    let totalAmount = 0;
    let srNo = 1;

    for (const batch of batches) {
      const payoutResults = (batch.metadata as Record<string, unknown>)
        ?.payoutResults;

      for (const reconRecord of batch.reconciliationRecords) {
        const record = await this.buildReconciliationRecord(
          srNo++,
          batch,
          reconRecord,
          payoutResults,
        );
        records.push(record);
        totalAmount += parseFloat(record.net_amount);
      }
    }

    // Generate file
    const fileName = `ONDC_RECON_${periodStart.toISOString().split('T')[0]}_${periodEnd.toISOString().split('T')[0]}.${format}`;

    let fileBuffer: Buffer;
    if (format === 'xlsx') {
      fileBuffer = await this.generateExcelFile(records);
    } else {
      fileBuffer = this.generateCSVFile(records);
    }

    this.logger.log(
      `Reconciliation file generated: ${fileName}, ${records.length} records, ₹${totalAmount.toFixed(2)}`,
    );

    return {
      fileName,
      fileBuffer,
      recordCount: records.length,
      totalAmount,
      generatedAt: new Date(),
    };
  }

  /**
   * Build a single reconciliation record in Annexure 2 format
   */
  private async buildReconciliationRecord(
    srNo: number,
    batch: Record<string, unknown>,
    reconRecord: Record<string, unknown>,
    payoutResults: unknown,
  ): Promise<PayoutReconciliationRecord> {
    // Get driver details for payee information
    const driver = reconRecord.internalOrderId
      ? await this.prisma.order
          .findUnique({
            where: { id: reconRecord.internalOrderId as string },
            include: { driver: true },
          })
          .then((order) => order?.driver)
      : null;

    // Find matching payout result
    const payoutResultsObj = payoutResults as Record<string, unknown>;
    const payoutResult = (
      payoutResultsObj?.results as Array<Record<string, unknown>>
    )?.find((r) =>
      (r.transferId as string)?.includes(
        reconRecord.networkParticipantId as string,
      ),
    );

    // Calculate amounts
    const orderAmount = Number(reconRecord.ondcAmount || 0);
    const commission = Number(reconRecord.ondcCommission || 0);
    const tax = Number(reconRecord.ondcTaxAmount || 0);
    const netAmount = orderAmount - commission - tax;

    return {
      sr_no: srNo,
      settlement_id: batch.batchId as string,
      txn_ref_no:
        (payoutResult?.transferId as string) || `TXN-${reconRecord.id}`,
      order_id: reconRecord.ondcOrderId as string,
      transaction_id: (reconRecord.ondcTransactionId as string) || '',
      collector_app_id: reconRecord.networkParticipantId as string,
      receiver_app_id: process.env.ONDC_BPP_ID || 'quikboys.bpp.ondc',
      payer_name: 'ONDC Network',
      payer_account: 'ONDC Settlement Account',
      payee_name: driver?.name || (driver?.firstName as string) || 'Driver',
      payee_account: driver?.bankDetails
        ? `${(driver.bankDetails as any).accountNumber.slice(-4)}@${(driver.bankDetails as any).ifscCode}`
        : 'N/A',
      settlement_type: this.getSettlementType(payoutResult),
      settlement_bank_ref: (payoutResult?.referenceId as string) || '',
      order_amount: orderAmount.toFixed(2),
      settlement_amount: netAmount.toFixed(2),
      commission_amount: commission.toFixed(2),
      tax_amount: tax.toFixed(2),
      net_amount: netAmount.toFixed(2),
      currency: 'INR',
      settlement_status: this.mapSettlementStatus(
        batch.status as SettlementBatchStatus,
        payoutResult?.success as boolean,
      ),
      settlement_date:
        (batch.processedAt as Date)?.toISOString().split('T')[0] || '',
      utr_number: (payoutResult?.referenceId as string) || '',
      remarks: this.generateRemarks(reconRecord, payoutResult),
    };
  }

  /**
   * Generate Excel file in Annexure 2 format
   */
  private async generateExcelFile(
    records: PayoutReconciliationRecord[],
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'QuikBoys ONDC RSF';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Reconciliation', {
      headerFooter: {
        firstHeader: 'ONDC RSF 2.0 - Payout Reconciliation Report',
      },
    });

    // Define columns as per Annexure 2
    worksheet.columns = [
      { header: 'Sr. No.', key: 'sr_no', width: 8 },
      { header: 'Settlement ID', key: 'settlement_id', width: 25 },
      { header: 'Txn Ref No', key: 'txn_ref_no', width: 25 },
      { header: 'Order ID', key: 'order_id', width: 30 },
      { header: 'Transaction ID', key: 'transaction_id', width: 30 },
      { header: 'Collector App ID', key: 'collector_app_id', width: 25 },
      { header: 'Receiver App ID', key: 'receiver_app_id', width: 25 },
      { header: 'Payer Name', key: 'payer_name', width: 20 },
      { header: 'Payer Account', key: 'payer_account', width: 25 },
      { header: 'Payee Name', key: 'payee_name', width: 20 },
      { header: 'Payee Account', key: 'payee_account', width: 25 },
      { header: 'Settlement Type', key: 'settlement_type', width: 15 },
      { header: 'Settlement Bank Ref', key: 'settlement_bank_ref', width: 25 },
      { header: 'Order Amount', key: 'order_amount', width: 15 },
      { header: 'Settlement Amount', key: 'settlement_amount', width: 15 },
      { header: 'Commission', key: 'commission_amount', width: 12 },
      { header: 'Tax Amount', key: 'tax_amount', width: 12 },
      { header: 'Net Amount', key: 'net_amount', width: 15 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Status', key: 'settlement_status', width: 15 },
      { header: 'Settlement Date', key: 'settlement_date', width: 15 },
      { header: 'UTR Number', key: 'utr_number', width: 25 },
      { header: 'Remarks', key: 'remarks', width: 30 },
    ];

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add data rows
    for (const record of records) {
      worksheet.addRow(record);
    }

    // Add summary row
    const summaryRow = worksheet.addRow({
      sr_no: '',
      settlement_id: 'TOTAL',
      txn_ref_no: '',
      order_id: '',
      transaction_id: '',
      collector_app_id: '',
      receiver_app_id: '',
      payer_name: '',
      payer_account: '',
      payee_name: '',
      payee_account: '',
      settlement_type: '',
      settlement_bank_ref: '',
      order_amount: records
        .reduce((sum, r) => sum + parseFloat(r.order_amount), 0)
        .toFixed(2),
      settlement_amount: records
        .reduce((sum, r) => sum + parseFloat(r.settlement_amount), 0)
        .toFixed(2),
      commission_amount: records
        .reduce((sum, r) => sum + parseFloat(r.commission_amount), 0)
        .toFixed(2),
      tax_amount: records
        .reduce((sum, r) => sum + parseFloat(r.tax_amount), 0)
        .toFixed(2),
      net_amount: records
        .reduce((sum, r) => sum + parseFloat(r.net_amount), 0)
        .toFixed(2),
      currency: 'INR',
      settlement_status: '',
      settlement_date: '',
      utr_number: '',
      remarks: `Total Records: ${records.length}`,
    });
    summaryRow.font = { bold: true };

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Generate CSV file in Annexure 2 format
   */
  private generateCSVFile(records: PayoutReconciliationRecord[]): Buffer {
    const headers = [
      'Sr. No.',
      'Settlement ID',
      'Txn Ref No',
      'Order ID',
      'Transaction ID',
      'Collector App ID',
      'Receiver App ID',
      'Payer Name',
      'Payer Account',
      'Payee Name',
      'Payee Account',
      'Settlement Type',
      'Settlement Bank Ref',
      'Order Amount',
      'Settlement Amount',
      'Commission',
      'Tax Amount',
      'Net Amount',
      'Currency',
      'Status',
      'Settlement Date',
      'UTR Number',
      'Remarks',
    ];

    const rows = records.map((r) => [
      r.sr_no,
      r.settlement_id,
      r.txn_ref_no,
      r.order_id,
      r.transaction_id,
      r.collector_app_id,
      r.receiver_app_id,
      r.payer_name,
      r.payer_account,
      r.payee_name,
      r.payee_account,
      r.settlement_type,
      r.settlement_bank_ref,
      r.order_amount,
      r.settlement_amount,
      r.commission_amount,
      r.tax_amount,
      r.net_amount,
      r.currency,
      r.settlement_status,
      r.settlement_date,
      r.utr_number,
      `"${r.remarks.replace(/"/g, '""')}"`,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
    ].join('\n');

    return Buffer.from(csvContent, 'utf-8');
  }

  /**
   * Get settlement type from payout result
   */
  private getSettlementType(payoutResult: unknown): string {
    if (!payoutResult) return 'PENDING';

    const result = payoutResult as Record<string, unknown>;
    const transferId = result.transferId as string;

    // Determine from transfer mode or infer from reference
    if (transferId?.includes('UPI')) return 'UPI';
    if (transferId?.includes('RTGS')) return 'RTGS';
    if (transferId?.includes('NEFT')) return 'NEFT';

    return 'IMPS'; // Default to IMPS
  }

  /**
   * Map settlement status to ONDC format
   */
  private mapSettlementStatus(
    batchStatus: SettlementBatchStatus,
    payoutSuccess?: boolean,
  ): string {
    if (
      batchStatus === SettlementBatchStatus.COMPLETED &&
      payoutSuccess !== false
    ) {
      return 'SETTLED';
    }
    if (batchStatus === SettlementBatchStatus.PARTIAL) {
      return payoutSuccess ? 'SETTLED' : 'PENDING';
    }
    if (batchStatus === SettlementBatchStatus.FAILED) {
      return 'FAILED';
    }
    if (batchStatus === SettlementBatchStatus.PROCESSING) {
      return 'PROCESSING';
    }
    return 'PENDING';
  }

  /**
   * Generate remarks based on record status
   */
  private generateRemarks(
    reconRecord: Record<string, unknown>,
    payoutResult: unknown,
  ): string {
    const remarks: string[] = [];

    if (
      reconRecord.discrepancyAmount &&
      Number(reconRecord.discrepancyAmount) !== 0
    ) {
      remarks.push(`Discrepancy: ₹${reconRecord.discrepancyAmount}`);
    }

    if (reconRecord.discrepancyReason) {
      remarks.push(reconRecord.discrepancyReason as string);
    }

    const result = payoutResult as Record<string, unknown>;
    if (result?.errorMessage) {
      remarks.push(`Error: ${result.errorMessage}`);
    }

    return remarks.join('; ') || 'Settlement processed';
  }

  /**
   * Get reconciliation summary for dashboard
   */
  async getReconciliationSummary(
    periodStart: Date,
    periodEnd: Date,
    networkParticipantId?: string,
  ) {
    const batches = await this.prisma.settlementBatch.findMany({
      where: {
        periodStart: { gte: periodStart },
        periodEnd: { lte: periodEnd },
        networkParticipantId: networkParticipantId || undefined,
      },
      include: {
        _count: {
          select: { reconciliationRecords: true },
        },
      },
    });

    const summary = {
      totalBatches: batches.length,
      completedBatches: batches.filter(
        (b) => b.status === SettlementBatchStatus.COMPLETED,
      ).length,
      pendingBatches: batches.filter(
        (b) => b.status === SettlementBatchStatus.PENDING,
      ).length,
      failedBatches: batches.filter(
        (b) => b.status === SettlementBatchStatus.FAILED,
      ).length,
      totalRecords: batches.reduce(
        (sum, b) => sum + b._count.reconciliationRecords,
        0,
      ),
      totalAmount: batches.reduce((sum, b) => sum + Number(b.totalAmount), 0),
      reconciledAmount: batches.reduce(
        (sum, b) => sum + Number(b.reconciledAmount),
        0,
      ),
      discrepancyAmount: batches.reduce(
        (sum, b) => sum + Number(b.discrepancyAmount),
        0,
      ),
      periodStart,
      periodEnd,
    };

    return summary;
  }
}
