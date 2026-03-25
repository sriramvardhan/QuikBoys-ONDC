import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Quote, QuoteBreakupItem } from '../interfaces/beckn-message.interface';
import { getErrorMessage } from '../types/ondc-error.interface';

/**
 * QuoteService handles pricing calculations for ONDC orders
 * Implements distance-based pricing with GST
 */
@Injectable()
export class QuoteService {
  private readonly logger = new Logger(QuoteService.name);
  private readonly baseFare: number;
  private readonly perKmCharge: number;
  private readonly taxPercentage: number;
  private readonly currency = 'INR';

  constructor(private readonly configService: ConfigService) {
    this.baseFare = this.configService.get<number>('ondc.pricing.baseFare', 30);
    this.perKmCharge = this.configService.get<number>(
      'ondc.pricing.perKmCharge',
      8,
    );
    this.taxPercentage = this.configService.get<number>(
      'ondc.pricing.taxPercentage',
      18,
    );
  }

  /**
   * Calculate quote for a delivery
   */
  calculateQuote(
    distanceKm: number,
    itemId: string,
    itemTitle: string,
    vehicleCategory?: string,
  ): Quote {
    // Get pricing based on vehicle category
    const pricing = this.getPricingForCategory(vehicleCategory);

    // Calculate delivery charge
    const deliveryCharge = pricing.baseFare + distanceKm * pricing.perKmCharge;
    const roundedDeliveryCharge = Math.round(deliveryCharge * 100) / 100;

    // Calculate tax
    const tax = (roundedDeliveryCharge * this.taxPercentage) / 100;
    const roundedTax = Math.round(tax * 100) / 100;

    // Total price
    const totalPrice = roundedDeliveryCharge + roundedTax;
    const roundedTotal = Math.round(totalPrice * 100) / 100;

    // Build breakup
    const breakup: QuoteBreakupItem[] = [
      {
        '@ondc/org/item_id': itemId,
        '@ondc/org/title_type': 'delivery',
        title: itemTitle,
        price: {
          currency: this.currency,
          value: roundedDeliveryCharge.toFixed(2),
        },
      },
      {
        '@ondc/org/item_id': itemId,
        '@ondc/org/title_type': 'tax',
        title: 'Tax',
        price: {
          currency: this.currency,
          value: roundedTax.toFixed(2),
        },
      },
    ];

    return {
      price: {
        currency: this.currency,
        value: roundedTotal.toFixed(2),
      },
      breakup,
      ttl: 'PT15M', // Quote valid for 15 minutes
    };
  }

  /**
   * Get pricing based on vehicle category
   */
  private getPricingForCategory(category?: string): {
    baseFare: number;
    perKmCharge: number;
  } {
    const categoryPricing: Record<
      string,
      { baseFare: number; perKmCharge: number }
    > = {
      BIKE: { baseFare: 30, perKmCharge: 8 },
      SCOOTER: { baseFare: 30, perKmCharge: 8 },
      AUTO: { baseFare: 50, perKmCharge: 12 },
      CAR: { baseFare: 80, perKmCharge: 15 },
      VAN: { baseFare: 100, perKmCharge: 18 },
    };

    if (category && categoryPricing[category.toUpperCase()]) {
      return categoryPricing[category.toUpperCase()];
    }

    return {
      baseFare: this.baseFare,
      perKmCharge: this.perKmCharge,
    };
  }

  /**
   * Calculate distance between two GPS coordinates (Haversine formula)
   */
  calculateDistance(pickup: string, delivery: string): number {
    try {
      const [pickupLat, pickupLng] = pickup.split(',').map(Number);
      const [deliveryLat, deliveryLng] = delivery.split(',').map(Number);

      const R = 6371; // Earth's radius in km
      const dLat = this.toRad(deliveryLat - pickupLat);
      const dLng = this.toRad(deliveryLng - pickupLng);

      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(this.toRad(pickupLat)) *
          Math.cos(this.toRad(deliveryLat)) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);

      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;

      return Math.round(distance * 100) / 100; // Round to 2 decimal places
    } catch (error: unknown) {
      this.logger.error(
        `Error calculating distance: ${getErrorMessage(error)}`,
      );
      return 0;
    }
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Estimate delivery time based on distance
   */
  estimateDeliveryTime(distanceKm: number): {
    minutes: number;
    isoRange: { start: string; end: string };
  } {
    // Average speed: 20 km/h in city traffic
    const avgSpeed = 20;
    const baseTimeMinutes = 10; // Pickup and delivery time

    const travelTimeMinutes = Math.ceil((distanceKm / avgSpeed) * 60);
    const totalMinutes = baseTimeMinutes + travelTimeMinutes;

    // Add buffer of 20%
    const estimatedMinutes = Math.ceil(totalMinutes * 1.2);

    // Create time range
    const now = new Date();
    const startTime = new Date(now.getTime() + estimatedMinutes * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 15 * 60 * 1000); // 15 min window

    return {
      minutes: estimatedMinutes,
      isoRange: {
        start: startTime.toISOString(),
        end: endTime.toISOString(),
      },
    };
  }

  /**
   * Check if delivery is within serviceable distance
   */
  isServiceable(distanceKm: number, maxDistanceKm = 30): boolean {
    return distanceKm > 0 && distanceKm <= maxDistanceKm;
  }

  /**
   * Get minimum order value if applicable
   */
  getMinimumOrderValue(): number {
    return 0; // No minimum for logistics
  }
}
