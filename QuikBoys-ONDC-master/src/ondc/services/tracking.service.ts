import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import { OnTrackMessage } from '../interfaces/catalog.interface';
import { getErrorMessage } from '../types/ondc-error.interface';
import { getOndcBaseUrl } from '../../config/environment.config.js';

/**
 * TrackingService handles real-time tracking for ONDC orders
 * Provides tracking URLs and location updates
 */
@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.baseUrl =
      this.configService.get<string>('ondc.subscriberUrl') ||
      getOndcBaseUrl();
  }

  /**
   * Get tracking info for an order
   */
  async getTrackingInfo(orderId: string): Promise<OnTrackMessage | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        driver: true,
      },
    });

    if (!order) {
      this.logger.warn(`Order not found for tracking: ${orderId}`);
      return null;
    }

    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    // Determine if tracking is active
    const isActive = this.isTrackingActive(order.status);

    // Build tracking URL
    const trackingUrl = `${this.baseUrl}/track/${order.ondcOrderId || orderId}`;

    // Get current driver location if available
    let currentLocation: { gps: string; updated_at?: string } | undefined;
    if (
      isActive &&
      order.driver?.currentLatitude &&
      order.driver?.currentLongitude
    ) {
      currentLocation = {
        gps: `${order.driver.currentLatitude.toString()},${order.driver.currentLongitude.toString()}`,
        updated_at: order.driver.lastLocationUpdate?.toISOString(),
      };
    }

    return {
      tracking: {
        id: fulfillment?.fulfillmentId || `F-${orderId.slice(0, 8)}`,
        url: trackingUrl,
        status: isActive ? 'active' : 'inactive',
        location: currentLocation,
      },
    };
  }

  /**
   * Get tracking info by ONDC order ID
   */
  async getTrackingByOndcOrderId(
    ondcOrderId: string,
  ): Promise<OnTrackMessage | null> {
    const order = await this.prisma.order.findUnique({
      where: { ondcOrderId },
    });

    if (!order) {
      return null;
    }

    return this.getTrackingInfo(order.id);
  }

  /**
   * Update driver location for tracking
   */
  async updateDriverLocation(orderId: string, gps: string): Promise<void> {
    try {
      // Update fulfillment with current location
      await this.prisma.ondcFulfillment.updateMany({
        where: { orderId },
        data: {
          currentLocationGps: gps,
          locationUpdatedAt: new Date(),
        },
      });

      this.logger.debug(
        `Updated tracking location for order ${orderId}: ${gps}`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to update tracking location: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Generate tracking URL for an order
   */
  generateTrackingUrl(orderId: string): string {
    return `${this.baseUrl}/track/${orderId}`;
  }

  /**
   * Check if tracking should be active for a given status
   */
  private isTrackingActive(status: string): boolean {
    const activeStatuses = [
      'ASSIGNED',
      'PICKED_UP',
      'IN_TRANSIT',
      'BROADCASTING',
    ];
    return activeStatuses.includes(status);
  }

  /**
   * Get tracking history for an order
   */
  async getTrackingHistory(orderId: string): Promise<
    Array<{
      timestamp: Date;
      status: string;
      location?: string;
      notes?: string;
    }>
  > {
    const history = await this.prisma.ondcFulfillmentHistory.findMany({
      where: {
        fulfillment: {
          orderId,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return history.map((item) => ({
      timestamp: item.createdAt,
      status: item.newState,
      location: item.locationGps || undefined,
      notes: item.notes || undefined,
    }));
  }

  /**
   * Set tracking URL for order
   */
  async setTrackingUrl(orderId: string, url: string): Promise<void> {
    await this.prisma.ondcFulfillment.updateMany({
      where: { orderId },
      data: {
        trackingUrl: url,
      },
    });
  }

  /**
   * Update agent details for tracking
   */
  async updateAgentDetails(
    orderId: string,
    agentName: string,
    agentPhone: string,
    vehicleCategory?: string,
    vehicleRegistration?: string,
  ): Promise<void> {
    await this.prisma.ondcFulfillment.updateMany({
      where: { orderId },
      data: {
        agentName,
        agentPhone,
        vehicleCategory,
        vehicleRegistration,
      },
    });

    this.logger.debug(`Updated agent details for order ${orderId}`);
  }
}
