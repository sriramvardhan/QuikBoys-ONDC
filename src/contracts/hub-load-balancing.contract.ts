/**
 * HubLoadBalancingService Contract
 *
 * This is the interface that the ONDC module depends on from the monolith's
 * HubsModule. Used by MultiModalTransportService and HyperlocalOptimizationService
 * to route orders to the best hub based on location and capacity.
 */

export interface HubSelectionOptions {
  preferredHubId?: string;
  maxDistanceKm?: number;
  requireCapacity?: boolean;
  excludeOverloaded?: boolean;
  preferCapacity?: boolean;
}

export interface HubSelectionResult {
  selectedHub: {
    hubId: string;
    hubCode: string;
    hubName: string;
  };
  selectionReason: string;
  distanceFromPickup: number;
  currentLoad: number;
  maxCapacity: number;
  utilizationPercent: number;
}

export interface HubLoadMetrics {
  hubId: string;
  hubName: string;
  activeOrders: number;
  maxCapacity: number;
  utilizationPercent: number;
  availableDrivers: number;
  avgDeliveryTimeMinutes: number;
}

export interface IHubLoadBalancingService {
  selectHubForOrder(
    pickupLatitude: number,
    pickupLongitude: number,
    options?: HubSelectionOptions,
  ): Promise<HubSelectionResult | null>;
  selectHubByPincode(
    pincode: string,
  ): Promise<{ hubId: string; pincode: string; coverageType: string } | null>;
  getAllHubMetrics(): Promise<HubLoadMetrics[]>;
  getHubMetrics(hubId: string): Promise<HubLoadMetrics | null>;
  canHubAcceptOrder(
    hubId: string,
  ): Promise<{ canAccept: boolean; reason?: string }>;
}

export const HUB_LOAD_BALANCING_SERVICE = 'HUB_LOAD_BALANCING_SERVICE';
