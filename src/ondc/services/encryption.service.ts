import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * EncryptionService handles X25519 encryption/decryption for ONDC
 * Used for the on_subscribe challenge-response flow
 *
 * ONDC Challenge Format (encrypted with X25519 + AES-256-GCM):
 * [ephemeral_public_key (32 bytes) | nonce (12 bytes) | ciphertext | auth_tag (16 bytes)]
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly encryptionPrivateKey: string;
  private readonly encryptionPublicKey: string;

  constructor(private readonly configService: ConfigService) {
    this.encryptionPrivateKey =
      this.configService.get<string>('ondc.encryptionPrivateKey') || '';
    this.encryptionPublicKey =
      this.configService.get<string>('ondc.encryptionPublicKey') || '';

    if (!this.encryptionPrivateKey) {
      this.logger.warn(
        'ONDC_ENCRYPTION_PRIVATE_KEY not configured - on_subscribe will fail',
      );
    }
  }

  /**
   * Decrypt a challenge received from ONDC registry
   *
   * Challenge format: Base64([ephemeral_public_key (32) | nonce (12) | ciphertext | auth_tag (16)])
   *
   * Decryption process:
   * 1. Parse the encrypted data components
   * 2. Perform X25519 ECDH key agreement
   * 3. Derive AES key using HKDF
   * 4. Decrypt with AES-256-GCM
   */
  async decryptChallenge(encryptedChallenge: string): Promise<string> {
    try {
      if (!this.encryptionPrivateKey) {
        throw new Error('Encryption private key not configured');
      }

      this.logger.debug('Decrypting ONDC challenge...');

      // Decode the base64 challenge
      const data = Buffer.from(encryptedChallenge, 'base64');

      // Validate minimum length (32 + 12 + 1 + 16 = 61 bytes minimum)
      if (data.length < 61) {
        throw new Error(
          `Invalid challenge length: ${data.length} bytes (minimum 61 required)`,
        );
      }

      // Parse components from the encrypted data
      const ephemeralPublicKey = data.subarray(0, 32);
      const nonce = data.subarray(32, 44); // 12 bytes for AES-GCM
      const ciphertextWithTag = data.subarray(44);
      const authTag = ciphertextWithTag.subarray(-16);
      const ciphertext = ciphertextWithTag.subarray(0, -16);

      this.logger.debug(
        `Challenge components: ephemeralKey=${ephemeralPublicKey.length}b, nonce=${nonce.length}b, ciphertext=${ciphertext.length}b, authTag=${authTag.length}b`,
      );

      // Import our private key from base64 DER format
      const privateKeyBuffer = Buffer.from(this.encryptionPrivateKey, 'base64');
      const privateKey = crypto.createPrivateKey({
        key: privateKeyBuffer,
        format: 'der',
        type: 'pkcs8',
      });

      // Create ephemeral public key object (X25519 SPKI format)
      // X25519 SPKI prefix: 302a300506032b656e032100 (12 bytes)
      const x25519SpkiPrefix = Buffer.from('302a300506032b656e032100', 'hex');
      const ephemeralPubKey = crypto.createPublicKey({
        key: Buffer.concat([x25519SpkiPrefix, ephemeralPublicKey]),
        format: 'der',
        type: 'spki',
      });

      // Perform ECDH key agreement to get shared secret
      const sharedSecret = crypto.diffieHellman({
        privateKey: privateKey,
        publicKey: ephemeralPubKey,
      });

      this.logger.debug(`Shared secret derived: ${sharedSecret.length} bytes`);

      // Derive AES key from shared secret using HKDF
      // Using empty salt and 'ondc' as info (ONDC standard)
      const aesKey = crypto.hkdfSync(
        'sha256',
        sharedSecret,
        Buffer.alloc(0), // empty salt
        Buffer.from('ondc'), // info
        32, // key length for AES-256
      );

      // Decrypt with AES-256-GCM
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        Buffer.from(aesKey),
        nonce,
      );
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      const answer = decrypted.toString('utf8');
      this.logger.log('Challenge decrypted successfully');

      return answer;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to decrypt challenge: ${errorMessage}`);
      throw new Error(`Challenge decryption failed: ${errorMessage}`);
    }
  }

  /**
   * Check if encryption is properly configured
   */
  isConfigured(): boolean {
    return !!this.encryptionPrivateKey && !!this.encryptionPublicKey;
  }

  /**
   * Get encryption public key (for registration verification)
   */
  getPublicKey(): string {
    return this.encryptionPublicKey;
  }

  /**
   * Verify encryption configuration on startup
   */
  verifyConfiguration(): {
    configured: boolean;
    hasPrivateKey: boolean;
    hasPublicKey: boolean;
  } {
    return {
      configured: this.isConfigured(),
      hasPrivateKey: !!this.encryptionPrivateKey,
      hasPublicKey: !!this.encryptionPublicKey,
    };
  }
}
