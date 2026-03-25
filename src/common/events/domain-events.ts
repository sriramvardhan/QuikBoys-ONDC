/**
 * Domain Events — subset used by the ONDC module.
 * The monolith defines additional events; only ONDC-relevant ones are here.
 */

export type OrderSource = 'ONDC' | 'PRIVATE_VENDOR' | 'CUSTOMER' | 'PETPOOJA';

export class OrderCreatedEvent {
  static readonly event = 'order.created';
  constructor(
    public readonly orderId: string,
    public readonly vendorId: string,
    public readonly source: OrderSource,
    public readonly metadata?: Record<string, unknown>,
  ) {}
}

export class OrderAssignedEvent {
  static readonly event = 'order.assigned';
  constructor(
    public readonly orderId: string,
    public readonly driverId: string,
  ) {}
}

export class OrderCompletedEvent {
  static readonly event = 'order.completed';
  constructor(
    public readonly orderId: string,
    public readonly driverId: string,
  ) {}
}

export class OrderCancelledEvent {
  static readonly event = 'order.cancelled';
  constructor(
    public readonly orderId: string,
    public readonly reason: string,
    public readonly cancelledBy: string,
  ) {}
}

export class BroadcastExpiredEvent {
  static readonly event = 'broadcast.expired';
  constructor(
    public readonly orderId: string,
    public readonly broadcastId: string,
  ) {}
}

export class DispatchExhaustedEvent {
  static readonly event = 'dispatch.exhausted';
  constructor(
    public readonly orderId: string,
    public readonly attempts: number,
  ) {}
}
