// ============================================
// Weight Differential Service
// File: src/ondc/services/weight-differential.service.ts
// ONDC Logistics - Weight differential handling for package mismatches
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

/**
 * Weight measurement details
 */
export interface WeightMeasurement {
  declaredWeight: number; // Weight declared by sender (kg)
  actualWeight: number; // Weight measured at pickup/hub (kg)
  measuredAt: Date;
  measuredBy: string; // Driver ID or Hub ID
  measurementLocation: 'PICKUP' | 'HUB' | 'DELIVERY';
  deviceId?: string; // Weighing scale device ID
}

/**
 * Weight differential calculation result
 */
export interface WeightDifferentialResult {
  orderId: string;
  declaredWeight: number;
  actualWeight: number;
  differenceKg: number;
  differencePercentage: number;
  isWithinTolerance: boolean;
  additionalCharges: number;
  chargeBreakdown: {
    baseRate: number;
    perKgRate: number;
    applicableWeight: number;
    totalCharge: number;
  };
  requiresApproval: boolean;
  status: 'ACCEPTED' | 'DISPUTED' | 'PENDING_APPROVAL' | 'CHARGED';
}

/**
 * Weight slab for pricing
 */
interface WeightSlab {
  minWeight: number;
  maxWeight: number;
  ratePerKg: number;
}

/**
 * WeightDifferentialService - Handles weight mismatches per ONDC Logistics spec
 *
 * ONDC Requirement:
 * - Track declared vs actual weight
 * - Apply differential charges when actual > declared
 * - Support tolerance threshold
 * - Generate weight differential reports
 */
@Injectable()
export class WeightDifferentialService {
  private readonly logger = new Logger(WeightDifferentialService.name);
  private readonly tolerancePercentage: number;
  private readonly baseRatePerKg: number;
  private readonly weightSlabs: WeightSlab[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    // Tolerance percentage (typically 5-10% allowed)
    this.tolerancePercentage = this.configService.get<number>(
      'WEIGHT_TOLERANCE_PERCENTAGE',
      10,
    );

    // Base rate per kg for differential charges
    this.baseRatePerKg = this.configService.get<number>(
      'WEIGHT_DIFFERENTIAL_RATE_PER_KG',
      15,
    );

    // Weight slabs for tiered pricing
    this.weightSlabs = [
      { minWeight: 0, maxWeight: 5, ratePerKg: 10 },
      { minWeight: 5, maxWeight: 10, ratePerKg: 12 },
      { minWeight: 10, maxWeight: 20, ratePerKg: 15 },
      { minWeight: 20, maxWeight: 50, ratePerKg: 18 },
      { minWeight: 50, maxWeight: Infinity, ratePerKg: 20 },
    ];
  }

  /**
   * Record weight measurement at pickup
   */
  async recordPickupWeight(
    orderId: string,
    actualWeight: number,
    measuredBy: string,
    deviceId?: string,
  ): Promise<WeightDifferentialResult> {
    return this.recordWeight(
      orderId,
      actualWeight,
      measuredBy,
      'PICKUP',
      deviceId,
    );
  }

  /**
   * Record weight measurement at hub
   */
  async recordHubWeight(
    orderId: string,
    actualWeight: number,
    measuredBy: string,
    deviceId?: string,
  ): Promise<WeightDifferentialResult> {
    return this.recordWeight(
      orderId,
      actualWeight,
      measuredBy,
      'HUB',
      deviceId,
    );
  }

  /**
   * Record weight measurement
   */
  private async recordWeight(
    orderId: string,
    actualWeight: number,
    measuredBy: string,
    location: 'PICKUP' | 'HUB' | 'DELIVERY',
    deviceId?: string,
  ): Promise<WeightDifferentialResult> {
    // Get order with declared weight
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // Get declared weight from order items or metadata
    const items = order.items as Array<{ weight?: number }> | null;
    const declaredWeight =
      items?.reduce((sum, item) => sum + (item.weight || 0), 0) || 1;

    // Calculate differential
    const result = this.calculateDifferential(
      orderId,
      declaredWeight,
      actualWeight,
    );

    // Store measurement in fulfillment
    await this.storeWeightMeasurement(orderId, {
      declaredWeight,
      actualWeight,
      measuredAt: new Date(),
      measuredBy,
      measurementLocation: location,
      deviceId,
    });

    // Update order with weight differential if applicable
    if (!result.isWithinTolerance && result.additionalCharges > 0) {
      await this.applyDifferentialCharges(orderId, result);
    }

    this.logger.log(
      `Weight recorded for order ${orderId}: declared=${declaredWeight}kg, actual=${actualWeight}kg, ` +
        `diff=${result.differencePercentage.toFixed(1)}%, charges=₹${result.additionalCharges}`,
    );

    return result;
  }

  /**
   * Calculate weight differential and charges
   */
  calculateDifferential(
    orderId: string,
    declaredWeight: number,
    actualWeight: number,
  ): WeightDifferentialResult {
    const differenceKg = actualWeight - declaredWeight;
    const differencePercentage =
      declaredWeight > 0 ? (differenceKg / declaredWeight) * 100 : 0;

    // Check if within tolerance
    const isWithinTolerance = differencePercentage <= this.tolerancePercentage;

    // Calculate additional charges if over tolerance
    let additionalCharges = 0;
    let chargeBreakdown = {
      baseRate: 0,
      perKgRate: 0,
      applicableWeight: 0,
      totalCharge: 0,
    };

    if (!isWithinTolerance && differenceKg > 0) {
      // Calculate excess weight beyond tolerance
      const toleranceWeight = declaredWeight * (this.tolerancePercentage / 100);
      const chargeableWeight = Math.max(0, differenceKg - toleranceWeight);

      // Get applicable rate based on actual weight
      const ratePerKg = this.getRateForWeight(actualWeight);

      additionalCharges = chargeableWeight * ratePerKg;

      chargeBreakdown = {
        baseRate: this.baseRatePerKg,
        perKgRate: ratePerKg,
        applicableWeight: chargeableWeight,
        totalCharge: additionalCharges,
      };
    }

    // Determine if approval is required (e.g., >25% difference)
    const requiresApproval = differencePercentage > 25;

    return {
      orderId,
      declaredWeight,
      actualWeight,
      differenceKg,
      differencePercentage,
      isWithinTolerance,
      additionalCharges: Math.round(additionalCharges * 100) / 100,
      chargeBreakdown,
      requiresApproval,
      status: isWithinTolerance
        ? 'ACCEPTED'
        : requiresApproval
          ? 'PENDING_APPROVAL'
          : 'CHARGED',
    };
  }

  /**
   * Get rate per kg based on weight slab
   */
  private getRateForWeight(weight: number): number {
    const slab = this.weightSlabs.find(
      (s) => weight >= s.minWeight && weight < s.maxWeight,
    );
    return slab?.ratePerKg || this.baseRatePerKg;
  }

  /**
   * Store weight measurement in fulfillment
   */
  private async storeWeightMeasurement(
    orderId: string,
    measurement: WeightMeasurement,
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
    const existingMeasurements =
      (pickupAddress._weightMeasurements as Array<Record<string, unknown>>) ||
      [];

    // Serialize measurement to JSON-compatible format
    const serializedMeasurement = {
      declaredWeight: measurement.declaredWeight,
      actualWeight: measurement.actualWeight,
      measuredAt: measurement.measuredAt.toISOString(),
      measuredBy: measurement.measuredBy,
      measurementLocation: measurement.measurementLocation,
      deviceId: measurement.deviceId,
    };

    const updatedPickupAddress = {
      ...pickupAddress,
      _weightMeasurements: [...existingMeasurements, serializedMeasurement],
      _latestWeight: {
        declared: measurement.declaredWeight,
        actual: measurement.actualWeight,
        measuredAt: measurement.measuredAt.toISOString(),
        location: measurement.measurementLocation,
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
   * Apply differential charges to order
   */
  private async applyDifferentialCharges(
    orderId: string,
    result: WeightDifferentialResult,
  ): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) return;

    // Update order total with differential charges
    const newTotal = Number(order.totalAmount) + result.additionalCharges;

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        totalAmount: newTotal,
        // Store differential details in specialInstructions or a JSON field
        specialInstructions: order.specialInstructions
          ? `${order.specialInstructions}\n[Weight Differential: +₹${result.additionalCharges}]`
          : `[Weight Differential: +₹${result.additionalCharges}]`,
      },
    });

    this.logger.log(
      `Applied weight differential charges ₹${result.additionalCharges} to order ${orderId}`,
    );
  }

  /**
   * Get weight differential status for an order
   */
  async getWeightStatus(orderId: string): Promise<{
    hasMeasurement: boolean;
    measurement?: WeightMeasurement;
    differential?: WeightDifferentialResult;
  }> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      return { hasMeasurement: false };
    }

    const pickupAddress = fulfillment.pickupAddress as Record<
      string,
      unknown
    > | null;
    const latestWeight = pickupAddress?._latestWeight as
      | {
          declared: number;
          actual: number;
          measuredAt: string;
          location: string;
        }
      | undefined;

    if (!latestWeight) {
      return { hasMeasurement: false };
    }

    const measurement: WeightMeasurement = {
      declaredWeight: latestWeight.declared,
      actualWeight: latestWeight.actual,
      measuredAt: new Date(latestWeight.measuredAt),
      measuredBy: 'system',
      measurementLocation: latestWeight.location as
        | 'PICKUP'
        | 'HUB'
        | 'DELIVERY',
    };

    const differential = this.calculateDifferential(
      orderId,
      latestWeight.declared,
      latestWeight.actual,
    );

    return {
      hasMeasurement: true,
      measurement,
      differential,
    };
  }

  /**
   * Dispute weight measurement
   */
  async disputeWeight(
    orderId: string,
    reason: string,
    requestedBy: string,
  ): Promise<{ success: boolean; disputeId: string }> {
    const disputeId = `WD-${orderId.slice(0, 8)}-${Date.now()}`;

    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      throw new Error(`Fulfillment not found for order: ${orderId}`);
    }

    const pickupAddress =
      (fulfillment.pickupAddress as Record<string, unknown>) || {};

    const updatedPickupAddress = {
      ...pickupAddress,
      _weightDispute: {
        disputeId,
        reason,
        requestedBy,
        requestedAt: new Date().toISOString(),
        status: 'PENDING',
      },
    };

    await this.prisma.ondcFulfillment.update({
      where: { id: fulfillment.id },
      data: {
        pickupAddress: updatedPickupAddress as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `Weight dispute created for order ${orderId}: ${disputeId}`,
    );

    return { success: true, disputeId };
  }

  /**
   * Build weight differential tags for ONDC response
   */
  buildWeightTags(result: WeightDifferentialResult): Array<{
    descriptor: { code: string };
    list: Array<{ descriptor: { code: string }; value: string }>;
  }> {
    return [
      {
        descriptor: { code: 'weight_differential' },
        list: [
          {
            descriptor: { code: 'declared_weight' },
            value: result.declaredWeight.toString(),
          },
          {
            descriptor: { code: 'actual_weight' },
            value: result.actualWeight.toString(),
          },
          {
            descriptor: { code: 'difference_kg' },
            value: result.differenceKg.toFixed(2),
          },
          {
            descriptor: { code: 'difference_percentage' },
            value: result.differencePercentage.toFixed(1),
          },
          {
            descriptor: { code: 'additional_charges' },
            value: result.additionalCharges.toFixed(2),
          },
          {
            descriptor: { code: 'status' },
            value: result.status,
          },
        ],
      },
    ];
  }
}
