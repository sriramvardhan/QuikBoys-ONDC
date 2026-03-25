/**
 * ONDC Logistics Fulfillment States
 * Based on ONDC Protocol Specifications for Logistics
 */
export enum OndcFulfillmentState {
  // Pre-pickup states
  PENDING = 'Pending',
  SEARCHING_FOR_AGENT = 'Searching-for-Agent',
  AGENT_ASSIGNED = 'Agent-assigned',

  // Pickup states
  AT_PICKUP = 'At-pickup',
  ORDER_PICKED_UP = 'Order-picked-up',

  // Transit states
  IN_TRANSIT = 'In-transit',
  OUT_FOR_DELIVERY = 'Out-for-delivery',
  AT_DELIVERY = 'At-delivery',

  // Completion states
  ORDER_DELIVERED = 'Order-delivered',
  CANCELLED = 'Cancelled',

  // RTO (Return to Origin) states
  RTO_INITIATED = 'RTO-Initiated',
  RTO_IN_TRANSIT = 'RTO-In-transit',
  RTO_DELIVERED = 'RTO-Delivered',
  RTO_DISPOSED = 'RTO-Disposed',
}

/**
 * ONDC Fulfillment Types
 */
export enum OndcFulfillmentType {
  DELIVERY = 'Delivery',
  SELF_PICKUP = 'Self-Pickup',
  RTO = 'RTO',
}

/**
 * Vehicle categories for logistics
 */
export enum VehicleCategory {
  IMMEDIATE_DELIVERY = 'Immediate Delivery',
  SAME_DAY_DELIVERY = 'Same Day Delivery',
  NEXT_DAY_DELIVERY = 'Next Day Delivery',
}

/**
 * Delivery type codes
 */
export enum DeliveryTypeCode {
  P2P = 'P2P', // Point to Point (Immediate)
  P2H2P = 'P2H2P', // Point to Hub to Point (Standard)
}

/**
 * Map internal OrderStatus to ONDC Fulfillment State
 */
export const INTERNAL_STATUS_TO_ONDC_STATE: Record<
  string,
  OndcFulfillmentState
> = {
  PENDING: OndcFulfillmentState.PENDING,
  PENDING_ACCEPTANCE: OndcFulfillmentState.PENDING,
  BROADCASTING: OndcFulfillmentState.SEARCHING_FOR_AGENT,
  ACCEPTED: OndcFulfillmentState.AGENT_ASSIGNED,
  ASSIGNED: OndcFulfillmentState.AGENT_ASSIGNED,
  PICKED_UP: OndcFulfillmentState.ORDER_PICKED_UP,
  IN_TRANSIT: OndcFulfillmentState.OUT_FOR_DELIVERY,
  DELIVERED: OndcFulfillmentState.ORDER_DELIVERED,
  CANCELLED: OndcFulfillmentState.CANCELLED,
};

/**
 * Map ONDC Fulfillment State to internal OrderStatus
 */
export const ONDC_STATE_TO_INTERNAL_STATUS: Record<
  OndcFulfillmentState,
  string
> = {
  [OndcFulfillmentState.PENDING]: 'PENDING',
  [OndcFulfillmentState.SEARCHING_FOR_AGENT]: 'BROADCASTING',
  [OndcFulfillmentState.AGENT_ASSIGNED]: 'ASSIGNED',
  [OndcFulfillmentState.AT_PICKUP]: 'ASSIGNED',
  [OndcFulfillmentState.ORDER_PICKED_UP]: 'PICKED_UP',
  [OndcFulfillmentState.IN_TRANSIT]: 'IN_TRANSIT',
  [OndcFulfillmentState.OUT_FOR_DELIVERY]: 'IN_TRANSIT',
  [OndcFulfillmentState.AT_DELIVERY]: 'IN_TRANSIT',
  [OndcFulfillmentState.ORDER_DELIVERED]: 'DELIVERED',
  [OndcFulfillmentState.CANCELLED]: 'CANCELLED',
  [OndcFulfillmentState.RTO_INITIATED]: 'CANCELLED',
  [OndcFulfillmentState.RTO_IN_TRANSIT]: 'CANCELLED',
  [OndcFulfillmentState.RTO_DELIVERED]: 'CANCELLED',
  [OndcFulfillmentState.RTO_DISPOSED]: 'CANCELLED',
};
