/**
 * ONDC Logistics Category Codes
 * Based on ONDC Logistics Protocol for Hyperlocal Delivery
 */

/**
 * Category IDs for logistics services
 */
export enum LogisticsCategoryId {
  // Immediate/Express Delivery
  IMMEDIATE_DELIVERY = 'Immediate Delivery',
  EXPRESS_DELIVERY = 'Express Delivery',

  // Same Day Delivery
  SAME_DAY_DELIVERY = 'Same Day Delivery',

  // Standard Delivery
  STANDARD_DELIVERY = 'Standard Delivery',
  NEXT_DAY_DELIVERY = 'Next Day Delivery',
}

/**
 * Logistics item interface
 */
export interface LogisticsItem {
  id: string;
  code: string;
  name: string;
  shortDesc: string;
  longDesc: string;
  categoryId: string;
  vehicleCategory: string;
  tat: string;
  descriptor: {
    code: string;
    name: string;
    short_desc: string;
    long_desc: string;
  };
  category_ids: string[];
  time: {
    label: string;
    duration: string;
    timestamp: string;
  };
}

/**
 * Logistics item descriptors
 */
export const LOGISTICS_ITEMS: Record<string, LogisticsItem> = {
  'IMMEDIATE-BIKE': {
    id: 'IMMEDIATE-BIKE',
    code: 'P2P',
    name: 'Immediate Delivery - Bike',
    shortDesc: 'Point to Point Express Delivery by Bike',
    longDesc:
      'Immediate pickup and delivery within 1-2 hours. Ideal for food, groceries, and urgent packages.',
    categoryId: LogisticsCategoryId.IMMEDIATE_DELIVERY,
    vehicleCategory: 'BIKE',
    tat: 'PT2H',
    descriptor: {
      code: 'P2P',
      name: 'Immediate Delivery - Bike',
      short_desc: 'Point to Point Express Delivery by Bike',
      long_desc:
        'Immediate pickup and delivery within 1-2 hours. Ideal for food, groceries, and urgent packages.',
    },
    category_ids: [LogisticsCategoryId.IMMEDIATE_DELIVERY],
    time: {
      label: 'TAT',
      duration: 'PT2H',
      timestamp: '',
    },
  },
  'IMMEDIATE-AUTO': {
    id: 'IMMEDIATE-AUTO',
    code: 'P2P',
    name: 'Immediate Delivery - Auto',
    shortDesc: 'Point to Point Express Delivery by Auto',
    longDesc:
      'Immediate pickup and delivery within 1-2 hours for larger packages.',
    categoryId: LogisticsCategoryId.IMMEDIATE_DELIVERY,
    vehicleCategory: 'AUTO',
    tat: 'PT2H',
    descriptor: {
      code: 'P2P',
      name: 'Immediate Delivery - Auto',
      short_desc: 'Point to Point Express Delivery by Auto',
      long_desc:
        'Immediate pickup and delivery within 1-2 hours for larger packages.',
    },
    category_ids: [LogisticsCategoryId.IMMEDIATE_DELIVERY],
    time: {
      label: 'TAT',
      duration: 'PT2H',
      timestamp: '',
    },
  },
  'EXPRESS-BIKE': {
    id: 'EXPRESS-BIKE',
    code: 'P2P',
    name: 'Express Delivery - Bike',
    shortDesc: 'Express 4-Hour Delivery by Bike',
    longDesc: 'Fast delivery within 4 hours of pickup.',
    categoryId: LogisticsCategoryId.EXPRESS_DELIVERY,
    vehicleCategory: 'BIKE',
    tat: 'PT4H',
    descriptor: {
      code: 'P2P',
      name: 'Express Delivery - Bike',
      short_desc: 'Express 4-Hour Delivery by Bike',
      long_desc: 'Fast delivery within 4 hours of pickup.',
    },
    category_ids: [LogisticsCategoryId.EXPRESS_DELIVERY],
    time: {
      label: 'TAT',
      duration: 'PT4H',
      timestamp: '',
    },
  },
  'SAME-DAY-BIKE': {
    id: 'SAME-DAY-BIKE',
    code: 'P2P',
    name: 'Same Day Delivery - Bike',
    shortDesc: 'Same Day Delivery Service by Bike',
    longDesc:
      'Delivery within the same day. Order before cut-off time for same day delivery.',
    categoryId: LogisticsCategoryId.SAME_DAY_DELIVERY,
    vehicleCategory: 'BIKE',
    tat: 'PT8H',
    descriptor: {
      code: 'P2P',
      name: 'Same Day Delivery - Bike',
      short_desc: 'Same Day Delivery Service by Bike',
      long_desc:
        'Delivery within the same day. Order before cut-off time for same day delivery.',
    },
    category_ids: [LogisticsCategoryId.SAME_DAY_DELIVERY],
    time: {
      label: 'TAT',
      duration: 'PT8H',
      timestamp: '',
    },
  },
  'SAME-DAY-AUTO': {
    id: 'SAME-DAY-AUTO',
    code: 'P2P',
    name: 'Same Day Delivery - Auto',
    shortDesc: 'Same Day Delivery Service by Auto',
    longDesc: 'Delivery within the same day for larger packages.',
    categoryId: LogisticsCategoryId.SAME_DAY_DELIVERY,
    vehicleCategory: 'AUTO',
    tat: 'PT8H',
    descriptor: {
      code: 'P2P',
      name: 'Same Day Delivery - Auto',
      short_desc: 'Same Day Delivery Service by Auto',
      long_desc: 'Delivery within the same day for larger packages.',
    },
    category_ids: [LogisticsCategoryId.SAME_DAY_DELIVERY],
    time: {
      label: 'TAT',
      duration: 'PT8H',
      timestamp: '',
    },
  },
  'STANDARD-BIKE': {
    id: 'STANDARD-BIKE',
    code: 'P2P',
    name: 'Standard Delivery - Bike',
    shortDesc: 'Standard 24-48 hour delivery by Bike',
    longDesc:
      'Reliable delivery within 24-48 hours. Economical option for non-urgent packages.',
    categoryId: LogisticsCategoryId.STANDARD_DELIVERY,
    vehicleCategory: 'BIKE',
    tat: 'P1D',
    descriptor: {
      code: 'P2P',
      name: 'Standard Delivery - Bike',
      short_desc: 'Standard 24-48 hour delivery by Bike',
      long_desc:
        'Reliable delivery within 24-48 hours. Economical option for non-urgent packages.',
    },
    category_ids: [LogisticsCategoryId.STANDARD_DELIVERY],
    time: {
      label: 'TAT',
      duration: 'P1D',
      timestamp: '',
    },
  },
  'STANDARD-AUTO': {
    id: 'STANDARD-AUTO',
    code: 'P2P',
    name: 'Standard Delivery - Auto',
    shortDesc: 'Standard 24-48 hour delivery by Auto',
    longDesc:
      'Reliable delivery within 24-48 hours for larger packages.',
    categoryId: LogisticsCategoryId.STANDARD_DELIVERY,
    vehicleCategory: 'AUTO',
    tat: 'P1D',
    descriptor: {
      code: 'P2P',
      name: 'Standard Delivery - Auto',
      short_desc: 'Standard 24-48 hour delivery by Auto',
      long_desc:
        'Reliable delivery within 24-48 hours for larger packages.',
    },
    category_ids: [LogisticsCategoryId.STANDARD_DELIVERY],
    time: {
      label: 'TAT',
      duration: 'P1D',
      timestamp: '',
    },
  },
};

/**
 * Vehicle category interface
 */
export interface VehicleCategoryInfo {
  code: string;
  name: string;
  maxWeight: number;
  maxLength: number;
  maxBreadth: number;
  maxHeight: number;
  basePrice: number;
  baseFare: number;
  perKmPrice: number;
  capacity: string;
}

/**
 * Vehicle categories and their capabilities
 */
export const VEHICLE_CATEGORIES: Record<string, VehicleCategoryInfo> = {
  BIKE: {
    code: 'BIKE',
    name: 'Two Wheeler',
    maxWeight: 10, // kg
    maxLength: 40, // cm
    maxBreadth: 30, // cm
    maxHeight: 30, // cm
    basePrice: 30,
    baseFare: 30,
    perKmPrice: 8,
    capacity: '10kg',
  },
  AUTO: {
    code: 'AUTO',
    name: 'Three Wheeler',
    maxWeight: 50, // kg
    maxLength: 80, // cm
    maxBreadth: 60, // cm
    maxHeight: 60, // cm
    basePrice: 50,
    baseFare: 50,
    perKmPrice: 12,
    capacity: '50kg',
  },
  MINI_TRUCK: {
    code: 'MINI_TRUCK',
    name: 'Mini Truck',
    maxWeight: 500, // kg
    maxLength: 200, // cm
    maxBreadth: 150, // cm
    maxHeight: 120, // cm
    basePrice: 150,
    baseFare: 150,
    perKmPrice: 20,
    capacity: '500kg',
  },
};

/**
 * Payment types for logistics
 */
export enum PaymentType {
  PRE_PAID = 'PRE-PAID',
  ON_ORDER = 'ON-ORDER',
  ON_FULFILLMENT = 'ON-FULFILLMENT',
  POST_FULFILLMENT = 'POST-FULFILLMENT',
}

/**
 * Payment collection methods
 */
export enum PaymentCollectedBy {
  BAP = 'BAP',
  BPP = 'BPP',
}

/**
 * Serviceable city interface with complete address fields
 */
export interface ServiceableCity {
  code: string;
  name: string;
  state: string;
  country: string;
  center: string;
  areaCode: string;
  street?: string;
  locality?: string;
}

/**
 * Default serviceable cities (start with Hyderabad)
 * Includes complete address fields for ONDC compliance
 */
export const SERVICEABLE_CITIES: ServiceableCity[] = [
  {
    code: 'std:040',
    name: 'Hyderabad',
    state: 'Telangana',
    country: 'IND',
    center: '17.385044,78.486671', // Hyderabad city center GPS
    areaCode: '500001',
    street: 'Banjara Hills Road No. 12',
    locality: 'Banjara Hills',
  },
  {
    code: 'std:080',
    name: 'Bengaluru',
    state: 'Karnataka',
    country: 'IND',
    center: '12.971599,77.594566',
    areaCode: '560001',
    street: 'MG Road',
    locality: 'Central Bengaluru',
  },
  {
    code: 'std:044',
    name: 'Chennai',
    state: 'Tamil Nadu',
    country: 'IND',
    center: '13.082680,80.270721',
    areaCode: '600001',
    street: 'Anna Salai',
    locality: 'T. Nagar',
  },
  {
    code: 'std:022',
    name: 'Mumbai',
    state: 'Maharashtra',
    country: 'IND',
    center: '19.076090,72.877426',
    areaCode: '400001',
    street: 'Linking Road',
    locality: 'Bandra West',
  },
  {
    code: 'std:011',
    name: 'New Delhi',
    state: 'Delhi',
    country: 'IND',
    center: '28.613939,77.209023',
    areaCode: '110001',
    street: 'Connaught Place',
    locality: 'Central Delhi',
  },
];
