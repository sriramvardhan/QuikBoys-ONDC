import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '@prisma/client';
import { Order, OrderStatus, OndcFulfillmentState } from '@prisma/client';
import {
  INTERNAL_STATUS_TO_ONDC_STATE,
  ONDC_STATE_TO_INTERNAL_STATUS,
  OndcFulfillmentState as OndcState,
} from '../constants/fulfillment-states';
import {
  ConfirmOrder,
  ConfirmFulfillment,
  Billing,
  Payment,
  Address,
} from '../interfaces/beckn-message.interface';
import { Fulfillment } from '../interfaces/fulfillment.interface';
import { getErrorMessage } from '../types/ondc-error.interface';
import { HubLoadBalancingService } from '../../stubs/hub-load-balancing.stub.js';
import { AutoDispatchService } from '../../stubs/auto-dispatch.stub.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderCreatedEvent } from '../../common/events/domain-events.js';
import { randomInt } from 'crypto';

// Extended Address type with contact info (as stored in DB)
interface AddressWithContact extends Address {
  contact_phone?: string;
  contact_name?: string;
}

/**
 * OrderMappingService handles conversion between internal orders and ONDC format
 * Manages bidirectional state synchronization with intelligent hub selection
 */
@Injectable()
export class OrderMappingService {
  private readonly logger = new Logger(OrderMappingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hubLoadBalancing: HubLoadBalancingService,
    private readonly autoDispatch: AutoDispatchService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create internal order from ONDC confirm request
   */
  async createOrderFromOndc(
    confirmOrder: ConfirmOrder,
    transactionId: string,
    bapId: string,
    bapName?: string,
  ): Promise<Order> {
    const fulfillment = confirmOrder.fulfillments?.[0];

    // Extract pickup and delivery details
    const pickupLocation = fulfillment?.start?.location;
    const deliveryLocation = fulfillment?.end?.location;

    // Parse GPS coordinates
    const [pickupLat, pickupLng] = (pickupLocation?.gps || '0,0')
      .split(',')
      .map(Number);
    const [deliveryLat, deliveryLng] = (deliveryLocation?.gps || '0,0')
      .split(',')
      .map(Number);

    // Build pickup address
    const pickupAddress = {
      gps: pickupLocation?.gps,
      name: pickupLocation?.address?.name || '',
      building: pickupLocation?.address?.building || '',
      street: pickupLocation?.address?.street || '',
      locality: pickupLocation?.address?.locality || '',
      city: pickupLocation?.address?.city || '',
      state: pickupLocation?.address?.state || '',
      country: pickupLocation?.address?.country || 'India',
      area_code: pickupLocation?.address?.area_code || '',
      contact_name: fulfillment?.start?.person?.name || '',
      contact_phone: fulfillment?.start?.contact?.phone || '',
    };

    // Build delivery address
    const deliveryAddress = {
      gps: deliveryLocation?.gps,
      name: deliveryLocation?.address?.name || '',
      building: deliveryLocation?.address?.building || '',
      street: deliveryLocation?.address?.street || '',
      locality: deliveryLocation?.address?.locality || '',
      city: deliveryLocation?.address?.city || '',
      state: deliveryLocation?.address?.state || '',
      country: deliveryLocation?.address?.country || 'India',
      area_code: deliveryLocation?.address?.area_code || '',
      contact_name: fulfillment?.end?.person?.name || '',
      contact_phone: fulfillment?.end?.contact?.phone || '',
    };

    // Calculate delivery fee from quote
    const deliveryFee = parseFloat(confirmOrder.quote?.price?.value || '0');
    const tax = this.extractTaxFromQuote(confirmOrder.quote);

    // Generate OTP
    const otp = this.generateOtp();

    // Select optimal hub based on pickup location and load balancing
    let hubId: string | null = null;
    let hubSelectionReason: string | null = null;

    if (pickupLat && pickupLng) {
      try {
        const hubSelection = await this.hubLoadBalancing.selectHubForOrder(
          pickupLat,
          pickupLng,
          { excludeOverloaded: true, preferCapacity: true },
        );

        if (hubSelection) {
          hubId = hubSelection.selectedHub.hubId;
          hubSelectionReason = hubSelection.selectionReason;
          this.logger.log(
            `Selected hub ${hubSelection.selectedHub.hubCode} for ONDC order. ` +
            `Reason: ${hubSelectionReason}, Distance: ${hubSelection.distanceFromPickup.toFixed(2)}km`,
          );
        }
      } catch (error) {
        this.logger.warn(`Hub selection failed for ONDC order: ${getErrorMessage(error)}`);
        // Continue without hub assignment - order can still be processed
      }
    }

    // Create order in database
    const order = await this.prisma.order.create({
      data: {
        orderSource: 'ONDC',
        ondcOrderId: confirmOrder.id,
        transactionId: transactionId,
        bapId: bapId,
        bapName: bapName || bapId,
        merchantName: 'ONDC Order',
        merchantType: 'logistics',
        customerId: await this.getOrCreateCustomer(confirmOrder.billing),
        customerPhone: confirmOrder.billing?.phone || '',
        customerEmail: confirmOrder.billing?.email,
        customerName: confirmOrder.billing?.name,
        pickupAddress: pickupAddress as any,
        pickupLatitude: pickupLat,
        pickupLongitude: pickupLng,
        deliveryAddress: deliveryAddress as any,
        deliveryLatitude: deliveryLat,
        deliveryLongitude: deliveryLng,
        items: (confirmOrder.items || []) as any,
        subtotal: 0,
        deliveryFee: deliveryFee,
        tax: tax,
        discount: 0,
        totalAmount: deliveryFee,
        codAmount: this.isCOD(confirmOrder.payment) ? deliveryFee : null,
        status: OrderStatus.PENDING,
        paymentMethod: this.isCOD(confirmOrder.payment) ? 'COD' : 'PREPAID',
        paymentStatus: this.isCOD(confirmOrder.payment)
          ? 'PENDING'
          : 'COMPLETED',
        otp: otp,
        specialInstructions: this.extractInstructions(fulfillment),
        // Hub assignment for load balancing
        hubId: hubId,
        hubAssignedAt: hubId ? new Date() : null,
        hubSelectionReason: hubSelectionReason,
      },
    });

    this.logger.log(
      `Created internal order ${order.id} from ONDC order ${confirmOrder.id}` +
      (hubId ? ` (Hub: ${hubId})` : ''),
    );

    // Create ONDC fulfillment record
    await this.createOndcFulfillment(order.id, fulfillment);

    // Emit domain event
    this.eventEmitter.emit(
      OrderCreatedEvent.event,
      new OrderCreatedEvent(order.id, '', 'ONDC'),
    );

    // Auto-dispatch: broadcast to nearby drivers (fire-and-forget)
    this.autoDispatch.dispatchOrder(order.id).catch((error) => {
      this.logger.error(`Auto-dispatch failed for ONDC order ${order.id}: ${getErrorMessage(error)}`);
    });

    return order;
  }

  /**
   * Create ONDC fulfillment record
   */
  private async createOndcFulfillment(
    orderId: string,
    fulfillment?: ConfirmFulfillment,
  ): Promise<void> {
    try {
      await this.prisma.ondcFulfillment.create({
        data: {
          orderId,
          fulfillmentId: fulfillment?.id || `F-${orderId.slice(0, 8)}`,
          type: fulfillment?.type || 'Delivery',
          state: OndcFulfillmentState.Pending,
          stateCode: 'Pending',
          tracking: true,
          pickupGps: fulfillment?.start?.location?.gps,
          pickupAddress: fulfillment?.start?.location
            ?.address as any,
          pickupContactName: fulfillment?.start?.person?.name,
          pickupContactPhone: fulfillment?.start?.contact?.phone,
          deliveryGps: fulfillment?.end?.location?.gps,
          deliveryAddress: fulfillment?.end?.location
            ?.address as any,
          deliveryContactName: fulfillment?.end?.person?.name,
          deliveryContactPhone: fulfillment?.end?.contact?.phone,
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        `Failed to create ONDC fulfillment: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Update ONDC fulfillment state
   */
  async updateOndcFulfillmentState(
    orderId: string,
    newState: OndcFulfillmentState,
    changedBy?: string,
    notes?: string,
    locationGps?: string,
  ): Promise<void> {
    try {
      const fulfillment = await this.prisma.ondcFulfillment.findFirst({
        where: { orderId },
      });

      if (!fulfillment) {
        this.logger.warn(`ONDC fulfillment not found for order: ${orderId}`);
        return;
      }

      const previousState = fulfillment.state;

      // Update fulfillment state
      await this.prisma.ondcFulfillment.update({
        where: { id: fulfillment.id },
        data: {
          state: newState,
          stateCode: newState.replace('_', '-'),
          currentLocationGps: locationGps,
          locationUpdatedAt: locationGps ? new Date() : undefined,
        },
      });

      // Record state history
      await this.prisma.ondcFulfillmentHistory.create({
        data: {
          fulfillmentId: fulfillment.id,
          previousState: previousState,
          newState: newState,
          stateCode: newState.replace('_', '-'),
          changedBy,
          notes,
          locationGps,
        },
      });

      this.logger.debug(
        `Updated ONDC fulfillment state: ${previousState} -> ${newState}`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to update ONDC fulfillment state: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Get ONDC state from internal order status
   */
  getOndcStateFromInternal(internalStatus: OrderStatus): OndcState {
    return INTERNAL_STATUS_TO_ONDC_STATE[internalStatus] || OndcState.PENDING;
  }

  /**
   * Get internal status from ONDC state
   */
  getInternalStatusFromOndc(ondcState: OndcState): OrderStatus {
    const statusString = ONDC_STATE_TO_INTERNAL_STATUS[ondcState] || 'PENDING';
    return statusString as OrderStatus;
  }

  /**
   * Build fulfillment object for ONDC response
   */
  async buildFulfillmentResponse(orderId: string): Promise<Fulfillment | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        driver: true,
      },
    });

    if (!order) {
      return null;
    }

    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      return null;
    }

    const pickupAddress = order.pickupAddress as AddressWithContact | null;
    const deliveryAddress = order.deliveryAddress as AddressWithContact | null;

    return {
      id: fulfillment.fulfillmentId,
      type: fulfillment.type,
      state: {
        descriptor: {
          code: fulfillment.stateCode,
          name: fulfillment.state.replace('_', ' '),
        },
        updated_at: fulfillment.updatedAt.toISOString(),
      },
      tracking: fulfillment.tracking,
      start: {
        location: {
          gps:
            fulfillment.pickupGps ||
            `${(order.pickupLatitude ?? 0).toString()},${(order.pickupLongitude ?? 0).toString()}`,
          address: (pickupAddress || {}) as Address,
        },
        contact: {
          phone:
            fulfillment.pickupContactPhone ||
            pickupAddress?.contact_phone ||
            '',
        },
        person: {
          name:
            fulfillment.pickupContactName ||
            pickupAddress?.contact_name ||
            'Merchant',
        },
        time: order.actualPickupTime
          ? {
              timestamp: order.actualPickupTime.toISOString(),
            }
          : order.estimatedPickupTime
            ? {
                range: {
                  start: order.estimatedPickupTime.toISOString(),
                  end: new Date(
                    order.estimatedPickupTime.getTime() + 15 * 60000,
                  ).toISOString(),
                },
              }
            : undefined,
      },
      end: {
        location: {
          gps:
            fulfillment.deliveryGps ||
            `${(order.deliveryLatitude ?? 0).toString()},${(order.deliveryLongitude ?? 0).toString()}`,
          address: (deliveryAddress || {}) as Address,
        },
        contact: {
          phone:
            fulfillment.deliveryContactPhone ||
            deliveryAddress?.contact_phone ||
            order.customerPhone,
        },
        person: {
          name:
            fulfillment.deliveryContactName ||
            deliveryAddress?.contact_name ||
            order.customerName ||
            'Customer',
        },
        time: order.actualDeliveryTime
          ? {
              timestamp: order.actualDeliveryTime.toISOString(),
            }
          : order.estimatedDeliveryTime
            ? {
                range: {
                  start: order.estimatedDeliveryTime.toISOString(),
                  end: new Date(
                    order.estimatedDeliveryTime.getTime() + 15 * 60000,
                  ).toISOString(),
                },
              }
            : undefined,
      },
      agent: order.driver
        ? {
            name: order.driver.name,
            phone: order.driver.phone,
          }
        : undefined,
      vehicle: fulfillment.vehicleCategory
        ? {
            category: fulfillment.vehicleCategory,
            registration: fulfillment.vehicleRegistration || undefined,
          }
        : undefined,
      tags: [],
    };
  }

  /**
   * Get order by ONDC order ID
   */
  async getOrderByOndcId(ondcOrderId: string): Promise<Order | null> {
    return this.prisma.order.findUnique({
      where: { ondcOrderId },
      include: {
        driver: true,
      },
    });
  }

  /**
   * Get order by transaction ID
   */
  async getOrderByTransactionId(transactionId: string): Promise<Order | null> {
    return this.prisma.order.findFirst({
      where: { transactionId },
      include: {
        driver: true,
      },
    });
  }

  /**
   * Helper: Get or create customer from billing info
   */
  private async getOrCreateCustomer(billing?: Billing): Promise<string> {
    if (!billing?.phone) {
      throw new Error('Customer phone is required');
    }

    // Try to find existing user by phone
    let user = await this.prisma.user.findUnique({
      where: { phone: billing.phone },
    });

    if (!user) {
      // Create new customer user
      user = await this.prisma.user.create({
        data: {
          phone: billing.phone,
          name: billing.name || 'ONDC Customer',
          email: billing.email,
          role: 'CUSTOMER',
          isVerified: true,
        },
      });
    }

    return user.id;
  }

  /**
   * Helper: Extract tax from quote
   */
  private extractTaxFromQuote(quote?: {
    breakup?: Array<{
      '@ondc/org/title_type': string;
      price: { value: string };
    }>;
  }): number {
    const taxItem = quote?.breakup?.find(
      (item) => item['@ondc/org/title_type'] === 'tax',
    );
    return parseFloat(taxItem?.price?.value || '0');
  }

  /**
   * Helper: Check if payment is COD
   */
  private isCOD(payment?: Payment): boolean {
    return (
      payment?.type === 'ON-FULFILLMENT' || payment?.collected_by === 'BPP'
    );
  }

  /**
   * Helper: Extract delivery instructions
   */
  private extractInstructions(
    fulfillment?: ConfirmFulfillment,
  ): string | undefined {
    const instructions = fulfillment?.end?.instructions;
    return instructions?.short_desc || instructions?.name;
  }

  /**
   * Helper: Generate 6-digit OTP
   */
  private generateOtp(): string {
    return randomInt(100000, 999999).toString();
  }
}
