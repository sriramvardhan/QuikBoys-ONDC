import { Injectable, Logger } from '@nestjs/common';
import {
  IHubLoadBalancingService,
  HubSelectionOptions,
  HubSelectionResult,
  HubLoadMetrics,
} from '../contracts/hub-load-balancing.contract.js';

/**
 * Stub HubLoadBalancingService for standalone ONDC development.
 *
 * Returns a default hub so ONDC flows can proceed without the full hubs system.
 */
@Injectable()
export class HubLoadBalancingStub implements IHubLoadBalancingService {
  private readonly logger = new Logger('HubLoadBalancingStub');

  async selectHubForOrder(
    pickupLatitude: number,
    pickupLongitude: number,
    _options?: HubSelectionOptions,
  ): Promise<HubSelectionResult | null> {
    this.logger.warn(
      `[STUB] selectHubForOrder called for (${pickupLatitude}, ${pickupLongitude})`,
    );
    return {
      selectedHub: {
        hubId: 'default-hub',
        hubCode: 'HUB-000',
        hubName: 'Default Hub (Stub)',
      },
      selectionReason: 'Stub: default hub selected',
      distanceFromPickup: 5,
      currentLoad: 10,
      maxCapacity: 100,
      utilizationPercent: 10,
    };
  }

  async selectHubByPincode(pincode: string) {
    this.logger.warn(`[STUB] selectHubByPincode called for ${pincode}`);
    return {
      hubId: 'default-hub',
      pincode,
      coverageType: 'FULL',
    };
  }

  async getAllHubMetrics(): Promise<HubLoadMetrics[]> {
    return [
      {
        hubId: 'default-hub',
        hubName: 'Default Hub (Stub)',
        activeOrders: 10,
        maxCapacity: 100,
        utilizationPercent: 10,
        availableDrivers: 20,
        avgDeliveryTimeMinutes: 30,
      },
    ];
  }

  async getHubMetrics(hubId: string): Promise<HubLoadMetrics | null> {
    return {
      hubId,
      hubName: 'Default Hub (Stub)',
      activeOrders: 10,
      maxCapacity: 100,
      utilizationPercent: 10,
      availableDrivers: 20,
      avgDeliveryTimeMinutes: 30,
    };
  }

  async canHubAcceptOrder(_hubId: string) {
    return { canAccept: true };
  }
}

// Alias matching the monolith class name
export { HubLoadBalancingStub as HubLoadBalancingService };
