import {
  Address,
  Contact,
  Descriptor,
  Person,
  Tag,
  Time,
} from './beckn-message.interface';

/**
 * Fulfillment structure for on_* callbacks
 */
export interface Fulfillment {
  id: string;
  type: string;
  state?: FulfillmentState;
  tracking?: boolean;
  start?: FulfillmentStop;
  end?: FulfillmentStop;
  agent?: Agent;
  vehicle?: Vehicle;
  tags?: Tag[];
  rateable?: boolean;
}

/**
 * Fulfillment State
 */
export interface FulfillmentState {
  descriptor: {
    code: string;
    name?: string;
  };
  updated_at?: string;
}

/**
 * Fulfillment Stop (Start/End)
 */
export interface FulfillmentStop {
  location: {
    gps: string;
    address?: Address;
    descriptor?: Descriptor;
  };
  contact?: Contact;
  person?: Person;
  time?: Time;
  instructions?: {
    code: string;
    name: string;
    short_desc?: string;
    images?: string[];
  };
  authorization?: {
    type: string;
    token?: string;
    valid_from?: string;
    valid_to?: string;
  };
}

/**
 * Delivery Agent
 */
export interface Agent {
  name?: string;
  phone?: string;
  rateable?: boolean;
}

/**
 * Vehicle details
 */
export interface Vehicle {
  category?: string;
  registration?: string;
  capacity?: string;
  make?: string;
  model?: string;
}

/**
 * Tracking information for on_track
 */
export interface TrackingInfo {
  url?: string;
  status: 'active' | 'inactive';
  location?: {
    gps: string;
    updated_at?: string;
  };
}

/**
 * Build fulfillment response from internal order data
 */
export interface FulfillmentBuildOptions {
  fulfillmentId: string;
  type: string;
  state: string;
  pickup: {
    gps: string;
    address: Address;
    contact: Contact;
    person?: Person;
    time?: Time;
  };
  delivery: {
    gps: string;
    address: Address;
    contact: Contact;
    person?: Person;
    time?: Time;
  };
  agent?: {
    name: string;
    phone: string;
  };
  vehicle?: {
    registration: string;
    category: string;
  };
  tracking?: boolean;
}

/**
 * Order state transition for fulfillment
 */
export interface FulfillmentTransition {
  fromState: string;
  toState: string;
  allowedFromStates: string[];
  timestamp: string;
  notes?: string;
}
