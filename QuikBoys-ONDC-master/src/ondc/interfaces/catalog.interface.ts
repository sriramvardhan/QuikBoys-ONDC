import { Descriptor, Quote, Tag, Time } from './beckn-message.interface';
import { Fulfillment } from './fulfillment.interface';

/**
 * Provider structure for on_search catalog
 */
export interface Provider {
  id: string;
  descriptor: Descriptor;
  categories?: Category[];
  items?: Item[];
  fulfillments?: ProviderFulfillment[];
  locations?: ProviderLocation[];
  time?: Time;
  tags?: Tag[];
}

/**
 * Category structure
 */
export interface Category {
  id: string;
  descriptor: Descriptor;
  time?: Time;
  tags?: Tag[];
}

/**
 * Item structure for logistics catalog
 */
export interface Item {
  id: string;
  parent_item_id?: string;
  category_id?: string; // Required by ONDC Pramaan (singular form)
  category_ids?: string[];
  fulfillment_ids?: string[];
  descriptor: Descriptor;
  price?: {
    currency: string;
    value: string;
    minimum_value?: string;
    maximum_value?: string;
  };
  time?: Time;
  matched?: boolean;
  tags?: Tag[];
}

/**
 * Provider Fulfillment for catalog
 */
export interface ProviderFulfillment {
  id: string;
  type: string;
  tracking?: boolean;
  tags?: Tag[];
}

/**
 * Provider Location
 */
export interface ProviderLocation {
  id: string;
  gps?: string;
  address?: {
    name?: string;
    building?: string;
    street?: string;
    locality?: string;
    city?: string;
    state?: string;
    country?: string;
    area_code?: string;
  };
  time?: Time;
}

/**
 * On Search Catalog structure
 */
export interface OnSearchCatalog {
  'bpp/descriptor'?: Descriptor;
  'bpp/providers'?: Provider[];
}

/**
 * On Search Message
 */
export interface OnSearchMessage {
  catalog: OnSearchCatalog;
}

/**
 * On Select Order structure
 */
export interface OnSelectOrder {
  provider: {
    id: string;
    descriptor?: Descriptor;
    locations?: ProviderLocation[];
  };
  items: Item[];
  fulfillments: Fulfillment[];
  quote: Quote;
  ttl?: string;
}

/**
 * On Select Message
 */
export interface OnSelectMessage {
  order: OnSelectOrder;
}

/**
 * On Init Order structure
 */
export interface OnInitOrder {
  provider: {
    id: string;
    descriptor?: Descriptor;
    locations?: ProviderLocation[];
  };
  items: Item[];
  fulfillments: Fulfillment[];
  billing?: {
    name: string;
    phone: string;
    email?: string;
    address?: {
      name?: string;
      building?: string;
      street?: string;
      locality?: string;
      city?: string;
      state?: string;
      country?: string;
      area_code?: string;
    };
    tax_number?: string;
  };
  quote: Quote;
  payment?: {
    type: string;
    collected_by?: string;
    status?: string;
    '@ondc/org/settlement_details'?: unknown[];
  };
  tags?: Tag[];
}

/**
 * On Init Message
 */
export interface OnInitMessage {
  order: OnInitOrder;
}

/**
 * Cancellation Term structure per ONDC spec
 */
export interface CancellationTerm {
  fulfillment_state: {
    descriptor: {
      code: string;
      short_desc?: string;
    };
  };
  reason_required: boolean;
  cancellation_fee: {
    percentage?: string;
    amount?: {
      currency: string;
      value: string;
    };
  };
  refund_eligible?: boolean;
}

/**
 * On Confirm Order structure
 */
export interface OnConfirmOrder {
  id: string;
  state: string;
  provider: {
    id: string;
    descriptor?: Descriptor;
    locations?: ProviderLocation[];
  };
  items: Item[];
  fulfillments: Fulfillment[];
  billing: {
    name: string;
    phone: string;
    email?: string;
    address?: {
      name?: string;
      building?: string;
      street?: string;
      locality?: string;
      city?: string;
      state?: string;
      country?: string;
      area_code?: string;
    };
    tax_number?: string;
  };
  quote: Quote;
  payment: {
    type: string;
    collected_by?: string;
    status?: string;
    '@ondc/org/settlement_basis'?: string;
    '@ondc/org/settlement_window'?: string;
    '@ondc/org/settlement_details'?: unknown[];
  };
  // Cancellation terms (ONDC Logistics requirement)
  cancellation_terms?: CancellationTerm[];
  // Linked order (ONDC Pramaan requirement)
  '@ondc/org/linked_order'?: unknown;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
}

/**
 * On Confirm Message
 */
export interface OnConfirmMessage {
  order: OnConfirmOrder;
}

/**
 * On Status Order structure
 */
export interface OnStatusOrder {
  id: string;
  state: string;
  provider: {
    id: string;
    descriptor?: Descriptor;
    locations?: ProviderLocation[];
  };
  items: Item[];
  fulfillments: Fulfillment[];
  billing?: {
    name: string;
    phone: string;
    email?: string;
    address?: {
      name?: string;
      building?: string;
      street?: string;
      locality?: string;
      city?: string;
      state?: string;
      country?: string;
      area_code?: string;
    };
  };
  quote?: Quote;
  payment?: {
    type: string;
    collected_by?: string;
    status?: string;
    '@ondc/org/settlement_basis'?: string;
    '@ondc/org/settlement_window'?: string;
    '@ondc/org/settlement_details'?: unknown[];
  };
  // Cancellation terms (ONDC Pramaan requirement)
  cancellation_terms?: CancellationTerm[];
  // Linked order (ONDC Pramaan requirement)
  '@ondc/org/linked_order'?: unknown;
  created_at?: string;
  updated_at: string;
  tags?: Tag[];
}

/**
 * On Status Message
 */
export interface OnStatusMessage {
  order: OnStatusOrder;
}

/**
 * On Track Message
 */
export interface OnTrackMessage {
  tracking: {
    id: string;
    url?: string;
    status: 'active' | 'inactive';
    location?: {
      gps: string;
      updated_at?: string;
    };
  };
}

/**
 * On Cancel Order structure
 */
export interface OnCancelOrder {
  id: string;
  state: string;
  provider: {
    id: string;
    descriptor?: Descriptor;
  };
  items?: Item[];
  fulfillments?: Fulfillment[];
  quote?: Quote;
  cancellation?: {
    cancelled_by: string;
    reason: {
      id: string;
      descriptor?: Descriptor;
    };
  };
  created_at?: string;
  updated_at: string;
  tags?: Tag[];
}

/**
 * On Cancel Message
 */
export interface OnCancelMessage {
  order: OnCancelOrder;
}

/**
 * On Update Order structure
 */
export interface OnUpdateOrder {
  id: string;
  state: string;
  provider: {
    id: string;
    descriptor?: Descriptor;
  };
  items?: Item[];
  fulfillments?: Fulfillment[];
  quote?: Quote;
  payment?: {
    type: string;
    collected_by?: string;
    status?: string;
    '@ondc/org/settlement_basis'?: string;
    '@ondc/org/settlement_window'?: string;
    '@ondc/org/settlement_details'?: unknown[];
  };
  // Cancellation terms (ONDC Pramaan requirement)
  cancellation_terms?: CancellationTerm[];
  // Linked order (ONDC Pramaan requirement)
  '@ondc/org/linked_order'?: unknown;
  created_at?: string;
  updated_at: string;
  tags?: Tag[];
}

/**
 * On Update Message
 */
export interface OnUpdateMessage {
  order: OnUpdateOrder;
}
