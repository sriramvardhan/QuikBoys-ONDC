import { Injectable, Logger } from '@nestjs/common';
import { StatusRequest } from '../interfaces/beckn-request.interface';
import {
  OnStatusMessage,
  OnStatusOrder,
} from '../interfaces/catalog.interface';
import { CallbackService } from '../services/callback.service';
import { OrderMappingService } from '../services/order-mapping.service';
import { OndcTransactionStatus } from '@prisma/client';
import { buildOndcError, OndcErrorCode } from '../constants/error-codes';
import { ConfigService } from '@nestjs/config';
import { OndcFulfillmentState } from '../constants/fulfillment-states';
import { getErrorMessage } from '../../common/utils/error.utils.js';

// Type for order items stored in JSON field
interface OrderItem {
  id?: string;
  descriptor?: Record<string, unknown>;
  fulfillment_ids?: string[];
  quantity?: { count: number };
  category_id?: string;
}

/**
 * StatusProcessor handles ONDC status requests
 * Returns current order status and fulfillment details
 */
@Injectable()
export class StatusProcessor {
  private readonly logger = new Logger(StatusProcessor.name);
  private readonly providerId: string;

  constructor(
    private readonly callbackService: CallbackService,
    private readonly orderMappingService: OrderMappingService,
    private readonly configService: ConfigService,
  ) {
    this.providerId = this.configService.get<string>('ondc.providerId') || 'P1';
  }

  /**
   * Process status request and send on_status callback
   */
  async process(request: StatusRequest): Promise<void> {
    const { context, message } = request;
    const transactionId = context.transaction_id;

    try {
      this.logger.log(`Processing status request: ${transactionId}`);

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

      // Find order by ONDC order ID or internal order ID
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

      // Get fulfillment details
      const fulfillment =
        await this.orderMappingService.buildFulfillmentResponse(order.id);

      if (!fulfillment) {
        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.ORDER_NOT_FOUND,
            'Fulfillment details not found',
          ),
        );
        return;
      }

      // Get ONDC state from internal status
      const ondcState = this.orderMappingService.getOndcStateFromInternal(
        order.status,
      );

      // Map internal status to ONDC order state
      const orderState = this.mapToOrderState(ondcState);

      // Build delivery address
      const deliveryAddress = order.deliveryAddress as Record<string, unknown>;

      // Build cancellation_terms per ONDC Pramaan spec
      const cancellation_terms = [
        {
          fulfillment_state: { descriptor: { code: 'Pending' } },
          reason_required: false,
          cancellation_fee: {
            percentage: '0',
            amount: { currency: 'INR', value: '0' },
          },
        },
        {
          fulfillment_state: { descriptor: { code: 'Agent-assigned' } },
          reason_required: true,
          cancellation_fee: {
            percentage: '10',
            amount: { currency: 'INR', value: '50' },
          },
        },
        {
          fulfillment_state: { descriptor: { code: 'Order-picked-up' } },
          reason_required: true,
          cancellation_fee: {
            percentage: '20',
            amount: { currency: 'INR', value: '100' },
          },
        },
      ];

      // Build linked_order per ONDC Pramaan spec
      const pickupAddress = order.pickupAddress as Record<string, unknown>;
      const linkedOrder = {
        items: (order.items as OrderItem[])?.map((item) => ({
          category_id: item.category_id || 'Standard Delivery',
          descriptor: item.descriptor || { name: 'Package' },
          quantity: item.quantity || { count: 1 },
          price: { currency: 'INR', value: order.totalAmount.toString() },
        })) || [
          {
            category_id: 'Standard Delivery',
            descriptor: { name: 'Package' },
            quantity: { count: 1 },
            price: { currency: 'INR', value: order.totalAmount.toString() },
          },
        ],
        provider: {
          descriptor: {
            name: (pickupAddress?.name as string) || 'Seller',
          },
          address: {
            name: (pickupAddress?.name as string) || 'Pickup Location',
            building: (pickupAddress?.building as string) || '',
            locality: (pickupAddress?.locality as string) || '',
            city: (pickupAddress?.city as string) || 'Hyderabad',
            state: (pickupAddress?.state as string) || 'Telangana',
            country: 'India',
            area_code: (pickupAddress?.area_code as string) || '500001',
          },
        },
        order: {
          id: order.ondcOrderId || order.id,
          weight: { unit: 'kilogram', value: 1 },
          dimensions: {
            length: { unit: 'centimeter', value: 20 },
            breadth: { unit: 'centimeter', value: 15 },
            height: { unit: 'centimeter', value: 10 },
          },
        },
      };

      // Build on_status order with all required ONDC Pramaan fields
      const onStatusOrder: OnStatusOrder = {
        id: order.ondcOrderId || order.id,
        state: orderState,
        provider: {
          id: this.providerId,
        },
        items: (order.items as OrderItem[])?.map((item) => ({
          id: item.id || 'STANDARD-BIKE',
          category_id: item.category_id || 'Standard Delivery', // Required by ONDC Pramaan
          descriptor: item.descriptor || { name: 'Standard Delivery' },
          fulfillment_ids: [fulfillment.id],
        })) || [
          {
            id: 'STANDARD-BIKE',
            category_id: 'Standard Delivery',
            descriptor: { name: 'Standard Delivery' },
            fulfillment_ids: [fulfillment.id],
          },
        ],
        fulfillments: [fulfillment],
        billing: {
          name: order.customerName || 'Customer',
          phone: order.customerPhone,
          email: order.customerEmail || undefined,
          address: deliveryAddress,
        },
        quote: {
          price: {
            currency: 'INR',
            value: order.totalAmount.toString(),
          },
          breakup: [
            {
              '@ondc/org/item_id': 'STANDARD-BIKE',
              '@ondc/org/title_type': 'delivery',
              title: 'Delivery Charge',
              price: {
                currency: 'INR',
                value: order.deliveryFee.toString(),
              },
            },
            {
              '@ondc/org/item_id': 'STANDARD-BIKE',
              '@ondc/org/title_type': 'tax',
              title: 'Tax',
              price: {
                currency: 'INR',
                value: order.tax.toString(),
              },
            },
          ],
        },
        payment: {
          type:
            order.paymentMethod === 'COD'
              ? 'ON-FULFILLMENT'
              : 'PRE-FULFILLMENT',
          collected_by: 'BPP',
          status: order.paymentStatus === 'COMPLETED' ? 'PAID' : 'NOT-PAID',
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
        cancellation_terms,
        '@ondc/org/linked_order': linkedOrder,
        created_at: order.createdAt.toISOString(),
        updated_at: order.createdAt.toISOString(),
      };

      // Build on_status message
      const onStatusMessage: OnStatusMessage = {
        order: onStatusOrder,
      };

      // Send callback
      const sent = await this.callbackService.sendCallback(
        context,
        onStatusMessage,
      );

      if (sent) {
        this.logger.log(
          `on_status callback sent successfully: ${transactionId}`,
        );

        await this.callbackService.updateTransactionStatus(
          transactionId,
          OndcTransactionStatus.COMPLETED,
          order.id,
        );
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Status processing error: ${errorMessage}`);

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
   * Map ONDC fulfillment state to order state
   */
  private mapToOrderState(fulfillmentState: OndcFulfillmentState): string {
    const stateMapping: Record<OndcFulfillmentState, string> = {
      [OndcFulfillmentState.PENDING]: 'Accepted',
      [OndcFulfillmentState.SEARCHING_FOR_AGENT]: 'In-progress',
      [OndcFulfillmentState.AGENT_ASSIGNED]: 'In-progress',
      [OndcFulfillmentState.AT_PICKUP]: 'In-progress',
      [OndcFulfillmentState.ORDER_PICKED_UP]: 'In-progress',
      [OndcFulfillmentState.IN_TRANSIT]: 'In-progress',
      [OndcFulfillmentState.OUT_FOR_DELIVERY]: 'In-progress',
      [OndcFulfillmentState.AT_DELIVERY]: 'In-progress',
      [OndcFulfillmentState.ORDER_DELIVERED]: 'Completed',
      [OndcFulfillmentState.CANCELLED]: 'Cancelled',
      [OndcFulfillmentState.RTO_INITIATED]: 'In-progress',
      [OndcFulfillmentState.RTO_IN_TRANSIT]: 'In-progress',
      [OndcFulfillmentState.RTO_DELIVERED]: 'Completed',
      [OndcFulfillmentState.RTO_DISPOSED]: 'Completed',
    };

    return stateMapping[fulfillmentState] || 'In-progress';
  }
}
