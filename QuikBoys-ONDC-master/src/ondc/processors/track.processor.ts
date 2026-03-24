import { Injectable, Logger } from '@nestjs/common';
import { TrackRequest } from '../interfaces/beckn-request.interface';
import { OnTrackMessage } from '../interfaces/catalog.interface';
import { CallbackService } from '../services/callback.service';
import { TrackingService } from '../services/tracking.service';
import { OrderMappingService } from '../services/order-mapping.service';
import { OndcTransactionStatus } from '@prisma/client';
import { buildOndcError, OndcErrorCode } from '../constants/error-codes';
import { getErrorMessage } from '../../common/utils/error.utils.js';

/**
 * TrackProcessor handles ONDC track requests
 * Returns real-time tracking information
 */
@Injectable()
export class TrackProcessor {
  private readonly logger = new Logger(TrackProcessor.name);

  constructor(
    private readonly callbackService: CallbackService,
    private readonly trackingService: TrackingService,
    private readonly orderMappingService: OrderMappingService,
  ) {}

  /**
   * Process track request and send on_track callback
   */
  async process(request: TrackRequest): Promise<void> {
    const { context, message } = request;
    const transactionId = context.transaction_id;

    try {
      this.logger.log(`Processing track request: ${transactionId}`);

      await this.callbackService.updateTransactionStatus(
        transactionId,
        OndcTransactionStatus.PROCESSING,
      );

      const orderId = message?.order_id;

      if (!orderId) {
        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.INVALID_REQUEST_FORMAT,
            'order_id is required',
          ),
        );
        return;
      }

      // Find order
      let order = await this.orderMappingService.getOrderByOndcId(orderId);
      if (!order) {
        order =
          await this.orderMappingService.getOrderByTransactionId(transactionId);
      }

      if (!order) {
        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.ORDER_NOT_FOUND,
            `Order ${orderId} not found`,
          ),
        );
        return;
      }

      // Get tracking info
      const trackingInfo = await this.trackingService.getTrackingInfo(order.id);

      if (!trackingInfo) {
        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.INTERNAL_ERROR,
            'Tracking info not available',
          ),
        );
        return;
      }

      // If callback URL provided, store it
      if (message?.callback_url) {
        await this.trackingService.setTrackingUrl(
          order.id,
          message.callback_url,
        );
      }

      // Build on_track message
      const onTrackMessage: OnTrackMessage = trackingInfo;

      // Send callback
      const sent = await this.callbackService.sendCallback(
        context,
        onTrackMessage,
      );

      if (sent) {
        this.logger.log(
          `on_track callback sent successfully: ${transactionId}`,
        );

        await this.callbackService.updateTransactionStatus(
          transactionId,
          OndcTransactionStatus.COMPLETED,
          order.id,
        );
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Track processing error: ${errorMessage}`);

      await this.callbackService.updateTransactionStatus(
        transactionId,
        OndcTransactionStatus.FAILED,
        undefined,
        OndcErrorCode.INTERNAL_ERROR,
        errorMessage,
      );

      await this.callbackService.sendCallback(
        context,
        null,
        buildOndcError(OndcErrorCode.INTERNAL_ERROR, errorMessage),
      );
    }
  }
}
