import { BecknContext } from './beckn-context.interface';
import {
  SearchMessage,
  SelectMessage,
  InitMessage,
  ConfirmMessage,
  StatusMessage,
  TrackMessage,
  CancelMessage,
  UpdateMessage,
} from './beckn-message.interface';

/**
 * Generic Beckn API Request
 */
export interface BecknApiRequest<T = unknown> {
  context: BecknContext;
  message: T;
}

/**
 * Search Request
 */
export type SearchRequest = BecknApiRequest<SearchMessage>;

/**
 * Select Request
 */
export type SelectRequest = BecknApiRequest<SelectMessage>;

/**
 * Init Request
 */
export type InitRequest = BecknApiRequest<InitMessage>;

/**
 * Confirm Request
 */
export type ConfirmRequest = BecknApiRequest<ConfirmMessage>;

/**
 * Status Request
 */
export type StatusRequest = BecknApiRequest<StatusMessage>;

/**
 * Track Request
 */
export type TrackRequest = BecknApiRequest<TrackMessage>;

/**
 * Cancel Request
 */
export type CancelRequest = BecknApiRequest<CancelMessage>;

/**
 * Update Request
 */
export type UpdateRequest = BecknApiRequest<UpdateMessage>;

/**
 * Type guard to check if request has valid context
 */
export function hasValidContext(
  request: unknown,
): request is BecknApiRequest<unknown> {
  const req = request as BecknApiRequest<unknown>;
  return (
    req &&
    typeof req === 'object' &&
    req.context &&
    typeof req.context === 'object' &&
    typeof req.context.transaction_id === 'string' &&
    typeof req.context.message_id === 'string' &&
    typeof req.context.bap_id === 'string' &&
    typeof req.context.bap_uri === 'string'
  );
}

/**
 * Parsed authorization header
 */
export interface ParsedAuthHeader {
  keyId: string;
  algorithm: string;
  created: string;
  expires: string;
  headers: string;
  signature: string;
  subscriberId?: string;
  uniqueKeyId?: string;
}

/**
 * Registry lookup result
 */
export interface RegistryLookupResult {
  subscriber_id: string;
  subscriber_url: string;
  signing_public_key: string;
  encr_public_key?: string;
  valid_from: string;
  valid_until: string;
  type: string;
  domain: string;
  city?: string;
  country?: string;
  status: string;
}

/**
 * Callback request options
 */
export interface CallbackOptions {
  url: string;
  action: string;
  context: BecknContext;
  message: unknown;
  retryCount?: number;
  retryDelayMs?: number;
}
