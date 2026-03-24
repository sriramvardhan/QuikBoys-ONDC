import { Injectable, Logger } from '@nestjs/common';
import { SelectRequest } from '../interfaces/beckn-request.interface';
import {
  OnSelectMessage,
  OnSelectOrder,
} from '../interfaces/catalog.interface';
import { CallbackService } from '../services/callback.service';
import { CatalogService } from '../services/catalog.service';
import { QuoteService } from '../services/quote.service';
import { OndcTransactionStatus } from '@prisma/client';
import { buildOndcError, OndcErrorCode } from '../constants/error-codes';
import { ConfigService } from '@nestjs/config';
import { getErrorMessage } from '../../common/utils/error.utils.js';

/**
 * SelectProcessor handles ONDC select requests
 * Returns quote for selected logistics service
 */
@Injectable()
export class SelectProcessor {
  private readonly logger = new Logger(SelectProcessor.name);
  private readonly providerId: string;

  constructor(
    private readonly callbackService: CallbackService,
    private readonly catalogService: CatalogService,
    private readonly quoteService: QuoteService,
    private readonly configService: ConfigService,
  ) {
    this.providerId = this.configService.get<string>('ondc.providerId') || 'P1';
  }

  /**
   * Process select request and send on_select callback
   */
  async process(request: SelectRequest): Promise<void> {
    const { context, message } = request;
    const transactionId = context.transaction_id;

    try {
      this.logger.log(`Processing select request: ${transactionId}`);

      await this.callbackService.updateTransactionStatus(
        transactionId,
        OndcTransactionStatus.PROCESSING,
      );

      const order = message?.order;

      // Validate provider
      if (order?.provider?.id !== this.providerId) {
        this.logger.warn(`Provider mismatch: ${order?.provider?.id}`);

        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.PROVIDER_NOT_FOUND,
            'Provider not found',
          ),
        );

        await this.callbackService.updateTransactionStatus(
          transactionId,
          OndcTransactionStatus.COMPLETED,
        );
        return;
      }

      // Validate item
      const selectedItem = order?.items?.[0];
      if (!selectedItem?.id) {
        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(OndcErrorCode.ITEM_NOT_FOUND, 'No item selected'),
        );
        return;
      }

      // Get item from catalog
      const itemInfo = this.catalogService.getItem(selectedItem.id);
      if (!itemInfo) {
        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.ITEM_NOT_FOUND,
            `Item ${selectedItem.id} not found`,
          ),
        );
        return;
      }

      // Check if there's a previous quote TTL that has expired
      // The quote TTL is 15 minutes from the timestamp in the context
      if (context.timestamp) {
        const requestTimestamp = new Date(context.timestamp).getTime();
        const currentTime = Date.now();
        const quoteTtlMs = 15 * 60 * 1000; // 15 minutes in milliseconds

        // If this is a re-selection after initial quote, check if quote has expired
        if (currentTime - requestTimestamp > quoteTtlMs) {
          this.logger.warn(`Quote expired for transaction: ${transactionId}`);
          await this.callbackService.sendCallback(
            context,
            null,
            buildOndcError(
              OndcErrorCode.QUOTE_EXPIRED,
              'Quote has expired. Please request a new quote.',
            ),
          );
          return;
        }
      }

      // Get fulfillment details
      const fulfillment = order?.fulfillments?.[0];
      const pickupGps = fulfillment?.start?.location?.gps;
      const deliveryGps = fulfillment?.end?.location?.gps;

      // Calculate distance and quote
      let distance = 0;
      if (pickupGps && deliveryGps) {
        distance = this.quoteService.calculateDistance(pickupGps, deliveryGps);
      }

      // Get vehicle category from fulfillment
      const vehicleCategory = fulfillment?.id
        ? this.catalogService.getVehicleCategoryByFulfillmentId(fulfillment.id)
        : itemInfo.vehicleCategory;

      // Calculate quote
      const quote = this.quoteService.calculateQuote(
        distance,
        selectedItem.id,
        itemInfo.name,
        vehicleCategory,
      );

      // Estimate delivery time
      const deliveryEstimate = this.quoteService.estimateDeliveryTime(distance);

      // Build on_select order
      const onSelectOrder: OnSelectOrder = {
        provider: {
          id: this.providerId,
        },
        items: [
          {
            id: selectedItem.id,
            descriptor: {
              code: itemInfo.code,
              name: itemInfo.name,
              short_desc: itemInfo.shortDesc,
            },
            price: quote.breakup[0]?.price,
            fulfillment_ids: [fulfillment?.id || `F-${vehicleCategory}`],
          },
        ],
        fulfillments: [
          {
            id: fulfillment?.id || `F-${vehicleCategory}`,
            type: 'Delivery',
            tracking: true,
            start: fulfillment?.start
              ? {
                  location: {
                    gps: pickupGps || '',
                    address: fulfillment.start.location?.address,
                  },
                  time: {
                    range: {
                      start: new Date().toISOString(),
                      end: new Date(Date.now() + 30 * 60000).toISOString(),
                    },
                  },
                }
              : undefined,
            end: fulfillment?.end
              ? {
                  location: {
                    gps: deliveryGps || '',
                    address: fulfillment.end.location?.address,
                  },
                  time: {
                    range: deliveryEstimate.isoRange,
                  },
                }
              : undefined,
          },
        ],
        quote,
        ttl: 'PT15M',
      };

      // Build on_select message
      const onSelectMessage: OnSelectMessage = {
        order: onSelectOrder,
      };

      // Send callback
      const sent = await this.callbackService.sendCallback(
        context,
        onSelectMessage,
      );

      if (sent) {
        this.logger.log(
          `on_select callback sent successfully: ${transactionId}`,
        );
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Select processing error: ${errorMessage}`);

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
