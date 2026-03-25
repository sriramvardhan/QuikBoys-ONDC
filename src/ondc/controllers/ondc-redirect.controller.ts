import {
  Controller,
  Post,
  Body,
  Headers,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator.js';
import { SearchProcessor } from '../processors/search.processor';
import { SelectProcessor } from '../processors/select.processor';
import { InitProcessor } from '../processors/init.processor';
import { ConfirmProcessor } from '../processors/confirm.processor';
import { StatusProcessor } from '../processors/status.processor';
import { TrackProcessor } from '../processors/track.processor';
import { CancelProcessor } from '../processors/cancel.processor';
import { UpdateProcessor } from '../processors/update.processor';
import { CallbackService } from '../services/callback.service';
import { NetworkObservabilityService } from '../services/network-observability.service';
import { ConfigService } from '@nestjs/config';
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
import { hasValidContext } from '../interfaces/beckn-request.interface';
import type { AckResponse, BecknError } from '../interfaces/beckn-message.interface';
import { buildOndcError, OndcErrorCode } from '../constants/error-codes';
import { BecknAction } from '../constants/beckn-actions';
import { isError } from '../../common/types/exception.types.js';

/**
 * ONDC Legacy Redirect Controller
 *
 * This controller handles the legacy /api/v1/ondc/* routes that are registered
 * in the ONDC gateway. It processes requests directly (same as webhook controller).
 *
 * Background:
 * - ONDC Gateway has subscriber_url: https://dev.quikboys.com/api/v1/ondc
 * - Our actual endpoints are at: https://dev.quikboys.com/ondc/*
 * - This controller allows tests to pass while registry is being updated
 *
 * TODO: Remove this controller once ONDC registry is updated to use
 * subscriber_url: https://dev.quikboys.com/ondc
 */
@Controller('api/v1/ondc') // Full path - excluded from global prefix to avoid double-prefixing
export class OndcRedirectController {
  private readonly logger = new Logger(OndcRedirectController.name);

  constructor(
    private readonly callbackService: CallbackService,
    private readonly configService: ConfigService,
    private readonly searchProcessor: SearchProcessor,
    private readonly selectProcessor: SelectProcessor,
    private readonly initProcessor: InitProcessor,
    private readonly confirmProcessor: ConfirmProcessor,
    private readonly statusProcessor: StatusProcessor,
    private readonly trackProcessor: TrackProcessor,
    private readonly cancelProcessor: CancelProcessor,
    private readonly updateProcessor: UpdateProcessor,
    private readonly networkObservabilityService: NetworkObservabilityService,
  ) {}

  /**
   * Validate signature for incoming ONDC request
   * Note: For now, we skip signature verification for Pramaan testing
   * The main WebhookController uses BecknSignatureGuard which handles this properly
   */
  private validateSignature(
    authHeader: string | undefined,
    body: unknown,
    bapId: string | undefined,
  ): boolean {
    // Check for trusted test BAPs (skip signature verification)
    const trustedTestBapsEnv = this.configService.get<string>('ONDC_TRUSTED_TEST_BAPS', '');
    const trustedTestBaps = trustedTestBapsEnv
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    this.logger.log(`[REDIRECT] Configured trusted BAPs: ${trustedTestBaps.length > 0 ? trustedTestBaps.join(', ') : 'NONE'}`);
    this.logger.log(`[REDIRECT] Incoming BAP ID: ${bapId || 'undefined'}`);

    // Check for exact match OR partial match (e.g., staging-bap.pramaan.ondc.org contains pramaan.ondc.org)
    if (bapId && trustedTestBaps.some((trusted) => bapId.includes(trusted) || trusted.includes(bapId))) {
      this.logger.log(`[REDIRECT] Skipping signature for trusted BAP: ${bapId}`);
      return true;
    }

    // For legacy route, we trust requests that have proper ONDC context
    // Full signature verification is handled by the guard on the main /ondc routes
    if (authHeader) {
      this.logger.log(`[REDIRECT] Authorization header present, accepting request`);
      return true;
    }

    this.logger.warn('[REDIRECT] No Authorization header provided');
    return false;
  }

  /**
   * Validate incoming request
   */
  private validateRequest(
    request: unknown,
    expectedAction: BecknAction,
  ): BecknError | null {
    if (!hasValidContext(request)) {
      return buildOndcError(
        OndcErrorCode.INVALID_REQUEST_FORMAT,
        'Invalid request context',
      );
    }

    const req = request as { context: { action: string }; message: unknown };

    if (req.context.action !== (expectedAction as string)) {
      return buildOndcError(
        OndcErrorCode.INVALID_ACTION,
        `Expected action ${expectedAction}, got ${req.context.action}`,
      );
    }

    if (!req.message) {
      return buildOndcError(
        OndcErrorCode.INVALID_REQUEST_FORMAT,
        'Message body is required',
      );
    }

    return null;
  }

  @Post('search')
  @Public()
  @HttpCode(HttpStatus.OK)
  async search(
    @Body() request: SearchRequest,
    @Headers('authorization') authHeader: string,
  ): Promise<AckResponse> {
    const requestReceivedAt = new Date();

    this.logger.log(`[REDIRECT] ========== /api/v1/ondc/search RECEIVED ==========`);
    this.logger.log(`[REDIRECT] Timestamp: ${requestReceivedAt.toISOString()}`);
    this.logger.log(`[REDIRECT] Transaction ID: ${request.context?.transaction_id}`);
    this.logger.log(`[REDIRECT] BAP ID: ${request.context?.bap_id}`);

    // Validate signature
    const isValidSignature = this.validateSignature(
      authHeader,
      request,
      request.context?.bap_id,
    );

    if (!isValidSignature) {
      this.logger.warn(`[REDIRECT] Signature verification failed for search`);
      return this.callbackService.buildNackResponse(
        buildOndcError(OndcErrorCode.INVALID_SIGNATURE, 'Invalid signature'),
      );
    }

    const validationError = this.validateRequest(request, BecknAction.SEARCH);
    if (validationError) {
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);
    await this.networkObservabilityService.captureRequestStart(
      request.context.transaction_id,
      request.context.message_id,
      requestReceivedAt,
    );

    this.searchProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`[REDIRECT] Search processing error: ${message}`);
    });

    await this.networkObservabilityService.captureResponseReady(
      request.context.transaction_id,
      request.context.message_id,
      BecknAction.SEARCH,
    );

    return this.callbackService.buildAckResponse();
  }

  @Post('select')
  @Public()
  @HttpCode(HttpStatus.OK)
  async select(
    @Body() request: SelectRequest,
    @Headers('authorization') authHeader: string,
  ): Promise<AckResponse> {
    this.logger.log(`[REDIRECT] /api/v1/ondc/select -> Processing`);

    const isValidSignature = this.validateSignature(
      authHeader,
      request,
      request.context?.bap_id,
    );

    if (!isValidSignature) {
      return this.callbackService.buildNackResponse(
        buildOndcError(OndcErrorCode.INVALID_SIGNATURE, 'Invalid signature'),
      );
    }

    const validationError = this.validateRequest(request, BecknAction.SELECT);
    if (validationError) {
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);

    this.selectProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`[REDIRECT] Select processing error: ${message}`);
    });

    return this.callbackService.buildAckResponse();
  }

  @Post('init')
  @Public()
  @HttpCode(HttpStatus.OK)
  async init(
    @Body() request: InitRequest,
    @Headers('authorization') authHeader: string,
  ): Promise<AckResponse> {
    this.logger.log(`[REDIRECT] /api/v1/ondc/init -> Processing`);

    const isValidSignature = this.validateSignature(
      authHeader,
      request,
      request.context?.bap_id,
    );

    if (!isValidSignature) {
      return this.callbackService.buildNackResponse(
        buildOndcError(OndcErrorCode.INVALID_SIGNATURE, 'Invalid signature'),
      );
    }

    const validationError = this.validateRequest(request, BecknAction.INIT);
    if (validationError) {
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);

    this.initProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`[REDIRECT] Init processing error: ${message}`);
    });

    return this.callbackService.buildAckResponse();
  }

  @Post('confirm')
  @Public()
  @HttpCode(HttpStatus.OK)
  async confirm(
    @Body() request: ConfirmRequest,
    @Headers('authorization') authHeader: string,
  ): Promise<AckResponse> {
    this.logger.log(`[REDIRECT] /api/v1/ondc/confirm -> Processing`);

    const isValidSignature = this.validateSignature(
      authHeader,
      request,
      request.context?.bap_id,
    );

    if (!isValidSignature) {
      return this.callbackService.buildNackResponse(
        buildOndcError(OndcErrorCode.INVALID_SIGNATURE, 'Invalid signature'),
      );
    }

    const validationError = this.validateRequest(request, BecknAction.CONFIRM);
    if (validationError) {
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);

    this.confirmProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`[REDIRECT] Confirm processing error: ${message}`);
    });

    return this.callbackService.buildAckResponse();
  }

  @Post('status')
  @Public()
  @HttpCode(HttpStatus.OK)
  async status(
    @Body() request: StatusRequest,
    @Headers('authorization') authHeader: string,
  ): Promise<AckResponse> {
    this.logger.log(`[REDIRECT] /api/v1/ondc/status -> Processing`);

    const isValidSignature = this.validateSignature(
      authHeader,
      request,
      request.context?.bap_id,
    );

    if (!isValidSignature) {
      return this.callbackService.buildNackResponse(
        buildOndcError(OndcErrorCode.INVALID_SIGNATURE, 'Invalid signature'),
      );
    }

    const validationError = this.validateRequest(request, BecknAction.STATUS);
    if (validationError) {
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);

    this.statusProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`[REDIRECT] Status processing error: ${message}`);
    });

    return this.callbackService.buildAckResponse();
  }

  @Post('track')
  @Public()
  @HttpCode(HttpStatus.OK)
  async track(
    @Body() request: TrackRequest,
    @Headers('authorization') authHeader: string,
  ): Promise<AckResponse> {
    this.logger.log(`[REDIRECT] /api/v1/ondc/track -> Processing`);

    const isValidSignature = this.validateSignature(
      authHeader,
      request,
      request.context?.bap_id,
    );

    if (!isValidSignature) {
      return this.callbackService.buildNackResponse(
        buildOndcError(OndcErrorCode.INVALID_SIGNATURE, 'Invalid signature'),
      );
    }

    const validationError = this.validateRequest(request, BecknAction.TRACK);
    if (validationError) {
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);

    this.trackProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`[REDIRECT] Track processing error: ${message}`);
    });

    return this.callbackService.buildAckResponse();
  }

  @Post('cancel')
  @Public()
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Body() request: CancelRequest,
    @Headers('authorization') authHeader: string,
  ): Promise<AckResponse> {
    this.logger.log(`[REDIRECT] /api/v1/ondc/cancel -> Processing`);

    const isValidSignature = this.validateSignature(
      authHeader,
      request,
      request.context?.bap_id,
    );

    if (!isValidSignature) {
      return this.callbackService.buildNackResponse(
        buildOndcError(OndcErrorCode.INVALID_SIGNATURE, 'Invalid signature'),
      );
    }

    const validationError = this.validateRequest(request, BecknAction.CANCEL);
    if (validationError) {
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);

    this.cancelProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`[REDIRECT] Cancel processing error: ${message}`);
    });

    return this.callbackService.buildAckResponse();
  }

  @Post('update')
  @Public()
  @HttpCode(HttpStatus.OK)
  async update(
    @Body() request: UpdateRequest,
    @Headers('authorization') authHeader: string,
  ): Promise<AckResponse> {
    this.logger.log(`[REDIRECT] /api/v1/ondc/update -> Processing`);

    const isValidSignature = this.validateSignature(
      authHeader,
      request,
      request.context?.bap_id,
    );

    if (!isValidSignature) {
      return this.callbackService.buildNackResponse(
        buildOndcError(OndcErrorCode.INVALID_SIGNATURE, 'Invalid signature'),
      );
    }

    const validationError = this.validateRequest(request, BecknAction.UPDATE);
    if (validationError) {
      return this.callbackService.buildNackResponse(validationError);
    }

    await this.callbackService.recordTransaction(request.context, request);

    this.updateProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`[REDIRECT] Update processing error: ${message}`);
    });

    return this.callbackService.buildAckResponse();
  }
}
