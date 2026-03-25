// ============================================
// RTO (Return to Origin) Service
// File: src/ondc/services/rto.service.ts
// ONDC Logistics - Return to Origin flow handling
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { OndcFulfillmentState, OrderStatus } from '@prisma/client';

/**
 * RTO Reason codes per ONDC spec
 */
export enum RTOReasonCode {
  // Delivery failure reasons
  RECIPIENT_NOT_AVAILABLE = 'RTO001',
  RECIPIENT_REFUSED = 'RTO002',
  WRONG_ADDRESS = 'RTO003',
  INCOMPLETE_ADDRESS = 'RTO004',
  ADDRESS_NOT_FOUND = 'RTO005',
  RESTRICTED_AREA = 'RTO006',

  // Package issues
  PACKAGE_DAMAGED = 'RTO011',
  PACKAGE_LOST = 'RTO012',
  PACKAGE_TAMPERED = 'RTO013',

  // Payment issues (COD)
  COD_NOT_READY = 'RTO021',
  COD_AMOUNT_MISMATCH = 'RTO022',

  // Buyer request
  BUYER_CANCELLED = 'RTO031',
  BUYER_RESCHEDULED_EXPIRED = 'RTO032',

  // System/Operational
  MAX_DELIVERY_ATTEMPTS = 'RTO041',
  SLA_BREACH = 'RTO042',
  OPERATIONAL_ISSUE = 'RTO043',
}

/**
 * RTO Status states per ONDC
 */
export type RTOStatus =
  | 'RTO-Initiated'
  | 'RTO-Approved'
  | 'RTO-In-transit'
  | 'RTO-At-origin'
  | 'RTO-Delivered'
  | 'RTO-Disposed'
  | 'RTO-Cancelled';

/**
 * RTO Details structure
 */
export interface RTODetails {
  rtoId: string;
  orderId: string;
  fulfillmentId: string;
  originalAwbNumber?: string;
  rtoAwbNumber?: string;
  reasonCode: RTOReasonCode;
  reasonDescription: string;
  status: RTOStatus;
  initiatedAt: Date;
  initiatedBy: 'LSP' | 'BUYER' | 'SELLER';
  deliveryAttempts: number;

  // Location details
  pickupLocation: {
    gps?: string;
    address?: string;
  };
  originLocation: {
    gps?: string;
    address?: string;
  };

  // Timeline
  timeline: Array<{
    status: RTOStatus;
    timestamp: Date;
    location?: string;
    remarks?: string;
    updatedBy: string;
  }>;

  // Charges
  rtoCharges: {
    shippingCharge: number;
    returnCharge: number;
    handlingCharge: number;
    totalCharge: number;
  };

  // Completion details
  completedAt?: Date;
  receivedBy?: string;
  receivedAtLocation?: string;
  proofOfDelivery?: string;
}

/**
 * RTO Initiation request
 */
export interface RTOInitiationRequest {
  orderId: string;
  fulfillmentId: string;
  reasonCode: RTOReasonCode;
  reasonDescription?: string;
  initiatedBy: 'LSP' | 'BUYER' | 'SELLER';
  deliveryAttempts?: number;
  currentLocation?: {
    gps?: string;
    address?: string;
  };
}

/**
 * RTO Update request
 */
export interface RTOUpdateRequest {
  orderId: string;
  status: RTOStatus;
  location?: string;
  remarks?: string;
  updatedBy: string;
}

/**
 * RTOService - Manages Return to Origin flow for ONDC Logistics
 *
 * ONDC Requirement: LSPs must handle RTO scenarios when delivery
 * fails, tracking the return journey and updating status per spec.
 */
@Injectable()
export class RTOService {
  private readonly logger = new Logger(RTOService.name);
  private readonly maxDeliveryAttempts: number;
  private readonly rtoChargePercentage: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.maxDeliveryAttempts = this.configService.get<number>(
      'MAX_DELIVERY_ATTEMPTS',
      3,
    );
    this.rtoChargePercentage = this.configService.get<number>(
      'RTO_CHARGE_PERCENTAGE',
      50,
    );
  }

  /**
   * Initiate RTO for an order
   */
  async initiateRTO(request: RTOInitiationRequest): Promise<RTODetails> {
    const {
      orderId,
      fulfillmentId,
      reasonCode,
      reasonDescription,
      initiatedBy,
      deliveryAttempts = 1,
      currentLocation,
    } = request;

    // Get order and fulfillment details
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      throw new Error(`Fulfillment not found for order: ${orderId}`);
    }

    // Generate RTO ID
    const rtoId = this.generateRTOId(orderId);

    // Get AWB number if exists
    const pickupAddress =
      (fulfillment.pickupAddress as Record<string, unknown>) || {};
    const awbData = pickupAddress._awbData as
      | { awbNumber?: string }
      | undefined;
    const originalAwbNumber = awbData?.awbNumber;

    // Generate RTO AWB number
    const rtoAwbNumber = originalAwbNumber
      ? `RTO-${originalAwbNumber}`
      : `RTO-${orderId.slice(0, 8)}`;

    // Calculate RTO charges
    const orderAmount = Number(order.totalAmount);
    const rtoCharges = this.calculateRTOCharges(orderAmount);

    // Get origin location from fulfillment
    const originLocation = {
      gps: (pickupAddress.gps as string) || '',
      address: this.formatAddress(pickupAddress),
    };

    const rtoDetails: RTODetails = {
      rtoId,
      orderId,
      fulfillmentId,
      originalAwbNumber,
      rtoAwbNumber,
      reasonCode,
      reasonDescription:
        reasonDescription || this.getReasonDescription(reasonCode),
      status: 'RTO-Initiated',
      initiatedAt: new Date(),
      initiatedBy,
      deliveryAttempts,
      pickupLocation: currentLocation || { gps: '', address: '' },
      originLocation,
      timeline: [
        {
          status: 'RTO-Initiated',
          timestamp: new Date(),
          location: currentLocation?.address,
          remarks: `RTO initiated due to: ${this.getReasonDescription(reasonCode)}`,
          updatedBy: initiatedBy,
        },
      ],
      rtoCharges,
    };

    // Store RTO details
    await this.storeRTODetails(orderId, rtoDetails);

    // Update fulfillment state
    await this.prisma.ondcFulfillment.update({
      where: { id: fulfillment.id },
      data: {
        state: OndcFulfillmentState.RTO_Initiated,
        stateCode: 'RTO-Initiated',
      },
    });

    // Update order status to CANCELLED (closest available status for RTO)
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
      },
    });

    this.logger.log(
      `RTO initiated: ${rtoId} for order ${orderId}, Reason: ${reasonCode}`,
    );

    return rtoDetails;
  }

  /**
   * Update RTO status
   */
  async updateRTOStatus(request: RTOUpdateRequest): Promise<RTODetails> {
    const { orderId, status, location, remarks, updatedBy } = request;

    const rtoDetails = await this.getRTOByOrderId(orderId);

    if (!rtoDetails) {
      throw new Error(`RTO not found for order: ${orderId}`);
    }

    // Validate status transition
    if (!this.isValidStatusTransition(rtoDetails.status, status)) {
      throw new Error(
        `Invalid status transition from ${rtoDetails.status} to ${status}`,
      );
    }

    // Add to timeline
    rtoDetails.timeline.push({
      status,
      timestamp: new Date(),
      location,
      remarks,
      updatedBy,
    });

    // Update status
    rtoDetails.status = status;

    // Handle completion
    if (status === 'RTO-Delivered') {
      rtoDetails.completedAt = new Date();
      rtoDetails.receivedAtLocation = location;
    }

    // Store updated details
    await this.storeRTODetails(orderId, rtoDetails);

    // Update fulfillment status
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (fulfillment) {
      const fulfillmentState = this.mapRTOToFulfillmentState(status);
      await this.prisma.ondcFulfillment.update({
        where: { id: fulfillment.id },
        data: {
          state: fulfillmentState,
          stateCode: status,
        },
      });
    }

    // Update order status based on RTO status
    const orderStatus = this.mapRTOToOrderStatus(status);
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: orderStatus,
      },
    });

    this.logger.log(`RTO status updated: ${orderId} -> ${status}`);

    return rtoDetails;
  }

  /**
   * Complete RTO delivery (package returned to origin)
   */
  async completeRTO(
    orderId: string,
    receivedBy: string,
    proofOfDelivery?: string,
  ): Promise<RTODetails> {
    const rtoDetails = await this.getRTOByOrderId(orderId);

    if (!rtoDetails) {
      throw new Error(`RTO not found for order: ${orderId}`);
    }

    if (rtoDetails.status !== 'RTO-At-origin') {
      throw new Error(
        `Cannot complete RTO - current status: ${rtoDetails.status}`,
      );
    }

    rtoDetails.status = 'RTO-Delivered';
    rtoDetails.completedAt = new Date();
    rtoDetails.receivedBy = receivedBy;
    rtoDetails.proofOfDelivery = proofOfDelivery;

    rtoDetails.timeline.push({
      status: 'RTO-Delivered',
      timestamp: new Date(),
      location: rtoDetails.originLocation.address,
      remarks: `Package received by ${receivedBy}`,
      updatedBy: 'SYSTEM',
    });

    await this.storeRTODetails(orderId, rtoDetails);

    // Update fulfillment state
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });
    if (fulfillment) {
      await this.prisma.ondcFulfillment.update({
        where: { id: fulfillment.id },
        data: {
          state: OndcFulfillmentState.RTO_Delivered,
          stateCode: 'RTO-Delivered',
        },
      });
    }

    // Update order status to CANCELLED (closest available status)
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
      },
    });

    this.logger.log(`RTO completed for order ${orderId}`);

    return rtoDetails;
  }

  /**
   * Dispose RTO package (unclaimed/damaged)
   */
  async disposeRTO(
    orderId: string,
    reason: string,
    disposedBy: string,
  ): Promise<RTODetails> {
    const rtoDetails = await this.getRTOByOrderId(orderId);

    if (!rtoDetails) {
      throw new Error(`RTO not found for order: ${orderId}`);
    }

    rtoDetails.status = 'RTO-Disposed';
    rtoDetails.completedAt = new Date();

    rtoDetails.timeline.push({
      status: 'RTO-Disposed',
      timestamp: new Date(),
      remarks: `Package disposed: ${reason}. Disposed by: ${disposedBy}`,
      updatedBy: disposedBy,
    });

    await this.storeRTODetails(orderId, rtoDetails);

    this.logger.log(`RTO disposed for order ${orderId}: ${reason}`);

    return rtoDetails;
  }

  /**
   * Cancel RTO (e.g., rescheduled delivery)
   */
  async cancelRTO(
    orderId: string,
    reason: string,
    cancelledBy: string,
  ): Promise<RTODetails> {
    const rtoDetails = await this.getRTOByOrderId(orderId);

    if (!rtoDetails) {
      throw new Error(`RTO not found for order: ${orderId}`);
    }

    // Can only cancel before RTO-In-transit
    if (!['RTO-Initiated', 'RTO-Approved'].includes(rtoDetails.status)) {
      throw new Error(`Cannot cancel RTO in status: ${rtoDetails.status}`);
    }

    rtoDetails.status = 'RTO-Cancelled';

    rtoDetails.timeline.push({
      status: 'RTO-Cancelled',
      timestamp: new Date(),
      remarks: `RTO cancelled: ${reason}. Cancelled by: ${cancelledBy}`,
      updatedBy: cancelledBy,
    });

    await this.storeRTODetails(orderId, rtoDetails);

    // Revert fulfillment state and order status
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });
    if (fulfillment) {
      await this.prisma.ondcFulfillment.update({
        where: { id: fulfillment.id },
        data: {
          state: OndcFulfillmentState.In_transit,
          stateCode: 'In-transit',
        },
      });
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.IN_TRANSIT,
      },
    });

    this.logger.log(`RTO cancelled for order ${orderId}: ${reason}`);

    return rtoDetails;
  }

  /**
   * Get RTO details by order ID
   */
  async getRTOByOrderId(orderId: string): Promise<RTODetails | null> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      return null;
    }

    const pickupAddress = fulfillment.pickupAddress as Record<
      string,
      unknown
    > | null;
    const rtoData = pickupAddress?._rtoData as RTODetails | undefined;

    if (!rtoData?.rtoId) {
      return null;
    }

    // Parse dates from stored strings
    return {
      ...rtoData,
      initiatedAt: new Date(rtoData.initiatedAt),
      completedAt: rtoData.completedAt
        ? new Date(rtoData.completedAt)
        : undefined,
      timeline: rtoData.timeline.map((t) => ({
        ...t,
        timestamp: new Date(t.timestamp),
      })),
    };
  }

  /**
   * Check if order requires RTO
   */
  async checkRTORequired(
    orderId: string,
    deliveryAttempts: number,
  ): Promise<{ required: boolean; reason?: RTOReasonCode }> {
    if (deliveryAttempts >= this.maxDeliveryAttempts) {
      return {
        required: true,
        reason: RTOReasonCode.MAX_DELIVERY_ATTEMPTS,
      };
    }

    return { required: false };
  }

  /**
   * Calculate RTO charges
   */
  calculateRTOCharges(orderAmount: number): RTODetails['rtoCharges'] {
    const shippingCharge = (orderAmount * this.rtoChargePercentage) / 100;
    const returnCharge = shippingCharge * 0.8; // 80% of shipping for return
    const handlingCharge = 50; // Fixed handling charge

    return {
      shippingCharge: Math.round(shippingCharge * 100) / 100,
      returnCharge: Math.round(returnCharge * 100) / 100,
      handlingCharge,
      totalCharge:
        Math.round((shippingCharge + returnCharge + handlingCharge) * 100) /
        100,
    };
  }

  /**
   * Get RTO statistics for reporting
   */
  async getRTOStatistics(
    startDate: Date,
    endDate: Date,
  ): Promise<{
    totalRTOs: number;
    completedRTOs: number;
    pendingRTOs: number;
    disposedRTOs: number;
    cancelledRTOs: number;
    rtoPercentage: number;
    topReasons: Array<{ reason: string; count: number }>;
  }> {
    // Get all fulfillments in date range
    const fulfillments = await this.prisma.ondcFulfillment.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const rtoData: RTODetails[] = [];
    for (const f of fulfillments) {
      const pickup = f.pickupAddress as Record<string, unknown> | null;
      const rto = pickup?._rtoData as RTODetails | undefined;
      if (rto?.rtoId) {
        rtoData.push(rto);
      }
    }

    const totalRTOs = rtoData.length;
    const completedRTOs = rtoData.filter(
      (r) => r.status === 'RTO-Delivered',
    ).length;
    const pendingRTOs = rtoData.filter((r) =>
      [
        'RTO-Initiated',
        'RTO-Approved',
        'RTO-In-transit',
        'RTO-At-origin',
      ].includes(r.status),
    ).length;
    const disposedRTOs = rtoData.filter(
      (r) => r.status === 'RTO-Disposed',
    ).length;
    const cancelledRTOs = rtoData.filter(
      (r) => r.status === 'RTO-Cancelled',
    ).length;

    // Calculate top reasons
    const reasonCounts = new Map<string, number>();
    for (const rto of rtoData) {
      const count = reasonCounts.get(rto.reasonCode) || 0;
      reasonCounts.set(rto.reasonCode, count + 1);
    }

    const topReasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Calculate RTO percentage (RTOs / total orders)
    const totalOrders = await this.prisma.order.count({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const rtoPercentage = totalOrders > 0 ? (totalRTOs / totalOrders) * 100 : 0;

    return {
      totalRTOs,
      completedRTOs,
      pendingRTOs,
      disposedRTOs,
      cancelledRTOs,
      rtoPercentage: Math.round(rtoPercentage * 100) / 100,
      topReasons,
    };
  }

  /**
   * Generate unique RTO ID
   */
  private generateRTOId(orderId: string): string {
    const timestamp = Date.now().toString(36);
    return `RTO-${orderId.slice(0, 8)}-${timestamp}`.toUpperCase();
  }

  /**
   * Get reason description for code
   */
  private getReasonDescription(code: RTOReasonCode): string {
    const descriptions: Record<RTOReasonCode, string> = {
      [RTOReasonCode.RECIPIENT_NOT_AVAILABLE]:
        'Recipient was not available at delivery location',
      [RTOReasonCode.RECIPIENT_REFUSED]:
        'Recipient refused to accept the delivery',
      [RTOReasonCode.WRONG_ADDRESS]: 'Delivery address was incorrect',
      [RTOReasonCode.INCOMPLETE_ADDRESS]:
        'Delivery address was incomplete or unclear',
      [RTOReasonCode.ADDRESS_NOT_FOUND]:
        'Delivery address could not be located',
      [RTOReasonCode.RESTRICTED_AREA]:
        'Delivery location is in a restricted area',
      [RTOReasonCode.PACKAGE_DAMAGED]: 'Package was damaged during transit',
      [RTOReasonCode.PACKAGE_LOST]: 'Package was lost during transit',
      [RTOReasonCode.PACKAGE_TAMPERED]: 'Package showed signs of tampering',
      [RTOReasonCode.COD_NOT_READY]: 'Customer did not have COD amount ready',
      [RTOReasonCode.COD_AMOUNT_MISMATCH]: 'COD amount dispute',
      [RTOReasonCode.BUYER_CANCELLED]:
        'Buyer cancelled the order after dispatch',
      [RTOReasonCode.BUYER_RESCHEDULED_EXPIRED]:
        'Rescheduled delivery window expired',
      [RTOReasonCode.MAX_DELIVERY_ATTEMPTS]:
        'Maximum delivery attempts exceeded',
      [RTOReasonCode.SLA_BREACH]: 'Delivery SLA breached',
      [RTOReasonCode.OPERATIONAL_ISSUE]: 'Operational issue prevented delivery',
    };

    return descriptions[code] || 'Return to origin initiated';
  }

  /**
   * Check if status transition is valid
   */
  private isValidStatusTransition(
    currentStatus: RTOStatus,
    newStatus: RTOStatus,
  ): boolean {
    const validTransitions: Record<RTOStatus, RTOStatus[]> = {
      'RTO-Initiated': ['RTO-Approved', 'RTO-Cancelled'],
      'RTO-Approved': ['RTO-In-transit', 'RTO-Cancelled'],
      'RTO-In-transit': ['RTO-At-origin'],
      'RTO-At-origin': ['RTO-Delivered', 'RTO-Disposed'],
      'RTO-Delivered': [],
      'RTO-Disposed': [],
      'RTO-Cancelled': [],
    };

    return validTransitions[currentStatus]?.includes(newStatus) || false;
  }

  /**
   * Map RTO status to fulfillment state
   */
  private mapRTOToFulfillmentState(rtoStatus: RTOStatus): OndcFulfillmentState {
    const mapping: Record<RTOStatus, OndcFulfillmentState> = {
      'RTO-Initiated': OndcFulfillmentState.RTO_Initiated,
      'RTO-Approved': OndcFulfillmentState.RTO_Initiated,
      'RTO-In-transit': OndcFulfillmentState.RTO_Initiated,
      'RTO-At-origin': OndcFulfillmentState.RTO_Initiated,
      'RTO-Delivered': OndcFulfillmentState.RTO_Delivered,
      'RTO-Disposed': OndcFulfillmentState.RTO_Disposed,
      'RTO-Cancelled': OndcFulfillmentState.In_transit,
    };

    return mapping[rtoStatus] || OndcFulfillmentState.RTO_Initiated;
  }

  /**
   * Map RTO status to order status
   * Note: Using available OrderStatus values (CANCELLED for RTO states)
   */
  private mapRTOToOrderStatus(rtoStatus: RTOStatus): OrderStatus {
    const mapping: Record<RTOStatus, OrderStatus> = {
      'RTO-Initiated': OrderStatus.CANCELLED,
      'RTO-Approved': OrderStatus.CANCELLED,
      'RTO-In-transit': OrderStatus.CANCELLED,
      'RTO-At-origin': OrderStatus.CANCELLED,
      'RTO-Delivered': OrderStatus.CANCELLED,
      'RTO-Disposed': OrderStatus.CANCELLED,
      'RTO-Cancelled': OrderStatus.IN_TRANSIT,
    };

    return mapping[rtoStatus] || OrderStatus.CANCELLED;
  }

  /**
   * Format address object to string
   */
  private formatAddress(address: Record<string, unknown>): string {
    const parts: string[] = [];

    if (address.building) parts.push(String(address.building));
    if (address.street) parts.push(String(address.street));
    if (address.locality) parts.push(String(address.locality));
    if (address.city) parts.push(String(address.city));
    if (address.state) parts.push(String(address.state));
    if (address.pincode) parts.push(String(address.pincode));

    return parts.join(', ') || '';
  }

  /**
   * Store RTO details in fulfillment
   */
  private async storeRTODetails(
    orderId: string,
    details: RTODetails,
  ): Promise<void> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      this.logger.warn(
        `No fulfillment found for order ${orderId} to store RTO`,
      );
      return;
    }

    const pickupAddress =
      (fulfillment.pickupAddress as Record<string, unknown>) || {};

    const updatedPickupAddress = {
      ...pickupAddress,
      _rtoData: {
        ...details,
        initiatedAt: details.initiatedAt.toISOString(),
        completedAt: details.completedAt?.toISOString(),
        timeline: details.timeline.map((t) => ({
          ...t,
          timestamp: t.timestamp.toISOString(),
        })),
      },
    };

    await this.prisma.ondcFulfillment.update({
      where: { id: fulfillment.id },
      data: {
        pickupAddress: updatedPickupAddress as any,
      },
    });
  }

  /**
   * Build RTO tags for ONDC response
   */
  buildRTOTags(details: RTODetails): Array<{
    descriptor: { code: string };
    list: Array<{ descriptor: { code: string }; value: string }>;
  }> {
    if (!details.rtoId) {
      return [];
    }

    return [
      {
        descriptor: { code: 'rto_details' },
        list: [
          {
            descriptor: { code: 'rto_id' },
            value: details.rtoId,
          },
          {
            descriptor: { code: 'rto_awb' },
            value: details.rtoAwbNumber || '',
          },
          {
            descriptor: { code: 'reason_code' },
            value: details.reasonCode,
          },
          {
            descriptor: { code: 'status' },
            value: details.status,
          },
          {
            descriptor: { code: 'initiated_at' },
            value: details.initiatedAt.toISOString(),
          },
          {
            descriptor: { code: 'delivery_attempts' },
            value: details.deliveryAttempts.toString(),
          },
          {
            descriptor: { code: 'rto_charge' },
            value: details.rtoCharges.totalCharge.toString(),
          },
        ],
      },
    ];
  }
}
