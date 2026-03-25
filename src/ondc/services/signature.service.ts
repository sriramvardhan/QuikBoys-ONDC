import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { getErrorMessage } from '../types/ondc-error.interface';
import { ParsedAuthHeader } from '../interfaces/beckn-request.interface';

/**
 * SignatureService handles Ed25519 signing and verification for ONDC/Beckn protocol
 * Implements the authorization header format specified in ONDC specs
 */
@Injectable()
export class SignatureService {
  private readonly logger = new Logger(SignatureService.name);
  private readonly privateKey: string;
  private readonly subscriberId: string;
  private readonly uniqueKeyId: string;

  constructor(private readonly configService: ConfigService) {
    this.privateKey =
      this.configService.get<string>('ondc.signingPrivateKey') || '';
    this.subscriberId =
      this.configService.get<string>('ondc.subscriberId') ||
      'quikboys.ondc.org';
    this.uniqueKeyId =
      this.configService.get<string>('ondc.uniqueKeyId') || 'key1';
  }

  /**
   * Create authorization header for outgoing requests
   * Format: Signature keyId="...",algorithm="ed25519",created="...",expires="...",headers="(created) (expires) digest",signature="..."
   */
  createAuthorizationHeader(body: unknown): string {
    const created = Math.floor(Date.now() / 1000);
    const expires = created + 300; // 5 minutes validity

    // Create digest of request body
    const digest = this.createDigest(body);

    // Create signing string
    const signingString = this.createSigningString(created, expires, digest);

    // Sign the string
    const signature = this.sign(signingString);

    // Build authorization header with ONDC-compliant keyId format: subscriber_id|unique_key_id|ed25519
    const keyId = `${this.subscriberId}|${this.uniqueKeyId}|ed25519`;
    const authHeader = `Signature keyId="${keyId}",algorithm="ed25519",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${signature}"`;

    this.logger.debug(
      `Created auth header for subscriber: ${this.subscriberId}`,
    );
    return authHeader;
  }

  /**
   * Verify authorization header from incoming requests
   */
  verifyAuthorizationHeader(
    authHeader: string,
    body: unknown,
    publicKey: string,
  ): boolean {
    try {
      const parsed = this.parseAuthorizationHeader(authHeader);
      if (!parsed) {
        this.logger.warn('Failed to parse authorization header');
        return false;
      }

      // Check if signature has expired
      const now = Math.floor(Date.now() / 1000);
      if (parseInt(parsed.expires) < now) {
        this.logger.warn('Signature has expired');
        return false;
      }

      // Check if signature is not from future (with 5 min tolerance)
      if (parseInt(parsed.created) > now + 300) {
        this.logger.warn('Signature created in future');
        return false;
      }

      // Create digest and signing string
      const digest = this.createDigest(body);
      const signingString = this.createSigningString(
        parseInt(parsed.created),
        parseInt(parsed.expires),
        digest,
      );

      // Verify signature
      const isValid = this.verify(signingString, parsed.signature, publicKey);

      if (!isValid) {
        this.logger.warn('Signature verification failed');
      }

      return isValid;
    } catch (error: unknown) {
      this.logger.error(
        `Signature verification error: ${getErrorMessage(error)}`,
      );
      return false;
    }
  }

  /**
   * Parse authorization header into components
   */
  parseAuthorizationHeader(authHeader: string): ParsedAuthHeader | null {
    try {
      // Remove "Signature " prefix if present
      const signatureString = authHeader.replace(/^Signature\s+/i, '');

      const params: Record<string, string> = {};
      const regex = /(\w+)="([^"]+)"/g;
      let match;

      while ((match = regex.exec(signatureString)) !== null) {
        params[match[1]] = match[2];
      }

      if (
        !params.keyId ||
        !params.algorithm ||
        !params.created ||
        !params.expires ||
        !params.signature
      ) {
        this.logger.warn('Missing required parameters in auth header');
        return null;
      }

      // Parse keyId to extract subscriber_id and unique_key_id
      const keyIdParts = params.keyId.split('|');
      const subscriberId = keyIdParts[0];
      const uniqueKeyId = keyIdParts.length > 1 ? keyIdParts[1] : undefined;

      return {
        keyId: params.keyId,
        algorithm: params.algorithm,
        created: params.created,
        expires: params.expires,
        headers: params.headers || '(created) (expires) digest',
        signature: params.signature,
        subscriberId,
        uniqueKeyId,
      };
    } catch (error: unknown) {
      this.logger.error(`Error parsing auth header: ${getErrorMessage(error)}`);
      return null;
    }
  }

  /**
   * Create BLAKE-512 digest of request body
   */
  private createDigest(body: unknown): string {
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    const hash = crypto.createHash('blake2b512').update(bodyString).digest();
    return `BLAKE-512=${hash.toString('base64')}`;
  }

  /**
   * Create signing string from components
   */
  private createSigningString(
    created: number,
    expires: number,
    digest: string,
  ): string {
    return `(created): ${created}\n(expires): ${expires}\ndigest: ${digest}`;
  }

  /**
   * Create an Ed25519 private key object from various formats
   * Supports: 64-byte raw (seed+pubkey), 48-byte DER PKCS8, 32-byte seed
   */
  private createPrivateKeyObject(keyBase64: string): crypto.KeyObject {
    const keyBuffer = Buffer.from(keyBase64, 'base64');
    const keyLength = keyBuffer.length;

    // 64-byte raw Ed25519 format (seed + public key)
    // Common in ONDC/libsodium implementations
    if (keyLength === 64) {
      const seed = keyBuffer.slice(0, 32);
      const derPrefix = Buffer.from([
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
        0x04, 0x22, 0x04, 0x20,
      ]);
      const derKey = Buffer.concat([derPrefix, seed]);
      return crypto.createPrivateKey({
        key: derKey,
        format: 'der',
        type: 'pkcs8',
      });
    }

    // 48-byte DER PKCS8 format (standard Node.js format)
    if (keyLength === 48) {
      return crypto.createPrivateKey({
        key: keyBuffer,
        format: 'der',
        type: 'pkcs8',
      });
    }

    // 32-byte raw seed
    if (keyLength === 32) {
      const derPrefix = Buffer.from([
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
        0x04, 0x22, 0x04, 0x20,
      ]);
      const derKey = Buffer.concat([derPrefix, keyBuffer]);
      return crypto.createPrivateKey({
        key: derKey,
        format: 'der',
        type: 'pkcs8',
      });
    }

    throw new Error(`Unsupported key length: ${keyLength} bytes`);
  }

  /**
   * Sign a string using Ed25519 private key
   */
  private sign(message: string): string {
    try {
      // Create key object (handles multiple formats)
      const keyObject = this.createPrivateKeyObject(this.privateKey);

      // Sign the message
      const signature = crypto.sign(null, Buffer.from(message), keyObject);
      return signature.toString('base64');
    } catch (error: unknown) {
      this.logger.error(`Signing error: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Verify a signature using Ed25519 public key
   */
  private verify(
    message: string,
    signature: string,
    publicKey: string,
  ): boolean {
    try {
      // Decode base64 public key
      const publicKeyBuffer = Buffer.from(publicKey, 'base64');

      // Create key object
      const keyObject = crypto.createPublicKey({
        key: publicKeyBuffer,
        format: 'der',
        type: 'spki',
      });

      // Verify signature
      const signatureBuffer = Buffer.from(signature, 'base64');
      return crypto.verify(
        null,
        Buffer.from(message),
        keyObject,
        signatureBuffer,
      );
    } catch (error: unknown) {
      this.logger.error(`Verification error: ${getErrorMessage(error)}`);
      return false;
    }
  }

  /**
   * Get subscriber ID from parsed auth header
   */
  getSubscriberIdFromHeader(authHeader: string): string | null {
    const parsed = this.parseAuthorizationHeader(authHeader);
    return parsed?.subscriberId || null;
  }

  /**
   * Create X-Gateway-Authorization header for gateway requests
   */
  createGatewayAuthorizationHeader(body: unknown): string {
    return this.createAuthorizationHeader(body);
  }

  /**
   * Verify request from ONDC Gateway
   */
  verifyGatewayRequest(
    authHeader: string,
    body: unknown,
    gatewayPublicKey: string,
  ): boolean {
    return this.verifyAuthorizationHeader(authHeader, body, gatewayPublicKey);
  }
}
