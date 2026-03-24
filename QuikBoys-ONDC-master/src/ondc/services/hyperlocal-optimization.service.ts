// ============================================
// Hyperlocal Delivery Optimization Service
// File: src/ondc/services/hyperlocal-optimization.service.ts
// ONDC Logistics - Hyperlocal delivery optimization for quick commerce
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

/**
 * Delivery zone configuration
 */
export interface DeliveryZone {
  zoneId: string;
  zoneName: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  serviceable: boolean;
  deliveryTimeMinutes: number; // Estimated delivery time
  surgeMultiplier: number;
  activeDrivers: number;
  pendingOrders: number;
}

/**
 * Driver location and availability
 */
export interface DriverLocation {
  driverId: string;
  lat: number;
  lng: number;
  lastUpdated: Date;
  isAvailable: boolean;
  currentOrderId?: string;
  vehicleType: 'BIKE' | 'SCOOTER' | 'THREE_WHEELER' | 'FOUR_WHEELER';
  rating: number;
  totalDeliveries: number;
}

/**
 * Optimal driver assignment result
 */
export interface DriverAssignmentResult {
  orderId: string;
  assignedDriver: {
    driverId: string;
    name: string;
    phone: string;
    vehicleNumber: string;
    vehicleType: string;
  } | null;
  estimatedPickupTime: number; // minutes
  estimatedDeliveryTime: number; // minutes
  distanceToPickup: number; // km
  totalDistance: number; // km
  assignmentScore: number;
  alternateDrivers: Array<{
    driverId: string;
    score: number;
    eta: number;
  }>;
}

/**
 * Batch optimization result
 */
export interface BatchOptimizationResult {
  batchId: string;
  orders: Array<{
    orderId: string;
    sequence: number;
    pickupEta: number;
    deliveryEta: number;
  }>;
  totalDistance: number;
  totalTime: number;
  efficiency: number; // 0-100 score
  route: Array<{
    type: 'PICKUP' | 'DELIVERY';
    orderId: string;
    lat: number;
    lng: number;
    eta: number;
  }>;
}

/**
 * Serviceability check result
 */
export interface ServiceabilityResult {
  isServiceable: boolean;
  zone?: DeliveryZone;
  estimatedDeliveryMinutes?: number;
  deliveryFee?: number;
  surgeApplied: boolean;
  surgeMultiplier: number;
  reason?: string;
}

/**
 * Demand prediction for a zone
 */
export interface DemandPrediction {
  zoneId: string;
  hour: number;
  predictedOrders: number;
  recommendedDrivers: number;
  confidence: number;
}

/**
 * HyperlocalOptimizationService - Optimizes hyperlocal deliveries for quick commerce
 *
 * ONDC Hyperlocal Requirements:
 * - Real-time driver assignment
 * - Dynamic ETAs based on traffic/demand
 * - Zone-based serviceability
 * - Batch optimization for efficiency
 * - Demand prediction and driver positioning
 */
@Injectable()
export class HyperlocalOptimizationService {
  private readonly logger = new Logger(HyperlocalOptimizationService.name);
  private readonly maxDeliveryRadiusKm: number;
  private readonly baseDeliveryFee: number;
  private readonly perKmRate: number;
  private readonly maxBatchSize: number;
  private readonly zones: Map<string, DeliveryZone> = new Map();
  private readonly driverLocations: Map<string, DriverLocation> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.maxDeliveryRadiusKm = this.configService.get<number>(
      'HYPERLOCAL_MAX_RADIUS_KM',
      15,
    );
    this.baseDeliveryFee = this.configService.get<number>(
      'HYPERLOCAL_BASE_FEE',
      30,
    );
    this.perKmRate = this.configService.get<number>(
      'HYPERLOCAL_PER_KM_RATE',
      8,
    );
    this.maxBatchSize = this.configService.get<number>(
      'HYPERLOCAL_MAX_BATCH_SIZE',
      3,
    );

    // Initialize default zones (should be loaded from DB in production)
    this.initializeDefaultZones();
  }

  /**
   * Initialize default delivery zones
   */
  private initializeDefaultZones(): void {
    const defaultZones: DeliveryZone[] = [
      {
        zoneId: 'ZONE_HYD_HITECH',
        zoneName: 'Hyderabad Hitech City',
        centerLat: 17.4435,
        centerLng: 78.3772,
        radiusKm: 5,
        serviceable: true,
        deliveryTimeMinutes: 30,
        surgeMultiplier: 1.0,
        activeDrivers: 0,
        pendingOrders: 0,
      },
      {
        zoneId: 'ZONE_HYD_GACHI',
        zoneName: 'Hyderabad Gachibowli',
        centerLat: 17.4401,
        centerLng: 78.3489,
        radiusKm: 5,
        serviceable: true,
        deliveryTimeMinutes: 25,
        surgeMultiplier: 1.0,
        activeDrivers: 0,
        pendingOrders: 0,
      },
      {
        zoneId: 'ZONE_HYD_JUBILEE',
        zoneName: 'Hyderabad Jubilee Hills',
        centerLat: 17.4326,
        centerLng: 78.4071,
        radiusKm: 4,
        serviceable: true,
        deliveryTimeMinutes: 25,
        surgeMultiplier: 1.0,
        activeDrivers: 0,
        pendingOrders: 0,
      },
      {
        zoneId: 'ZONE_HYD_BANJARA',
        zoneName: 'Hyderabad Banjara Hills',
        centerLat: 17.4156,
        centerLng: 78.4347,
        radiusKm: 4,
        serviceable: true,
        deliveryTimeMinutes: 25,
        surgeMultiplier: 1.0,
        activeDrivers: 0,
        pendingOrders: 0,
      },
      {
        zoneId: 'ZONE_HYD_MADHAPUR',
        zoneName: 'Hyderabad Madhapur',
        centerLat: 17.4484,
        centerLng: 78.3908,
        radiusKm: 4,
        serviceable: true,
        deliveryTimeMinutes: 20,
        surgeMultiplier: 1.0,
        activeDrivers: 0,
        pendingOrders: 0,
      },
    ];

    defaultZones.forEach((zone) => this.zones.set(zone.zoneId, zone));
  }

  /**
   * Check if a location is serviceable
   */
  async checkServiceability(
    pickupLat: number,
    pickupLng: number,
    deliveryLat: number,
    deliveryLng: number,
  ): Promise<ServiceabilityResult> {
    // Calculate distance
    const distance = this.calculateDistance(
      pickupLat,
      pickupLng,
      deliveryLat,
      deliveryLng,
    );

    // Check if within max radius
    if (distance > this.maxDeliveryRadiusKm) {
      return {
        isServiceable: false,
        surgeApplied: false,
        surgeMultiplier: 1.0,
        reason: `Distance ${distance.toFixed(1)}km exceeds max hyperlocal radius of ${this.maxDeliveryRadiusKm}km`,
      };
    }

    // Find delivery zone
    const zone = this.findZoneForLocation(deliveryLat, deliveryLng);

    if (!zone || !zone.serviceable) {
      return {
        isServiceable: false,
        surgeApplied: false,
        surgeMultiplier: 1.0,
        reason: 'Delivery location not in serviceable zone',
      };
    }

    // Calculate delivery fee with surge
    const baseFee = this.baseDeliveryFee + distance * this.perKmRate;
    const deliveryFee = baseFee * zone.surgeMultiplier;

    // Calculate ETA based on distance and zone conditions
    const baseEta = this.calculateBaseEta(distance);
    const adjustedEta = Math.ceil(baseEta * this.getTrafficMultiplier());

    return {
      isServiceable: true,
      zone,
      estimatedDeliveryMinutes: adjustedEta,
      deliveryFee: Math.round(deliveryFee),
      surgeApplied: zone.surgeMultiplier > 1.0,
      surgeMultiplier: zone.surgeMultiplier,
    };
  }

  /**
   * Find optimal driver for an order
   */
  async findOptimalDriver(
    orderId: string,
    pickupLat: number,
    pickupLng: number,
    deliveryLat: number,
    deliveryLng: number,
    requiredVehicleType?: string,
  ): Promise<DriverAssignmentResult> {
    // Get available drivers
    const availableDrivers = await this.getAvailableDrivers(
      pickupLat,
      pickupLng,
      10, // Search within 10km radius
    );

    if (availableDrivers.length === 0) {
      return {
        orderId,
        assignedDriver: null,
        estimatedPickupTime: 0,
        estimatedDeliveryTime: 0,
        distanceToPickup: 0,
        totalDistance: 0,
        assignmentScore: 0,
        alternateDrivers: [],
      };
    }

    // Filter by vehicle type if required
    const eligibleDrivers = requiredVehicleType
      ? availableDrivers.filter((d) => d.vehicleType === requiredVehicleType)
      : availableDrivers;

    // Score and rank drivers
    const scoredDrivers = eligibleDrivers.map((driver) => {
      const distanceToPickup = this.calculateDistance(
        driver.lat,
        driver.lng,
        pickupLat,
        pickupLng,
      );

      const pickupEta = this.calculateBaseEta(distanceToPickup);
      const deliveryDistance = this.calculateDistance(
        pickupLat,
        pickupLng,
        deliveryLat,
        deliveryLng,
      );

      // Scoring factors
      const distanceScore = Math.max(0, 100 - distanceToPickup * 10);
      const ratingScore = driver.rating * 20;
      const experienceScore = Math.min(driver.totalDeliveries / 10, 50);

      const totalScore = distanceScore + ratingScore + experienceScore;

      return {
        driver,
        distanceToPickup,
        pickupEta,
        deliveryDistance,
        totalScore,
      };
    });

    // Sort by score
    scoredDrivers.sort((a, b) => b.totalScore - a.totalScore);

    const bestDriver = scoredDrivers[0];

    // Get driver details from database (User model with role=DRIVER)
    const driverDetails = await this.prisma.user.findUnique({
      where: { id: bestDriver.driver.driverId },
    });

    const totalDistance =
      bestDriver.distanceToPickup + bestDriver.deliveryDistance;
    const deliveryEta =
      bestDriver.pickupEta + this.calculateBaseEta(bestDriver.deliveryDistance);

    return {
      orderId,
      assignedDriver: driverDetails
        ? {
            driverId: driverDetails.id,
            name: driverDetails.name,
            phone: driverDetails.phone,
            vehicleNumber: 'N/A', // Not stored directly on User model
            vehicleType: driverDetails.vehicleType || 'BIKE',
          }
        : null,
      estimatedPickupTime: Math.ceil(bestDriver.pickupEta),
      estimatedDeliveryTime: Math.ceil(deliveryEta),
      distanceToPickup: Math.round(bestDriver.distanceToPickup * 100) / 100,
      totalDistance: Math.round(totalDistance * 100) / 100,
      assignmentScore: Math.round(bestDriver.totalScore),
      alternateDrivers: scoredDrivers.slice(1, 4).map((s) => ({
        driverId: s.driver.driverId,
        score: Math.round(s.totalScore),
        eta: Math.ceil(s.pickupEta),
      })),
    };
  }

  /**
   * Get available drivers near a location
   */
  private async getAvailableDrivers(
    lat: number,
    lng: number,
    radiusKm: number,
  ): Promise<DriverLocation[]> {
    // Get active drivers from database (User model with role=DRIVER)
    const drivers = await this.prisma.user.findMany({
      where: {
        role: 'DRIVER',
        driverStatus: 'ONLINE', // Use driverStatus enum
        isActive: true,
      },
    });

    // Convert to DriverLocation with distance filtering
    const driverLocations: DriverLocation[] = [];

    for (const driver of drivers) {
      // Use stored location or default (in production, use real-time location)
      const driverLat = driver.currentLatitude
        ? parseFloat(driver.currentLatitude.toString())
        : lat + (Math.random() - 0.5) * 0.05;
      const driverLng = driver.currentLongitude
        ? parseFloat(driver.currentLongitude.toString())
        : lng + (Math.random() - 0.5) * 0.05;

      const distance = this.calculateDistance(lat, lng, driverLat, driverLng);

      if (distance <= radiusKm) {
        driverLocations.push({
          driverId: driver.id,
          lat: driverLat,
          lng: driverLng,
          lastUpdated: driver.updatedAt,
          isAvailable: true,
          vehicleType:
            (driver.vehicleType as DriverLocation['vehicleType']) || 'BIKE',
          rating: 4.5, // Default rating
          totalDeliveries: 0, // Would need separate tracking
        });
      }
    }

    return driverLocations;
  }

  /**
   * Optimize batch delivery for a driver
   */
  async optimizeBatch(
    driverId: string,
    orderIds: string[],
  ): Promise<BatchOptimizationResult> {
    if (orderIds.length > this.maxBatchSize) {
      orderIds = orderIds.slice(0, this.maxBatchSize);
    }

    const batchId = `BATCH-${driverId.slice(0, 8)}-${Date.now()}`;

    // Get order details
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
    });

    // Get fulfillments separately
    const fulfillments = await this.prisma.ondcFulfillment.findMany({
      where: { orderId: { in: orderIds } },
    });
    const fulfillmentMap = new Map(fulfillments.map((f) => [f.orderId, f]));

    if (orders.length === 0) {
      return {
        batchId,
        orders: [],
        totalDistance: 0,
        totalTime: 0,
        efficiency: 0,
        route: [],
      };
    }

    // Extract pickup and delivery points
    const points: Array<{
      type: 'PICKUP' | 'DELIVERY';
      orderId: string;
      lat: number;
      lng: number;
    }> = [];

    for (const order of orders) {
      const fulfillment = fulfillmentMap.get(order.id);
      if (fulfillment) {
        const pickupAddr = fulfillment.pickupAddress as Record<
          string,
          unknown
        > | null;
        const deliveryAddr = order.deliveryAddress as Record<
          string,
          unknown
        > | null;

        if (pickupAddr) {
          const gps = String(pickupAddr.gps || '').split(',');
          if (gps.length === 2) {
            points.push({
              type: 'PICKUP',
              orderId: order.id,
              lat: parseFloat(gps[0]),
              lng: parseFloat(gps[1]),
            });
          }
        }

        if (deliveryAddr) {
          const gps = String(deliveryAddr.gps || '').split(',');
          if (gps.length === 2) {
            points.push({
              type: 'DELIVERY',
              orderId: order.id,
              lat: parseFloat(gps[0]),
              lng: parseFloat(gps[1]),
            });
          }
        }
      }
    }

    // Optimize route using nearest neighbor heuristic
    const optimizedRoute = this.nearestNeighborRoute(points);

    // Calculate total distance and time
    let totalDistance = 0;
    let currentTime = 0;
    const route: BatchOptimizationResult['route'] = [];

    for (let i = 0; i < optimizedRoute.length; i++) {
      const point = optimizedRoute[i];

      if (i > 0) {
        const prevPoint = optimizedRoute[i - 1];
        const segmentDistance = this.calculateDistance(
          prevPoint.lat,
          prevPoint.lng,
          point.lat,
          point.lng,
        );
        totalDistance += segmentDistance;
        currentTime += this.calculateBaseEta(segmentDistance);
      }

      // Add stop time
      currentTime += point.type === 'PICKUP' ? 5 : 3; // minutes

      route.push({
        ...point,
        eta: Math.ceil(currentTime),
      });
    }

    // Calculate order-specific ETAs
    const orderResults: BatchOptimizationResult['orders'] = [];
    let sequence = 1;

    for (const order of orders) {
      const pickupPoint = route.find(
        (p) => p.orderId === order.id && p.type === 'PICKUP',
      );
      const deliveryPoint = route.find(
        (p) => p.orderId === order.id && p.type === 'DELIVERY',
      );

      orderResults.push({
        orderId: order.id,
        sequence: sequence++,
        pickupEta: pickupPoint?.eta || 0,
        deliveryEta: deliveryPoint?.eta || 0,
      });
    }

    // Calculate efficiency score
    const directDistance = orders.reduce((sum, order) => {
      const fulfillment = fulfillmentMap.get(order.id);
      if (!fulfillment) return sum;

      const pickupAddr = fulfillment.pickupAddress as Record<
        string,
        unknown
      > | null;
      const deliveryAddr = order.deliveryAddress as Record<
        string,
        unknown
      > | null;

      if (pickupAddr && deliveryAddr) {
        const pickupGps = String(pickupAddr.gps || '').split(',');
        const deliveryGps = String(deliveryAddr.gps || '').split(',');

        if (pickupGps.length === 2 && deliveryGps.length === 2) {
          return (
            sum +
            this.calculateDistance(
              parseFloat(pickupGps[0]),
              parseFloat(pickupGps[1]),
              parseFloat(deliveryGps[0]),
              parseFloat(deliveryGps[1]),
            )
          );
        }
      }
      return sum;
    }, 0);

    const efficiency =
      totalDistance > 0
        ? Math.min(100, Math.round((directDistance / totalDistance) * 100))
        : 0;

    this.logger.log(
      `Batch ${batchId} optimized: ${orders.length} orders, ${totalDistance.toFixed(1)}km, ${Math.ceil(currentTime)}min, ${efficiency}% efficiency`,
    );

    return {
      batchId,
      orders: orderResults,
      totalDistance: Math.round(totalDistance * 100) / 100,
      totalTime: Math.ceil(currentTime),
      efficiency,
      route,
    };
  }

  /**
   * Nearest neighbor route optimization
   */
  private nearestNeighborRoute(
    points: Array<{
      type: 'PICKUP' | 'DELIVERY';
      orderId: string;
      lat: number;
      lng: number;
    }>,
  ): typeof points {
    if (points.length <= 1) return points;

    const route: typeof points = [];
    const remaining = [...points];
    const pickedUp = new Set<string>();

    // Start with first pickup
    const firstPickup = remaining.find((p) => p.type === 'PICKUP');
    if (firstPickup) {
      route.push(firstPickup);
      remaining.splice(remaining.indexOf(firstPickup), 1);
      pickedUp.add(firstPickup.orderId);
    }

    while (remaining.length > 0) {
      const lastPoint = route[route.length - 1];

      // Find nearest valid point (pickup, or delivery if pickup done)
      let nearestIdx = -1;
      let nearestDist = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const point = remaining[i];

        // Can only deliver if pickup is done
        if (point.type === 'DELIVERY' && !pickedUp.has(point.orderId)) {
          continue;
        }

        const dist = this.calculateDistance(
          lastPoint.lat,
          lastPoint.lng,
          point.lat,
          point.lng,
        );

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }

      if (nearestIdx >= 0) {
        const nextPoint = remaining[nearestIdx];
        route.push(nextPoint);
        remaining.splice(nearestIdx, 1);

        if (nextPoint.type === 'PICKUP') {
          pickedUp.add(nextPoint.orderId);
        }
      } else {
        // Shouldn't happen, but safety
        break;
      }
    }

    return route;
  }

  /**
   * Update zone surge pricing based on demand
   */
  async updateZoneSurge(
    zoneId: string,
    activeDrivers: number,
    pendingOrders: number,
  ): Promise<DeliveryZone | null> {
    const zone = this.zones.get(zoneId);
    if (!zone) return null;

    // Calculate demand-supply ratio
    const ratio = activeDrivers > 0 ? pendingOrders / activeDrivers : 10;

    // Determine surge multiplier
    let surgeMultiplier = 1.0;
    if (ratio > 3) surgeMultiplier = 2.0;
    else if (ratio > 2) surgeMultiplier = 1.5;
    else if (ratio > 1.5) surgeMultiplier = 1.25;

    // Update zone
    zone.activeDrivers = activeDrivers;
    zone.pendingOrders = pendingOrders;
    zone.surgeMultiplier = surgeMultiplier;

    this.zones.set(zoneId, zone);

    this.logger.log(
      `Zone ${zoneId} surge updated: ratio=${ratio.toFixed(1)}, surge=${surgeMultiplier}x`,
    );

    return zone;
  }

  /**
   * Predict demand for zones
   */
  predictDemand(hour: number): DemandPrediction[] {
    const predictions: DemandPrediction[] = [];

    // Simple hour-based demand prediction
    const baseMultiplier = this.getHourDemandMultiplier(hour);

    for (const zone of this.zones.values()) {
      const baseDemand = 20; // Average orders per hour
      const predictedOrders = Math.round(baseDemand * baseMultiplier);
      const recommendedDrivers = Math.ceil(predictedOrders / 3); // 3 orders per driver per hour

      predictions.push({
        zoneId: zone.zoneId,
        hour,
        predictedOrders,
        recommendedDrivers,
        confidence: 0.75, // ML model would provide real confidence
      });
    }

    return predictions;
  }

  /**
   * Get demand multiplier based on hour
   */
  private getHourDemandMultiplier(hour: number): number {
    // Peak hours: lunch (12-14), dinner (19-22)
    if (hour >= 12 && hour <= 14) return 1.8;
    if (hour >= 19 && hour <= 22) return 2.0;
    if (hour >= 10 && hour <= 11) return 1.3;
    if (hour >= 15 && hour <= 18) return 1.2;
    if (hour >= 7 && hour <= 9) return 1.0;
    return 0.5; // Off-peak
  }

  /**
   * Get traffic multiplier (time-based)
   */
  private getTrafficMultiplier(): number {
    const hour = new Date().getHours();

    // Peak traffic hours
    if ((hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 20)) {
      return 1.5;
    }
    if ((hour >= 7 && hour <= 8) || (hour >= 10 && hour <= 11)) {
      return 1.25;
    }

    return 1.0;
  }

  /**
   * Calculate base ETA in minutes
   */
  private calculateBaseEta(distanceKm: number): number {
    // Assume 20 km/h average speed for hyperlocal
    const speedKmH = 20;
    return (distanceKm / speedKmH) * 60;
  }

  /**
   * Find zone for a location
   */
  private findZoneForLocation(lat: number, lng: number): DeliveryZone | null {
    for (const zone of this.zones.values()) {
      const distance = this.calculateDistance(
        lat,
        lng,
        zone.centerLat,
        zone.centerLng,
      );

      if (distance <= zone.radiusKm) {
        return zone;
      }
    }
    return null;
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  private calculateDistance(
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
   * Store hyperlocal optimization data in fulfillment
   */
  async storeOptimizationData(
    orderId: string,
    data: {
      zone?: DeliveryZone;
      assignment?: DriverAssignmentResult;
      batch?: BatchOptimizationResult;
    },
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
      _hyperlocalOptimization: {
        zone: data.zone
          ? {
              zoneId: data.zone.zoneId,
              zoneName: data.zone.zoneName,
              surgeMultiplier: data.zone.surgeMultiplier,
            }
          : undefined,
        assignment: data.assignment
          ? {
              driverId: data.assignment.assignedDriver?.driverId,
              estimatedPickupTime: data.assignment.estimatedPickupTime,
              estimatedDeliveryTime: data.assignment.estimatedDeliveryTime,
              assignmentScore: data.assignment.assignmentScore,
            }
          : undefined,
        batch: data.batch
          ? {
              batchId: data.batch.batchId,
              sequence: data.batch.orders.find((o) => o.orderId === orderId)
                ?.sequence,
              efficiency: data.batch.efficiency,
            }
          : undefined,
        updatedAt: new Date().toISOString(),
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
   * Build ONDC hyperlocal tags
   */
  buildHyperlocalTags(
    serviceability: ServiceabilityResult,
    assignment?: DriverAssignmentResult,
  ): Array<{
    descriptor: { code: string };
    list: Array<{ descriptor: { code: string }; value: string }>;
  }> {
    const tags: Array<{
      descriptor: { code: string };
      list: Array<{ descriptor: { code: string }; value: string }>;
    }> = [];

    // Serviceability tags
    tags.push({
      descriptor: { code: 'serviceability' },
      list: [
        {
          descriptor: { code: 'is_serviceable' },
          value: serviceability.isServiceable.toString(),
        },
        {
          descriptor: { code: 'estimated_delivery_minutes' },
          value: (serviceability.estimatedDeliveryMinutes || 0).toString(),
        },
        {
          descriptor: { code: 'delivery_fee' },
          value: (serviceability.deliveryFee || 0).toString(),
        },
        {
          descriptor: { code: 'surge_applied' },
          value: serviceability.surgeApplied.toString(),
        },
        {
          descriptor: { code: 'surge_multiplier' },
          value: serviceability.surgeMultiplier.toFixed(2),
        },
      ],
    });

    // Assignment tags
    if (assignment && assignment.assignedDriver) {
      tags.push({
        descriptor: { code: 'driver_assignment' },
        list: [
          {
            descriptor: { code: 'driver_id' },
            value: assignment.assignedDriver.driverId,
          },
          {
            descriptor: { code: 'vehicle_type' },
            value: assignment.assignedDriver.vehicleType,
          },
          {
            descriptor: { code: 'estimated_pickup_minutes' },
            value: assignment.estimatedPickupTime.toString(),
          },
          {
            descriptor: { code: 'estimated_delivery_minutes' },
            value: assignment.estimatedDeliveryTime.toString(),
          },
          {
            descriptor: { code: 'assignment_score' },
            value: assignment.assignmentScore.toString(),
          },
        ],
      });
    }

    return tags;
  }
}
