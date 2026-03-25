import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { UpdateRequest } from '../interfaces/beckn-request.interface';
import {
  OnUpdateMessage,
  OnUpdateOrder,
} from '../interfaces/catalog.interface';
import { CallbackService } from '../services/callback.service';
import { OrderMappingService } from '../services/order-mapping.service';
import { PrismaService } from '../../database/prisma.service.js';
import { OndcTransactionStatus } from '@prisma/client';
import { buildOndcError, OndcErrorCode } from '../constants/error-codes';
import { ConfigService } from '@nestjs/config';
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
 * UpdateProcessor handles ONDC update requests
 * Processes order updates (reschedule, address change, etc.)
 */
@Injectable()
export class UpdateProcessor {
  private readonly logger = new Logger(UpdateProcessor.name);
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
   * Process update request and send on_update callback
   */
  async process(request: UpdateRequest): Promise<void> {
    const { context, message } = request;
    const transactionId = context.transaction_id;

    try {
      this.logger.log(`Processing update request: ${transactionId}`);

      await this.callbackService.updateTransactionStatus(
        transactionId,
        OndcTransactionStatus.PROCESSING,
      );

      const updateOrder = message?.order;
      const updateTarget = message?.update_target;

      if (!updateOrder?.id) {
        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.INVALID_REQUEST_FORMAT,
            'order.id is required',
          ),
        );
        return;
      }

      // Find order
      let order = await this.orderMappingService.getOrderByOndcId(
        updateOrder.id,
      );
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
            `Order ${updateOrder.id} not found`,
          ),
        );
        return;
      }

      // Process update based on target
      let updateApplied = false;
      let updateDescription = '';
      let weightDifferentialCharge = 0;

      switch (updateTarget) {
        case 'fulfillment':
          updateApplied = await this.processFulfillmentUpdate(
            order.id,
            updateOrder.fulfillments,
          );
          updateDescription = 'Fulfillment updated';
          break;

        case 'items':
          updateApplied = await this.processItemsUpdate(
            order.id,
            updateOrder.items,
          );
          updateDescription = 'Items updated';
          break;

        case 'address':
          // Update delivery address
          updateApplied = await this.processAddressUpdate(
            order.id,
            updateOrder.fulfillments,
          );
          updateDescription = 'Delivery address updated';
          break;

        case 'weight': {
          // Update package weight and recalculate charges
          const weightResult = await this.processWeightUpdate(
            order.id,
            updateOrder.fulfillments,
          );
          updateApplied = weightResult.applied;
          weightDifferentialCharge = weightResult.differentialCharge;
          updateDescription =
            weightResult.differentialCharge > 0
              ? `Weight updated. Additional charge: ₹${weightResult.differentialCharge}`
              : 'Weight updated';
          break;
        }

        case 'dimensions':
          // Update package dimensions
          updateApplied = await this.processDimensionsUpdate(
            order.id,
            updateOrder.fulfillments,
          );
          updateDescription = 'Package dimensions updated';
          break;

        case 'reschedule':
          // Reschedule delivery time
          updateApplied = await this.processRescheduleUpdate(
            order.id,
            updateOrder.fulfillments,
          );
          updateDescription = 'Delivery rescheduled';
          break;

        case 'payment':
          // Update payment status
          updateApplied = await this.processPaymentUpdate(
            order.id,
            updateOrder.payment,
          );
          updateDescription = 'Payment status updated';
          break;

        default:
          this.logger.warn(`Unknown update target: ${updateTarget}`);
          updateDescription = `Update target ${updateTarget} not supported`;
      }

      // Get updated fulfillment
      const fulfillment =
        await this.orderMappingService.buildFulfillmentResponse(order.id);

      // Reload order for latest data
      order = await this.prisma.order.findUnique({
        where: { id: order.id },
        include: { driver: true },
      });

      if (!order) {
        await this.callbackService.sendCallback(
          context,
          null,
          buildOndcError(
            OndcErrorCode.ORDER_NOT_FOUND,
            'Order not found after update',
          ),
        );
        return;
      }

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
        items:
          (order.items as OrderItem[])?.map((item) => ({
            category_id: item.category_id || 'Standard Delivery',
            descriptor: item.descriptor || { name: 'Package' },
            quantity: item.quantity || { count: 1 },
            price: {
              currency: 'INR',
              value: Number(order.totalAmount).toFixed(2),
            },
          })) || [
            {
              category_id: 'Standard Delivery',
              descriptor: { name: 'Package' },
              quantity: { count: 1 },
              price: {
                currency: 'INR',
                value: Number(order.totalAmount).toFixed(2),
              },
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

      // Build on_update order with all required ONDC Pramaan fields
      const onUpdateOrder: OnUpdateOrder = {
        id: order.ondcOrderId || order.id,
        state: this.mapOrderState(order.status),
        provider: {
          id: this.providerId,
        },
        items:
          (order.items as OrderItem[])?.map((item) => ({
            id: item.id || 'STANDARD-BIKE',
            category_id: item.category_id || 'Standard Delivery', // Required by ONDC Pramaan
            descriptor: item.descriptor || { name: 'Standard Delivery' },
            fulfillment_ids: [fulfillment?.id || 'F-BIKE'],
          })) || [],
        fulfillments: fulfillment ? [fulfillment] : undefined,
        quote: {
          price: {
            currency: 'INR',
            value: (
              Number(order.totalAmount) + weightDifferentialCharge
            ).toFixed(2),
          },
          breakup: [
            {
              '@ondc/org/item_id': 'STANDARD-BIKE',
              '@ondc/org/title_type': 'delivery',
              title: 'Delivery Charge',
              price: {
                currency: 'INR',
                value: Number(order.deliveryFee).toFixed(2),
              },
            },
            {
              '@ondc/org/item_id': 'STANDARD-BIKE',
              '@ondc/org/title_type': 'tax',
              title: 'Tax',
              price: {
                currency: 'INR',
                value: Number(order.tax).toFixed(2),
              },
            },
            ...(weightDifferentialCharge > 0
              ? [
                  {
                    '@ondc/org/item_id': 'STANDARD-BIKE',
                    '@ondc/org/title_type': 'misc',
                    title: 'Weight Differential Charge',
                    price: {
                      currency: 'INR',
                      value: weightDifferentialCharge.toFixed(2),
                    },
                  },
                ]
              : []),
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
        updated_at: new Date().toISOString(),
        tags: [
          {
            code: 'update_info',
            list: [
              { code: 'target', value: updateTarget },
              { code: 'status', value: updateApplied ? 'applied' : 'pending' },
              { code: 'description', value: updateDescription },
            ],
          },
        ],
      };

      // Build on_update message
      const onUpdateMessage: OnUpdateMessage = {
        order: onUpdateOrder,
      };

      // Send callback
      const sent = await this.callbackService.sendCallback(
        context,
        onUpdateMessage,
      );

      if (sent) {
        this.logger.log(
          `on_update callback sent successfully: ${transactionId}`,
        );

        await this.callbackService.updateTransactionStatus(
          transactionId,
          OndcTransactionStatus.COMPLETED,
          order.id,
        );
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Update processing error: ${errorMessage}`);

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
   * Process fulfillment update
   */
  private async processFulfillmentUpdate(
    orderId: string,
    fulfillments?: Array<{
      id: string;
      type?: string;
      state?: { descriptor: { code: string } };
    }>,
  ): Promise<boolean> {
    if (!fulfillments?.length) {
      return false;
    }

    const fulfillment = fulfillments[0];

    // Update fulfillment state if provided
    if (fulfillment.state?.descriptor?.code) {
      await this.prisma.ondcFulfillment.updateMany({
        where: { orderId },
        data: {
          stateCode: fulfillment.state.descriptor.code,
        },
      });

      this.logger.debug(`Updated fulfillment state for order ${orderId}`);
      return true;
    }

    return false;
  }

  /**
   * Process items update
   */
  private async processItemsUpdate(
    orderId: string,
    items?: Array<{ id: string; quantity?: { count: number } }>,
  ): Promise<boolean> {
    if (!items?.length) {
      return false;
    }

    // Update order items
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return false;
    }

    // Merge item updates
    const currentItems = (order.items as OrderItem[]) || [];
    const updatedItems = currentItems.map((item) => {
      const update = items.find((i) => i.id === item.id);
      if (update?.quantity) {
        return { ...item, quantity: update.quantity };
      }
      return item;
    });

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        items: updatedItems as any,
      },
    });

    this.logger.debug(`Updated items for order ${orderId}`);
    return true;
  }

  /**
   * Map internal status to ONDC order state
   */
  private mapOrderState(status: string): string {
    const stateMapping: Record<string, string> = {
      PENDING: 'Accepted',
      PENDING_ACCEPTANCE: 'Accepted',
      ACCEPTED: 'In-progress',
      ASSIGNED: 'In-progress',
      BROADCASTING: 'In-progress',
      PICKED_UP: 'In-progress',
      IN_TRANSIT: 'In-progress',
      DELIVERED: 'Completed',
      CANCELLED: 'Cancelled',
    };

    return stateMapping[status] || 'In-progress';
  }

  /**
   * Process address update for delivery location
   */
  private async processAddressUpdate(
    orderId: string,
    fulfillments?: Array<{
      id: string;
      end?: {
        location?: {
          gps?: string;
          address?: {
            name?: string;
            building?: string;
            street?: string;
            locality?: string;
            city?: string;
            state?: string;
            country?: string;
            area_code?: string;
          };
        };
      };
    }>,
  ): Promise<boolean> {
    if (!fulfillments?.length) {
      return false;
    }

    const fulfillment = fulfillments[0];
    const newAddress = fulfillment.end?.location?.address;
    const newGps = fulfillment.end?.location?.gps;

    if (!newAddress && !newGps) {
      return false;
    }

    // Update ONDC fulfillment with new address using correct field names
    const fulfillmentUpdateData: Prisma.OndcFulfillmentUpdateManyMutationInput =
      {};

    if (newGps) {
      fulfillmentUpdateData.deliveryGps = newGps;
    }

    if (newAddress) {
      fulfillmentUpdateData.deliveryAddress =
        newAddress as any;
    }

    if (Object.keys(fulfillmentUpdateData).length > 0) {
      await this.prisma.ondcFulfillment.updateMany({
        where: { orderId },
        data: fulfillmentUpdateData,
      });
    }

    // Also update the main order delivery address
    const orderUpdateData: Prisma.OrderUpdateInput = {};

    if (newGps) {
      const [lat, lng] = newGps.split(',').map(Number);
      orderUpdateData.deliveryLatitude = lat;
      orderUpdateData.deliveryLongitude = lng;
    }

    if (newAddress) {
      orderUpdateData.deliveryAddress = newAddress as any;
    }

    if (Object.keys(orderUpdateData).length > 0) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: orderUpdateData,
      });
    }

    this.logger.debug(`Updated address for order ${orderId}`);
    return true;
  }

  /**
   * Process weight update and calculate differential charges
   */
  private async processWeightUpdate(
    orderId: string,
    fulfillments?: Array<{
      id: string;
      tags?: Array<{
        code: string;
        list: Array<{ code: string; value: string }>;
      }>;
    }>,
  ): Promise<{ applied: boolean; differentialCharge: number }> {
    if (!fulfillments?.length) {
      return { applied: false, differentialCharge: 0 };
    }

    const fulfillment = fulfillments[0];
    const weightTag = fulfillment.tags?.find(
      (t) => t.code === 'package_weight',
    );

    if (!weightTag) {
      return { applied: false, differentialCharge: 0 };
    }

    const weightValue = weightTag.list?.find((l) => l.code === 'weight')?.value;
    const weightUnit =
      weightTag.list?.find((l) => l.code === 'unit')?.value || 'kilogram';

    if (!weightValue) {
      return { applied: false, differentialCharge: 0 };
    }

    const newWeightKg =
      weightUnit === 'gram'
        ? parseFloat(weightValue) / 1000
        : parseFloat(weightValue);

    // Get current order to compare weights (stored in items JSON)
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { items: true, totalAmount: true },
    });

    // Parse current weight from items if available
    const items = order?.items as { weight?: number } | null;
    const currentWeight = items?.weight || 0;

    // Calculate weight differential charge (₹5 per additional kg)
    const weightDifference = Math.max(0, newWeightKg - currentWeight);
    const perKgRate = this.configService.get<number>(
      'ondc.pricing.perKgRate',
      5,
    );
    const differentialCharge =
      Math.round(weightDifference * perKgRate * 100) / 100;

    // Update order items with new weight and adjust total if needed
    const updatedItems = {
      ...(items || {}),
      weight: newWeightKg,
      weightUnit: 'kg',
    };

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        items: updatedItems as any,
        ...(differentialCharge > 0 && {
          totalAmount: {
            increment: differentialCharge,
          },
        }),
      },
    });

    this.logger.debug(
      `Updated weight for order ${orderId}: ${newWeightKg}kg, differential: ₹${differentialCharge}`,
    );
    return { applied: true, differentialCharge };
  }

  /**
   * Process dimensions update
   */
  private async processDimensionsUpdate(
    orderId: string,
    fulfillments?: Array<{
      id: string;
      tags?: Array<{
        code: string;
        list: Array<{ code: string; value: string }>;
      }>;
    }>,
  ): Promise<boolean> {
    if (!fulfillments?.length) {
      return false;
    }

    const fulfillment = fulfillments[0];
    const dimensionsTag = fulfillment.tags?.find(
      (t) => t.code === 'package_dimensions',
    );

    if (!dimensionsTag) {
      return false;
    }

    const length = dimensionsTag.list?.find((l) => l.code === 'length')?.value;
    const breadth = dimensionsTag.list?.find(
      (l) => l.code === 'breadth',
    )?.value;
    const height = dimensionsTag.list?.find((l) => l.code === 'height')?.value;

    if (!length && !breadth && !height) {
      return false;
    }

    // Get current order to update dimensions in items JSON
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { items: true },
    });

    const items = order?.items as Record<string, unknown> | null;

    // Update order items with new dimensions
    const updatedItems = {
      ...(items || {}),
      dimensions: {
        length: length ? parseFloat(length) : undefined,
        breadth: breadth ? parseFloat(breadth) : undefined,
        height: height ? parseFloat(height) : undefined,
        unit: 'cm',
      },
    };

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        items: updatedItems as any,
      },
    });

    this.logger.debug(
      `Updated dimensions for order ${orderId}: L=${length}, B=${breadth}, H=${height}`,
    );
    return true;
  }

  /**
   * Process reschedule update for delivery time
   */
  private async processRescheduleUpdate(
    orderId: string,
    fulfillments?: Array<{
      id: string;
      end?: {
        time?: {
          range?: {
            start?: string;
            end?: string;
          };
        };
      };
    }>,
  ): Promise<boolean> {
    if (!fulfillments?.length) {
      return false;
    }

    const fulfillment = fulfillments[0];
    const timeRange = fulfillment.end?.time?.range;

    if (!timeRange?.start && !timeRange?.end) {
      return false;
    }

    // Update fulfillment delivery time
    if (timeRange.end) {
      await this.prisma.ondcFulfillment.updateMany({
        where: { orderId },
        data: {
          deliveryTime: new Date(timeRange.end),
        },
      });
    }

    // Also update order estimated delivery time
    const orderUpdateData: Prisma.OrderUpdateInput = {};

    if (timeRange.end) {
      orderUpdateData.estimatedDeliveryTime = new Date(timeRange.end);
    }

    if (Object.keys(orderUpdateData).length > 0) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: orderUpdateData,
      });
    }

    this.logger.debug(`Rescheduled delivery for order ${orderId}`);
    return true;
  }

  /**
   * Process payment status update
   */
  private async processPaymentUpdate(
    orderId: string,
    payment?: {
      status?: string;
      type?: string;
      collected_by?: string;
      '@ondc/org/settlement_details'?: Array<{
        settlement_counterparty?: string;
        settlement_phase?: string;
        settlement_amount?: string;
        settlement_type?: string;
        settlement_bank_account_no?: string;
        settlement_ifsc_code?: string;
        bank_name?: string;
        branch_name?: string;
      }>;
    },
  ): Promise<boolean> {
    if (!payment) {
      return false;
    }

    // Update order payment status
    const updateData: Record<string, unknown> = {};

    if (payment.status) {
      updateData.paymentStatus =
        payment.status === 'PAID' ? 'COMPLETED' : payment.status;
    }

    if (payment.type) {
      updateData.paymentMethod = payment.type;
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: updateData as Prisma.OrderUpdateInput,
      });
    }

    // Log settlement details if provided (stored in ONDC transaction for audit)
    const settlementDetails = payment['@ondc/org/settlement_details'];
    if (settlementDetails?.length) {
      this.logger.debug(
        `Settlement details received for order ${orderId}: ${JSON.stringify(settlementDetails)}`,
      );

      // Store settlement details in ONDC transaction for future reference
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { transactionId: true },
      });

      if (order?.transactionId) {
        await this.prisma.ondcTransaction
          .update({
            where: { transactionId: order.transactionId },
            data: {
              responsePayload: {
                settlementDetails: settlementDetails,
              } as any,
            },
          })
          .catch((err: unknown) => {
            this.logger.warn(
              `Failed to store settlement details: ${err instanceof Error ? err.message : 'Unknown error'}`,
            );
          });
      }
    }

    this.logger.debug(`Updated payment status for order ${orderId}`);
    return true;
  }
}
