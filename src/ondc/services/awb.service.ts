// ============================================
// AWB (Air Waybill) Number Service
// File: src/ondc/services/awb.service.ts
// ONDC Logistics - AWB number generation for P2H2P shipments
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { ConfigService } from '@nestjs/config';

/**
 * AWB Number Format: QBZ-YYMM-XXXXXX
 * - QBZ: Provider prefix (QuikBoys)
 * - YYMM: Year and month
 * - XXXXXX: Sequential 6-digit number
 */
export interface AWBDetails {
  awbNumber: string;
  generatedAt: Date;
  orderId: string;
  deliveryType: 'P2P' | 'P2H2P';
  status: 'GENERATED' | 'ASSIGNED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
}

/**
 * AWBService - Generates and manages AWB numbers for P2H2P shipments
 *
 * ONDC Requirement: P2H2P (Point to Hub to Point) deliveries require
 * AWB numbers for tracking through hub/warehouse processing.
 *
 * Note: AWB data is stored in OndcFulfillment.pickupAddress JSON field
 * under the key "_awbData" since there's no dedicated field.
 */
@Injectable()
export class AWBService {
  private readonly logger = new Logger(AWBService.name);
  private readonly providerPrefix: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.providerPrefix = this.configService.get<string>('AWB_PREFIX', 'QBZ');
  }

  /**
   * Generate AWB number for P2H2P shipment
   * Format: QBZ-YYMM-XXXXXX
   */
  async generateAWBNumber(
    orderId: string,
    deliveryType: 'P2P' | 'P2H2P' = 'P2H2P',
  ): Promise<AWBDetails> {
    // Only generate AWB for P2H2P shipments
    if (deliveryType === 'P2P') {
      this.logger.debug(`P2P order ${orderId} - AWB not required`);
      return {
        awbNumber: '',
        generatedAt: new Date(),
        orderId,
        deliveryType,
        status: 'GENERATED',
      };
    }

    const now = new Date();
    const yearMonth = this.getYearMonth(now);

    // Get next sequence number for this month
    const sequenceNumber = await this.getNextSequence(yearMonth);

    // Format: QBZ-2412-000001
    const awbNumber = `${this.providerPrefix}-${yearMonth}-${sequenceNumber.toString().padStart(6, '0')}`;

    // Store AWB record in fulfillment's pickupAddress JSON
    await this.storeAWBRecord(awbNumber, orderId, deliveryType);

    this.logger.log(`Generated AWB number: ${awbNumber} for order: ${orderId}`);

    return {
      awbNumber,
      generatedAt: now,
      orderId,
      deliveryType,
      status: 'GENERATED',
    };
  }

  /**
   * Get AWB details for an order
   */
  async getAWBByOrderId(orderId: string): Promise<AWBDetails | null> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      return null;
    }

    // AWB data is stored in pickupAddress JSON under _awbData key
    const pickupAddress = fulfillment.pickupAddress as Record<
      string,
      unknown
    > | null;
    const awbData = pickupAddress?._awbData as
      | {
          awbNumber: string;
          generatedAt: string;
          deliveryType: string;
          status: string;
        }
      | undefined;

    if (!awbData?.awbNumber) {
      return null;
    }

    return {
      awbNumber: awbData.awbNumber,
      generatedAt: new Date(awbData.generatedAt),
      orderId,
      deliveryType: awbData.deliveryType as 'P2P' | 'P2H2P',
      status: awbData.status as AWBDetails['status'],
    };
  }

  /**
   * Validate AWB number format
   */
  validateAWBNumber(awbNumber: string): boolean {
    // Format: XXX-YYMM-NNNNNN
    const awbPattern = /^[A-Z]{2,4}-\d{4}-\d{6}$/;
    return awbPattern.test(awbNumber);
  }

  /**
   * Update AWB status when fulfillment state changes
   */
  async updateAWBStatus(
    orderId: string,
    status: AWBDetails['status'],
  ): Promise<void> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) return;

    const pickupAddress =
      (fulfillment.pickupAddress as Record<string, unknown>) || {};
    const awbData = (pickupAddress._awbData as Record<string, unknown>) || {};

    await this.prisma.ondcFulfillment.update({
      where: { id: fulfillment.id },
      data: {
        pickupAddress: {
          ...pickupAddress,
          _awbData: {
            ...awbData,
            status,
            statusUpdatedAt: new Date().toISOString(),
          },
        },
      },
    });

    this.logger.debug(`Updated AWB status for order ${orderId} to: ${status}`);
  }

  /**
   * Get year and month string (YYMM)
   */
  private getYearMonth(date: Date): string {
    const year = date.getFullYear().toString().slice(2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${year}${month}`;
  }

  /**
   * Get next sequence number for the month
   * Uses a counter based approach since we can't query JSON fields efficiently
   */
  private async getNextSequence(yearMonth: string): Promise<number> {
    // Count existing fulfillments this month with AWB data
    // This is a simple approach - in production, consider a separate counter table
    const prefix = `${this.providerPrefix}-${yearMonth}-`;

    // Get all fulfillments and filter by AWB prefix in memory
    // This is acceptable for moderate volumes
    const fulfillments = await this.prisma.ondcFulfillment.findMany({
      where: {
        createdAt: {
          gte: new Date(`20${yearMonth.slice(0, 2)}-${yearMonth.slice(2)}-01`),
        },
      },
      select: {
        pickupAddress: true,
      },
    });

    let maxSequence = 0;
    for (const f of fulfillments) {
      const pickup = f.pickupAddress as Record<string, unknown> | null;
      const awbData = pickup?._awbData as { awbNumber?: string } | undefined;
      if (awbData?.awbNumber?.startsWith(prefix)) {
        const seq = parseInt(awbData.awbNumber.split('-')[2], 10);
        if (seq > maxSequence) {
          maxSequence = seq;
        }
      }
    }

    return maxSequence + 1;
  }

  /**
   * Store AWB record in fulfillment's pickupAddress JSON
   */
  private async storeAWBRecord(
    awbNumber: string,
    orderId: string,
    deliveryType: string,
  ): Promise<void> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      this.logger.warn(
        `No fulfillment found for order ${orderId} to store AWB`,
      );
      return;
    }

    const existingPickupAddress =
      (fulfillment.pickupAddress as Record<string, unknown>) || {};

    await this.prisma.ondcFulfillment.update({
      where: { id: fulfillment.id },
      data: {
        type: deliveryType,
        pickupAddress: {
          ...existingPickupAddress,
          _awbData: {
            awbNumber,
            generatedAt: new Date().toISOString(),
            deliveryType,
            status: 'GENERATED',
          },
        },
      },
    });
  }

  /**
   * Map fulfillment state to AWB status
   */
  mapFulfillmentStateToAWBStatus(state: string): AWBDetails['status'] {
    const stateMapping: Record<string, AWBDetails['status']> = {
      Pending: 'GENERATED',
      'Searching-for-Agent': 'GENERATED',
      'Agent-assigned': 'ASSIGNED',
      'At-pickup': 'ASSIGNED',
      'Order-picked-up': 'IN_TRANSIT',
      'In-transit': 'IN_TRANSIT',
      'Out-for-delivery': 'IN_TRANSIT',
      'At-delivery': 'IN_TRANSIT',
      'Order-delivered': 'DELIVERED',
      Cancelled: 'CANCELLED',
      'RTO-Initiated': 'IN_TRANSIT',
      'RTO-In-transit': 'IN_TRANSIT',
      'RTO-Delivered': 'DELIVERED',
    };

    return stateMapping[state] || 'GENERATED';
  }

  /**
   * Build AWB tags for ONDC fulfillment response
   * Required for P2H2P shipments per ONDC spec
   */
  buildAWBTags(awbDetails: AWBDetails): Array<{
    descriptor: { code: string };
    list: Array<{ descriptor: { code: string }; value: string }>;
  }> {
    if (!awbDetails.awbNumber) {
      return [];
    }

    return [
      {
        descriptor: {
          code: 'AWB_NO',
        },
        list: [
          {
            descriptor: { code: 'AWB_NO' },
            value: awbDetails.awbNumber,
          },
        ],
      },
    ];
  }
}
