/**
 * Beckn Protocol Context Interface
 * Defines the structure of the context object in all Beckn API requests/responses
 */
export interface BecknContext {
  /**
   * Domain code (e.g., "ONDC:LOG" for logistics)
   */
  domain: string;

  /**
   * Country code (ISO 3166-1 alpha-3)
   */
  country: string;

  /**
   * City code (std:XXX format for India)
   */
  city: string;

  /**
   * Action being performed (search, select, init, confirm, etc.)
   */
  action: string;

  /**
   * Core API version
   */
  core_version: string;

  /**
   * BAP (Buyer Application Provider) ID
   */
  bap_id: string;

  /**
   * BAP URI for callbacks
   */
  bap_uri: string;

  /**
   * BPP (Backend Platform Provider) ID
   */
  bpp_id?: string;

  /**
   * BPP URI
   */
  bpp_uri?: string;

  /**
   * Unique transaction ID for the entire order journey
   */
  transaction_id: string;

  /**
   * Unique message ID for this specific request
   */
  message_id: string;

  /**
   * ISO 8601 timestamp
   */
  timestamp: string;

  /**
   * Key used for signing
   */
  key?: string;

  /**
   * Time to live for the request (ISO 8601 duration format, e.g., "PT30S")
   */
  ttl?: string;
}

/**
 * Build context for callback response
 */
export interface CallbackContext extends BecknContext {
  /**
   * BPP ID (required in callback)
   */
  bpp_id: string;

  /**
   * BPP URI (required in callback)
   */
  bpp_uri: string;
}

/**
 * Context builder options
 */
export interface ContextBuilderOptions {
  action: string;
  transactionId: string;
  messageId: string;
  bapId: string;
  bapUri: string;
  city?: string;
  ttlSeconds?: number;
}
