import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { BecknSignatureGuard } from '../../guards/beckn-signature.guard';
import { CallbackService } from '../../services/callback.service';
import type { ReceiverReconRequest } from '../dto/receiver-recon.dto';
import type { SettlementRequest } from '../dto/settlement.dto';
import {
  AckResponse,
  BecknError,
} from '../../interfaces/beckn-message.interface';
import { buildRspError, RspErrorCode } from '../constants/rsp-error-codes';
import { ReceiverReconProcessor } from '../processors/receiver-recon.processor';
import { OnSettlementService } from '../services/on-settlement.service';
import { isError } from '../../../common/types/exception.types.js';

/**
 * RspWebhookController - Handles ONDC RSP endpoints
 * Processes reconciliation and settlement requests from ONDC network
 * RSF 2.0 compliant implementation
 */
@Controller('ondc')
@UseGuards(BecknSignatureGuard)
export class RspWebhookController {
  private readonly logger = new Logger(RspWebhookController.name);

  constructor(
    private readonly callbackService: CallbackService,
    private readonly receiverReconProcessor: ReceiverReconProcessor,
    private readonly onSettlementService: OnSettlementService,
  ) {}

  /**
   * receiver_recon endpoint - Receive reconciliation data from ONDC network
   * Network sends daily reconciliation data for settlement processing
   * BPP responds with ACK and processes asynchronously
   */
  @Post('receiver_recon')
  @HttpCode(HttpStatus.OK)
  async receiverRecon(
    @Body() request: ReceiverReconRequest,
  ): Promise<AckResponse> {
    this.logger.log(
      `Received receiver_recon: ${request.context?.transaction_id}`,
    );

    // Validate request
    const validationError = this.validateReceiverReconRequest(request);
    if (validationError) {
      this.logger.warn(`Validation error: ${validationError.message}`);
      return this.callbackService.buildNackResponse(validationError);
    }

    // Record transaction for audit
    await this.callbackService.recordTransaction(request.context, request);

    // Process asynchronously
    this.receiverReconProcessor.process(request).catch((error: unknown) => {
      const message = isError(error) ? error.message : String(error);
      this.logger.error(`Receiver recon processing error: ${message}`);
    });

    // Return immediate ACK
    return this.callbackService.buildAckResponse();
  }

  /**
   * Validate receiver_recon request
   * Performs basic validation before processing
   */
  private validateReceiverReconRequest(
    request: ReceiverReconRequest,
  ): BecknError | null {
    // Check context exists
    if (!request.context) {
      return buildRspError(
        RspErrorCode.INVALID_REQUEST_FORMAT,
        'Missing request context',
      );
    }

    // Check action matches
    if (request.context.action !== 'receiver_recon') {
      return buildRspError(
        RspErrorCode.INVALID_REQUEST_FORMAT,
        `Expected action receiver_recon, got ${request.context.action}`,
      );
    }

    // Check message exists
    if (!request.message || !request.message.recon) {
      return buildRspError(
        RspErrorCode.MISSING_RECONCILIATION_DATA,
        'Missing reconciliation data in message',
      );
    }

    const { recon } = request.message;

    // Check required fields
    if (!recon.recon_id) {
      return buildRspError(
        RspErrorCode.INVALID_RECONCILIATION_ID,
        'Missing reconciliation ID',
      );
    }

    if (!recon.period || !recon.period.start_time || !recon.period.end_time) {
      return buildRspError(
        RspErrorCode.INVALID_RECONCILIATION_PERIOD,
        'Missing or invalid reconciliation period',
      );
    }

    if (!recon.orders || !Array.isArray(recon.orders)) {
      return buildRspError(
        RspErrorCode.INVALID_TRANSACTION_DATA,
        'Missing or invalid orders array',
      );
    }

    if (recon.orders.length === 0) {
      return buildRspError(
        RspErrorCode.INVALID_TRANSACTION_DATA,
        'Orders array is empty',
      );
    }

    // Validate each order has required fields
    for (const order of recon.orders) {
      if (!order.order_id || !order.transaction_id) {
        return buildRspError(
          RspErrorCode.INVALID_TRANSACTION_DATA,
          `Order missing required fields: order_id or transaction_id`,
        );
      }

      if (!order.total_amount || isNaN(parseFloat(order.total_amount))) {
        return buildRspError(
          RspErrorCode.INVALID_TRANSACTION_DATA,
          `Order ${order.order_id} has invalid total_amount`,
        );
      }
    }

    // All validation passed
    return null;
  }

  /**
   * settlement endpoint - Receive settlement notifications from ONDC network
   * RSF 2.0: ONDC sends settlement confirmations with UTR numbers
   * BPP responds with ACK and processes asynchronously
   */
  @Post('settlement')
  @HttpCode(HttpStatus.OK)
  async settlement(@Body() request: SettlementRequest): Promise<AckResponse> {
    this.logger.log(
      `Received settlement: ${request.message?.settlement?.settlement_id}`,
    );

    // Validate request
    const validationError = this.validateSettlementRequest(request);
    if (validationError) {
      this.logger.warn(
        `Settlement validation error: ${validationError.message}`,
      );
      return this.callbackService.buildNackResponse(validationError);
    }

    // Record transaction for audit
    await this.callbackService.recordTransaction(request.context, request);

    // Process asynchronously
    this.onSettlementService
      .processSettlement(request)
      .catch((error: unknown) => {
        const message = isError(error) ? error.message : String(error);
        this.logger.error(`Settlement processing error: ${message}`);
      });

    // Return immediate ACK
    return this.callbackService.buildAckResponse();
  }

  /**
   * Validate settlement request
   */
  private validateSettlementRequest(
    request: SettlementRequest,
  ): BecknError | null {
    // Check context exists
    if (!request.context) {
      return buildRspError(
        RspErrorCode.INVALID_REQUEST_FORMAT,
        'Missing request context',
      );
    }

    // Check action matches
    if (request.context.action !== 'settlement') {
      return buildRspError(
        RspErrorCode.INVALID_REQUEST_FORMAT,
        `Expected action settlement, got ${request.context.action}`,
      );
    }

    // Check message exists
    if (!request.message || !request.message.settlement) {
      return buildRspError(
        RspErrorCode.MISSING_RECONCILIATION_DATA,
        'Missing settlement data in message',
      );
    }

    const { settlement } = request.message;

    // Check required fields
    if (!settlement.settlement_id) {
      return buildRspError(
        RspErrorCode.INVALID_RECONCILIATION_ID,
        'Missing settlement ID',
      );
    }

    if (!settlement.orders || !Array.isArray(settlement.orders)) {
      return buildRspError(
        RspErrorCode.INVALID_TRANSACTION_DATA,
        'Missing or invalid orders array',
      );
    }

    if (settlement.orders.length === 0) {
      return buildRspError(
        RspErrorCode.INVALID_TRANSACTION_DATA,
        'Settlement orders array is empty',
      );
    }

    // Validate each order has required fields
    for (const order of settlement.orders) {
      if (!order.order_id || !order.transaction_id) {
        return buildRspError(
          RspErrorCode.INVALID_TRANSACTION_DATA,
          `Settlement order missing required fields: order_id or transaction_id`,
        );
      }

      if (
        !order.settlement_amount ||
        isNaN(parseFloat(order.settlement_amount))
      ) {
        return buildRspError(
          RspErrorCode.INVALID_TRANSACTION_DATA,
          `Settlement order ${order.order_id} has invalid settlement_amount`,
        );
      }
    }

    return null;
  }
}
