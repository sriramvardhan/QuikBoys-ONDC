import { Injectable, Logger } from '@nestjs/common';
import { SearchRequest } from '../interfaces/beckn-request.interface';
import { OnSearchMessage } from '../interfaces/catalog.interface';
import { CallbackService } from '../services/callback.service';
import { CatalogService } from '../services/catalog.service';
import { QuoteService } from '../services/quote.service';
import { OndcTransactionStatus } from '@prisma/client';
import { buildOndcError, OndcErrorCode } from '../constants/error-codes';
import { getErrorMessage } from '../../common/utils/error.utils.js';

/**
 * SearchProcessor handles ONDC search requests
 * Returns available logistics services based on search criteria
 */
@Injectable()
export class SearchProcessor {
  private readonly logger = new Logger(SearchProcessor.name);

  constructor(
    private readonly callbackService: CallbackService,
    private readonly catalogService: CatalogService,
    private readonly quoteService: QuoteService,
  ) {}

  /**
   * Process search request and send on_search callback
   */
  async process(request: SearchRequest): Promise<void> {
    // Entry logging - this MUST appear in logs
    this.logger.log(`[SEARCH_PROCESSOR] ========== PROCESSOR ENTRY ==========`);
    this.logger.log(`[SEARCH_PROCESSOR] Request received at: ${new Date().toISOString()}`);
    this.logger.log(`[SEARCH_PROCESSOR] Request object exists: ${!!request}`);
    this.logger.log(`[SEARCH_PROCESSOR] Context exists: ${!!request?.context}`);
    this.logger.log(`[SEARCH_PROCESSOR] Full request: ${JSON.stringify(request)}`);

    const { context, message } = request;
    const transactionId = context.transaction_id;

    this.logger.log(`[SEARCH_PROCESSOR] Transaction ID: ${transactionId}`);
    this.logger.log(`[SEARCH_PROCESSOR] City: ${context.city}`);
    this.logger.log(`[SEARCH_PROCESSOR] BAP ID: ${context.bap_id}`);
    this.logger.log(`[SEARCH_PROCESSOR] BAP URI: ${context.bap_uri}`);

    try {
      this.logger.log(`Processing search request: ${transactionId}`);

      // Update transaction status
      await this.callbackService.updateTransactionStatus(
        transactionId,
        OndcTransactionStatus.PROCESSING,
      );

      // Extract search intent
      const intent = message?.intent;

      // Get fulfillment type from intent
      const fulfillmentType = intent?.fulfillment?.type;

      // Get pickup and delivery locations
      const pickupGps = intent?.fulfillment?.start?.location?.gps;
      const deliveryGps = intent?.fulfillment?.end?.location?.gps;

      // Calculate distance if both locations provided
      let distance = 0;
      if (pickupGps && deliveryGps) {
        distance = this.quoteService.calculateDistance(pickupGps, deliveryGps);
        this.logger.debug(`Calculated distance: ${distance} km`);

        // Check serviceability
        if (!this.quoteService.isServiceable(distance)) {
          this.logger.warn(`Distance ${distance} km not serviceable`);

          // Send error callback
          await this.callbackService.sendCallback(
            context,
            null,
            buildOndcError(
              OndcErrorCode.AREA_NOT_SERVICEABLE,
              `Distance ${distance} km exceeds serviceable range`,
            ),
          );

          await this.callbackService.updateTransactionStatus(
            transactionId,
            OndcTransactionStatus.COMPLETED,
          );
          return;
        }
      }

      // Check if city is serviceable
      const city = context.city;
      if (!this.catalogService.isServiceableCity(city)) {
        this.logger.warn(`City not serviceable: ${city}`);

        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.AREA_NOT_SERVICEABLE,
            `City ${city} is not serviceable`,
          ),
        );

        await this.callbackService.updateTransactionStatus(
          transactionId,
          OndcTransactionStatus.COMPLETED,
        );
        return;
      }

      // Validate category if specified in search intent
      const requestedCategory = intent?.category?.id;
      if (requestedCategory) {
        const validCategories = [
          'Immediate Delivery',
          'Express Delivery',
          'Same Day Delivery',
          'Standard Delivery',
          'Next Day Delivery',
        ];

        if (!validCategories.includes(requestedCategory)) {
          this.logger.warn(`Category not found: ${requestedCategory}`);

          await this.callbackService.sendCallback(
            context,
            null,
            buildOndcError(
              OndcErrorCode.CATEGORY_NOT_FOUND,
              `Category '${requestedCategory}' is not available`,
            ),
          );

          await this.callbackService.updateTransactionStatus(
            transactionId,
            OndcTransactionStatus.COMPLETED,
          );
          return;
        }
      }

      // Build catalog response
      const catalog = this.catalogService.buildCatalog(city, fulfillmentType);

      // Check if any providers are available in the catalog
      const providers = catalog['bpp/providers'] || [];
      if (providers.length === 0) {
        this.logger.warn(`No providers available for city: ${city}`);

        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.NO_PROVIDERS_AVAILABLE,
            'No logistics providers available in the requested area',
          ),
        );

        await this.callbackService.updateTransactionStatus(
          transactionId,
          OndcTransactionStatus.COMPLETED,
        );
        return;
      }

      // Build on_search message
      const onSearchMessage: OnSearchMessage = {
        catalog,
      };

      // Send callback
      const sent = await this.callbackService.sendCallback(
        context,
        onSearchMessage,
      );

      if (sent) {
        this.logger.log(
          `on_search callback sent successfully: ${transactionId}`,
        );
      } else {
        this.logger.error(
          `Failed to send on_search callback: ${transactionId}`,
        );
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Search processing error: ${errorMessage}`);

      // Update transaction status
      await this.callbackService.updateTransactionStatus(
        transactionId,
        OndcTransactionStatus.FAILED,
        undefined,
        OndcErrorCode.INTERNAL_ERROR,
        errorMessage,
      );

      // Send error callback
      await this.callbackService.sendCallback(
        context,
        null,
        buildOndcError(OndcErrorCode.INTERNAL_ERROR, errorMessage),
      );
    }
  }
}
