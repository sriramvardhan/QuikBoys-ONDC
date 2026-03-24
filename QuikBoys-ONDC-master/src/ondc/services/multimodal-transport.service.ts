// ============================================
// Multi-Modal Transport Service
// File: src/ondc/services/multimodal-transport.service.ts
// ONDC Logistics - Multi-modal transport handling for complex deliveries
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

/**
 * Transport modes supported per ONDC spec
 */
export enum TransportMode {
  BIKE = 'BIKE',
  SCOOTER = 'SCOOTER',
  THREE_WHEELER = 'THREE_WHEELER',
  FOUR_WHEELER = 'FOUR_WHEELER',
  MINI_TRUCK = 'MINI_TRUCK',
  TRUCK = 'TRUCK',
  TEMPO = 'TEMPO',
  RAIL = 'RAIL',
  AIR = 'AIR',
  WATERWAY = 'WATERWAY',
}

/**
 * Transport leg in multi-modal journey
 */
export interface TransportLeg {
  legId: string;
  sequence: number;
  mode: TransportMode;
  vehicleCategory: string;
  vehicleCapacity?: {
    weightKg: number;
    volumeLiters?: number;
  };
  startLocation: {
    gps: string;
    address?: string;
    type: 'PICKUP' | 'HUB' | 'TRANSIT_POINT' | 'DELIVERY';
  };
  endLocation: {
    gps: string;
    address?: string;
    type: 'PICKUP' | 'HUB' | 'TRANSIT_POINT' | 'DELIVERY';
  };
  estimatedDistance: number; // km
  estimatedDuration: number; // minutes
  estimatedCost: number;
  agentId?: string;
  agentName?: string;
  vehicleNumber?: string;
  status: 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  actualStartTime?: Date;
  actualEndTime?: Date;
  handoverDetails?: {
    handedOverBy: string;
    receivedBy: string;
    timestamp: Date;
    verificationCode?: string;
  };
}

/**
 * Multi-modal route plan
 */
export interface MultiModalRoute {
  routeId: string;
  orderId: string;
  totalLegs: number;
  legs: TransportLeg[];
  totalDistance: number;
  totalDuration: number;
  totalCost: number;
  currentLeg: number;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Route optimization criteria
 */
export interface RouteOptimizationCriteria {
  prioritize: 'COST' | 'TIME' | 'RELIABILITY';
  maxLegs?: number;
  preferredModes?: TransportMode[];
  avoidModes?: TransportMode[];
  maxBudget?: number;
  maxDuration?: number; // minutes
}

/**
 * Hub/Transit point details
 */
export interface TransitHub {
  hubId: string;
  name: string;
  type: 'SORTING_CENTER' | 'DISTRIBUTION_HUB' | 'TRANSIT_POINT' | 'MICRO_HUB';
  location: {
    gps: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
  };
  operatingHours: {
    open: string; // HH:mm
    close: string;
    daysOpen: number[]; // 0-6, Sunday = 0
  };
  supportedModes: TransportMode[];
  capacity: {
    maxPackagesPerDay: number;
    currentLoad: number;
  };
  isActive: boolean;
}

/**
 * Mode configuration for cost/time calculation
 */
interface ModeConfig {
  baseRate: number;
  perKmRate: number;
  avgSpeedKmh: number;
  maxWeightKg: number;
  maxDistanceKm: number;
  reliability: number; // 0-1
}

/**
 * MultiModalTransportService - Manages multi-modal transport for ONDC
 *
 * ONDC Requirement: Support for complex delivery routes using multiple
 * transport modes (bike -> hub -> truck -> hub -> bike)
 */
@Injectable()
export class MultiModalTransportService {
  private readonly logger = new Logger(MultiModalTransportService.name);
  private readonly modeConfigs: Map<TransportMode, ModeConfig>;
  private readonly transitHubs: TransitHub[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    // Initialize mode configurations
    this.modeConfigs = new Map([
      [
        TransportMode.BIKE,
        {
          baseRate: 20,
          perKmRate: 8,
          avgSpeedKmh: 25,
          maxWeightKg: 10,
          maxDistanceKm: 15,
          reliability: 0.95,
        },
      ],
      [
        TransportMode.SCOOTER,
        {
          baseRate: 25,
          perKmRate: 10,
          avgSpeedKmh: 30,
          maxWeightKg: 20,
          maxDistanceKm: 20,
          reliability: 0.93,
        },
      ],
      [
        TransportMode.THREE_WHEELER,
        {
          baseRate: 40,
          perKmRate: 12,
          avgSpeedKmh: 25,
          maxWeightKg: 100,
          maxDistanceKm: 30,
          reliability: 0.92,
        },
      ],
      [
        TransportMode.FOUR_WHEELER,
        {
          baseRate: 80,
          perKmRate: 15,
          avgSpeedKmh: 40,
          maxWeightKg: 500,
          maxDistanceKm: 100,
          reliability: 0.94,
        },
      ],
      [
        TransportMode.MINI_TRUCK,
        {
          baseRate: 150,
          perKmRate: 20,
          avgSpeedKmh: 45,
          maxWeightKg: 1000,
          maxDistanceKm: 300,
          reliability: 0.91,
        },
      ],
      [
        TransportMode.TRUCK,
        {
          baseRate: 300,
          perKmRate: 25,
          avgSpeedKmh: 50,
          maxWeightKg: 5000,
          maxDistanceKm: 1000,
          reliability: 0.9,
        },
      ],
      [
        TransportMode.TEMPO,
        {
          baseRate: 100,
          perKmRate: 18,
          avgSpeedKmh: 35,
          maxWeightKg: 750,
          maxDistanceKm: 150,
          reliability: 0.92,
        },
      ],
      [
        TransportMode.RAIL,
        {
          baseRate: 200,
          perKmRate: 8,
          avgSpeedKmh: 60,
          maxWeightKg: 10000,
          maxDistanceKm: 2000,
          reliability: 0.88,
        },
      ],
      [
        TransportMode.AIR,
        {
          baseRate: 500,
          perKmRate: 30,
          avgSpeedKmh: 500,
          maxWeightKg: 1000,
          maxDistanceKm: 5000,
          reliability: 0.96,
        },
      ],
    ]);

    // Sample transit hubs (in production, load from database)
    this.transitHubs = this.loadTransitHubs();
  }

  /**
   * Plan multi-modal route for an order
   */
  async planRoute(
    orderId: string,
    pickupGps: string,
    deliveryGps: string,
    packageWeight: number,
    criteria: RouteOptimizationCriteria = { prioritize: 'COST' },
  ): Promise<MultiModalRoute> {
    const distance = this.calculateDistance(pickupGps, deliveryGps);

    // For short distances (<15km), use single mode
    if (distance <= 15) {
      return this.createSingleModeRoute(
        orderId,
        pickupGps,
        deliveryGps,
        packageWeight,
        distance,
      );
    }

    // For medium distances (15-50km), consider hub routing
    if (distance <= 50) {
      return this.createHubRoute(
        orderId,
        pickupGps,
        deliveryGps,
        packageWeight,
        distance,
        criteria,
      );
    }

    // For long distances (>50km), use full multi-modal
    return this.createMultiModalRoute(
      orderId,
      pickupGps,
      deliveryGps,
      packageWeight,
      distance,
      criteria,
    );
  }

  /**
   * Create single mode route for short distances
   */
  private createSingleModeRoute(
    orderId: string,
    pickupGps: string,
    deliveryGps: string,
    packageWeight: number,
    distance: number,
  ): MultiModalRoute {
    const mode = this.selectOptimalMode(packageWeight, distance);
    const config = this.modeConfigs.get(mode)!;

    const duration = Math.ceil((distance / config.avgSpeedKmh) * 60);
    const cost = config.baseRate + distance * config.perKmRate;

    const leg: TransportLeg = {
      legId: `${orderId}-LEG-1`,
      sequence: 1,
      mode,
      vehicleCategory: this.getModeVehicleCategory(mode),
      startLocation: {
        gps: pickupGps,
        type: 'PICKUP',
      },
      endLocation: {
        gps: deliveryGps,
        type: 'DELIVERY',
      },
      estimatedDistance: distance,
      estimatedDuration: duration,
      estimatedCost: cost,
      status: 'PENDING',
    };

    return {
      routeId: `ROUTE-${orderId}`,
      orderId,
      totalLegs: 1,
      legs: [leg],
      totalDistance: distance,
      totalDuration: duration,
      totalCost: Math.round(cost * 100) / 100,
      currentLeg: 1,
      status: 'PLANNED',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Create hub-based route for medium distances
   */
  private createHubRoute(
    orderId: string,
    pickupGps: string,
    deliveryGps: string,
    packageWeight: number,
    _totalDistance: number,
    _criteria: RouteOptimizationCriteria,
  ): MultiModalRoute {
    // Find nearest hub to midpoint
    const hub = this.findNearestHub(pickupGps, deliveryGps);

    const legs: TransportLeg[] = [];
    let totalCost = 0;
    let totalDuration = 0;

    // Leg 1: Pickup to Hub
    const leg1Distance = this.calculateDistance(pickupGps, hub.location.gps);
    const leg1Mode = this.selectOptimalMode(packageWeight, leg1Distance);
    const leg1Config = this.modeConfigs.get(leg1Mode)!;
    const leg1Duration = Math.ceil(
      (leg1Distance / leg1Config.avgSpeedKmh) * 60,
    );
    const leg1Cost = leg1Config.baseRate + leg1Distance * leg1Config.perKmRate;

    legs.push({
      legId: `${orderId}-LEG-1`,
      sequence: 1,
      mode: leg1Mode,
      vehicleCategory: this.getModeVehicleCategory(leg1Mode),
      startLocation: { gps: pickupGps, type: 'PICKUP' },
      endLocation: { gps: hub.location.gps, address: hub.name, type: 'HUB' },
      estimatedDistance: leg1Distance,
      estimatedDuration: leg1Duration,
      estimatedCost: leg1Cost,
      status: 'PENDING',
    });
    totalCost += leg1Cost;
    totalDuration += leg1Duration;

    // Add hub processing time
    totalDuration += 30; // 30 min hub processing

    // Leg 2: Hub to Delivery
    const leg2Distance = this.calculateDistance(hub.location.gps, deliveryGps);
    const leg2Mode = this.selectOptimalMode(packageWeight, leg2Distance);
    const leg2Config = this.modeConfigs.get(leg2Mode)!;
    const leg2Duration = Math.ceil(
      (leg2Distance / leg2Config.avgSpeedKmh) * 60,
    );
    const leg2Cost = leg2Config.baseRate + leg2Distance * leg2Config.perKmRate;

    legs.push({
      legId: `${orderId}-LEG-2`,
      sequence: 2,
      mode: leg2Mode,
      vehicleCategory: this.getModeVehicleCategory(leg2Mode),
      startLocation: { gps: hub.location.gps, address: hub.name, type: 'HUB' },
      endLocation: { gps: deliveryGps, type: 'DELIVERY' },
      estimatedDistance: leg2Distance,
      estimatedDuration: leg2Duration,
      estimatedCost: leg2Cost,
      status: 'PENDING',
    });
    totalCost += leg2Cost;
    totalDuration += leg2Duration;

    return {
      routeId: `ROUTE-${orderId}`,
      orderId,
      totalLegs: 2,
      legs,
      totalDistance: leg1Distance + leg2Distance,
      totalDuration,
      totalCost: Math.round(totalCost * 100) / 100,
      currentLeg: 1,
      status: 'PLANNED',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Create full multi-modal route for long distances
   */
  private createMultiModalRoute(
    orderId: string,
    pickupGps: string,
    deliveryGps: string,
    packageWeight: number,
    _totalDistance: number,
    criteria: RouteOptimizationCriteria,
  ): MultiModalRoute {
    // Find origin and destination hubs
    const originHub = this.findNearestHubToPoint(pickupGps);
    const destHub = this.findNearestHubToPoint(deliveryGps);

    const legs: TransportLeg[] = [];
    let totalCost = 0;
    let totalDuration = 0;
    let sequence = 1;

    // Leg 1: First mile (Pickup to Origin Hub)
    const leg1Distance = this.calculateDistance(
      pickupGps,
      originHub.location.gps,
    );
    const leg1Mode = TransportMode.BIKE; // First mile always bike/scooter
    const leg1Config = this.modeConfigs.get(leg1Mode)!;
    const leg1Duration = Math.ceil(
      (leg1Distance / leg1Config.avgSpeedKmh) * 60,
    );
    const leg1Cost = leg1Config.baseRate + leg1Distance * leg1Config.perKmRate;

    legs.push({
      legId: `${orderId}-LEG-${sequence}`,
      sequence: sequence++,
      mode: leg1Mode,
      vehicleCategory: 'Two Wheeler',
      startLocation: { gps: pickupGps, type: 'PICKUP' },
      endLocation: {
        gps: originHub.location.gps,
        address: originHub.name,
        type: 'HUB',
      },
      estimatedDistance: leg1Distance,
      estimatedDuration: leg1Duration,
      estimatedCost: leg1Cost,
      status: 'PENDING',
    });
    totalCost += leg1Cost;
    totalDuration += leg1Duration + 30; // + hub processing

    // Leg 2: Line haul (Origin Hub to Destination Hub)
    const lineHaulDistance = this.calculateDistance(
      originHub.location.gps,
      destHub.location.gps,
    );
    const lineHaulMode = this.selectLineHaulMode(
      packageWeight,
      lineHaulDistance,
      criteria,
    );
    const lineHaulConfig = this.modeConfigs.get(lineHaulMode)!;
    const lineHaulDuration = Math.ceil(
      (lineHaulDistance / lineHaulConfig.avgSpeedKmh) * 60,
    );
    const lineHaulCost =
      lineHaulConfig.baseRate + lineHaulDistance * lineHaulConfig.perKmRate;

    legs.push({
      legId: `${orderId}-LEG-${sequence}`,
      sequence: sequence++,
      mode: lineHaulMode,
      vehicleCategory: this.getModeVehicleCategory(lineHaulMode),
      startLocation: {
        gps: originHub.location.gps,
        address: originHub.name,
        type: 'HUB',
      },
      endLocation: {
        gps: destHub.location.gps,
        address: destHub.name,
        type: 'HUB',
      },
      estimatedDistance: lineHaulDistance,
      estimatedDuration: lineHaulDuration,
      estimatedCost: lineHaulCost,
      status: 'PENDING',
    });
    totalCost += lineHaulCost;
    totalDuration += lineHaulDuration + 30; // + hub processing

    // Leg 3: Last mile (Destination Hub to Delivery)
    const leg3Distance = this.calculateDistance(
      destHub.location.gps,
      deliveryGps,
    );
    const leg3Mode = TransportMode.BIKE; // Last mile always bike/scooter
    const leg3Config = this.modeConfigs.get(leg3Mode)!;
    const leg3Duration = Math.ceil(
      (leg3Distance / leg3Config.avgSpeedKmh) * 60,
    );
    const leg3Cost = leg3Config.baseRate + leg3Distance * leg3Config.perKmRate;

    legs.push({
      legId: `${orderId}-LEG-${sequence}`,
      sequence: sequence,
      mode: leg3Mode,
      vehicleCategory: 'Two Wheeler',
      startLocation: {
        gps: destHub.location.gps,
        address: destHub.name,
        type: 'HUB',
      },
      endLocation: { gps: deliveryGps, type: 'DELIVERY' },
      estimatedDistance: leg3Distance,
      estimatedDuration: leg3Duration,
      estimatedCost: leg3Cost,
      status: 'PENDING',
    });
    totalCost += leg3Cost;
    totalDuration += leg3Duration;

    const totalDistance = leg1Distance + lineHaulDistance + leg3Distance;

    return {
      routeId: `ROUTE-${orderId}`,
      orderId,
      totalLegs: legs.length,
      legs,
      totalDistance,
      totalDuration,
      totalCost: Math.round(totalCost * 100) / 100,
      currentLeg: 1,
      status: 'PLANNED',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Update leg status
   */
  async updateLegStatus(
    orderId: string,
    legId: string,
    status: TransportLeg['status'],
    agentDetails?: {
      agentId: string;
      agentName: string;
      vehicleNumber?: string;
    },
  ): Promise<MultiModalRoute | null> {
    const route = await this.getRouteByOrderId(orderId);
    if (!route) return null;

    const legIndex = route.legs.findIndex((l) => l.legId === legId);
    if (legIndex === -1) return null;

    route.legs[legIndex].status = status;

    if (agentDetails) {
      route.legs[legIndex].agentId = agentDetails.agentId;
      route.legs[legIndex].agentName = agentDetails.agentName;
      route.legs[legIndex].vehicleNumber = agentDetails.vehicleNumber;
    }

    if (status === 'IN_PROGRESS') {
      route.legs[legIndex].actualStartTime = new Date();
      route.status = 'IN_PROGRESS';
    }

    if (status === 'COMPLETED') {
      route.legs[legIndex].actualEndTime = new Date();

      // Move to next leg
      if (route.currentLeg < route.totalLegs) {
        route.currentLeg++;
      } else {
        route.status = 'COMPLETED';
      }
    }

    if (status === 'FAILED') {
      route.status = 'FAILED';
    }

    route.updatedAt = new Date();

    await this.storeRouteDetails(orderId, route);

    this.logger.log(`Leg ${legId} status updated to ${status}`);

    return route;
  }

  /**
   * Record handover between legs
   */
  async recordHandover(
    orderId: string,
    legId: string,
    handedOverBy: string,
    receivedBy: string,
    verificationCode?: string,
  ): Promise<boolean> {
    const route = await this.getRouteByOrderId(orderId);
    if (!route) return false;

    const legIndex = route.legs.findIndex((l) => l.legId === legId);
    if (legIndex === -1) return false;

    route.legs[legIndex].handoverDetails = {
      handedOverBy,
      receivedBy,
      timestamp: new Date(),
      verificationCode,
    };

    await this.storeRouteDetails(orderId, route);

    this.logger.log(`Handover recorded for leg ${legId}`);

    return true;
  }

  /**
   * Get route by order ID
   */
  async getRouteByOrderId(orderId: string): Promise<MultiModalRoute | null> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) return null;

    const pickupAddress = fulfillment.pickupAddress as Record<
      string,
      unknown
    > | null;
    const routeData = pickupAddress?._multiModalRoute as
      | MultiModalRoute
      | undefined;

    if (!routeData?.routeId) return null;

    return {
      ...routeData,
      createdAt: new Date(routeData.createdAt),
      updatedAt: new Date(routeData.updatedAt),
      legs: routeData.legs.map((leg) => ({
        ...leg,
        actualStartTime: leg.actualStartTime
          ? new Date(leg.actualStartTime)
          : undefined,
        actualEndTime: leg.actualEndTime
          ? new Date(leg.actualEndTime)
          : undefined,
        handoverDetails: leg.handoverDetails
          ? {
              ...leg.handoverDetails,
              timestamp: new Date(leg.handoverDetails.timestamp),
            }
          : undefined,
      })),
    };
  }

  /**
   * Select optimal transport mode based on weight and distance
   */
  private selectOptimalMode(weight: number, distance: number): TransportMode {
    // Find modes that can handle the weight and distance
    const eligibleModes: TransportMode[] = [];

    this.modeConfigs.forEach((config, mode) => {
      if (config.maxWeightKg >= weight && config.maxDistanceKm >= distance) {
        eligibleModes.push(mode);
      }
    });

    if (eligibleModes.length === 0) {
      return TransportMode.TRUCK; // Fallback
    }

    // Select cheapest eligible mode
    let cheapestMode = eligibleModes[0];
    let lowestCost = Infinity;

    for (const mode of eligibleModes) {
      const config = this.modeConfigs.get(mode)!;
      const cost = config.baseRate + distance * config.perKmRate;
      if (cost < lowestCost) {
        lowestCost = cost;
        cheapestMode = mode;
      }
    }

    return cheapestMode;
  }

  /**
   * Select line haul mode for long distance
   */
  private selectLineHaulMode(
    weight: number,
    distance: number,
    criteria: RouteOptimizationCriteria,
  ): TransportMode {
    const eligibleModes: TransportMode[] = [];

    this.modeConfigs.forEach((config, mode) => {
      if (
        config.maxWeightKg >= weight &&
        config.maxDistanceKm >= distance &&
        !criteria.avoidModes?.includes(mode)
      ) {
        if (
          !criteria.preferredModes ||
          criteria.preferredModes.includes(mode)
        ) {
          eligibleModes.push(mode);
        }
      }
    });

    if (eligibleModes.length === 0) {
      return TransportMode.TRUCK;
    }

    // Select based on criteria
    let bestMode = eligibleModes[0];
    let bestScore = -Infinity;

    for (const mode of eligibleModes) {
      const config = this.modeConfigs.get(mode)!;
      let score = 0;

      switch (criteria.prioritize) {
        case 'COST':
          score = 1 / (config.baseRate + distance * config.perKmRate);
          break;
        case 'TIME':
          score = config.avgSpeedKmh;
          break;
        case 'RELIABILITY':
          score = config.reliability;
          break;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMode = mode;
      }
    }

    return bestMode;
  }

  /**
   * Get vehicle category for mode
   */
  private getModeVehicleCategory(mode: TransportMode): string {
    const categories: Record<TransportMode, string> = {
      [TransportMode.BIKE]: 'Two Wheeler',
      [TransportMode.SCOOTER]: 'Two Wheeler',
      [TransportMode.THREE_WHEELER]: 'Three Wheeler',
      [TransportMode.FOUR_WHEELER]: 'Four Wheeler',
      [TransportMode.MINI_TRUCK]: 'Light Commercial Vehicle',
      [TransportMode.TRUCK]: 'Heavy Commercial Vehicle',
      [TransportMode.TEMPO]: 'Light Commercial Vehicle',
      [TransportMode.RAIL]: 'Rail Cargo',
      [TransportMode.AIR]: 'Air Cargo',
      [TransportMode.WATERWAY]: 'Water Transport',
    };
    return categories[mode] || 'Other';
  }

  /**
   * Find nearest hub to midpoint between pickup and delivery
   */
  private findNearestHub(pickupGps: string, deliveryGps: string): TransitHub {
    const [pickLat, pickLng] = pickupGps.split(',').map(Number);
    const [delLat, delLng] = deliveryGps.split(',').map(Number);

    const midLat = (pickLat + delLat) / 2;
    const midLng = (pickLng + delLng) / 2;

    return this.findNearestHubToPoint(`${midLat},${midLng}`);
  }

  /**
   * Find nearest hub to a point
   */
  private findNearestHubToPoint(gps: string): TransitHub {
    const [lat, lng] = gps.split(',').map(Number);
    let nearestHub = this.transitHubs[0];
    let minDistance = Infinity;

    for (const hub of this.transitHubs) {
      if (!hub.isActive) continue;

      const [hubLat, hubLng] = hub.location.gps.split(',').map(Number);
      const distance = this.haversineDistance(lat, lng, hubLat, hubLng);

      if (distance < minDistance) {
        minDistance = distance;
        nearestHub = hub;
      }
    }

    return nearestHub;
  }

  /**
   * Calculate distance between two GPS points
   */
  private calculateDistance(gps1: string, gps2: string): number {
    const [lat1, lng1] = gps1.split(',').map(Number);
    const [lat2, lng2] = gps2.split(',').map(Number);
    return this.haversineDistance(lat1, lng1, lat2, lng2);
  }

  /**
   * Haversine formula for distance calculation
   */
  private haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Store route details in fulfillment
   */
  private async storeRouteDetails(
    orderId: string,
    route: MultiModalRoute,
  ): Promise<void> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      this.logger.warn(`No fulfillment found for order ${orderId}`);
      return;
    }

    const pickupAddress =
      (fulfillment.pickupAddress as Record<string, unknown>) || {};

    const updatedPickupAddress = {
      ...pickupAddress,
      _multiModalRoute: {
        ...route,
        createdAt: route.createdAt.toISOString(),
        updatedAt: route.updatedAt.toISOString(),
        legs: route.legs.map((leg) => ({
          ...leg,
          actualStartTime: leg.actualStartTime?.toISOString(),
          actualEndTime: leg.actualEndTime?.toISOString(),
          handoverDetails: leg.handoverDetails
            ? {
                ...leg.handoverDetails,
                timestamp: leg.handoverDetails.timestamp.toISOString(),
              }
            : undefined,
        })),
      },
    };

    await this.prisma.ondcFulfillment.update({
      where: { id: fulfillment.id },
      data: {
        pickupAddress: updatedPickupAddress as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Load transit hubs (sample data)
   */
  private loadTransitHubs(): TransitHub[] {
    return [
      {
        hubId: 'HUB-DEL-01',
        name: 'Delhi Distribution Hub',
        type: 'DISTRIBUTION_HUB',
        location: {
          gps: '28.6139,77.2090',
          address: 'Sector 18, Noida',
          city: 'Delhi NCR',
          state: 'Delhi',
          pincode: '201301',
        },
        operatingHours: {
          open: '06:00',
          close: '22:00',
          daysOpen: [0, 1, 2, 3, 4, 5, 6],
        },
        supportedModes: [
          TransportMode.BIKE,
          TransportMode.THREE_WHEELER,
          TransportMode.FOUR_WHEELER,
          TransportMode.TRUCK,
        ],
        capacity: { maxPackagesPerDay: 10000, currentLoad: 3500 },
        isActive: true,
      },
      {
        hubId: 'HUB-MUM-01',
        name: 'Mumbai Central Hub',
        type: 'DISTRIBUTION_HUB',
        location: {
          gps: '19.0760,72.8777',
          address: 'Andheri East',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400069',
        },
        operatingHours: {
          open: '06:00',
          close: '22:00',
          daysOpen: [0, 1, 2, 3, 4, 5, 6],
        },
        supportedModes: [
          TransportMode.BIKE,
          TransportMode.THREE_WHEELER,
          TransportMode.FOUR_WHEELER,
          TransportMode.TRUCK,
        ],
        capacity: { maxPackagesPerDay: 15000, currentLoad: 5000 },
        isActive: true,
      },
      {
        hubId: 'HUB-BLR-01',
        name: 'Bangalore Tech Hub',
        type: 'DISTRIBUTION_HUB',
        location: {
          gps: '12.9716,77.5946',
          address: 'Electronic City',
          city: 'Bangalore',
          state: 'Karnataka',
          pincode: '560100',
        },
        operatingHours: {
          open: '06:00',
          close: '22:00',
          daysOpen: [0, 1, 2, 3, 4, 5, 6],
        },
        supportedModes: [
          TransportMode.BIKE,
          TransportMode.THREE_WHEELER,
          TransportMode.FOUR_WHEELER,
          TransportMode.TRUCK,
        ],
        capacity: { maxPackagesPerDay: 12000, currentLoad: 4000 },
        isActive: true,
      },
      {
        hubId: 'HUB-HYD-01',
        name: 'Hyderabad Logistics Hub',
        type: 'DISTRIBUTION_HUB',
        location: {
          gps: '17.3850,78.4867',
          address: 'Gachibowli',
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '500032',
        },
        operatingHours: {
          open: '06:00',
          close: '22:00',
          daysOpen: [0, 1, 2, 3, 4, 5, 6],
        },
        supportedModes: [
          TransportMode.BIKE,
          TransportMode.THREE_WHEELER,
          TransportMode.FOUR_WHEELER,
          TransportMode.TRUCK,
        ],
        capacity: { maxPackagesPerDay: 8000, currentLoad: 2500 },
        isActive: true,
      },
    ];
  }

  /**
   * Build multi-modal tags for ONDC response
   */
  buildMultiModalTags(route: MultiModalRoute): Array<{
    descriptor: { code: string };
    list: Array<{ descriptor: { code: string }; value: string }>;
  }> {
    const tags = [
      {
        descriptor: { code: 'route_info' },
        list: [
          { descriptor: { code: 'route_id' }, value: route.routeId },
          {
            descriptor: { code: 'total_legs' },
            value: route.totalLegs.toString(),
          },
          {
            descriptor: { code: 'current_leg' },
            value: route.currentLeg.toString(),
          },
          {
            descriptor: { code: 'total_distance' },
            value: route.totalDistance.toFixed(2),
          },
          {
            descriptor: { code: 'total_duration' },
            value: route.totalDuration.toString(),
          },
          { descriptor: { code: 'status' }, value: route.status },
        ],
      },
    ];

    // Add leg details
    for (const leg of route.legs) {
      tags.push({
        descriptor: { code: `leg_${leg.sequence}` },
        list: [
          { descriptor: { code: 'leg_id' }, value: leg.legId },
          { descriptor: { code: 'mode' }, value: leg.mode },
          {
            descriptor: { code: 'vehicle_category' },
            value: leg.vehicleCategory,
          },
          {
            descriptor: { code: 'distance' },
            value: leg.estimatedDistance.toFixed(2),
          },
          {
            descriptor: { code: 'duration' },
            value: leg.estimatedDuration.toString(),
          },
          { descriptor: { code: 'status' }, value: leg.status },
        ],
      });
    }

    return tags;
  }
}
