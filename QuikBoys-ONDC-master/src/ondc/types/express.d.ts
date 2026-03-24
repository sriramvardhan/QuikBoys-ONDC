/**
 * Type augmentation for Express Request
 * Adds ONDC-specific properties to the request object
 */

declare namespace Express {
  export interface Request {
    /**
     * ONDC subscriber information attached by BecknSignatureGuard
     * Present only if signature verification was successful
     */
    ondcSubscriber?: {
      subscriberId: string;
      verified: boolean;
    };
  }
}
