import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { RegistryLookupResult } from '../interfaces/beckn-request.interface';
import { SignatureService } from './signature.service';
import { getErrorMessage } from '../types/ondc-error.interface';

/**
 * RegistryService handles ONDC registry operations
 * - Lookup subscriber information (BAP/BPP)
 * - Validate subscriber credentials
 * - Cache registry responses
 */
@Injectable()
export class RegistryService {
  private readonly logger = new Logger(RegistryService.name);
  private readonly registryUrl: string;
  private readonly cache = new Map<string, CachedLookup>();
  private readonly cacheTTL = 300000; // 5 minutes

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly signatureService: SignatureService,
  ) {
    this.registryUrl =
      this.configService.get<string>('ondc.registryUrl') ||
      'https://staging.registry.ondc.org';
  }

  /**
   * Lookup a subscriber in the ONDC registry
   */
  async lookup(
    subscriberId: string,
    domain?: string,
    type?: string,
  ): Promise<RegistryLookupResult | null> {
    const cacheKey = `${subscriberId}:${domain || 'all'}:${type || 'all'}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      this.logger.debug(`Registry cache hit for: ${subscriberId}`);
      return cached.result;
    }

    try {
      const lookupBody = {
        subscriber_id: subscriberId,
        ...(domain && { domain }),
        ...(type && { type }),
      };

      // Create authorization header for registry request
      const authHeader =
        this.signatureService.createAuthorizationHeader(lookupBody);

      const response = await firstValueFrom(
        this.httpService.post<RegistryLookupResult[]>(
          `${this.registryUrl}/lookup`,
          lookupBody,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            timeout: 10000,
          },
        ),
      );

      if (response.data && response.data.length > 0) {
        const result = response.data[0];

        // Cache the result
        this.cache.set(cacheKey, {
          result,
          expiresAt: Date.now() + this.cacheTTL,
        });

        this.logger.log(`Registry lookup successful for: ${subscriberId}`);
        return result;
      }

      this.logger.warn(`No registry entry found for: ${subscriberId}`);
      return null;
    } catch (error: unknown) {
      this.logger.error(`Registry lookup failed: ${getErrorMessage(error)}`);
      throw new HttpException(
        'Registry lookup failed',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Get public signing key for a subscriber
   */
  async getSigningPublicKey(subscriberId: string): Promise<string | null> {
    const result = await this.lookup(subscriberId);
    return result?.signing_public_key || null;
  }

  /**
   * Get encryption public key for a subscriber
   */
  async getEncryptionPublicKey(subscriberId: string): Promise<string | null> {
    const result = await this.lookup(subscriberId);
    return result?.encr_public_key || null;
  }

  /**
   * Validate that a subscriber is registered and active
   */
  async validateSubscriber(
    subscriberId: string,
    domain: string,
    expectedType: 'BAP' | 'BPP' | 'BG',
  ): Promise<boolean> {
    try {
      const result = await this.lookup(subscriberId, domain, expectedType);

      if (!result) {
        this.logger.warn(`Subscriber not found: ${subscriberId}`);
        return false;
      }

      // Check if subscriber is active
      if (result.status !== 'SUBSCRIBED') {
        this.logger.warn(
          `Subscriber not active: ${subscriberId}, status: ${result.status}`,
        );
        return false;
      }

      // Check validity period
      const now = new Date();
      const validFrom = new Date(result.valid_from);
      const validUntil = new Date(result.valid_until);

      if (now < validFrom || now > validUntil) {
        this.logger.warn(`Subscriber outside validity period: ${subscriberId}`);
        return false;
      }

      // Check type matches
      if (result.type !== expectedType) {
        this.logger.warn(
          `Subscriber type mismatch: expected ${expectedType}, got ${result.type}`,
        );
        return false;
      }

      return true;
    } catch (error: unknown) {
      this.logger.error(
        `Subscriber validation failed: ${getErrorMessage(error)}`,
      );
      return false;
    }
  }

  /**
   * Verify signature from a BAP request
   */
  async verifyBapSignature(
    authHeader: string,
    body: unknown,
    bapId: string,
  ): Promise<boolean> {
    const publicKey = await this.getSigningPublicKey(bapId);
    if (!publicKey) {
      this.logger.warn(`Could not get public key for BAP: ${bapId}`);
      return false;
    }

    return this.signatureService.verifyAuthorizationHeader(
      authHeader,
      body,
      publicKey,
    );
  }

  /**
   * Get subscriber URL for callbacks
   */
  async getSubscriberUrl(subscriberId: string): Promise<string | null> {
    const result = await this.lookup(subscriberId);
    return result?.subscriber_url || null;
  }

  /**
   * Subscribe to ONDC network (for initial registration)
   */
  async subscribe(subscriptionData: SubscriptionRequest): Promise<boolean> {
    try {
      const authHeader =
        this.signatureService.createAuthorizationHeader(subscriptionData);

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.registryUrl}/subscribe`,
          subscriptionData,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            timeout: 30000,
          },
        ),
      );

      if (response.status === 200 || response.status === 201) {
        this.logger.log('Successfully subscribed to ONDC network');
        return true;
      }

      return false;
    } catch (error: unknown) {
      this.logger.error(`Subscription failed: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Clear registry cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('Registry cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }
}

/**
 * Cached lookup entry
 */
interface CachedLookup {
  result: RegistryLookupResult;
  expiresAt: number;
}

/**
 * Subscription request structure
 */
interface SubscriptionRequest {
  subscriber_id: string;
  subscriber_url: string;
  signing_public_key: string;
  encr_public_key?: string;
  type: 'BAP' | 'BPP' | 'BG';
  domain: string;
  city?: string;
  country: string;
  valid_from: string;
  valid_until: string;
}
