import { BecknContext } from './beckn-context.interface';

/**
 * Base Beckn Request structure
 */
export interface BecknRequest<T = unknown> {
  context: BecknContext;
  message: T;
}

/**
 * Base Beckn Response structure
 */
export interface BecknResponse<T = unknown> {
  context: BecknContext;
  message?: T;
  error?: BecknError;
}

/**
 * ACK Response structure
 */
export interface AckResponse {
  message: {
    ack: {
      status: 'ACK' | 'NACK';
    };
  };
  error?: BecknError;
}

/**
 * Beckn Error structure
 */
export interface BecknError {
  type: string;
  code: string;
  path?: string;
  message: string;
}

/**
 * Search Message Intent
 */
export interface SearchIntent {
  category?: {
    id: string;
  };
  fulfillment?: {
    type: string;
    start?: {
      location: {
        gps: string;
        address?: Address;
      };
    };
    end?: {
      location: {
        gps: string;
        address?: Address;
      };
    };
  };
  payment?: {
    type: string;
  };
  tags?: Tag[];
}

/**
 * Search Message structure
 */
export interface SearchMessage {
  intent: SearchIntent;
}

/**
 * Select Message Order structure
 */
export interface SelectOrder {
  provider: {
    id: string;
  };
  items: SelectItem[];
  fulfillments: SelectFulfillment[];
  payment?: {
    type: string;
  };
}

export interface SelectItem {
  id: string;
  category_id?: string;
  descriptor?: Descriptor;
}

export interface SelectFulfillment {
  id: string;
  type: string;
  start?: FulfillmentEnd;
  end?: FulfillmentEnd;
  tags?: Tag[];
}

/**
 * Select Message structure
 */
export interface SelectMessage {
  order: SelectOrder;
}

/**
 * Init Message Order structure
 */
export interface InitOrder {
  provider: {
    id: string;
  };
  items: InitItem[];
  fulfillments: InitFulfillment[];
  billing: Billing;
  payment?: Payment;
}

export interface InitItem {
  id: string;
  quantity?: {
    count: number;
  };
  category_id?: string;
}

export interface InitFulfillment {
  id: string;
  type: string;
  start: FulfillmentEnd;
  end: FulfillmentEnd;
  tags?: Tag[];
}

/**
 * Init Message structure
 */
export interface InitMessage {
  order: InitOrder;
}

/**
 * Confirm Message Order structure
 */
export interface ConfirmOrder {
  id?: string;
  provider: {
    id: string;
  };
  items: ConfirmItem[];
  fulfillments: ConfirmFulfillment[];
  billing: Billing;
  payment: Payment;
  quote?: Quote;
  tags?: Tag[];
}

export interface ConfirmItem {
  id: string;
  quantity?: {
    count: number;
  };
  category_id?: string;
  descriptor?: Descriptor;
}

export interface ConfirmFulfillment {
  id: string;
  type: string;
  start: FulfillmentEnd;
  end: FulfillmentEnd;
  tags?: Tag[];
}

/**
 * Confirm Message structure
 */
export interface ConfirmMessage {
  order: ConfirmOrder;
}

/**
 * Status Message structure
 */
export interface StatusMessage {
  order_id: string;
}

/**
 * Track Message structure
 */
export interface TrackMessage {
  order_id: string;
  callback_url?: string;
}

/**
 * Cancel Message structure
 */
export interface CancelMessage {
  order_id: string;
  cancellation_reason_id: string;
  descriptor?: Descriptor;
}

/**
 * Update Message structure
 */
export interface UpdateMessage {
  order: {
    id: string;
    fulfillments?: UpdateFulfillment[];
    items?: UpdateItem[];
    payment?: UpdatePayment;
  };
  update_target: string;
}

/**
 * Payment update structure for ONDC
 */
export interface UpdatePayment {
  status?: string;
  type?: string;
  collected_by?: string;
  '@ondc/org/settlement_details'?: Array<{
    settlement_counterparty?: string;
    settlement_phase?: string;
    settlement_amount?: string;
    settlement_type?: string;
    settlement_bank_account_no?: string;
    settlement_ifsc_code?: string;
    bank_name?: string;
    branch_name?: string;
  }>;
}

export interface UpdateFulfillment {
  id: string;
  type?: string;
  state?: {
    descriptor: {
      code: string;
    };
  };
}

export interface UpdateItem {
  id: string;
  quantity?: {
    count: number;
  };
}

// ==========================================
// Common Types
// ==========================================

export interface Address {
  name?: string;
  building?: string;
  street?: string;
  locality?: string;
  city?: string;
  state?: string;
  country?: string;
  area_code?: string;
}

/**
 * Image object per ONDC spec
 */
export interface DescriptorImage {
  url: string;
  size_type?: 'xs' | 'sm' | 'md' | 'lg';
}

export interface Descriptor {
  code?: string;
  name?: string;
  short_desc?: string;
  long_desc?: string;
  images?: (string | DescriptorImage)[];
  tags?: Tag[];
}

export interface FulfillmentEnd {
  location: {
    gps: string;
    address?: Address;
  };
  contact?: Contact;
  person?: Person;
  time?: Time;
  instructions?: {
    code: string;
    name: string;
    short_desc?: string;
  };
}

export interface Contact {
  phone: string;
  email?: string;
}

export interface Person {
  name: string;
}

export interface Time {
  label?: string;
  timestamp?: string;
  duration?: string;
  range?: {
    start: string;
    end: string;
  };
}

export interface Billing {
  name: string;
  phone: string;
  email?: string;
  address?: Address;
  tax_number?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Payment {
  type: string;
  collected_by?: string;
  status?: string;
  params?: {
    amount?: string;
    currency?: string;
    transaction_id?: string;
    bank_code?: string;
    bank_account_number?: string;
    virtual_payment_address?: string;
  };
  uri?: string;
  tl_method?: string;
  tags?: Tag[];
  '@ondc/org/collection_amount'?: string;
  '@ondc/org/settlement_details'?: SettlementDetails[];
}

export interface SettlementDetails {
  settlement_counterparty: string;
  settlement_type: string;
  beneficiary_name?: string;
  settlement_bank_account_no?: string;
  settlement_ifsc_code?: string;
  upi_address?: string;
  bank_name?: string;
  branch_name?: string;
}

export interface Quote {
  price: {
    currency: string;
    value: string;
  };
  breakup: QuoteBreakupItem[];
  ttl?: string;
}

export interface QuoteBreakupItem {
  '@ondc/org/item_id': string;
  '@ondc/org/title_type': string;
  title: string;
  price: {
    currency: string;
    value: string;
  };
}

export interface Tag {
  code?: string;
  list?: TagListItem[];
  descriptor?: Descriptor;
}

export interface TagListItem {
  code?: string;
  value?: string;
}
