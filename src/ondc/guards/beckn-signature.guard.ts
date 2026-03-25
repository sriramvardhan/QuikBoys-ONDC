import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SignatureService } from '../services/signature.service';
import { RegistryService } from '../services/registry.service';
import { IS_PUBLIC_ONDC_KEY } from '../decorators/public-ondc.decorator';
// SECURITY: Removed SkipSignature decorator - signature verification must always be enforced
import { getErrorMessage } from '../types/ondc-error.interface';

/**
 * Guard that verifies the Beckn/ONDC Authorization header signature
 * Applied to all ONDC webhook endpoints
 */
@Injectable()
export class BecknSignatureGuard implements CanActivate {
  private readonly logger = new Logger(BecknSignatureGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly signatureService: SignatureService,
    private readonly registryService: RegistryService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Enhanced entry-point logging for debugging
    this.logger.log(`[GUARD_ENTRY] ========== SIGNATURE GUARD ACTIVATED ==========`);

    // Check if endpoint is marked as public (skip signature verification)
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_ONDC_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      this.logger.log(`[GUARD_ENTRY] Endpoint is public, skipping signature verification`);
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const requestBody = request.body as { context?: { bap_id?: string; transaction_id?: string } };

    this.logger.log(`[GUARD_ENTRY] Request path: ${request.path}`);
    this.logger.log(`[GUARD_ENTRY] Request method: ${request.method}`);
    this.logger.log(`[GUARD_ENTRY] BAP ID from body: ${requestBody?.context?.bap_id}`);
    this.logger.log(`[GUARD_ENTRY] Transaction ID: ${requestBody?.context?.transaction_id}`);

    // Check if this is a trusted test BAP (for Pramaan testing)
    // SECURITY: Only enable ONDC_TRUSTED_TEST_BAPS in test/preprod environments
    const trustedTestBapsConfig =
      this.configService.get<string>('ondc.trustedTestBaps') || '';
    const trustedTestBaps = trustedTestBapsConfig
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    const bapId = requestBody?.context?.bap_id;

    // Check for exact match OR partial match (e.g., staging-bap.pramaan.ondc.org contains pramaan.ondc.org)
    const isTrustedBap = bapId && trustedTestBaps.some((trusted) =>
      bapId.includes(trusted) || trusted.includes(bapId)
    );

    this.logger.log(`[GUARD_ENTRY] Trusted Test BAPs configured: ${trustedTestBaps.length > 0 ? trustedTestBaps.join(', ') : 'NONE'}`);
    this.logger.log(`[GUARD_ENTRY] Is BAP in trusted list: ${isTrustedBap}`);

    if (isTrustedBap) {
      this.logger.log(
        `Skipping signature verification for trusted test BAP: ${bapId}`,
      );
      // Attach subscriber info to request
      request.ondcSubscriber = {
        subscriberId: bapId,
        verified: false, // Not cryptographically verified
      };
      return true;
    }

    // SECURITY: For non-trusted BAPs, signature verification is ALWAYS enforced

    // Get authorization header
    const authHeader = request.headers['authorization'] as string;
    if (!authHeader) {
      this.logger.warn('Missing Authorization header');
      throw new UnauthorizedException({
        message: {
          ack: { status: 'NACK' },
        },
        error: {
          type: 'CONTEXT-ERROR',
          code: '20001',
          message: 'Missing Authorization header',
        },
      });
    }

    // Extract subscriber ID from header
    const subscriberId =
      this.signatureService.getSubscriberIdFromHeader(authHeader);
    if (!subscriberId) {
      this.logger.warn('Could not extract subscriber ID from auth header');
      throw new UnauthorizedException({
        message: {
          ack: { status: 'NACK' },
        },
        error: {
          type: 'CONTEXT-ERROR',
          code: '20002',
          message: 'Invalid Authorization header format',
        },
      });
    }

    // Get body for signature verification
    const body: unknown = request.body;
    if (!body) {
      this.logger.warn('Request body is empty');
      throw new UnauthorizedException({
        message: {
          ack: { status: 'NACK' },
        },
        error: {
          type: 'CONTEXT-ERROR',
          code: '20003',
          message: 'Request body is required',
        },
      });
    }

    try {
      // Verify signature using registry lookup
      const isValid = await this.registryService.verifyBapSignature(
        authHeader,
        body,
        subscriberId,
      );

      if (!isValid) {
        this.logger.warn(`Signature verification failed for: ${subscriberId}`);
        throw new UnauthorizedException({
          message: {
            ack: { status: 'NACK' },
          },
          error: {
            type: 'CONTEXT-ERROR',
            code: '20004',
            message: 'Signature verification failed',
          },
        });
      }

      // Attach subscriber info to request for later use
      request.ondcSubscriber = {
        subscriberId,
        verified: true,
      };

      this.logger.debug(`Signature verified for: ${subscriberId}`);
      return true;
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.error(
        `Signature verification error: ${getErrorMessage(error)}`,
      );
      throw new UnauthorizedException({
        message: {
          ack: { status: 'NACK' },
        },
        error: {
          type: 'CONTEXT-ERROR',
          code: '20005',
          message: 'Signature verification error',
        },
      });
    }
  }
}
