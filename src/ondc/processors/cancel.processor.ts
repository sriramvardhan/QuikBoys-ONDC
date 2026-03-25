import { Injectable, Logger } from '@nestjs/common';
import { CancelRequest } from '../interfaces/beckn-request.interface';
import {
  OnCancelMessage,
  OnCancelOrder,
} from '../interfaces/catalog.interface';
import { CallbackService } from '../services/callback.service';
import { OrderMappingService } from '../services/order-mapping.service';
import { PrismaService } from '../../database/prisma.service.js';
import {
  OndcTransactionStatus,
  OrderStatus,
  OndcFulfillmentState,
  CancellationReason,
  CancelledBy,
} from '@prisma/client';
import { buildOndcError, OndcErrorCode } from '../constants/error-codes';
import { getErrorMessage } from '../../common/utils/error.utils.js';
import { ConfigService } from '@nestjs/config';

// Type for order items stored in JSON field
interface OrderItem {
  id?: string;
  descriptor?: Record<string, unknown>;
  fulfillment_ids?: string[];
  quantity?: { count: number };
  category_id?: string;
}

/**
 * CancelProcessor handles ONDC cancel requests
 * Processes order cancellation and updates fulfillment state
 */
@Injectable()
export class CancelProcessor {
  private readonly logger = new Logger(CancelProcessor.name);
  private readonly providerId: string;

  constructor(
    private readonly callbackService: CallbackService,
    private readonly orderMappingService: OrderMappingService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.providerId = this.configService.get<string>('ondc.providerId') || 'P1';
  }

  /**
   * Process cancel request and send on_cancel callback
   */
  async process(request: CancelRequest): Promise<void> {
    const { context, message } = request;
    const transactionId = context.transaction_id;

    try {
      this.logger.log(`Processing cancel request: ${transactionId}`);

      await this.callbackService.updateTransactionStatus(
        transactionId,
        OndcTransactionStatus.PROCESSING,
      );

      const orderId = message?.order_id;
      const cancellationReasonId = message?.cancellation_reason_id;

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

      // Check if order can be cancelled
      const nonCancellableStatuses: OrderStatus[] = [
        OrderStatus.DELIVERED,
        OrderStatus.CANCELLED,
      ];
      if (nonCancellableStatuses.includes(order.status)) {
        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.CANCELLATION_NOT_POSSIBLE,
            `Order in ${order.status} state cannot be cancelled`,
          ),
        );
        return;
      }

      // Update internal order status
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });

      // Calculate refund amount based on order state and payment status
      const refundDetails = this.calculateRefund(order, cancellationReasonId);

      // Map the cancellation reason to Prisma enum
      const cancellationReason =
        this.mapToPrismaCancellationReason(cancellationReasonId);
      const cancelledByEnum = this.determineCancelledBy(
        cancellationReasonId,
        context.bap_id,
      );

      // Create cancellation record
      await this.prisma.orderCancellation.create({
        data: {
          orderId: order.id,
          reason: cancellationReason,
          cancelledBy: cancelledByEnum,
          notes:
            message?.descriptor?.name ||
            this.getCancellationReasonDescription(cancellationReasonId),
          refundRequired: refundDetails.refundRequired,
          refundAmount: refundDetails.refundAmount,
          refundStatus: refundDetails.refundRequired ? 'PENDING' : null,
        },
      });

      // Update ONDC fulfillment state
      await this.orderMappingService.updateOndcFulfillmentState(
        order.id,
        OndcFulfillmentState.Cancelled,
        'BAP',
        `Cancelled: ${cancellationReasonId}`,
      );

      // Get fulfillment details
      const fulfillment =
        await this.orderMappingService.buildFulfillmentResponse(order.id);

      // Determine RTO state if applicable
      const isRto = this.isRtoCancellation(cancellationReasonId);
      const fulfillmentStateCode = isRto ? 'RTO-Initiated' : 'Cancelled';

      // Build on_cancel order with proper refund information
      const onCancelOrder: OnCancelOrder = {
        id: order.ondcOrderId || order.id,
        state: 'Cancelled',
        provider: {
          id: this.providerId,
        },
        items:
          (order.items as OrderItem[])?.map((item) => ({
            id: item.id || 'IMMEDIATE-BIKE',
            descriptor: item.descriptor || { name: 'Immediate Delivery' },
            fulfillment_ids: [fulfillment?.id || 'F-BIKE'],
          })) || [],
        fulfillments: fulfillment
          ? [
              {
                ...fulfillment,
                state: {
                  descriptor: {
                    code: fulfillmentStateCode,
                    name: isRto ? 'Return To Origin Initiated' : 'Cancelled',
                  },
                  updated_at: new Date().toISOString(),
                },
              },
            ]
          : undefined,
        quote: {
          price: {
            currency: 'INR',
            value: refundDetails.refundRequired
              ? (refundDetails.refundAmount || 0).toFixed(2)
              : '0.00',
          },
          breakup: [
            {
              '@ondc/org/item_id': 'IMMEDIATE-BIKE',
              '@ondc/org/title_type': 'delivery',
              title: 'Delivery Charge',
              price: {
                currency: 'INR',
                value: '0.00',
              },
            },
            ...(refundDetails.refundRequired && refundDetails.refundAmount
              ? [
                  {
                    '@ondc/org/item_id': 'IMMEDIATE-BIKE',
                    '@ondc/org/title_type': 'refund',
                    title: 'Refund Amount',
                    price: {
                      currency: 'INR',
                      value: refundDetails.refundAmount.toFixed(2),
                    },
                  },
                ]
              : []),
          ],
        },
        cancellation: {
          cancelled_by: context.bap_id,
          reason: {
            id: cancellationReasonId || '004',
            descriptor: message?.descriptor || {
              name: this.getCancellationReasonDescription(cancellationReasonId),
              short_desc:
                this.getCancellationReasonDescription(cancellationReasonId),
            },
          },
        },
        updated_at: new Date().toISOString(),
        tags: [
          {
            code: 'cancellation_info',
            list: [
              { code: 'reason_id', value: cancellationReasonId || '004' },
              { code: 'rto_initiated', value: isRto ? 'yes' : 'no' },
              {
                code: 'refund_eligible',
                value: refundDetails.refundRequired ? 'yes' : 'no',
              },
              ...(refundDetails.refundAmount
                ? [
                    {
                      code: 'refund_amount',
                      value: refundDetails.refundAmount.toFixed(2),
                    },
                  ]
                : []),
            ],
          },
        ],
      };

      // Build on_cancel message
      const onCancelMessage: OnCancelMessage = {
        order: onCancelOrder,
      };

      // Send callback
      const sent = await this.callbackService.sendCallback(
        context,
        onCancelMessage,
      );

      if (sent) {
        this.logger.log(
          `on_cancel callback sent successfully: ${transactionId}`,
        );

        await this.callbackService.updateTransactionStatus(
          transactionId,
          OndcTransactionStatus.COMPLETED,
          order.id,
        );
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Cancel processing error: ${errorMessage}`);

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
   * Map ONDC cancellation reason ID to internal enum
   * Includes all ONDC LOG10 reason codes including RTO scenarios
   */
  private mapCancellationReason(
    reasonId?: string,
  ):
    | 'CUSTOMER_REQUESTED'
    | 'DRIVER_REQUESTED'
    | 'RTO'
    | 'MERCHANT_REQUESTED'
    | 'OTHER' {
    const reasonMapping: Record<
      string,
      | 'CUSTOMER_REQUESTED'
      | 'DRIVER_REQUESTED'
      | 'RTO'
      | 'MERCHANT_REQUESTED'
      | 'OTHER'
    > = {
      // Buyer/Customer cancellation reasons (001-009)
      '001': 'CUSTOMER_REQUESTED', // Price changed after order placed
      '002': 'CUSTOMER_REQUESTED', // Order created by mistake
      '003': 'CUSTOMER_REQUESTED', // Delivery time too long
      '004': 'CUSTOMER_REQUESTED', // Changed mind
      '005': 'CUSTOMER_REQUESTED', // Found better option
      '006': 'CUSTOMER_REQUESTED', // Duplicate order
      '007': 'CUSTOMER_REQUESTED', // Payment issue
      '008': 'CUSTOMER_REQUESTED', // Delivery address incorrect
      '009': 'CUSTOMER_REQUESTED', // Other buyer reason

      // Driver/Agent cancellation reasons (011-019)
      '011': 'DRIVER_REQUESTED', // Unable to pick up - location not found
      '012': 'DRIVER_REQUESTED', // Unable to deliver - recipient not available
      '013': 'DRIVER_REQUESTED', // Cannot complete delivery - vehicle breakdown
      '014': 'DRIVER_REQUESTED', // Package damaged during transit
      '015': 'DRIVER_REQUESTED', // Incorrect package details
      '016': 'DRIVER_REQUESTED', // Pickup location closed
      '017': 'DRIVER_REQUESTED', // Delivery location inaccessible
      '018': 'DRIVER_REQUESTED', // Weather conditions
      '019': 'DRIVER_REQUESTED', // Other agent reason

      // Merchant/Seller cancellation reasons (021-029)
      '021': 'MERCHANT_REQUESTED', // Item out of stock
      '022': 'MERCHANT_REQUESTED', // Store closed
      '023': 'MERCHANT_REQUESTED', // Unable to prepare order
      '024': 'MERCHANT_REQUESTED', // Pricing error
      '025': 'MERCHANT_REQUESTED', // Other merchant reason

      // RTO (Return to Origin) reason codes (031-039)
      '031': 'RTO', // RTO - Recipient not available after multiple attempts
      '032': 'RTO', // RTO - Recipient refused delivery
      '033': 'RTO', // RTO - Address incorrect/incomplete
      '034': 'RTO', // RTO - Recipient unreachable by phone
      '035': 'RTO', // RTO - Delivery location inaccessible
      '036': 'RTO', // RTO - Package held at customs
      '037': 'RTO', // RTO - COD amount not ready
      '038': 'RTO', // RTO - Shipment damaged
      '039': 'RTO', // RTO - Other RTO reason

      // System/Platform cancellation reasons (041-049)
      '041': 'OTHER', // System error
      '042': 'OTHER', // Fraud detected
      '043': 'OTHER', // Policy violation
      '044': 'OTHER', // Timeout - no driver assigned
      '045': 'OTHER', // Service unavailable in area
    };

    return reasonMapping[reasonId || ''] || 'OTHER';
  }

  /**
   * Get cancellation reason description for ONDC response
   */
  getCancellationReasonDescription(reasonId?: string): string {
    const reasonDescriptions: Record<string, string> = {
      // Buyer reasons
      '001': 'Price changed after order placed',
      '002': 'Order created by mistake',
      '003': 'Delivery time too long',
      '004': 'Changed mind',
      '005': 'Found better option',
      '006': 'Duplicate order',
      '007': 'Payment issue',
      '008': 'Delivery address incorrect',
      '009': 'Other buyer reason',

      // Driver reasons
      '011': 'Unable to pick up - location not found',
      '012': 'Unable to deliver - recipient not available',
      '013': 'Cannot complete delivery - vehicle breakdown',
      '014': 'Package damaged during transit',
      '015': 'Incorrect package details',
      '016': 'Pickup location closed',
      '017': 'Delivery location inaccessible',
      '018': 'Weather conditions',
      '019': 'Other agent reason',

      // Merchant reasons
      '021': 'Item out of stock',
      '022': 'Store closed',
      '023': 'Unable to prepare order',
      '024': 'Pricing error',
      '025': 'Other merchant reason',

      // RTO reasons
      '031': 'RTO - Recipient not available after multiple attempts',
      '032': 'RTO - Recipient refused delivery',
      '033': 'RTO - Address incorrect or incomplete',
      '034': 'RTO - Recipient unreachable by phone',
      '035': 'RTO - Delivery location inaccessible',
      '036': 'RTO - Package held at customs',
      '037': 'RTO - COD amount not ready',
      '038': 'RTO - Shipment damaged',
      '039': 'RTO - Other RTO reason',

      // System reasons
      '041': 'System error',
      '042': 'Fraud detected',
      '043': 'Policy violation',
      '044': 'Timeout - no driver assigned',
      '045': 'Service unavailable in area',
    };

    return reasonDescriptions[reasonId || ''] || 'Cancellation requested';
  }

  /**
   * Check if cancellation reason is RTO-related
   */
  isRtoCancellation(reasonId?: string): boolean {
    const rtoReasons = [
      '031',
      '032',
      '033',
      '034',
      '035',
      '036',
      '037',
      '038',
      '039',
    ];
    return rtoReasons.includes(reasonId || '');
  }

  /**
   * Map ONDC reason ID to Prisma CancellationReason enum
   * Includes all ONDC LOG10 cancellation and RTO reason codes
   */
  private mapToPrismaCancellationReason(reasonId?: string): CancellationReason {
    const mapping: Record<string, CancellationReason> = {
      // Buyer reasons
      '001': CancellationReason.CUSTOMER_REQUESTED,
      '002': CancellationReason.CUSTOMER_REQUESTED,
      '003': CancellationReason.CUSTOMER_REQUESTED,
      '004': CancellationReason.CUSTOMER_REQUESTED,
      '005': CancellationReason.CUSTOMER_REQUESTED,
      '006': CancellationReason.DUPLICATE_ORDER,
      '007': CancellationReason.PAYMENT_FAILED,
      '008': CancellationReason.CUSTOMER_REQUESTED,
      '009': CancellationReason.CUSTOMER_REQUESTED,

      // Driver reasons
      '011': CancellationReason.DRIVER_REQUESTED,
      '012': CancellationReason.CUSTOMER_NOT_REACHABLE,
      '013': CancellationReason.DRIVER_UNAVAILABLE,
      '014': CancellationReason.DRIVER_REQUESTED,
      '015': CancellationReason.DRIVER_REQUESTED,
      '016': CancellationReason.MERCHANT_UNAVAILABLE,
      '017': CancellationReason.DRIVER_REQUESTED,
      '018': CancellationReason.DRIVER_REQUESTED,
      '019': CancellationReason.DRIVER_REQUESTED,

      // Merchant reasons
      '021': CancellationReason.ITEMS_UNAVAILABLE,
      '022': CancellationReason.MERCHANT_UNAVAILABLE,
      '023': CancellationReason.MERCHANT_REQUESTED,
      '024': CancellationReason.MERCHANT_REQUESTED,
      '025': CancellationReason.MERCHANT_REQUESTED,

      // RTO (Return to Origin) reasons
      '031': CancellationReason.RTO_RECIPIENT_UNAVAILABLE,
      '032': CancellationReason.RTO_RECIPIENT_REFUSED,
      '033': CancellationReason.RTO_ADDRESS_INCORRECT,
      '034': CancellationReason.RTO_UNREACHABLE,
      '035': CancellationReason.RTO,
      '036': CancellationReason.RTO,
      '037': CancellationReason.RTO_COD_NOT_READY,
      '038': CancellationReason.RTO_SHIPMENT_DAMAGED,
      '039': CancellationReason.RTO,

      // System reasons
      '041': CancellationReason.SYSTEM_ERROR,
      '042': CancellationReason.SYSTEM_ERROR,
      '043': CancellationReason.SYSTEM_ERROR,
      '044': CancellationReason.DRIVER_UNAVAILABLE,
      '045': CancellationReason.SYSTEM_ERROR,
    };

    return mapping[reasonId || ''] || CancellationReason.OTHER;
  }

  /**
   * Determine who cancelled based on reason code
   */
  private determineCancelledBy(
    reasonId?: string,
    _bapId?: string,
  ): CancelledBy {
    if (!reasonId) return CancelledBy.CUSTOMER;

    const code = reasonId.substring(0, 2);

    switch (code) {
      case '00': // 001-009: Buyer reasons
        return CancelledBy.CUSTOMER;
      case '01': // 011-019: Driver reasons
        return CancelledBy.DRIVER;
      case '02': // 021-029: Merchant reasons
        return CancelledBy.MERCHANT;
      case '03': // 031-039: RTO reasons
        return CancelledBy.RTO;
      case '04': // 041-049: System reasons
        return CancelledBy.SYSTEM;
      default:
        return CancelledBy.CUSTOMER;
    }
  }

  /**
   * Calculate refund amount based on order state and cancellation reason
   * ONDC Logistics refund policy:
   * - Before pickup: Full refund minus cancellation fee (if applicable)
   * - After pickup, before delivery: Partial refund (deduct delivery charges incurred)
   * - RTO: Refund minus RTO charges
   */
  private calculateRefund(
    order: {
      status: OrderStatus;
      paymentStatus: string | null;
      totalAmount: unknown;
    },
    cancellationReasonId?: string,
  ): { refundRequired: boolean; refundAmount: number | null } {
    // No refund if payment not completed
    if (order.paymentStatus !== 'COMPLETED') {
      return { refundRequired: false, refundAmount: null };
    }

    const totalAmount =
      typeof order.totalAmount === 'object' && order.totalAmount !== null
        ? Number(order.totalAmount)
        : Number(order.totalAmount || 0);

    // If total is 0 or invalid, no refund needed
    if (!totalAmount || totalAmount <= 0) {
      return { refundRequired: false, refundAmount: null };
    }

    const isRto = this.isRtoCancellation(cancellationReasonId);

    // Calculate refund based on order state
    switch (order.status) {
      case OrderStatus.PENDING:
      case OrderStatus.ACCEPTED:
        // Before driver assignment - full refund
        return { refundRequired: true, refundAmount: totalAmount };

      case OrderStatus.ASSIGNED:
        // Driver assigned but not picked up - 90% refund (10% cancellation fee)
        return {
          refundRequired: true,
          refundAmount: Math.round(totalAmount * 0.9 * 100) / 100,
        };

      case OrderStatus.PICKED_UP:
        if (isRto) {
          // RTO scenario - 50% refund (RTO charges apply)
          return {
            refundRequired: true,
            refundAmount: Math.round(totalAmount * 0.5 * 100) / 100,
          };
        }
        // After pickup - 70% refund (partial delivery charge deducted)
        return {
          refundRequired: true,
          refundAmount: Math.round(totalAmount * 0.7 * 100) / 100,
        };

      case OrderStatus.IN_TRANSIT:
        if (isRto) {
          // RTO at delivery stage - 40% refund (higher RTO charges)
          return {
            refundRequired: true,
            refundAmount: Math.round(totalAmount * 0.4 * 100) / 100,
          };
        }
        // Late cancellation during transit - 50% refund
        return {
          refundRequired: true,
          refundAmount: Math.round(totalAmount * 0.5 * 100) / 100,
        };

      case OrderStatus.DELIVERED:
      case OrderStatus.CANCELLED:
        // Already delivered or cancelled - no refund
        return { refundRequired: false, refundAmount: null };

      default:
        // Default: Full refund for unknown states
        return { refundRequired: true, refundAmount: totalAmount };
    }
  }
}
