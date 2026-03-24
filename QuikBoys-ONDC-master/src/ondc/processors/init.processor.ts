import { Injectable, Logger } from '@nestjs/common';
import { InitRequest } from '../interfaces/beckn-request.interface';
import { OnInitMessage, OnInitOrder } from '../interfaces/catalog.interface';
import { CallbackService } from '../services/callback.service';
import { CatalogService } from '../services/catalog.service';
import { QuoteService } from '../services/quote.service';
import { OndcTransactionStatus } from '@prisma/client';
import { buildOndcError, OndcErrorCode } from '../constants/error-codes';
import { ConfigService } from '@nestjs/config';
import { getErrorMessage } from '../../common/utils/error.utils.js';

/**
 * InitProcessor handles ONDC init requests
 * Validates billing/fulfillment and returns order initialization details
 */
@Injectable()
export class InitProcessor {
  private readonly logger = new Logger(InitProcessor.name);
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
   * Process init request and send on_init callback
   */
  async process(request: InitRequest): Promise<void> {
    const { context, message } = request;
    const transactionId = context.transaction_id;

    try {
      this.logger.log(`Processing init request: ${transactionId}`);

      await this.callbackService.updateTransactionStatus(
        transactionId,
        OndcTransactionStatus.PROCESSING,
      );

      const order = message?.order;

      // Validate billing
      if (!order?.billing?.name || !order?.billing?.phone) {
        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.INVALID_REQUEST_FORMAT,
            'Billing name and phone are required',
          ),
        );
        return;
      }

      // Validate fulfillments
      const fulfillment = order?.fulfillments?.[0];
      if (
        !fulfillment?.start?.location?.gps ||
        !fulfillment?.end?.location?.gps
      ) {
        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.INVALID_REQUEST_FORMAT,
            'Pickup and delivery locations are required',
          ),
        );
        return;
      }

      // Calculate distance
      const pickupGps = fulfillment.start.location.gps;
      const deliveryGps = fulfillment.end.location.gps;
      const distance = this.quoteService.calculateDistance(
        pickupGps,
        deliveryGps,
      );

      // Check serviceability
      if (!this.quoteService.isServiceable(distance)) {
        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.AREA_NOT_SERVICEABLE,
            `Distance ${distance} km not serviceable`,
          ),
        );
        return;
      }

      // Get item details
      const selectedItem = order?.items?.[0];
      const itemInfo = selectedItem?.id
        ? this.catalogService.getItem(selectedItem.id)
        : null;

      // Get vehicle category
      const vehicleCategory = fulfillment.id
        ? this.catalogService.getVehicleCategoryByFulfillmentId(fulfillment.id)
        : itemInfo?.vehicleCategory || 'BIKE';

      // Calculate quote
      const quote = this.quoteService.calculateQuote(
        distance,
        selectedItem?.id || 'IMMEDIATE-BIKE',
        itemInfo?.name || 'Immediate Delivery',
        vehicleCategory,
      );

      // Estimate delivery time
      const deliveryEstimate = this.quoteService.estimateDeliveryTime(distance);

      // Build on_init order
      const onInitOrder: OnInitOrder = {
        provider: {
          id: this.providerId,
        },
        items: [
          {
            id: selectedItem?.id || 'IMMEDIATE-BIKE',
            descriptor: {
              name: itemInfo?.name || 'Immediate Delivery',
            },
            fulfillment_ids: [fulfillment.id],
          },
        ],
        fulfillments: [
          {
            id: fulfillment.id,
            type: 'Delivery',
            tracking: true,
            start: {
              location: {
                gps: pickupGps,
                address: fulfillment.start.location.address,
              },
              contact: fulfillment.start.contact,
              person: fulfillment.start.person,
              time: {
                range: {
                  start: new Date().toISOString(),
                  end: new Date(Date.now() + 30 * 60000).toISOString(),
                },
              },
            },
            end: {
              location: {
                gps: deliveryGps,
                address: fulfillment.end.location.address,
              },
              contact: fulfillment.end.contact,
              person: fulfillment.end.person,
              time: {
                range: deliveryEstimate.isoRange,
              },
            },
          },
        ],
        billing: order.billing,
        quote,
        payment: order.payment
          ? {
              type: order.payment.type,
              collected_by: 'BPP',
              status: 'NOT-PAID',
            }
          : {
              type: 'ON-FULFILLMENT',
              collected_by: 'BPP',
              status: 'NOT-PAID',
            },
        tags: [
          {
            code: 'bpp_terms',
            list: [
              {
                code: 'max_liability',
                value: this.configService.get<string>(
                  'ondc.terms.maxLiability',
                  '2',
                ),
              },
              {
                code: 'max_liability_cap',
                value: this.configService.get<string>(
                  'ondc.terms.maxLiabilityCap',
                  '10000',
                ),
              },
              {
                code: 'mandatory_arbitration',
                value: this.configService.get<string>(
                  'ondc.terms.mandatoryArbitration',
                  'false',
                ),
              },
              {
                code: 'court_jurisdiction',
                value: this.getCourtJurisdiction(
                  fulfillment.end.location.address?.city,
                ),
              },
              {
                code: 'delay_interest',
                value: this.configService.get<string>(
                  'ondc.terms.delayInterest',
                  '1000',
                ),
              },
            ],
          },
        ],
      };

      // Build on_init message
      const onInitMessage: OnInitMessage = {
        order: onInitOrder,
      };

      // Send callback
      const sent = await this.callbackService.sendCallback(
        context,
        onInitMessage,
      );

      if (sent) {
        this.logger.log(`on_init callback sent successfully: ${transactionId}`);
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Init processing error: ${errorMessage}`);

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

  /**
   * Get court jurisdiction based on delivery city
   * Maps city names to their respective High Court jurisdictions
   */
  private getCourtJurisdiction(city?: string): string {
    if (!city) {
      return this.configService.get<string>(
        'ondc.terms.defaultCourtJurisdiction',
        'Hyderabad',
      );
    }

    // Map cities to their respective court jurisdictions
    const jurisdictionMapping: Record<string, string> = {
      // Telangana
      hyderabad: 'Hyderabad',
      secunderabad: 'Hyderabad',
      warangal: 'Hyderabad',
      nizamabad: 'Hyderabad',
      karimnagar: 'Hyderabad',

      // Andhra Pradesh
      visakhapatnam: 'Amaravati',
      vizag: 'Amaravati',
      vijayawada: 'Amaravati',
      guntur: 'Amaravati',
      tirupati: 'Amaravati',
      nellore: 'Amaravati',

      // Maharashtra
      mumbai: 'Mumbai',
      pune: 'Mumbai',
      nagpur: 'Mumbai',
      nashik: 'Mumbai',
      thane: 'Mumbai',

      // Karnataka
      bangalore: 'Bengaluru',
      bengaluru: 'Bengaluru',
      mysore: 'Bengaluru',
      mysuru: 'Bengaluru',
      mangalore: 'Bengaluru',
      hubli: 'Bengaluru',

      // Tamil Nadu
      chennai: 'Chennai',
      coimbatore: 'Chennai',
      madurai: 'Chennai',
      trichy: 'Chennai',
      salem: 'Chennai',

      // Delhi NCR
      delhi: 'New Delhi',
      'new delhi': 'New Delhi',
      noida: 'New Delhi',
      gurgaon: 'New Delhi',
      gurugram: 'New Delhi',
      faridabad: 'New Delhi',
      ghaziabad: 'New Delhi',

      // Gujarat
      ahmedabad: 'Ahmedabad',
      surat: 'Ahmedabad',
      vadodara: 'Ahmedabad',
      rajkot: 'Ahmedabad',

      // West Bengal
      kolkata: 'Kolkata',
      howrah: 'Kolkata',

      // Kerala
      kochi: 'Kochi',
      cochin: 'Kochi',
      thiruvananthapuram: 'Kochi',
      trivandrum: 'Kochi',

      // Rajasthan
      jaipur: 'Jaipur',
      jodhpur: 'Jaipur',
      udaipur: 'Jaipur',

      // Madhya Pradesh
      bhopal: 'Bhopal',
      indore: 'Bhopal',

      // Uttar Pradesh
      lucknow: 'Lucknow',
      kanpur: 'Lucknow',
      varanasi: 'Lucknow',
      agra: 'Lucknow',

      // Punjab
      chandigarh: 'Chandigarh',
      ludhiana: 'Chandigarh',
      amritsar: 'Chandigarh',

      // Bihar
      patna: 'Patna',

      // Odisha
      bhubaneswar: 'Cuttack',
      cuttack: 'Cuttack',
    };

    const normalizedCity = city.toLowerCase().trim();
    return (
      jurisdictionMapping[normalizedCity] ||
      this.configService.get<string>(
        'ondc.terms.defaultCourtJurisdiction',
        'Hyderabad',
      )
    );
  }
}
