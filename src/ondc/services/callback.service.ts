import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '@prisma/client';
import { SignatureService } from './signature.service';
import { NetworkObservabilityService } from './network-observability.service';
import { getErrorMessage, getErrorCode } from '../types/ondc-error.interface';
import { getOndcBaseUrl } from '../../config/environment.config.js';
import {
  BecknContext,
  CallbackContext,
} from '../interfaces/beckn-context.interface';
import { AckResponse, BecknError } from '../interfaces/beckn-message.interface';
import {
  ACTION_TO_CALLBACK,
  BecknAction,
  BECKN_VERSION,
  ONDC_LOGISTICS_DOMAIN,
} from '../constants/beckn-actions';
import { OndcCallbackStatus, OndcTransactionStatus } from '@prisma/client';
import { ResilienceService } from '../../common/resilience/resilience.service.js';

/**
 * CallbackService handles sending on_* responses to BAPs
 * Implements retry logic and transaction tracking
 */
@Injectable()
export class CallbackService {
  private readonly logger = new Logger(CallbackService.name);
  private readonly bppId: string;
  private readonly bppUri: string;
  private readonly cityCode: string;
  private readonly countryCode: string;
  private readonly maxRetries = 3;
  private readonly retryDelayMs = 2000;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly signatureService: SignatureService,
    @Inject(forwardRef(() => NetworkObservabilityService))
    private readonly networkObservabilityService: NetworkObservabilityService,
    private readonly resilience: ResilienceService,
  ) {
    this.bppId =
      this.configService.get<string>('ondc.subscriberId') ||
      'quikboys.ondc.org';
    this.bppUri =
      this.configService.get<string>('ondc.subscriberUrl') ||
      getOndcBaseUrl();
    this.cityCode =
      this.configService.get<string>('ondc.cityCode') || 'std:040';
    this.countryCode = this.configService.get<string>('ondc.country') || 'IND';
  }

  /**
   * Send callback response to BAP
   */
  async sendCallback<T>(
    originalContext: BecknContext,
    message: T,
    error?: BecknError,
  ): Promise<boolean> {
    const callbackAction =
      ACTION_TO_CALLBACK[originalContext.action as BecknAction];
    if (!callbackAction) {
      this.logger.error(
        `Unknown action for callback: ${originalContext.action}`,
      );
      return false;
    }

    // Build callback context
    const callbackContext = this.buildCallbackContext(
      originalContext,
      callbackAction,
    );

    // Build callback payload
    const payload = {
      context: callbackContext,
      ...(error ? { error } : { message }),
    };

    // Get callback URL (normalize trailing slashes to prevent double-slash issues)
    const bapUri = originalContext.bap_uri.replace(/\/$/, '');
    const callbackUrl = `${bapUri}/${callbackAction}`;

    // Try to send callback with retries
    return this.sendWithRetry(
      callbackUrl,
      payload,
      originalContext.transaction_id,
      originalContext.message_id,
      callbackAction,
    );
  }

  /**
   * Build callback context from original request context
   */
  private buildCallbackContext(
    originalContext: BecknContext,
    callbackAction: string,
  ): CallbackContext {
    // Debug: Log incoming context
    this.logger.log(`[BUILD_CONTEXT] Original context received: ${JSON.stringify(originalContext)}`);
    this.logger.log(`[BUILD_CONTEXT] Original context type: ${typeof originalContext}`);
    this.logger.log(`[BUILD_CONTEXT] Original context is null: ${originalContext === null}`);
    this.logger.log(`[BUILD_CONTEXT] Original context is undefined: ${originalContext === undefined}`);
    this.logger.log(`[BUILD_CONTEXT] BPP ID from config: ${this.bppId}`);
    this.logger.log(`[BUILD_CONTEXT] BPP URI from config: ${this.bppUri}`);
    this.logger.log(`[BUILD_CONTEXT] BECKN_VERSION constant: ${BECKN_VERSION}`);
    this.logger.log(`[BUILD_CONTEXT] ONDC_LOGISTICS_DOMAIN constant: ${ONDC_LOGISTICS_DOMAIN}`);

    const callbackContext: CallbackContext = {
      domain: originalContext.domain || ONDC_LOGISTICS_DOMAIN,
      country: originalContext.country || this.countryCode,
      city: originalContext.city || this.cityCode,
      action: callbackAction,
      core_version: BECKN_VERSION,
      bap_id: originalContext.bap_id,
      bap_uri: originalContext.bap_uri,
      bpp_id: this.bppId,
      bpp_uri: this.bppUri,
      transaction_id: originalContext.transaction_id,
      message_id: originalContext.message_id,
      timestamp: new Date().toISOString(),
      ttl: originalContext.ttl || 'PT30S',
    };

    // Debug: Log built context
    this.logger.log(`[BUILD_CONTEXT] Built callback context: ${JSON.stringify(callbackContext)}`);

    return callbackContext;
  }

  /**
   * Send callback with retry logic
   */
  private async sendWithRetry(
    url: string,
    payload: unknown,
    transactionId: string,
    messageId: string,
    action: string,
    retryCount = 0,
  ): Promise<boolean> {
    try {
      // Create authorization header
      const authHeader =
        this.signatureService.createAuthorizationHeader(payload);

      // Enhanced logging for debugging ONDC callback delivery
      this.logger.log(`[CALLBACK] ========== SENDING ${action.toUpperCase()} ==========`);
      this.logger.log(`[CALLBACK] URL: ${url}`);
      this.logger.log(`[CALLBACK] Transaction ID: ${transactionId}`);
      this.logger.log(`[CALLBACK] Message ID: ${messageId}`);
      this.logger.log(`[CALLBACK] Retry Count: ${retryCount}`);

      // Log full payload for debugging Pramaan issues
      const payloadObj = payload as { context?: Record<string, unknown>; message?: unknown };
      this.logger.log(`[CALLBACK] Full context object: ${JSON.stringify(payloadObj.context, null, 2)}`);
      this.logger.log(`[CALLBACK] Context keys: ${payloadObj.context ? Object.keys(payloadObj.context).join(', ') : 'EMPTY'}`);
      this.logger.log(`[CALLBACK] context.domain: ${payloadObj.context?.domain}`);
      this.logger.log(`[CALLBACK] context.action: ${payloadObj.context?.action}`);
      this.logger.log(`[CALLBACK] context.core_version: ${payloadObj.context?.core_version}`);
      this.logger.log(`[CALLBACK] context.bap_id: ${payloadObj.context?.bap_id}`);
      this.logger.log(`[CALLBACK] context.bpp_id: ${payloadObj.context?.bpp_id}`);
      this.logger.log(`[CALLBACK] Has message: ${!!payloadObj.message}`);
      this.logger.log(`[CALLBACK] Full payload JSON: ${JSON.stringify(payload)}`);
      this.logger.log(`[CALLBACK] Auth header (first 80 chars): ${authHeader.substring(0, 80)}...`);

      this.logger.debug(`Sending ${action} callback to: ${url}`);

      // Capture callback initiated time for N.O.
      if (retryCount === 0) {
        await this.networkObservabilityService.captureCallbackInitiated(
          transactionId,
          messageId,
        );
      }

      // Track response time
      const startTime = Date.now();

      const breaker = this.resilience.getBreaker('ondc');
      const response = await breaker.execute(() =>
        firstValueFrom(
          this.httpService.post<AckResponse>(url, payload, {
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            timeout: 10000,
          }),
        ),
      );

      const responseTimeMs = Date.now() - startTime;

      // Log successful response
      this.logger.log(`[CALLBACK] Response received in ${responseTimeMs}ms`);
      this.logger.log(`[CALLBACK] Response status: ${response.status}`);
      this.logger.log(`[CALLBACK] Response data: ${JSON.stringify(response.data)}`);

      // Check for ACK response
      if (response.data?.message?.ack?.status === 'ACK') {
        await this.updateTransactionCallback(transactionId, messageId, {
          callbackSent: true,
          callbackSentAt: new Date(),
          callbackStatus: OndcCallbackStatus.ACKNOWLEDGED,
          responsePayload: payload as any,
          status: OndcTransactionStatus.COMPLETED,
        });

        // Record N.O. callback completion
        await this.networkObservabilityService.captureCallbackCompleted(
          transactionId,
          messageId,
          action,
          responseTimeMs,
          'success',
        );

        this.logger.log(
          `${action} callback acknowledged for: ${transactionId} (${responseTimeMs}ms)`,
        );
        return true;
      }

      // NACK received
      const errorMsg = response.data?.error?.message || 'NACK received';
      this.logger.warn(`[CALLBACK] NACK received for ${action}`);
      this.logger.warn(`[CALLBACK] NACK error: ${errorMsg}`);
      this.logger.warn(`[CALLBACK] Full NACK response: ${JSON.stringify(response.data)}`);
      this.logger.warn(
        `${action} callback NACK for ${transactionId}: ${errorMsg}`,
      );

      await this.updateTransactionCallback(transactionId, messageId, {
        callbackSent: true,
        callbackSentAt: new Date(),
        callbackStatus: OndcCallbackStatus.FAILED,
        callbackError: errorMsg,
        retryCount: retryCount,
      });

      // Record N.O. callback failure
      await this.networkObservabilityService.captureCallbackCompleted(
        transactionId,
        messageId,
        action,
        responseTimeMs,
        'failed',
      );

      return false;
    } catch (error: unknown) {
      const errorResponse = (error as { response?: { data?: unknown } })
        .response;
      const responseData = errorResponse?.data as
        | { message?: string }
        | undefined;
      const errorMsg = responseData?.message || getErrorMessage(error);
      this.logger.error(
        `${action} callback failed for ${transactionId}: ${errorMsg}`,
      );

      // Retry logic
      if (retryCount < this.maxRetries) {
        this.logger.log(
          `Retrying ${action} callback (${retryCount + 1}/${this.maxRetries})`,
        );

        await this.updateTransactionCallback(transactionId, messageId, {
          callbackStatus: OndcCallbackStatus.RETRYING,
          retryCount: retryCount + 1,
        });

        await this.delay(this.retryDelayMs * (retryCount + 1));
        return this.sendWithRetry(
          url,
          payload,
          transactionId,
          messageId,
          action,
          retryCount + 1,
        );
      }

      // Max retries exceeded
      await this.updateTransactionCallback(transactionId, messageId, {
        callbackSent: false,
        callbackStatus: OndcCallbackStatus.FAILED,
        callbackError: errorMsg,
        retryCount: retryCount,
        status: OndcTransactionStatus.FAILED,
      });

      return false;
    }
  }

  /**
   * Update transaction with callback status
   */
  private async updateTransactionCallback(
    transactionId: string,
    messageId: string,
    data: {
      callbackSent?: boolean;
      callbackSentAt?: Date;
      callbackStatus?: OndcCallbackStatus;
      callbackError?: string;
      responsePayload?: any;
      retryCount?: number;
      status?: OndcTransactionStatus;
    },
  ): Promise<void> {
    try {
      await this.prisma.ondcTransaction.updateMany({
        where: {
          transactionId,
          messageId,
        },
        data,
      });
    } catch (error: unknown) {
      this.logger.error(
        `Failed to update transaction callback: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Record incoming transaction
   */
  async recordTransaction(
    context: BecknContext,
    requestPayload: unknown,
    orderId?: string,
  ): Promise<void> {
    try {
      await this.prisma.ondcTransaction.create({
        data: {
          transactionId: context.transaction_id,
          messageId: context.message_id,
          action: context.action,
          bapId: context.bap_id,
          bapUri: context.bap_uri,
          bppId: context.bpp_id,
          bppUri: context.bpp_uri,
          domain: context.domain || ONDC_LOGISTICS_DOMAIN,
          city: context.city,
          country: context.country || 'IND',
          requestPayload: requestPayload as any,
          status: OndcTransactionStatus.RECEIVED,
          orderId,
        },
      });

      this.logger.debug(`Transaction recorded: ${context.transaction_id}`);
    } catch (error: unknown) {
      // Handle duplicate transaction (idempotency)
      const errorCode = getErrorCode(error);
      if (errorCode === 'P2002') {
        this.logger.warn(`Duplicate transaction: ${context.transaction_id}`);
      } else {
        this.logger.error(
          `Failed to record transaction: ${getErrorMessage(error)}`,
        );
      }
    }
  }

  /**
   * Update transaction status
   */
  async updateTransactionStatus(
    transactionId: string,
    status: OndcTransactionStatus,
    orderId?: string,
    errorCode?: string,
    errorMessage?: string,
  ): Promise<void> {
    try {
      await this.prisma.ondcTransaction.updateMany({
        where: { transactionId },
        data: {
          status,
          orderId,
          errorCode,
          errorMessage,
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        `Failed to update transaction status: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Get transaction by transaction ID
   */
  async getTransaction(transactionId: string) {
    return this.prisma.ondcTransaction.findUnique({
      where: { transactionId },
    });
  }

  /**
   * Get all transactions for an order
   */
  async getTransactionsByOrder(orderId: string) {
    return this.prisma.ondcTransaction.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Build ACK response
   */
  buildAckResponse(): AckResponse {
    return {
      message: {
        ack: {
          status: 'ACK',
        },
      },
    };
  }

  /**
   * Build NACK response
   */
  buildNackResponse(error: BecknError): AckResponse {
    return {
      message: {
        ack: {
          status: 'NACK',
        },
      },
      error,
    };
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
