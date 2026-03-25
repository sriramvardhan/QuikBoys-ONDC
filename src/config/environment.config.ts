/**
 * Environment configuration helpers for ONDC module.
 */

export function getApiBaseUrl(): string {
  return process.env.API_BASE_URL || 'http://localhost:3000';
}

export function getOndcBaseUrl(): string {
  return process.env.ONDC_SUBSCRIBER_URL || `${getApiBaseUrl()}/ondc`;
}

export function getOndcTrackingBaseUrl(): string {
  return (
    process.env.ONDC_TRACKING_BASE_URL || 'https://track.quikboys.in'
  );
}
