import { Injectable, Logger } from '@nestjs/common';
import { ConfirmRequest } from '../interfaces/beckn-request.interface';
import {
  OnConfirmMessage,
  OnConfirmOrder,
} from '../interfaces/catalog.interface';
import { CallbackService } from '../services/callback.service';
import { OrderMappingService } from '../services/order-mapping.service';
import { QuoteService } from '../services/quote.service';
import { AWBService } from '../services/awb.service';
import { ConfirmationCodeService } from '../services/confirmation-code.service';
import { CancellationTermsService } from '../services/cancellation-terms.service';
import { OndcTransactionStatus } from '@prisma/client';
import { buildOndcError, OndcErrorCode } from '../constants/error-codes';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { getErrorMessage } from '../../common/utils/error.utils.js';

/**
 * ConfirmProcessor handles ONDC confirm requests
 * Creates internal order and returns confirmed order details
 * Includes Phase 1 ONDC compliance: AWB, PCC/DCC, Cancellation Terms
 */
@Injectable()
export class ConfirmProcessor {
  private readonly logger = new Logger(ConfirmProcessor.name);
  private readonly providerId: string;

  constructor(
    private readonly callbackService: CallbackService,
    private readonly orderMappingService: OrderMappingService,
    private readonly quoteService: QuoteService,
    private readonly awbService: AWBService,
    private readonly confirmationCodeService: ConfirmationCodeService,
    private readonly cancellationTermsService: CancellationTermsService,
    private readonly configService: ConfigService,
  ) {
    this.providerId = this.configService.get<string>('ondc.providerId') || 'P1';
  }

  /**
   * Process confirm request and send on_confirm callback
   */
  async process(request: ConfirmRequest): Promise<void> {
    const { context, message } = request;
    const transactionId = context.transaction_id;

    try {
      this.logger.log(`Processing confirm request: ${transactionId}`);

      await this.callbackService.updateTransactionStatus(
        transactionId,
        OndcTransactionStatus.PROCESSING,
      );

      const confirmOrder = message?.order;

      // Validate order
      if (!confirmOrder?.billing || !confirmOrder?.fulfillments?.length) {
        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.INVALID_REQUEST_FORMAT,
            'Order must include billing and fulfillment details',
          ),
        );
        return;
      }

      // Generate order ID if not provided
      const orderId =
        confirmOrder.id || `QBZ-${uuidv4().slice(0, 8).toUpperCase()}`;

      // Create internal order from ONDC order
      const internalOrder = await this.orderMappingService.createOrderFromOndc(
        { ...confirmOrder, id: orderId },
        transactionId,
        context.bap_id,
        context.bap_id,
      );

      // Update transaction with order ID
      await this.callbackService.updateTransactionStatus(
        transactionId,
        OndcTransactionStatus.PROCESSING,
        internalOrder.id,
      );

      // Get fulfillment details
      const fulfillment = confirmOrder.fulfillments[0];
      const pickupGps = fulfillment?.start?.location?.gps || '';
      const deliveryGps = fulfillment?.end?.location?.gps || '';

      // Calculate quote
      const distance = this.quoteService.calculateDistance(
        pickupGps,
        deliveryGps,
      );
      const quote =
        confirmOrder.quote ||
        this.quoteService.calculateQuote(
          distance,
          confirmOrder.items?.[0]?.id || 'IMMEDIATE-BIKE',
          'Immediate Delivery',
          'BIKE',
        );

      const now = new Date().toISOString();

      // Determine delivery type from item (P2P or P2H2P)
      const itemId = confirmOrder.items?.[0]?.id || 'IMMEDIATE-BIKE';
      const isP2H2P =
        itemId.includes('STANDARD') || itemId.includes('NEXT-DAY');
      const deliveryType = isP2H2P ? 'P2H2P' : 'P2P';

      // Generate AWB number for P2H2P shipments (ONDC requirement)
      const awbDetails = await this.awbService.generateAWBNumber(
        internalOrder.id,
        deliveryType as 'P2P' | 'P2H2P',
      );

      // Generate PCC (Pickup Confirmation Code) for ONDC compliance
      const pcc = await this.confirmationCodeService.generatePCC(
        internalOrder.id,
        fulfillment.id,
      );

      // Get cancellation terms (required in on_confirm per ONDC spec)
      const cancellationTerms =
        this.cancellationTermsService.getCancellationTerms();

      // Build AWB tags for P2H2P
      const awbTags = this.awbService.buildAWBTags(awbDetails);

      // Build fulfillment tags including AWB
      const fulfillmentTags = [
        ...awbTags,
        {
          descriptor: { code: 'delivery_type' },
          list: [
            {
              descriptor: { code: 'type' },
              value: deliveryType,
            },
          ],
        },
      ];

      // Build linked_order per ONDC Pramaan spec
      const linkedOrder = {
        items:
          confirmOrder.items?.map((item) => ({
            category_id: 'Standard Delivery',
            descriptor: item.descriptor || { name: 'Package' },
            quantity: item.quantity || { count: 1 },
            price: {
              currency: 'INR',
              value: quote?.price?.value || '0',
            },
          })) || [
            {
              category_id: 'Standard Delivery',
              descriptor: { name: 'Package' },
              quantity: { count: 1 },
              price: { currency: 'INR', value: '0' },
            },
          ],
        provider: {
          descriptor: {
            name:
              (fulfillment.start?.person?.name as string) ||
              (fulfillment.start?.contact?.phone as string) ||
              'Seller',
          },
          address: fulfillment.start?.location?.address || {
            name: 'Pickup Location',
            building: '',
            locality: '',
            city: 'Hyderabad',
            state: 'Telangana',
            country: 'India',
            area_code: '500001',
          },
        },
        order: {
          id: orderId,
          weight: { unit: 'kilogram', value: 1 },
          dimensions: {
            length: { unit: 'centimeter', value: 20 },
            breadth: { unit: 'centimeter', value: 15 },
            height: { unit: 'centimeter', value: 10 },
          },
        },
      };

      // Build on_confirm order with all required ONDC Pramaan fields
      const onConfirmOrder: OnConfirmOrder = {
        id: orderId,
        state: 'Accepted',
        provider: {
          id: this.providerId,
        },
        items:
          confirmOrder.items?.map((item) => ({
            id: item.id,
            category_id: 'Standard Delivery', // Required by ONDC Pramaan
            descriptor: item.descriptor || { name: item.id },
            fulfillment_ids: [fulfillment.id],
          })) || [],
        fulfillments: [
          {
            id: fulfillment.id,
            type: 'Delivery',
            state: {
              descriptor: {
                code: 'Pending',
                name: 'Pending',
              },
              updated_at: now,
            },
            tracking: true,
            start: {
              location: {
                gps: pickupGps,
                address: fulfillment.start?.location?.address,
              },
              contact: fulfillment.start?.contact,
              person: fulfillment.start?.person,
              time: fulfillment.start?.time,
              instructions: fulfillment.start?.instructions
                ? {
                    code: fulfillment.start.instructions.code,
                    name: fulfillment.start.instructions.name,
                    short_desc: fulfillment.start.instructions.short_desc,
                  }
                : undefined,
              // PCC authorization for pickup (ONDC requirement)
              authorization:
                this.confirmationCodeService.buildAuthorizationForPickup(pcc),
            },
            end: {
              location: {
                gps: deliveryGps,
                address: fulfillment.end?.location?.address,
              },
              contact: fulfillment.end?.contact,
              person: fulfillment.end?.person,
              time: fulfillment.end?.time,
              instructions: fulfillment.end?.instructions
                ? {
                    code: fulfillment.end.instructions.code,
                    name: fulfillment.end.instructions.name,
                    short_desc: fulfillment.end.instructions.short_desc,
                  }
                : undefined,
              // DCC will be generated when order is picked up
            },
            tags: fulfillmentTags,
          },
        ],
        billing: confirmOrder.billing,
        quote,
        payment: {
          type: confirmOrder.payment?.type || 'ON-FULFILLMENT',
          collected_by: confirmOrder.payment?.collected_by || 'BPP',
          status: 'NOT-PAID',
          '@ondc/org/settlement_basis': 'delivery',
          '@ondc/org/settlement_window': 'P2D',
          '@ondc/org/settlement_details': [
            {
              settlement_counterparty: 'seller-app',
              settlement_phase: 'sale-amount',
              settlement_type: 'neft',
              settlement_bank_account_no: '1234567890',
              settlement_ifsc_code: 'SBIN0001234',
              beneficiary_name: 'QuikBoys Logistics',
              bank_name: 'State Bank of India',
              branch_name: 'Hyderabad Main Branch',
            },
          ],
        },
        // Cancellation terms (ONDC requirement for on_confirm)
        cancellation_terms: cancellationTerms,
        // Linked order (ONDC Pramaan requirement)
        '@ondc/org/linked_order': linkedOrder,
        created_at: now,
        updated_at: now,
        tags: confirmOrder.tags,
      };

      // Build on_confirm message
      const onConfirmMessage: OnConfirmMessage = {
        order: onConfirmOrder,
      };

      // Send callback
      const sent = await this.callbackService.sendCallback(
        context,
        onConfirmMessage,
      );

      if (sent) {
        this.logger.log(
          `on_confirm callback sent successfully: ${transactionId}, Order: ${orderId}`,
        );

        await this.callbackService.updateTransactionStatus(
          transactionId,
          OndcTransactionStatus.COMPLETED,
          internalOrder.id,
        );
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Confirm processing error: ${errorMessage}`);

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
