// ============================================
// Surge Pricing Service
// File: src/ondc/services/surge-pricing.service.ts
// ONDC Logistics - Dynamic pricing based on demand, time, and conditions
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { ConfigService } from '@nestjs/config';

/**
 * Surge factor breakdown
 */
export interface SurgeFactors {
  demandSupplyRatio: number;
  timeOfDay: number;
  weather: number;
  specialEvent: number;
  zoneMultiplier: number;
  vehicleType: number;
  distance: number;
}

/**
 * Surge pricing result
 */
export interface SurgePricingResult {
  basePrice: number;
  surgeMultiplier: number;
  finalPrice: number;
  factors: SurgeFactors;
  breakdown: {
    baseFare: number;
    distanceFare: number;
    surgeFare: number;
    taxes: number;
    total: number;
  };
  validUntil: Date;
  surgeLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  explanation: string;
}

/**
 * Zone surge data
 */
export interface ZoneSurgeData {
  zoneId: string;
  zoneName: string;
  activeDrivers: number;
  pendingOrders: number;
  demandRatio: number;
  currentSurge: number;
  lastUpdated: Date;
}

/**
 * Weather condition for surge calculation
 */
export type WeatherCondition =
  | 'CLEAR'
  | 'CLOUDY'
  | 'LIGHT_RAIN'
  | 'HEAVY_RAIN'
  | 'STORM'
  | 'EXTREME_HEAT'
  | 'EXTREME_COLD';

/**
 * Special event type
 */
export interface SpecialEvent {
  eventId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  affectedZones: string[];
  surgeMultiplier: number;
  priority: number;
}

/**
 * Vehicle type pricing
 */
interface VehiclePricing {
  baseFare: number;
  perKmRate: number;
  perMinRate: number;
  minFare: number;
  surgeCapMultiplier: number;
}

/**
 * SurgePricingService - Dynamic pricing engine for ONDC logistics
 *
 * ONDC Requirements:
 * - Transparent pricing breakdown
 * - Real-time surge based on demand
 * - Zone-based pricing
 * - Weather and event adjustments
 */
@Injectable()
export class SurgePricingService {
  private readonly logger = new Logger(SurgePricingService.name);
  private readonly maxSurgeMultiplier: number;
  private readonly minSurgeMultiplier: number;
  private readonly taxRate: number;
  private readonly zoneSurgeData: Map<string, ZoneSurgeData> = new Map();
  private readonly activeEvents: Map<string, SpecialEvent> = new Map();
  private currentWeather: WeatherCondition = 'CLEAR';

  private readonly vehiclePricing: Record<string, VehiclePricing> = {
    BIKE: {
      baseFare: 20,
      perKmRate: 8,
      perMinRate: 1,
      minFare: 30,
      surgeCapMultiplier: 3.0,
    },
    SCOOTER: {
      baseFare: 25,
      perKmRate: 10,
      perMinRate: 1.2,
      minFare: 35,
      surgeCapMultiplier: 3.0,
    },
    THREE_WHEELER: {
      baseFare: 35,
      perKmRate: 12,
      perMinRate: 1.5,
      minFare: 50,
      surgeCapMultiplier: 2.5,
    },
    FOUR_WHEELER: {
      baseFare: 50,
      perKmRate: 15,
      perMinRate: 2,
      minFare: 80,
      surgeCapMultiplier: 2.5,
    },
    MINI_TRUCK: {
      baseFare: 100,
      perKmRate: 20,
      perMinRate: 3,
      minFare: 150,
      surgeCapMultiplier: 2.0,
    },
    TRUCK: {
      baseFare: 200,
      perKmRate: 25,
      perMinRate: 4,
      minFare: 300,
      surgeCapMultiplier: 2.0,
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.maxSurgeMultiplier = this.configService.get<number>('MAX_SURGE', 3.0);
    this.minSurgeMultiplier = this.configService.get<number>('MIN_SURGE', 1.0);
    this.taxRate = this.configService.get<number>('TAX_RATE', 0.18); // 18% GST
  }

  /**
   * Calculate surge pricing for a delivery
   */
  calculateSurgePrice(
    zoneId: string,
    vehicleType: string,
    distanceKm: number,
    estimatedMinutes: number,
    pickupLat?: number,
    pickupLng?: number,
  ): SurgePricingResult {
    // Get vehicle pricing
    const pricing =
      this.vehiclePricing[vehicleType] || this.vehiclePricing.BIKE;

    // Calculate base price
    const baseFare = pricing.baseFare;
    const distanceFare = distanceKm * pricing.perKmRate;
    const timeFare = estimatedMinutes * pricing.perMinRate;
    const basePrice = Math.max(
      baseFare + distanceFare + timeFare,
      pricing.minFare,
    );

    // Calculate surge factors
    const factors = this.calculateSurgeFactors(
      zoneId,
      vehicleType,
      distanceKm,
      pickupLat,
      pickupLng,
    );

    // Calculate total surge multiplier
    const rawSurge = this.combineSurgeFactors(factors);

    // Apply caps
    const cappedSurge = Math.min(
      Math.max(rawSurge, this.minSurgeMultiplier),
      Math.min(this.maxSurgeMultiplier, pricing.surgeCapMultiplier),
    );

    // Calculate final price
    const surgeFare = basePrice * (cappedSurge - 1);
    const subtotal = basePrice + surgeFare;
    const taxes = subtotal * this.taxRate;
    const finalPrice = Math.round(subtotal + taxes);

    // Determine surge level
    const surgeLevel = this.getSurgeLevel(cappedSurge);

    // Generate explanation
    const explanation = this.generateExplanation(factors, surgeLevel);

    // Set validity (surge price valid for 5 minutes)
    const validUntil = new Date();
    validUntil.setMinutes(validUntil.getMinutes() + 5);

    return {
      basePrice: Math.round(basePrice),
      surgeMultiplier: Math.round(cappedSurge * 100) / 100,
      finalPrice,
      factors,
      breakdown: {
        baseFare: Math.round(baseFare),
        distanceFare: Math.round(distanceFare),
        surgeFare: Math.round(surgeFare),
        taxes: Math.round(taxes),
        total: finalPrice,
      },
      validUntil,
      surgeLevel,
      explanation,
    };
  }

  /**
   * Calculate individual surge factors
   */
  private calculateSurgeFactors(
    zoneId: string,
    vehicleType: string,
    distanceKm: number,
    _pickupLat?: number,
    _pickupLng?: number,
  ): SurgeFactors {
    // Demand-supply ratio factor
    const zoneData = this.zoneSurgeData.get(zoneId);
    const demandSupplyRatio = zoneData
      ? this.calculateDemandFactor(zoneData.demandRatio)
      : 1.0;

    // Time of day factor
    const timeOfDay = this.calculateTimeFactor();

    // Weather factor
    const weather = this.calculateWeatherFactor();

    // Special event factor
    const specialEvent = this.calculateEventFactor(zoneId);

    // Zone multiplier (premium zones)
    const zoneMultiplier = this.getZoneMultiplier(zoneId);

    // Vehicle type factor
    const vehicleTypeFactor = this.getVehicleTypeFactor(vehicleType);

    // Distance factor (longer distances may have lower surge)
    const distance = this.calculateDistanceFactor(distanceKm);

    return {
      demandSupplyRatio,
      timeOfDay,
      weather,
      specialEvent,
      zoneMultiplier,
      vehicleType: vehicleTypeFactor,
      distance,
    };
  }

  /**
   * Combine surge factors into single multiplier
   */
  private combineSurgeFactors(factors: SurgeFactors): number {
    // Weighted combination
    const weights = {
      demandSupplyRatio: 0.35,
      timeOfDay: 0.2,
      weather: 0.15,
      specialEvent: 0.15,
      zoneMultiplier: 0.05,
      vehicleType: 0.05,
      distance: 0.05,
    };

    let weightedSum = 0;
    let totalWeight = 0;

    for (const [factor, weight] of Object.entries(weights)) {
      weightedSum += factors[factor as keyof SurgeFactors] * weight;
      totalWeight += weight;
    }

    return weightedSum / totalWeight;
  }

  /**
   * Calculate demand factor from ratio
   */
  private calculateDemandFactor(ratio: number): number {
    // ratio = pendingOrders / activeDrivers
    if (ratio <= 0.5) return 0.9; // Low demand - slight discount
    if (ratio <= 1.0) return 1.0; // Normal
    if (ratio <= 1.5) return 1.2;
    if (ratio <= 2.0) return 1.5;
    if (ratio <= 3.0) return 2.0;
    return 2.5; // Very high demand
  }

  /**
   * Calculate time-based factor
   */
  private calculateTimeFactor(): number {
    const hour = new Date().getHours();
    const day = new Date().getDay();

    // Weekend premium
    const isWeekend = day === 0 || day === 6;
    let factor = isWeekend ? 1.1 : 1.0;

    // Peak hours
    if (hour >= 12 && hour <= 14)
      factor *= 1.3; // Lunch
    else if (hour >= 19 && hour <= 21)
      factor *= 1.5; // Dinner
    else if (hour >= 8 && hour <= 10)
      factor *= 1.2; // Morning rush
    else if (hour >= 0 && hour <= 5)
      factor *= 1.4; // Late night
    else if (hour >= 22 && hour <= 23) factor *= 1.2; // Night

    return factor;
  }

  /**
   * Calculate weather factor
   */
  private calculateWeatherFactor(): number {
    const weatherMultipliers: Record<WeatherCondition, number> = {
      CLEAR: 1.0,
      CLOUDY: 1.0,
      LIGHT_RAIN: 1.3,
      HEAVY_RAIN: 1.8,
      STORM: 2.5,
      EXTREME_HEAT: 1.2,
      EXTREME_COLD: 1.2,
    };

    return weatherMultipliers[this.currentWeather] || 1.0;
  }

  /**
   * Calculate special event factor
   */
  private calculateEventFactor(zoneId: string): number {
    const now = new Date();
    let maxMultiplier = 1.0;

    for (const event of this.activeEvents.values()) {
      if (
        event.startDate <= now &&
        event.endDate >= now &&
        event.affectedZones.includes(zoneId)
      ) {
        maxMultiplier = Math.max(maxMultiplier, event.surgeMultiplier);
      }
    }

    return maxMultiplier;
  }

  /**
   * Get zone-specific multiplier
   */
  private getZoneMultiplier(zoneId: string): number {
    // Premium zones (business districts, airports, etc.)
    const premiumZones: Record<string, number> = {
      ZONE_HYD_HITECH: 1.15,
      ZONE_HYD_AIRPORT: 1.25,
      ZONE_HYD_JUBILEE: 1.1,
      ZONE_HYD_BANJARA: 1.1,
    };

    return premiumZones[zoneId] || 1.0;
  }

  /**
   * Get vehicle type factor
   */
  private getVehicleTypeFactor(vehicleType: string): number {
    // Larger vehicles have lower surge sensitivity
    const factors: Record<string, number> = {
      BIKE: 1.0,
      SCOOTER: 1.0,
      THREE_WHEELER: 0.95,
      FOUR_WHEELER: 0.9,
      MINI_TRUCK: 0.85,
      TRUCK: 0.8,
    };

    return factors[vehicleType] || 1.0;
  }

  /**
   * Calculate distance factor
   */
  private calculateDistanceFactor(distanceKm: number): number {
    // Longer distances have slightly lower surge
    if (distanceKm <= 3) return 1.1; // Short trips higher surge
    if (distanceKm <= 10) return 1.0;
    if (distanceKm <= 20) return 0.95;
    return 0.9; // Long trips lower surge
  }

  /**
   * Determine surge level
   */
  private getSurgeLevel(
    multiplier: number,
  ): 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' {
    if (multiplier <= 1.0) return 'NONE';
    if (multiplier <= 1.25) return 'LOW';
    if (multiplier <= 1.5) return 'MEDIUM';
    if (multiplier <= 2.0) return 'HIGH';
    return 'VERY_HIGH';
  }

  /**
   * Generate human-readable explanation
   */
  private generateExplanation(
    factors: SurgeFactors,
    level: SurgePricingResult['surgeLevel'],
  ): string {
    if (level === 'NONE') {
      return 'Normal pricing - no surge applied';
    }

    const reasons: string[] = [];

    if (factors.demandSupplyRatio > 1.3) {
      reasons.push('high demand in your area');
    }
    if (factors.timeOfDay > 1.2) {
      reasons.push('peak hours');
    }
    if (factors.weather > 1.2) {
      reasons.push('weather conditions');
    }
    if (factors.specialEvent > 1.0) {
      reasons.push('special event');
    }

    if (reasons.length === 0) {
      return `${level.toLowerCase().replace('_', ' ')} surge pricing active`;
    }

    return `Surge pricing due to ${reasons.join(', ')}`;
  }

  /**
   * Update zone demand data
   */
  async updateZoneDemand(
    zoneId: string,
    zoneName: string,
    activeDrivers: number,
    pendingOrders: number,
  ): Promise<ZoneSurgeData> {
    const demandRatio =
      activeDrivers > 0 ? pendingOrders / activeDrivers : pendingOrders;

    const zoneData: ZoneSurgeData = {
      zoneId,
      zoneName,
      activeDrivers,
      pendingOrders,
      demandRatio,
      currentSurge: this.calculateDemandFactor(demandRatio),
      lastUpdated: new Date(),
    };

    this.zoneSurgeData.set(zoneId, zoneData);

    this.logger.debug(
      `Zone ${zoneId} demand updated: ${activeDrivers} drivers, ${pendingOrders} orders, surge=${zoneData.currentSurge.toFixed(2)}x`,
    );

    return zoneData;
  }

  /**
   * Update weather condition
   */
  updateWeather(condition: WeatherCondition): void {
    this.currentWeather = condition;
    this.logger.log(`Weather updated to: ${condition}`);
  }

  /**
   * Add special event
   */
  addSpecialEvent(event: SpecialEvent): void {
    this.activeEvents.set(event.eventId, event);
    this.logger.log(
      `Special event added: ${event.name} (${event.surgeMultiplier}x surge)`,
    );
  }

  /**
   * Remove special event
   */
  removeSpecialEvent(eventId: string): void {
    this.activeEvents.delete(eventId);
    this.logger.log(`Special event removed: ${eventId}`);
  }

  /**
   * Get all zone surge data
   */
  getAllZoneSurgeData(): ZoneSurgeData[] {
    return Array.from(this.zoneSurgeData.values());
  }

  /**
   * Get current surge for a zone
   */
  getZoneSurge(zoneId: string): number {
    const zoneData = this.zoneSurgeData.get(zoneId);
    return zoneData?.currentSurge || 1.0;
  }

  /**
   * Estimate fare without surge (for comparison)
   */
  estimateBaseFare(
    vehicleType: string,
    distanceKm: number,
    estimatedMinutes: number,
  ): number {
    const pricing =
      this.vehiclePricing[vehicleType] || this.vehiclePricing.BIKE;

    const baseFare = pricing.baseFare;
    const distanceFare = distanceKm * pricing.perKmRate;
    const timeFare = estimatedMinutes * pricing.perMinRate;
    const subtotal = Math.max(
      baseFare + distanceFare + timeFare,
      pricing.minFare,
    );
    const taxes = subtotal * this.taxRate;

    return Math.round(subtotal + taxes);
  }

  /**
   * Build ONDC pricing tags
   */
  buildPricingTags(result: SurgePricingResult): Array<{
    descriptor: { code: string };
    list: Array<{ descriptor: { code: string }; value: string }>;
  }> {
    return [
      {
        descriptor: { code: 'pricing' },
        list: [
          {
            descriptor: { code: 'base_price' },
            value: result.basePrice.toString(),
          },
          {
            descriptor: { code: 'surge_multiplier' },
            value: result.surgeMultiplier.toFixed(2),
          },
          {
            descriptor: { code: 'surge_level' },
            value: result.surgeLevel,
          },
          {
            descriptor: { code: 'final_price' },
            value: result.finalPrice.toString(),
          },
          {
            descriptor: { code: 'valid_until' },
            value: result.validUntil.toISOString(),
          },
        ],
      },
      {
        descriptor: { code: 'price_breakdown' },
        list: [
          {
            descriptor: { code: 'base_fare' },
            value: result.breakdown.baseFare.toString(),
          },
          {
            descriptor: { code: 'distance_fare' },
            value: result.breakdown.distanceFare.toString(),
          },
          {
            descriptor: { code: 'surge_fare' },
            value: result.breakdown.surgeFare.toString(),
          },
          {
            descriptor: { code: 'taxes' },
            value: result.breakdown.taxes.toString(),
          },
          {
            descriptor: { code: 'total' },
            value: result.breakdown.total.toString(),
          },
        ],
      },
      {
        descriptor: { code: 'surge_factors' },
        list: [
          {
            descriptor: { code: 'demand_supply' },
            value: result.factors.demandSupplyRatio.toFixed(2),
          },
          {
            descriptor: { code: 'time_of_day' },
            value: result.factors.timeOfDay.toFixed(2),
          },
          {
            descriptor: { code: 'weather' },
            value: result.factors.weather.toFixed(2),
          },
          {
            descriptor: { code: 'explanation' },
            value: result.explanation,
          },
        ],
      },
    ];
  }
}
