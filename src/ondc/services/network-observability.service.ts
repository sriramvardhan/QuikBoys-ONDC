import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Counter, Histogram, register } from 'prom-client';

/**
 * Network Observability Service
 * Tracks response times, processing durations, and callback latencies
 * for ONDC N.O. compliance
 */
@Injectable()
export class NetworkObservabilityService {
  private readonly logger = new Logger(NetworkObservabilityService.name);

  // Prometheus metrics for ONDC
  private readonly ondcWebhookResponseTime: Histogram;
  private readonly ondcCallbackResponseTime: Histogram;
  private readonly ondcProcessingTime: Histogram;
  private readonly ondcTransactionCounter: Counter;

  constructor(private readonly prisma: PrismaService) {
    // ONDC Webhook response time histogram
    this.ondcWebhookResponseTime = new Histogram({
      name: 'ondc_webhook_response_time_seconds',
      help: 'ONDC webhook response time in seconds',
      labelNames: ['action', 'status'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [register],
    });

    // ONDC Callback response time histogram
    this.ondcCallbackResponseTime = new Histogram({
      name: 'ondc_callback_response_time_seconds',
      help: 'ONDC callback HTTP response time in seconds',
      labelNames: ['action', 'callback_status'],
      buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [register],
    });

    // ONDC Processing time histogram
    this.ondcProcessingTime = new Histogram({
      name: 'ondc_processing_time_seconds',
      help: 'ONDC request processing time in seconds',
      labelNames: ['action'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      registers: [register],
    });

    // ONDC Transaction counter
    this.ondcTransactionCounter = new Counter({
      name: 'ondc_transactions_total',
      help: 'Total number of ONDC transactions',
      labelNames: ['action', 'status'],
      registers: [register],
    });
  }

  /**
   * Capture when a webhook request is received
   */
  async captureRequestStart(
    transactionId: string,
    messageId: string,
    requestReceivedAt: Date,
  ): Promise<void> {
    try {
      await this.prisma.ondcTransaction.updateMany({
        where: {
          transactionId,
          messageId,
        },
        data: {
          requestReceivedAt,
        },
      });
      this.logger.debug(
        `Captured request start for transaction: ${transactionId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to capture request start: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Capture when processing starts
   */
  async captureProcessingStart(
    transactionId: string,
    messageId: string,
  ): Promise<void> {
    try {
      await this.prisma.ondcTransaction.updateMany({
        where: {
          transactionId,
          messageId,
        },
        data: {
          processingStartedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to capture processing start: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Capture when ACK response is ready to be sent
   */
  async captureResponseReady(
    transactionId: string,
    messageId: string,
    action: string,
  ): Promise<void> {
    try {
      const now = new Date();
      const transaction = await this.prisma.ondcTransaction.findFirst({
        where: { transactionId, messageId },
        select: { requestReceivedAt: true, processingStartedAt: true },
      });

      let totalResponseTimeMs: number | null = null;
      let processingTimeMs: number | null = null;

      if (transaction?.requestReceivedAt) {
        totalResponseTimeMs = now.getTime() - transaction.requestReceivedAt.getTime();
        // Record Prometheus metric
        this.ondcWebhookResponseTime.observe(
          { action, status: 'success' },
          totalResponseTimeMs / 1000,
        );
      }

      if (transaction?.processingStartedAt) {
        processingTimeMs = now.getTime() - transaction.processingStartedAt.getTime();
        this.ondcProcessingTime.observe({ action }, processingTimeMs / 1000);
      }

      await this.prisma.ondcTransaction.updateMany({
        where: { transactionId, messageId },
        data: {
          responseReadyAt: now,
          totalResponseTimeMs,
          processingTimeMs,
        },
      });

      this.logger.debug(
        `Response ready for ${action}: totalTime=${totalResponseTimeMs}ms, processingTime=${processingTimeMs}ms`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to capture response ready: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Capture when callback is initiated
   */
  async captureCallbackInitiated(
    transactionId: string,
    messageId: string,
  ): Promise<void> {
    try {
      await this.prisma.ondcTransaction.updateMany({
        where: { transactionId, messageId },
        data: {
          callbackInitiatedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to capture callback initiated: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Capture when callback completes with response time
   */
  async captureCallbackCompleted(
    transactionId: string,
    messageId: string,
    action: string,
    responseTimeMs: number,
    callbackStatus: 'success' | 'failed',
  ): Promise<void> {
    try {
      await this.prisma.ondcTransaction.updateMany({
        where: { transactionId, messageId },
        data: {
          callbackCompletedAt: new Date(),
          callbackResponseTimeMs: responseTimeMs,
        },
      });

      // Record Prometheus metrics
      this.ondcCallbackResponseTime.observe(
        { action, callback_status: callbackStatus },
        responseTimeMs / 1000,
      );

      this.ondcTransactionCounter.inc({ action, status: callbackStatus });

      this.logger.debug(
        `Callback completed for ${action}: responseTime=${responseTimeMs}ms, status=${callbackStatus}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to capture callback completed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Record a failed webhook response
   */
  recordWebhookError(action: string): void {
    this.ondcWebhookResponseTime.observe({ action, status: 'error' }, 0);
    this.ondcTransactionCounter.inc({ action, status: 'error' });
  }

  /**
   * Export logs for N.O. compliance
   * Returns transaction logs with all timing data
   */
  async exportLogs(
    startDate: Date,
    endDate: Date,
    format: 'json' | 'csv' = 'json',
  ): Promise<{ data: unknown; contentType: string; filename: string }> {
    const transactions = await this.prisma.ondcTransaction.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        transactionId: true,
        messageId: true,
        action: true,
        bapId: true,
        bppId: true,
        domain: true,
        city: true,
        status: true,
        callbackStatus: true,
        requestReceivedAt: true,
        processingStartedAt: true,
        responseReadyAt: true,
        callbackInitiatedAt: true,
        callbackCompletedAt: true,
        totalResponseTimeMs: true,
        processingTimeMs: true,
        callbackResponseTimeMs: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const filename = `ondc_logs_${startDate.toISOString().split('T')[0]}_${endDate.toISOString().split('T')[0]}`;

    if (format === 'csv') {
      const csvData = this.convertToCSV(transactions);
      return {
        data: csvData,
        contentType: 'text/csv',
        filename: `${filename}.csv`,
      };
    }

    // JSON format (default)
    const jsonData = transactions.map((t) => ({
      transaction_id: t.transactionId,
      message_id: t.messageId,
      action: t.action,
      bap_id: t.bapId,
      bpp_id: t.bppId,
      domain: t.domain,
      city: t.city,
      status: t.status,
      callback_status: t.callbackStatus,
      request_received_at: t.requestReceivedAt?.toISOString(),
      processing_started_at: t.processingStartedAt?.toISOString(),
      response_ready_at: t.responseReadyAt?.toISOString(),
      callback_initiated_at: t.callbackInitiatedAt?.toISOString(),
      callback_completed_at: t.callbackCompletedAt?.toISOString(),
      total_response_time_ms: t.totalResponseTimeMs,
      processing_time_ms: t.processingTimeMs,
      callback_response_time_ms: t.callbackResponseTimeMs,
      timestamp: t.createdAt.toISOString(),
    }));

    return {
      data: jsonData,
      contentType: 'application/json',
      filename: `${filename}.json`,
    };
  }

  /**
   * Get N.O. summary statistics
   */
  async getSummaryStats(
    startDate: Date,
    endDate: Date,
  ): Promise<{
    totalTransactions: number;
    successfulTransactions: number;
    failedTransactions: number;
    avgResponseTimeMs: number;
    avgProcessingTimeMs: number;
    avgCallbackTimeMs: number;
    p95ResponseTimeMs: number;
    transactionsByAction: Record<string, number>;
  }> {
    const transactions = await this.prisma.ondcTransaction.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
      },
      select: {
        action: true,
        status: true,
        totalResponseTimeMs: true,
        processingTimeMs: true,
        callbackResponseTimeMs: true,
      },
    });

    const total = transactions.length;
    const successful = transactions.filter((t) => t.status === 'COMPLETED').length;
    const failed = transactions.filter((t) => t.status === 'FAILED').length;

    // Calculate averages
    const responseTimes = transactions
      .map((t) => t.totalResponseTimeMs)
      .filter((t): t is number => t !== null);
    const processingTimes = transactions
      .map((t) => t.processingTimeMs)
      .filter((t): t is number => t !== null);
    const callbackTimes = transactions
      .map((t) => t.callbackResponseTimeMs)
      .filter((t): t is number => t !== null);

    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    // Calculate P95
    const p95 = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const index = Math.ceil(0.95 * sorted.length) - 1;
      return sorted[index] || 0;
    };

    // Count by action
    const transactionsByAction = transactions.reduce(
      (acc, t) => {
        acc[t.action] = (acc[t.action] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      totalTransactions: total,
      successfulTransactions: successful,
      failedTransactions: failed,
      avgResponseTimeMs: Math.round(avg(responseTimes)),
      avgProcessingTimeMs: Math.round(avg(processingTimes)),
      avgCallbackTimeMs: Math.round(avg(callbackTimes)),
      p95ResponseTimeMs: Math.round(p95(responseTimes)),
      transactionsByAction,
    };
  }

  /**
   * Convert transactions to CSV format
   */
  private convertToCSV(
    transactions: Array<{
      transactionId: string;
      messageId: string;
      action: string;
      bapId: string;
      bppId: string | null;
      domain: string;
      city: string;
      status: string;
      callbackStatus: string;
      requestReceivedAt: Date | null;
      processingStartedAt: Date | null;
      responseReadyAt: Date | null;
      callbackInitiatedAt: Date | null;
      callbackCompletedAt: Date | null;
      totalResponseTimeMs: number | null;
      processingTimeMs: number | null;
      callbackResponseTimeMs: number | null;
      createdAt: Date;
      updatedAt: Date;
    }>,
  ): string {
    const headers = [
      'transaction_id',
      'message_id',
      'action',
      'bap_id',
      'bpp_id',
      'domain',
      'city',
      'status',
      'callback_status',
      'request_received_at',
      'processing_started_at',
      'response_ready_at',
      'callback_initiated_at',
      'callback_completed_at',
      'total_response_time_ms',
      'processing_time_ms',
      'callback_response_time_ms',
      'timestamp',
    ];

    const rows = transactions.map((t) =>
      [
        t.transactionId,
        t.messageId,
        t.action,
        t.bapId,
        t.bppId || '',
        t.domain,
        t.city,
        t.status,
        t.callbackStatus,
        t.requestReceivedAt?.toISOString() || '',
        t.processingStartedAt?.toISOString() || '',
        t.responseReadyAt?.toISOString() || '',
        t.callbackInitiatedAt?.toISOString() || '',
        t.callbackCompletedAt?.toISOString() || '',
        t.totalResponseTimeMs?.toString() || '',
        t.processingTimeMs?.toString() || '',
        t.callbackResponseTimeMs?.toString() || '',
        t.createdAt.toISOString(),
      ].join(','),
    );

    return [headers.join(','), ...rows].join('\n');
  }
}
