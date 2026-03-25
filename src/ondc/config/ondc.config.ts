import { registerAs } from '@nestjs/config';

export const ondcConfig = registerAs('ondc', () => ({
  // Environment
  environment: process.env.ONDC_ENVIRONMENT || 'staging',

  // Registry URLs
  registryUrl:
    process.env.ONDC_REGISTRY_URL || 'https://staging.registry.ondc.org',
  gatewayUrl:
    process.env.ONDC_GATEWAY_URL || 'https://staging.gateway.ondc.org',

  // Subscriber Details
  subscriberId: process.env.ONDC_SUBSCRIBER_ID,
  subscriberUrl: process.env.ONDC_SUBSCRIBER_URL,
  uniqueKeyId: process.env.ONDC_UNIQUE_KEY_ID || 'ed25519.k1',

  // Cryptographic Keys (Ed25519)
  signingPrivateKey: process.env.ONDC_SIGNING_PRIVATE_KEY,
  signingPublicKey: process.env.ONDC_SIGNING_PUBLIC_KEY,

  // Encryption Keys (X25519 - optional for sensitive data)
  encryptionPrivateKey: process.env.ONDC_ENCRYPTION_PRIVATE_KEY,
  encryptionPublicKey: process.env.ONDC_ENCRYPTION_PUBLIC_KEY,

  // Provider Details
  providerId: process.env.ONDC_PROVIDER_ID || 'P1',
  providerName: process.env.ONDC_PROVIDER_NAME || 'QuikBoys Logistics',
  providerShortDesc:
    process.env.ONDC_PROVIDER_SHORT_DESC || 'Hyperlocal delivery services',
  providerLongDesc:
    process.env.ONDC_PROVIDER_LONG_DESC ||
    'Fast and reliable last-mile delivery for food, groceries, and packages',

  // Domain Configuration
  domain: process.env.ONDC_DOMAIN || 'ONDC:LOG',
  cityCode: process.env.ONDC_CITY_CODE || 'std:040', // Hyderabad
  country: process.env.ONDC_COUNTRY || 'IND',

  // Callback Configuration
  callbackTimeoutMs: parseInt(
    process.env.ONDC_CALLBACK_TIMEOUT_MS || '30000',
    10,
  ),
  callbackRetryCount: parseInt(
    process.env.ONDC_CALLBACK_RETRY_COUNT || '3',
    10,
  ),
  callbackRetryDelayMs: parseInt(
    process.env.ONDC_CALLBACK_RETRY_DELAY_MS || '5000',
    10,
  ),

  // Pricing Configuration (Distance-based)
  pricing: {
    baseFare: parseFloat(process.env.ONDC_BASE_FARE || '30'),
    perKmRate: parseFloat(process.env.ONDC_PER_KM_RATE || '10'),
    perKgRate: parseFloat(process.env.ONDC_PER_KG_RATE || '5'),
    minimumFare: parseFloat(process.env.ONDC_MINIMUM_FARE || '40'),
    taxRate: parseFloat(process.env.ONDC_TAX_RATE || '0.18'), // 18% GST
  },

  // Tracking Configuration
  trackingBaseUrl:
    process.env.ONDC_TRACKING_BASE_URL || 'https://track.quikboys.in',

  // Trusted Test BAPs (comma-separated) - Skip signature verification for these BAPs
  // Used for Pramaan testing. Leave empty or unset in production.
  trustedTestBaps: process.env.ONDC_TRUSTED_TEST_BAPS,

  // TTL Configuration (in seconds)
  ttl: {
    search: parseInt(process.env.ONDC_TTL_SEARCH || '30', 10),
    select: parseInt(process.env.ONDC_TTL_SELECT || '30', 10),
    init: parseInt(process.env.ONDC_TTL_INIT || '30', 10),
    confirm: parseInt(process.env.ONDC_TTL_CONFIRM || '30', 10),
    status: parseInt(process.env.ONDC_TTL_STATUS || '30', 10),
    track: parseInt(process.env.ONDC_TTL_TRACK || '30', 10),
    cancel: parseInt(process.env.ONDC_TTL_CANCEL || '30', 10),
    update: parseInt(process.env.ONDC_TTL_UPDATE || '30', 10),
  },
}));

export type OndcConfig = ReturnType<typeof ondcConfig>;
