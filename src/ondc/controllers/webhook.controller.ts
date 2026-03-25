import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BecknSignatureGuard } from '../guards/beckn-signature.guard';
import { PublicOndc } from '../decorators/public-ondc.decorator';
import { CallbackService } from '../services/callback.service';
import { hasValidContext } from '../interfaces/beckn-request.interface';
import type {
  SearchRequest,
  SelectRequest,
  InitRequest,
  ConfirmRequest,
  StatusRequest,
  TrackRequest,
  CancelRequest,
  UpdateRequest,
} from '../interfaces/beckn-request.interface';
import type {
  AckResponse,
  BecknError,
} from '../interfaces/beckn-message.interface';
import { buildOndcError, OndcErrorCode } from '../constants/error-codes';
import { BecknAction } from '../constants/beckn-actions';
import { isError } from '../../common/types/exception.types.js';
import {
  OnSubscribeRequestDto,
  OnSubscribeResponseDto,
} from '../dto/on-subscribe.dto';
import { SubscriptionService } from '../services/subscription.service';
import { NetworkObservabilityService } from '../services/network-observability.service';
import { Public } from '../../auth/decorators/public.decorator.js';

// Import processors
import { SearchProcessor } from '../processors/search.processor';
import { SelectProcessor } from '../processors/select.processor';
import { InitProcessor } from '../processors/init.processor';
import { ConfirmProcessor } from '../processors/confirm.processor';
import { StatusProcessor } from '../processors/status.processor';
import { TrackProcessor } from '../processors/track.processor';
import { CancelProcessor } from '../processors/cancel.processor';
import { UpdateProcessor } from '../processors/update.processor';

/**
 * WebhookController handles all incoming ONDC/Beckn protocol requests
 * Each endpoint receives a request, returns ACK, and processes asynchronously
 */
@Controller('ondc')
@UseGuards(BecknSignatureGuard)
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly callbackService: CallbackService,
    private readonly searchProcessor: SearchProcessor,
    private readonly selectProcessor: SelectProcessor,
    private readonly initProcessor: InitProcessor,
    private readonly confirmProcessor: ConfirmProcessor,
    private readonly statusProcessor: StatusProcessor,
    private readonly trackProcessor: TrackProcessor,
    private readonly cancelProcessor: CancelProcessor,
    private readonly updateProcessor: UpdateProcessor,
    private readonly subscriptionService: SubscriptionService,
    private readonly networkObservabilityService: NetworkObservabilityService,
    private readonly httpService: HttpService,
  ) {}

  /**
   * Health check endpoint (public - no signature verification)
   */
  @Post('health')
  @Public() // Bypass global JWT auth guard
  @PublicOndc() // Bypass ONDC signature verification
  @HttpCode(HttpStatus.OK)
  health(): { status: string; timestamp: string } {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Diagnostic test endpoint - Test outbound HTTP connectivity
   * Used to verify ECS task can reach external endpoints like Pramaan BAP
   */
  @Get('test-callback')
  @Public()
  @PublicOndc()
  @HttpCode(HttpStatus.OK)
  async testCallback(
    @Query('url') url: string,
  ): Promise<{
    success: boolean;
    url: string;
    responseStatus?: number;
    responseTime?: number;
    error?: string;
    timestamp: string;
  }> {
    this.logger.log(`[TEST-CALLBACK] Testing outbound connectivity to: ${url}`);

    if (!url) {
      return {
        success: false,
        url: '',
        error: 'URL query parameter is required',
        timestamp: new Date().toISOString(),
      };
    }

    const startTime = Date.now();

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          url,
          { test: true, timestamp: new Date().toISOString() },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
            validateStatus: () => true, // Accept any status code
          },
        ),
      );

      const responseTime = Date.now() - startTime;

      this.logger.log(
        `[TEST-CALLBACK] Response from ${url}: status=${response.status}, time=${responseTime}ms`,
      );

      return {
        success: true,
        url,
        responseStatus: response.status,
        responseTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `[TEST-CALLBACK] Failed to reach ${url}: ${errorMessage}`,
      );

      return {
        success: false,
        url,
        responseTime,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * On Subscribe endpoint - ONDC registry subscription verification
   * This is a public endpoint called by the ONDC registry during BPP subscription
   * No signature verification required as this is a registry callback
   *
   * Flow:
   * 1. Registry sends encrypted challenge
   * 2. We decrypt using our X25519 private key
   * 3. We return the decrypted answer
   * 4. Registry verifies and activates subscription
   */
  @Post('on_subscribe')
  @Public() // Bypass global JWT auth guard
  @PublicOndc() // Bypass ONDC signature verification
  @HttpCode(HttpStatus.OK)
  async onSubscribe(
    @Body() request: OnSubscribeRequestDto,
  ): Promise<OnSubscribeResponseDto> {
    this.logger.log(`Received on_subscribe for: ${request.subscriber_id}`);
    return this.subscriptionService.handleOnSubscribe({
      subscriber_id: request.subscriber_id,
      challenge: request.challenge,
    });
  }

  /**
   * Search endpoint - Find logistics services
   * BAP sends search request with pickup/delivery locations
   * BPP responds with available services via on_search callback
   */
  @Post('search')
  @Public() // Bypass JWT auth - ONDC uses signature verification instead
  @HttpCode(HttpStatus.OK)
  async search(@Body() request: SearchRequest): Promise<AckResponse> {
    const requestReceivedAt = new Date();

    // Enhanced entry-point logging for Pramaan debugging
    this.logger.log(`[WEBHOOK_ENTRY] ========== SEARCH REQUEST RECEIVED ==========`);
    this.logger.log(`[WEBHOOK_ENTRY] Timestamp: ${requestReceivedAt.toISOString()}`);
    this.logger.log(`[WEBHOOK_ENTRY] Transaction ID: ${request.context?.transaction_id}`);
    this.logger.log(`[WEBHOOK_ENTRY] Message ID: ${request.context?.message_id}`);
    this.logger.log(`[WEBHOOK_ENTRY] BAP ID: ${request.context?.bap_id}`);
    this.logger.log(`[WEBHOOK_ENTRY] BAP URI: ${request.context?.bap_uri}`);
    this.logger.log(`[WEBHOOK_ENTRY] Full context: ${JSON.stringify(request.context)}`);
    this.logger.log(`[WEBHOOK_ENTRY] Request has message: ${!!request.message}`);

    this.logger.log(
      `Received search request: ${request.context?.transaction_id}`,
    );

    // Validate request
    const validationError = this.validateRequest(request, BecknAction.SEARCH);
    if (validationError) {
      this.networkObservabilityService.recordWebhookError(BecknAction.SEARCH);
      return this.callbackService.buildNackResponse(validationError);
    }

    // Record transaction
    await this.callbackService.recordTransaction(request.context, request);

    // Capture N.O. timing
    await this.networkObservabilityService.captureRequestStart(
      request.context.transaction_id,
      request.context.message_id,
      requestReceivedAt,
    );

    // Process asynchronously
    this.searchProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`Search processing error: ${message}`);
    });

    // Capture response ready time
    await this.networkObservabilityService.captureResponseReady(
      request.context.transaction_id,
      request.context.message_id,
      BecknAction.SEARCH,
    );

    return this.callbackService.buildAckResponse();
  }

  /**
   * Select endpoint - Select a logistics service
   * BAP selects a specific service/item from search results
   * BPP responds with quote via on_select callback
   */
  @Post('select')
  @Public() // Bypass JWT auth - ONDC uses signature verification instead
  @HttpCode(HttpStatus.OK)
  async select(@Body() request: SelectRequest): Promise<AckResponse> {
    const requestReceivedAt = new Date();
    this.logger.log(
      `Received select request: ${request.context?.transaction_id}`,
    );

    const validationError = this.validateRequest(request, BecknAction.SELECT);
    if (validationError) {
      this.networkObservabilityService.recordWebhookError(BecknAction.SELECT);
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);
    await this.networkObservabilityService.captureRequestStart(
      request.context.transaction_id,
      request.context.message_id,
      requestReceivedAt,
    );

    this.selectProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`Select processing error: ${message}`);
    });

    await this.networkObservabilityService.captureResponseReady(
      request.context.transaction_id,
      request.context.message_id,
      BecknAction.SELECT,
    );
    return this.callbackService.buildAckResponse();
  }

  /**
   * Init endpoint - Initialize order
   * BAP provides billing and fulfillment details
   * BPP confirms order can be fulfilled via on_init callback
   */
  @Post('init')
  @Public() // Bypass JWT auth - ONDC uses signature verification instead
  @HttpCode(HttpStatus.OK)
  async init(@Body() request: InitRequest): Promise<AckResponse> {
    const requestReceivedAt = new Date();
    this.logger.log(
      `Received init request: ${request.context?.transaction_id}`,
    );

    const validationError = this.validateRequest(request, BecknAction.INIT);
    if (validationError) {
      this.networkObservabilityService.recordWebhookError(BecknAction.INIT);
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);
    await this.networkObservabilityService.captureRequestStart(
      request.context.transaction_id,
      request.context.message_id,
      requestReceivedAt,
    );

    this.initProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`Init processing error: ${message}`);
    });

    await this.networkObservabilityService.captureResponseReady(
      request.context.transaction_id,
      request.context.message_id,
      BecknAction.INIT,
    );
    return this.callbackService.buildAckResponse();
  }

  /**
   * Confirm endpoint - Confirm order
   * BAP confirms the order with payment details
   * BPP creates order and responds via on_confirm callback
   */
  @Post('confirm')
  @Public() // Bypass JWT auth - ONDC uses signature verification instead
  @HttpCode(HttpStatus.OK)
  async confirm(@Body() request: ConfirmRequest): Promise<AckResponse> {
    const requestReceivedAt = new Date();
    this.logger.log(
      `Received confirm request: ${request.context?.transaction_id}`,
    );

    const validationError = this.validateRequest(request, BecknAction.CONFIRM);
    if (validationError) {
      this.networkObservabilityService.recordWebhookError(BecknAction.CONFIRM);
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);
    await this.networkObservabilityService.captureRequestStart(
      request.context.transaction_id,
      request.context.message_id,
      requestReceivedAt,
    );

    this.confirmProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`Confirm processing error: ${message}`);
    });

    await this.networkObservabilityService.captureResponseReady(
      request.context.transaction_id,
      request.context.message_id,
      BecknAction.CONFIRM,
    );
    return this.callbackService.buildAckResponse();
  }

  /**
   * Status endpoint - Get order status
   * BAP requests current status of an order
   * BPP responds with order details via on_status callback
   */
  @Post('status')
  @Public() // Bypass JWT auth - ONDC uses signature verification instead
  @HttpCode(HttpStatus.OK)
  async status(@Body() request: StatusRequest): Promise<AckResponse> {
    const requestReceivedAt = new Date();
    this.logger.log(
      `Received status request: ${request.context?.transaction_id}`,
    );

    const validationError = this.validateRequest(request, BecknAction.STATUS);
    if (validationError) {
      this.networkObservabilityService.recordWebhookError(BecknAction.STATUS);
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);
    await this.networkObservabilityService.captureRequestStart(
      request.context.transaction_id,
      request.context.message_id,
      requestReceivedAt,
    );

    this.statusProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`Status processing error: ${message}`);
    });

    await this.networkObservabilityService.captureResponseReady(
      request.context.transaction_id,
      request.context.message_id,
      BecknAction.STATUS,
    );
    return this.callbackService.buildAckResponse();
  }

  /**
   * Track endpoint - Get real-time tracking
   * BAP requests tracking information for an order
   * BPP responds with tracking URL/details via on_track callback
   */
  @Post('track')
  @Public() // Bypass JWT auth - ONDC uses signature verification instead
  @HttpCode(HttpStatus.OK)
  async track(@Body() request: TrackRequest): Promise<AckResponse> {
    const requestReceivedAt = new Date();
    this.logger.log(
      `Received track request: ${request.context?.transaction_id}`,
    );

    const validationError = this.validateRequest(request, BecknAction.TRACK);
    if (validationError) {
      this.networkObservabilityService.recordWebhookError(BecknAction.TRACK);
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);
    await this.networkObservabilityService.captureRequestStart(
      request.context.transaction_id,
      request.context.message_id,
      requestReceivedAt,
    );

    this.trackProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`Track processing error: ${message}`);
    });

    await this.networkObservabilityService.captureResponseReady(
      request.context.transaction_id,
      request.context.message_id,
      BecknAction.TRACK,
    );
    return this.callbackService.buildAckResponse();
  }

  /**
   * Cancel endpoint - Cancel order
   * BAP requests to cancel an order
   * BPP processes cancellation and responds via on_cancel callback
   */
  @Post('cancel')
  @Public() // Bypass JWT auth - ONDC uses signature verification instead
  @HttpCode(HttpStatus.OK)
  async cancel(@Body() request: CancelRequest): Promise<AckResponse> {
    const requestReceivedAt = new Date();
    this.logger.log(
      `Received cancel request: ${request.context?.transaction_id}`,
    );

    const validationError = this.validateRequest(request, BecknAction.CANCEL);
    if (validationError) {
      this.networkObservabilityService.recordWebhookError(BecknAction.CANCEL);
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);
    await this.networkObservabilityService.captureRequestStart(
      request.context.transaction_id,
      request.context.message_id,
      requestReceivedAt,
    );

    this.cancelProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`Cancel processing error: ${message}`);
    });

    await this.networkObservabilityService.captureResponseReady(
      request.context.transaction_id,
      request.context.message_id,
      BecknAction.CANCEL,
    );
    return this.callbackService.buildAckResponse();
  }

  /**
   * Update endpoint - Update order
   * BAP requests to update an order (e.g., reschedule)
   * BPP processes update and responds via on_update callback
   */
  @Post('update')
  @Public() // Bypass JWT auth - ONDC uses signature verification instead
  @HttpCode(HttpStatus.OK)
  async update(@Body() request: UpdateRequest): Promise<AckResponse> {
    const requestReceivedAt = new Date();
    this.logger.log(
      `Received update request: ${request.context?.transaction_id}`,
    );

    const validationError = this.validateRequest(request, BecknAction.UPDATE);
    if (validationError) {
      this.networkObservabilityService.recordWebhookError(BecknAction.UPDATE);
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);
    await this.networkObservabilityService.captureRequestStart(
      request.context.transaction_id,
      request.context.message_id,
      requestReceivedAt,
    );

    this.updateProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`Update processing error: ${message}`);
    });

    await this.networkObservabilityService.captureResponseReady(
      request.context.transaction_id,
      request.context.message_id,
      BecknAction.UPDATE,
    );
    return this.callbackService.buildAckResponse();
  }

  /**
   * Export N.O. logs endpoint
   * Returns transaction logs for ONDC Network Observability compliance
   */
  @Get('logs/export')
  @Public() // Requires internal auth, not ONDC signature
  @PublicOndc()
  @HttpCode(HttpStatus.OK)
  async exportLogs(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('format') format: 'json' | 'csv' = 'json',
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(`Exporting N.O. logs from ${startDate} to ${endDate}`);

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      res.status(HttpStatus.BAD_REQUEST).json({
        error: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD)',
      });
      return;
    }

    const result = await this.networkObservabilityService.exportLogs(
      start,
      end,
      format,
    );

    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.send(result.data);
  }

  /**
   * Get N.O. summary statistics
   * Returns aggregated metrics for ONDC Network Observability
   */
  @Get('logs/summary')
  @Public()
  @PublicOndc()
  @HttpCode(HttpStatus.OK)
  async getLogsSummary(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
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
    this.logger.log(`Getting N.O. summary from ${startDate} to ${endDate}`);

    const start = new Date(startDate);
    const end = new Date(endDate);

    return this.networkObservabilityService.getSummaryStats(start, end);
  }

  /**
   * Validate incoming request
   */
  private validateRequest(
    request: unknown,
    expectedAction: BecknAction,
  ): BecknError | null {
    // Check context structure
    if (!hasValidContext(request)) {
      return buildOndcError(
        OndcErrorCode.INVALID_REQUEST_FORMAT,
        'Invalid request context',
      );
    }

    const req = request as { context: { action: string }; message: unknown };

    // Check action matches
    if (req.context.action !== (expectedAction as string)) {
      return buildOndcError(
        OndcErrorCode.INVALID_ACTION,
        `Expected action ${expectedAction}, got ${req.context.action}`,
      );
    }

    // Check message exists
    if (!req.message) {
      return buildOndcError(
        OndcErrorCode.INVALID_REQUEST_FORMAT,
        'Message body is required',
      );
    }

    return null;
  }
}
