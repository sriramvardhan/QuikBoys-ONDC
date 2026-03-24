/**
 * ONDC Error Codes for Logistics Domain
 * Based on ONDC Error Code Specifications v1.2
 * Reference: ONDC Logistics Protocol Specification
 */
export enum OndcErrorCode {
  // Generic Errors (10xxx)
  INVALID_REQUEST = '10000',
  INVALID_REQUEST_FORMAT = '10005', // Related to INVALID_REQUEST
  INVALID_SIGNATURE = '10001',
  INVALID_TIMESTAMP = '10002',
  STALE_REQUEST = '10003',
  INTERNAL_ERROR = '10004',

  // Context Errors (20xxx)
  INVALID_DOMAIN = '20001',
  INVALID_COUNTRY = '20002',
  INVALID_CITY = '20003',
  INVALID_ACTION = '20004',
  INVALID_CORE_VERSION = '20005',
  INVALID_BAP_ID = '20006',
  INVALID_BAP_URI = '20007',
  INVALID_BPP_ID = '20008',
  INVALID_BPP_URI = '20009',
  INVALID_TRANSACTION_ID = '20010',
  INVALID_MESSAGE_ID = '20011',
  INVALID_TIMESTAMP_FORMAT = '20012',
  INVALID_TTL = '20013',

  // Intent/Search Errors (30xxx)
  INVALID_SEARCH_INTENT = '30001',
  LOCATION_NOT_SERVICEABLE = '30002',
  AREA_NOT_SERVICEABLE = '30006', // Related to LOCATION_NOT_SERVICEABLE
  CATEGORY_NOT_FOUND = '30003',
  NO_PROVIDERS_AVAILABLE = '30004',
  INVALID_GPS_FORMAT = '30005',

  // Order Errors (40xxx)
  ORDER_NOT_FOUND = '40001',
  ORDER_ALREADY_EXISTS = '40002',
  INVALID_ORDER_STATE = '40003',
  ORDER_CANNOT_BE_CANCELLED = '40004',
  ORDER_CANNOT_BE_UPDATED = '40005',
  QUOTE_EXPIRED = '40006',
  INVALID_PAYMENT_INFO = '40007',

  // Fulfillment Errors (50xxx)
  FULFILLMENT_NOT_FOUND = '50001',
  INVALID_FULFILLMENT_TYPE = '50002',
  AGENT_NOT_AVAILABLE = '50003',
  TRACKING_NOT_AVAILABLE = '50004',

  // Provider Errors (60xxx)
  PROVIDER_NOT_FOUND = '60001',
  PROVIDER_NOT_ACTIVE = '60002',
  ITEM_NOT_FOUND = '60003',
  ITEM_QUANTITY_UNAVAILABLE = '60004',

  // ============================================
  // ONDC Logistics Specific Error Codes (61xxx-65xxx)
  // Per ONDC Logistics Protocol v1.2
  // ============================================

  // Pickup Errors (61xxx)
  PICKUP_LOCATION_NOT_FOUND = '61001',
  PICKUP_TIME_SLOT_UNAVAILABLE = '61002',
  PICKUP_CONTACT_UNREACHABLE = '61003',
  PICKUP_ADDRESS_INCOMPLETE = '61004',
  PICKUP_FAILED_MERCHANT_UNAVAILABLE = '61005',
  PICKUP_FAILED_PACKAGE_NOT_READY = '61006',
  PICKUP_RESCHEDULED = '61007',

  // Delivery Errors (62xxx)
  DELIVERY_LOCATION_NOT_FOUND = '62001',
  DELIVERY_TIME_SLOT_UNAVAILABLE = '62002',
  DELIVERY_CONTACT_UNREACHABLE = '62003',
  DELIVERY_ADDRESS_INCOMPLETE = '62004',
  DELIVERY_FAILED_RECIPIENT_UNAVAILABLE = '62005',
  DELIVERY_FAILED_WRONG_ADDRESS = '62006',
  DELIVERY_FAILED_REFUSED = '62007',
  DELIVERY_RESCHEDULED = '62008',

  // Package/Weight Errors (63xxx)
  PACKAGE_WEIGHT_MISMATCH = '63001',
  PACKAGE_DIMENSIONS_EXCEEDED = '63002',
  PACKAGE_DAMAGED = '63003',
  PACKAGE_CONTENTS_PROHIBITED = '63004',
  PACKAGE_MISSING = '63005',
  WEIGHT_DIFFERENTIAL_CHARGES_APPLICABLE = '63006',

  // AWB/Tracking Errors (64xxx)
  AWB_NOT_GENERATED = '64001',
  AWB_INVALID = '64002',
  AWB_ALREADY_EXISTS = '64003',
  TRACKING_URL_NOT_AVAILABLE = '64004',
  SHIPMENT_NOT_TRACKABLE = '64005',

  // Confirmation Code Errors (65xxx)
  PCC_NOT_GENERATED = '65001',
  PCC_INVALID = '65002',
  PCC_ALREADY_USED = '65003',
  PCC_EXPIRED = '65004',
  PCC_VERIFICATION_FAILED = '65005',
  DCC_NOT_GENERATED = '65006',
  DCC_INVALID = '65007',
  DCC_ALREADY_USED = '65008',
  DCC_EXPIRED = '65009',
  DCC_VERIFICATION_FAILED = '65010',

  // Policy Errors (70xxx)
  CANCELLATION_NOT_ALLOWED = '70001',
  CANCELLATION_NOT_POSSIBLE = '70004', // Related to CANCELLATION_NOT_ALLOWED
  RETURN_NOT_ALLOWED = '70002',
  POLICY_VIOLATION = '70003',

  // RTO Errors (71xxx)
  RTO_INITIATED = '71001',
  RTO_ADDRESS_NOT_FOUND = '71002',
  RTO_FAILED = '71003',
  RTO_CHARGES_APPLICABLE = '71004',

  // Settlement/Payment Errors (72xxx)
  SETTLEMENT_FAILED = '72001',
  COD_COLLECTION_FAILED = '72002',
  PAYMENT_MISMATCH = '72003',
  REFUND_FAILED = '72004',
}

/**
 * Error Types
 */
export enum OndcErrorType {
  CONTEXT_ERROR = 'CONTEXT-ERROR',
  CORE_ERROR = 'CORE-ERROR',
  DOMAIN_ERROR = 'DOMAIN-ERROR',
  POLICY_ERROR = 'POLICY-ERROR',
  JSON_SCHEMA_ERROR = 'JSON-SCHEMA-ERROR',
}

/**
 * Error messages for error codes
 */
export const ERROR_MESSAGES: Partial<Record<OndcErrorCode, string>> = {
  [OndcErrorCode.INVALID_REQUEST]: 'Invalid request format',
  [OndcErrorCode.INVALID_SIGNATURE]:
    'Invalid or missing authorization signature',
  [OndcErrorCode.INVALID_TIMESTAMP]: 'Invalid timestamp in request',
  [OndcErrorCode.STALE_REQUEST]: 'Request is stale or expired',
  [OndcErrorCode.INTERNAL_ERROR]: 'Internal server error',

  [OndcErrorCode.INVALID_DOMAIN]: 'Invalid or unsupported domain',
  [OndcErrorCode.INVALID_COUNTRY]: 'Invalid or unsupported country code',
  [OndcErrorCode.INVALID_CITY]: 'Invalid or unsupported city code',
  [OndcErrorCode.INVALID_ACTION]: 'Invalid action',
  [OndcErrorCode.INVALID_CORE_VERSION]: 'Unsupported core version',
  [OndcErrorCode.INVALID_BAP_ID]: 'Invalid BAP subscriber ID',
  [OndcErrorCode.INVALID_BAP_URI]: 'Invalid BAP URI',
  [OndcErrorCode.INVALID_BPP_ID]: 'Invalid BPP subscriber ID',
  [OndcErrorCode.INVALID_BPP_URI]: 'Invalid BPP URI',
  [OndcErrorCode.INVALID_TRANSACTION_ID]: 'Invalid or missing transaction ID',
  [OndcErrorCode.INVALID_MESSAGE_ID]: 'Invalid or missing message ID',
  [OndcErrorCode.INVALID_TIMESTAMP_FORMAT]: 'Invalid timestamp format',
  [OndcErrorCode.INVALID_TTL]: 'Invalid TTL value',

  [OndcErrorCode.INVALID_SEARCH_INTENT]: 'Invalid search intent',
  [OndcErrorCode.LOCATION_NOT_SERVICEABLE]: 'Location is not serviceable',
  [OndcErrorCode.CATEGORY_NOT_FOUND]: 'Category not found',
  [OndcErrorCode.NO_PROVIDERS_AVAILABLE]: 'No providers available',
  [OndcErrorCode.INVALID_GPS_FORMAT]: 'Invalid GPS format. Expected: lat,lng',

  [OndcErrorCode.ORDER_NOT_FOUND]: 'Order not found',
  [OndcErrorCode.ORDER_ALREADY_EXISTS]: 'Order already exists',
  [OndcErrorCode.INVALID_ORDER_STATE]: 'Invalid order state for this operation',
  [OndcErrorCode.ORDER_CANNOT_BE_CANCELLED]: 'Order cannot be cancelled',
  [OndcErrorCode.ORDER_CANNOT_BE_UPDATED]: 'Order cannot be updated',
  [OndcErrorCode.QUOTE_EXPIRED]: 'Quote has expired',
  [OndcErrorCode.INVALID_PAYMENT_INFO]: 'Invalid payment information',

  [OndcErrorCode.FULFILLMENT_NOT_FOUND]: 'Fulfillment not found',
  [OndcErrorCode.INVALID_FULFILLMENT_TYPE]: 'Invalid fulfillment type',
  [OndcErrorCode.AGENT_NOT_AVAILABLE]: 'No delivery agents available',
  [OndcErrorCode.TRACKING_NOT_AVAILABLE]: 'Tracking not available',

  [OndcErrorCode.PROVIDER_NOT_FOUND]: 'Provider not found',
  [OndcErrorCode.PROVIDER_NOT_ACTIVE]: 'Provider is not active',
  [OndcErrorCode.ITEM_NOT_FOUND]: 'Item not found',
  [OndcErrorCode.ITEM_QUANTITY_UNAVAILABLE]: 'Item quantity not available',

  // Pickup Errors (61xxx)
  [OndcErrorCode.PICKUP_LOCATION_NOT_FOUND]: 'Pickup location not found',
  [OndcErrorCode.PICKUP_TIME_SLOT_UNAVAILABLE]:
    'Pickup time slot not available',
  [OndcErrorCode.PICKUP_CONTACT_UNREACHABLE]: 'Pickup contact unreachable',
  [OndcErrorCode.PICKUP_ADDRESS_INCOMPLETE]: 'Pickup address incomplete',
  [OndcErrorCode.PICKUP_FAILED_MERCHANT_UNAVAILABLE]:
    'Pickup failed - merchant unavailable',
  [OndcErrorCode.PICKUP_FAILED_PACKAGE_NOT_READY]:
    'Pickup failed - package not ready',
  [OndcErrorCode.PICKUP_RESCHEDULED]: 'Pickup has been rescheduled',

  // Delivery Errors (62xxx)
  [OndcErrorCode.DELIVERY_LOCATION_NOT_FOUND]: 'Delivery location not found',
  [OndcErrorCode.DELIVERY_TIME_SLOT_UNAVAILABLE]:
    'Delivery time slot not available',
  [OndcErrorCode.DELIVERY_CONTACT_UNREACHABLE]: 'Delivery contact unreachable',
  [OndcErrorCode.DELIVERY_ADDRESS_INCOMPLETE]: 'Delivery address incomplete',
  [OndcErrorCode.DELIVERY_FAILED_RECIPIENT_UNAVAILABLE]:
    'Delivery failed - recipient unavailable',
  [OndcErrorCode.DELIVERY_FAILED_WRONG_ADDRESS]:
    'Delivery failed - wrong address',
  [OndcErrorCode.DELIVERY_FAILED_REFUSED]:
    'Delivery failed - recipient refused',
  [OndcErrorCode.DELIVERY_RESCHEDULED]: 'Delivery has been rescheduled',

  // Package/Weight Errors (63xxx)
  [OndcErrorCode.PACKAGE_WEIGHT_MISMATCH]:
    'Package weight does not match declared weight',
  [OndcErrorCode.PACKAGE_DIMENSIONS_EXCEEDED]:
    'Package dimensions exceed allowed limits',
  [OndcErrorCode.PACKAGE_DAMAGED]: 'Package is damaged',
  [OndcErrorCode.PACKAGE_CONTENTS_PROHIBITED]:
    'Package contains prohibited items',
  [OndcErrorCode.PACKAGE_MISSING]: 'Package is missing',
  [OndcErrorCode.WEIGHT_DIFFERENTIAL_CHARGES_APPLICABLE]:
    'Weight differential charges applicable',

  // AWB/Tracking Errors (64xxx)
  [OndcErrorCode.AWB_NOT_GENERATED]: 'AWB number not generated',
  [OndcErrorCode.AWB_INVALID]: 'Invalid AWB number',
  [OndcErrorCode.AWB_ALREADY_EXISTS]: 'AWB number already exists',
  [OndcErrorCode.TRACKING_URL_NOT_AVAILABLE]: 'Tracking URL not available',
  [OndcErrorCode.SHIPMENT_NOT_TRACKABLE]: 'Shipment is not trackable',

  // Confirmation Code Errors (65xxx)
  [OndcErrorCode.PCC_NOT_GENERATED]:
    'Pickup Confirmation Code (PCC) not generated',
  [OndcErrorCode.PCC_INVALID]: 'Invalid Pickup Confirmation Code (PCC)',
  [OndcErrorCode.PCC_ALREADY_USED]:
    'Pickup Confirmation Code (PCC) already used',
  [OndcErrorCode.PCC_EXPIRED]: 'Pickup Confirmation Code (PCC) has expired',
  [OndcErrorCode.PCC_VERIFICATION_FAILED]:
    'Pickup Confirmation Code (PCC) verification failed',
  [OndcErrorCode.DCC_NOT_GENERATED]:
    'Delivery Confirmation Code (DCC) not generated',
  [OndcErrorCode.DCC_INVALID]: 'Invalid Delivery Confirmation Code (DCC)',
  [OndcErrorCode.DCC_ALREADY_USED]:
    'Delivery Confirmation Code (DCC) already used',
  [OndcErrorCode.DCC_EXPIRED]: 'Delivery Confirmation Code (DCC) has expired',
  [OndcErrorCode.DCC_VERIFICATION_FAILED]:
    'Delivery Confirmation Code (DCC) verification failed',

  // Policy Errors (70xxx)
  [OndcErrorCode.CANCELLATION_NOT_ALLOWED]:
    'Cancellation not allowed at this stage',
  [OndcErrorCode.RETURN_NOT_ALLOWED]: 'Return not allowed',
  [OndcErrorCode.POLICY_VIOLATION]: 'Policy violation',

  // RTO Errors (71xxx)
  [OndcErrorCode.RTO_INITIATED]: 'Return to Origin (RTO) initiated',
  [OndcErrorCode.RTO_ADDRESS_NOT_FOUND]: 'RTO address not found',
  [OndcErrorCode.RTO_FAILED]: 'RTO failed',
  [OndcErrorCode.RTO_CHARGES_APPLICABLE]: 'RTO charges applicable',

  // Settlement/Payment Errors (72xxx)
  [OndcErrorCode.SETTLEMENT_FAILED]: 'Settlement failed',
  [OndcErrorCode.COD_COLLECTION_FAILED]: 'COD collection failed',
  [OndcErrorCode.PAYMENT_MISMATCH]: 'Payment amount mismatch',
  [OndcErrorCode.REFUND_FAILED]: 'Refund processing failed',
};

/**
 * Build error object for ONDC response
 */
export function buildOndcError(
  code: OndcErrorCode,
  customMessage?: string,
  type: OndcErrorType = OndcErrorType.DOMAIN_ERROR,
) {
  return {
    type,
    code,
    message: customMessage || ERROR_MESSAGES[code] || 'Unknown error',
  };
}
