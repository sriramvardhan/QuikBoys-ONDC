// ============================================
// Delivery Slot Management Service
// File: src/ondc/services/delivery-slot.service.ts
// ONDC Logistics - Delivery slot booking and management
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

/**
 * Delivery slot definition
 */
export interface DeliverySlot {
  slotId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  type: 'EXPRESS' | 'STANDARD' | 'SCHEDULED' | 'SAME_DAY' | 'NEXT_DAY';
  capacity: number;
  booked: number;
  available: number;
  price: number;
  surgeMultiplier: number;
  zoneId?: string;
}

/**
 * Slot booking request
 */
export interface SlotBookingRequest {
  orderId: string;
  slotId: string;
  customerId: string;
  preferredDate: string;
  preferredTimeStart?: string;
  preferredTimeEnd?: string;
}

/**
 * Slot booking result
 */
export interface SlotBookingResult {
  success: boolean;
  bookingId?: string;
  slot?: DeliverySlot;
  estimatedDeliveryTime?: Date;
  price?: number;
  reason?: string;
}

/**
 * Slot availability query
 */
export interface SlotAvailabilityQuery {
  zoneId?: string;
  date: string;
  type?: DeliverySlot['type'];
  minCapacity?: number;
}

/**
 * Express delivery configuration
 */
interface ExpressConfig {
  enabled: boolean;
  maxRadiusKm: number;
  deliveryMinutes: number;
  premiumPrice: number;
  availableHours: { start: number; end: number };
}

/**
 * DeliverySlotService - Manages delivery slot bookings per ONDC spec
 *
 * ONDC Requirements:
 * - Slot-based delivery scheduling
 * - Express delivery (10-30 min)
 * - Same day / Next day delivery
 * - Capacity management
 * - Slot pricing with surge
 */
@Injectable()
export class DeliverySlotService {
  private readonly logger = new Logger(DeliverySlotService.name);
  private readonly defaultSlotDuration: number;
  private readonly slotsPerDay: number;
  private readonly defaultCapacityPerSlot: number;
  private readonly expressConfig: ExpressConfig;
  private readonly slotCache: Map<string, DeliverySlot[]> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.defaultSlotDuration = this.configService.get<number>(
      'SLOT_DURATION_HOURS',
      2,
    );
    this.slotsPerDay = this.configService.get<number>('SLOTS_PER_DAY', 8);
    this.defaultCapacityPerSlot = this.configService.get<number>(
      'SLOT_CAPACITY',
      50,
    );

    this.expressConfig = {
      enabled: true,
      maxRadiusKm: 10,
      deliveryMinutes: 30,
      premiumPrice: 50,
      availableHours: { start: 8, end: 22 },
    };
  }

  /**
   * Get available delivery slots for a date
   */
  async getAvailableSlots(
    query: SlotAvailabilityQuery,
  ): Promise<DeliverySlot[]> {
    const cacheKey = `${query.zoneId || 'all'}-${query.date}`;

    // Check cache first
    if (this.slotCache.has(cacheKey)) {
      const cached = this.slotCache.get(cacheKey)!;
      return this.filterSlots(cached, query);
    }

    // Generate slots for the date
    const slots = this.generateDaySlots(query.date, query.zoneId);

    // Load bookings from database
    await this.loadSlotBookings(slots, query.date);

    // Cache the slots
    this.slotCache.set(cacheKey, slots);

    // Set cache expiry (5 minutes)
    setTimeout(() => this.slotCache.delete(cacheKey), 5 * 60 * 1000);

    return this.filterSlots(slots, query);
  }

  /**
   * Filter slots based on query criteria
   */
  private filterSlots(
    slots: DeliverySlot[],
    query: SlotAvailabilityQuery,
  ): DeliverySlot[] {
    return slots.filter((slot) => {
      if (query.type && slot.type !== query.type) return false;
      if (query.minCapacity && slot.available < query.minCapacity) return false;
      return slot.available > 0;
    });
  }

  /**
   * Generate slots for a day
   */
  private generateDaySlots(date: string, zoneId?: string): DeliverySlot[] {
    const slots: DeliverySlot[] = [];
    const isToday = date === this.getTodayDate();
    const currentHour = new Date().getHours();

    // Express slot (if today and within operating hours)
    if (
      isToday &&
      this.expressConfig.enabled &&
      currentHour >= this.expressConfig.availableHours.start &&
      currentHour < this.expressConfig.availableHours.end
    ) {
      slots.push({
        slotId: `EXPRESS-${date}-${zoneId || 'ALL'}`,
        date,
        startTime: 'NOW',
        endTime: `+${this.expressConfig.deliveryMinutes}min`,
        type: 'EXPRESS',
        capacity: 100,
        booked: 0,
        available: 100,
        price: this.expressConfig.premiumPrice,
        surgeMultiplier: this.calculateSurgeMultiplier(currentHour),
        zoneId,
      });
    }

    // Same day slots (remaining slots for today)
    if (isToday) {
      const remainingSlots = this.generateTimeSlots(
        date,
        Math.max(currentHour + 2, 10),
        22,
        'SAME_DAY',
        zoneId,
      );
      slots.push(...remainingSlots);
    }

    // Standard/Scheduled slots
    if (!isToday) {
      const standardSlots = this.generateTimeSlots(
        date,
        8,
        22,
        'SCHEDULED',
        zoneId,
      );
      slots.push(...standardSlots);
    }

    return slots;
  }

  /**
   * Generate time slots for a period
   */
  private generateTimeSlots(
    date: string,
    startHour: number,
    endHour: number,
    type: DeliverySlot['type'],
    zoneId?: string,
  ): DeliverySlot[] {
    const slots: DeliverySlot[] = [];

    for (
      let hour = startHour;
      hour < endHour;
      hour += this.defaultSlotDuration
    ) {
      const startTime = `${hour.toString().padStart(2, '0')}:00`;
      const endTime = `${Math.min(hour + this.defaultSlotDuration, endHour)
        .toString()
        .padStart(2, '0')}:00`;

      const basePrice = this.getBasePrice(type, hour);
      const surgeMultiplier = this.calculateSurgeMultiplier(hour);

      slots.push({
        slotId: `${type}-${date}-${startTime}-${zoneId || 'ALL'}`,
        date,
        startTime,
        endTime,
        type,
        capacity: this.defaultCapacityPerSlot,
        booked: 0,
        available: this.defaultCapacityPerSlot,
        price: Math.round(basePrice * surgeMultiplier),
        surgeMultiplier,
        zoneId,
      });
    }

    return slots;
  }

  /**
   * Load existing bookings for slots
   */
  private async loadSlotBookings(
    slots: DeliverySlot[],
    date: string,
  ): Promise<void> {
    // Query fulfillments with slot booking data for this date
    const fulfillments = await this.prisma.ondcFulfillment.findMany({
      where: {
        createdAt: {
          gte: new Date(`${date}T00:00:00Z`),
          lte: new Date(`${date}T23:59:59Z`),
        },
      },
    });

    // Count bookings per slot from pickupAddress._slotBooking
    const bookingCounts: Map<string, number> = new Map();

    for (const fulfillment of fulfillments) {
      const pickupAddress = fulfillment.pickupAddress as Record<
        string,
        unknown
      > | null;
      const slotBooking = pickupAddress?._slotBooking as {
        slotId?: string;
        startTime?: string;
      } | null;

      if (!slotBooking?.startTime) continue;

      const startTime = slotBooking.startTime;

      // Find matching slot
      for (const slot of slots) {
        if (slot.startTime === startTime || slot.type === 'EXPRESS') {
          const count = bookingCounts.get(slot.slotId) || 0;
          bookingCounts.set(slot.slotId, count + 1);
        }
      }
    }

    // Update slot availability
    for (const slot of slots) {
      const booked = bookingCounts.get(slot.slotId) || 0;
      slot.booked = booked;
      slot.available = Math.max(0, slot.capacity - booked);
    }
  }

  /**
   * Book a delivery slot
   */
  async bookSlot(request: SlotBookingRequest): Promise<SlotBookingResult> {
    // Get available slots for the date
    const slots = await this.getAvailableSlots({
      date: request.preferredDate,
    });

    // Find the requested slot
    const slot = slots.find((s) => s.slotId === request.slotId);

    if (!slot) {
      return {
        success: false,
        reason: 'Slot not found or not available',
      };
    }

    if (slot.available <= 0) {
      return {
        success: false,
        reason: 'Slot is fully booked',
      };
    }

    // Generate booking ID
    const bookingId = `SLOT-${request.orderId.slice(0, 8)}-${Date.now()}`;

    // Calculate delivery time
    const deliveryTime = this.calculateDeliveryTime(slot);

    // Update fulfillment with slot booking
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId: request.orderId },
    });

    if (fulfillment) {
      const pickupAddress =
        (fulfillment.pickupAddress as Record<string, unknown>) || {};

      const updatedPickupAddress = {
        ...pickupAddress,
        _slotBooking: {
          bookingId,
          slotId: slot.slotId,
          slotType: slot.type,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          price: slot.price,
          surgeMultiplier: slot.surgeMultiplier,
          bookedAt: new Date().toISOString(),
          customerId: request.customerId,
        },
      };

      await this.prisma.ondcFulfillment.update({
        where: { id: fulfillment.id },
        data: {
          pickupAddress: updatedPickupAddress as any,
        },
      });
    }

    // Update slot availability in cache
    slot.booked += 1;
    slot.available -= 1;

    this.logger.log(
      `Slot ${slot.slotId} booked for order ${request.orderId}: ${slot.type} on ${slot.date} ${slot.startTime}-${slot.endTime}`,
    );

    return {
      success: true,
      bookingId,
      slot,
      estimatedDeliveryTime: deliveryTime,
      price: slot.price,
    };
  }

  /**
   * Cancel a slot booking
   */
  async cancelBooking(
    orderId: string,
    reason: string,
  ): Promise<{ success: boolean; refundAmount?: number }> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      return { success: false };
    }

    const pickupAddress = fulfillment.pickupAddress as Record<
      string,
      unknown
    > | null;
    const slotBooking = pickupAddress?._slotBooking as {
      bookingId: string;
      slotId: string;
      price: number;
    } | null;

    if (!slotBooking) {
      return { success: false };
    }

    // Calculate refund based on cancellation policy
    const refundAmount = this.calculateRefund(slotBooking.price);

    // Update fulfillment
    const updatedPickupAddress = {
      ...pickupAddress,
      _slotBooking: {
        ...slotBooking,
        cancelledAt: new Date().toISOString(),
        cancellationReason: reason,
        refundAmount,
        status: 'CANCELLED',
      },
    };

    await this.prisma.ondcFulfillment.update({
      where: { id: fulfillment.id },
      data: {
        pickupAddress: updatedPickupAddress as any,
      },
    });

    // Clear cache to refresh availability
    this.slotCache.clear();

    this.logger.log(
      `Slot booking ${slotBooking.bookingId} cancelled for order ${orderId}, refund: ₹${refundAmount}`,
    );

    return { success: true, refundAmount };
  }

  /**
   * Reschedule a slot booking
   */
  async rescheduleBooking(
    orderId: string,
    newSlotId: string,
    newDate: string,
  ): Promise<SlotBookingResult> {
    // Get current booking
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      return { success: false, reason: 'Order not found' };
    }

    const pickupAddress = fulfillment.pickupAddress as Record<
      string,
      unknown
    > | null;
    const currentBooking = pickupAddress?._slotBooking as {
      bookingId: string;
      slotId: string;
      customerId: string;
    } | null;

    if (!currentBooking) {
      return { success: false, reason: 'No existing booking found' };
    }

    // Book new slot
    const newBooking = await this.bookSlot({
      orderId,
      slotId: newSlotId,
      customerId: currentBooking.customerId,
      preferredDate: newDate,
    });

    if (newBooking.success) {
      // Mark old slot as rescheduled
      const updatedPickupAddress = {
        ...pickupAddress,
        _slotBooking: {
          ...newBooking.slot,
          bookingId: newBooking.bookingId,
          rescheduledFrom: currentBooking.bookingId,
          rescheduledAt: new Date().toISOString(),
        },
      };

      await this.prisma.ondcFulfillment.update({
        where: { id: fulfillment.id },
        data: {
          pickupAddress: updatedPickupAddress as any,
        },
      });

      // Clear cache
      this.slotCache.clear();
    }

    return newBooking;
  }

  /**
   * Get slot status for an order
   */
  async getSlotStatus(orderId: string): Promise<{
    hasBooking: boolean;
    booking?: {
      bookingId: string;
      slotType: string;
      date: string;
      startTime: string;
      endTime: string;
      price: number;
      status: string;
    };
  }> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      return { hasBooking: false };
    }

    const pickupAddress = fulfillment.pickupAddress as Record<
      string,
      unknown
    > | null;
    const slotBooking = pickupAddress?._slotBooking as {
      bookingId: string;
      slotType: string;
      date: string;
      startTime: string;
      endTime: string;
      price: number;
      status?: string;
    } | null;

    if (!slotBooking) {
      return { hasBooking: false };
    }

    return {
      hasBooking: true,
      booking: {
        bookingId: slotBooking.bookingId,
        slotType: slotBooking.slotType,
        date: slotBooking.date,
        startTime: slotBooking.startTime,
        endTime: slotBooking.endTime,
        price: slotBooking.price,
        status: slotBooking.status || 'CONFIRMED',
      },
    };
  }

  /**
   * Get express delivery availability
   */
  getExpressAvailability(_zoneId?: string): {
    available: boolean;
    estimatedMinutes: number;
    price: number;
    reason?: string;
  } {
    const currentHour = new Date().getHours();

    if (!this.expressConfig.enabled) {
      return {
        available: false,
        estimatedMinutes: 0,
        price: 0,
        reason: 'Express delivery not enabled',
      };
    }

    if (
      currentHour < this.expressConfig.availableHours.start ||
      currentHour >= this.expressConfig.availableHours.end
    ) {
      return {
        available: false,
        estimatedMinutes: 0,
        price: 0,
        reason: `Express delivery available ${this.expressConfig.availableHours.start}:00 - ${this.expressConfig.availableHours.end}:00`,
      };
    }

    const surgeMultiplier = this.calculateSurgeMultiplier(currentHour);

    return {
      available: true,
      estimatedMinutes: this.expressConfig.deliveryMinutes,
      price: Math.round(this.expressConfig.premiumPrice * surgeMultiplier),
    };
  }

  /**
   * Calculate surge multiplier based on hour
   */
  private calculateSurgeMultiplier(hour: number): number {
    // Peak hours: lunch (12-14), dinner (19-21)
    if (hour >= 12 && hour <= 14) return 1.5;
    if (hour >= 19 && hour <= 21) return 1.75;
    if (hour >= 18 && hour <= 22) return 1.25;
    return 1.0;
  }

  /**
   * Get base price for slot type and hour
   */
  private getBasePrice(type: DeliverySlot['type'], hour: number): number {
    const basePrices: Record<DeliverySlot['type'], number> = {
      EXPRESS: 50,
      SAME_DAY: 35,
      NEXT_DAY: 25,
      SCHEDULED: 20,
      STANDARD: 15,
    };

    let price = basePrices[type];

    // Premium for evening slots
    if (hour >= 18 && hour <= 21) {
      price *= 1.2;
    }

    // Discount for early morning
    if (hour >= 6 && hour <= 9) {
      price *= 0.9;
    }

    return price;
  }

  /**
   * Calculate delivery time from slot
   */
  private calculateDeliveryTime(slot: DeliverySlot): Date {
    const deliveryDate = new Date(slot.date);

    if (slot.type === 'EXPRESS') {
      // Express: now + delivery minutes
      const now = new Date();
      now.setMinutes(now.getMinutes() + this.expressConfig.deliveryMinutes);
      return now;
    }

    // Parse start time and set on date
    const [hours, minutes] = slot.startTime.split(':').map(Number);
    deliveryDate.setHours(hours, minutes, 0, 0);

    // Add half the slot duration for estimated delivery
    deliveryDate.setHours(
      deliveryDate.getHours() + this.defaultSlotDuration / 2,
    );

    return deliveryDate;
  }

  /**
   * Calculate refund based on cancellation time
   */
  private calculateRefund(originalPrice: number): number {
    // Full refund policy (can be enhanced with time-based rules)
    return originalPrice;
  }

  /**
   * Get today's date as YYYY-MM-DD
   */
  private getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Build ONDC slot tags
   */
  buildSlotTags(slots: DeliverySlot[]): Array<{
    descriptor: { code: string };
    list: Array<{ descriptor: { code: string }; value: string }>;
  }> {
    return slots.map((slot) => ({
      descriptor: { code: 'delivery_slot' },
      list: [
        { descriptor: { code: 'slot_id' }, value: slot.slotId },
        { descriptor: { code: 'date' }, value: slot.date },
        { descriptor: { code: 'start_time' }, value: slot.startTime },
        { descriptor: { code: 'end_time' }, value: slot.endTime },
        { descriptor: { code: 'type' }, value: slot.type },
        { descriptor: { code: 'available' }, value: slot.available.toString() },
        { descriptor: { code: 'price' }, value: slot.price.toString() },
        {
          descriptor: { code: 'surge_multiplier' },
          value: slot.surgeMultiplier.toFixed(2),
        },
      ],
    }));
  }

  /**
   * Build ONDC time range for fulfillment
   */
  buildTimeRange(slot: DeliverySlot): {
    label: string;
    timestamp: string;
    duration?: string;
  } {
    if (slot.type === 'EXPRESS') {
      return {
        label: 'Delivery',
        timestamp: new Date().toISOString(),
        duration: `PT${this.expressConfig.deliveryMinutes}M`,
      };
    }

    const startDate = new Date(`${slot.date}T${slot.startTime}:00`);
    const durationHours = this.defaultSlotDuration;

    return {
      label: 'Delivery',
      timestamp: startDate.toISOString(),
      duration: `PT${durationHours}H`,
    };
  }
}
