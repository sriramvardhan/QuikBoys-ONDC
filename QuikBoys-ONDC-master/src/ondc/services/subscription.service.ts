import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import { EncryptionService } from './encryption.service';
import { OndcSubscriptionStatus } from '@prisma/client';

export interface OnSubscribeRequest {
  subscriber_id: string;
  challenge: string;
}

export interface OnSubscribeResponse {
  answer: string;
}

/**
 * SubscriptionService handles the ONDC subscription verification flow
 *
 * Flow:
 * 1. ONDC registry sends /on_subscribe with encrypted challenge
 * 2. We decrypt the challenge using our X25519 private key
 * 3. We return the decrypted answer
 * 4. Registry verifies and activates our subscription
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);
  private readonly subscriberId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
  ) {
    this.subscriberId =
      this.configService.get<string>('ondc.subscriberId') || '';

    if (!this.subscriberId) {
      this.logger.warn('ONDC_SUBSCRIBER_ID not configured');
    }
  }

  /**
   * Handle the on_subscribe callback from ONDC registry
   *
   * @param request - Contains subscriber_id and encrypted challenge
   * @returns Decrypted challenge as the answer
   */
  async handleOnSubscribe(
    request: OnSubscribeRequest,
  ): Promise<OnSubscribeResponse> {
    this.logger.log(`Processing on_subscribe for: ${request.subscriber_id}`);

    // Record the subscription attempt
    const subscription = await this.prisma.ondcSubscription.create({
      data: {
        subscriberId: request.subscriber_id,
        challengeReceived: request.challenge,
        status: OndcSubscriptionStatus.PENDING,
        receivedAt: new Date(),
      },
    });

    try {
      // Validate subscriber ID matches our configured ID
      if (request.subscriber_id !== this.subscriberId) {
        this.logger.warn(
          `Subscriber ID mismatch: expected "${this.subscriberId}", got "${request.subscriber_id}"`,
        );
        await this.updateStatus(
          subscription.id,
          OndcSubscriptionStatus.FAILED,
          `Subscriber ID mismatch: expected ${this.subscriberId}`,
        );
        throw new HttpException(
          {
            message: 'Subscriber ID mismatch',
            expected: this.subscriberId,
            received: request.subscriber_id,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Check if encryption is properly configured
      if (!this.encryptionService.isConfigured()) {
        this.logger.error('Encryption keys not configured');
        await this.updateStatus(
          subscription.id,
          OndcSubscriptionStatus.FAILED,
          'Encryption keys not configured',
        );
        throw new HttpException(
          'Server encryption not configured',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Decrypt the challenge
      const answer = await this.encryptionService.decryptChallenge(
        request.challenge,
      );

      // Update subscription status to VERIFIED
      await this.updateStatus(
        subscription.id,
        OndcSubscriptionStatus.VERIFIED,
        null,
        answer,
      );

      this.logger.log(
        `on_subscribe challenge answered successfully for ${request.subscriber_id}`,
      );

      return { answer };
    } catch (error) {
      // If it's already an HttpException, rethrow it
      if (error instanceof HttpException) {
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`on_subscribe failed: ${errorMessage}`);

      await this.updateStatus(
        subscription.id,
        OndcSubscriptionStatus.FAILED,
        errorMessage,
      );

      throw new HttpException(
        {
          message: 'Failed to process subscription verification',
          error: errorMessage,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Update subscription record status
   */
  private async updateStatus(
    id: string,
    status: OndcSubscriptionStatus,
    errorMessage?: string | null,
    answerSent?: string,
  ): Promise<void> {
    await this.prisma.ondcSubscription.update({
      where: { id },
      data: {
        status,
        errorMessage: errorMessage || null,
        answerSent: answerSent || null,
        respondedAt: new Date(),
      },
    });
  }

  /**
   * Get current subscription status
   */
  async getSubscriptionStatus(): Promise<{
    isSubscribed: boolean;
    lastAttempt?: Date;
    status?: string;
    subscriberId: string;
  }> {
    const latest = await this.prisma.ondcSubscription.findFirst({
      orderBy: { receivedAt: 'desc' },
    });

    return {
      isSubscribed: latest?.status === OndcSubscriptionStatus.VERIFIED,
      lastAttempt: latest?.receivedAt,
      status: latest?.status,
      subscriberId: this.subscriberId,
    };
  }

  /**
   * Get all subscription attempts (for debugging)
   */
  async getSubscriptionHistory(limit: number = 10): Promise<
    Array<{
      id: string;
      subscriberId: string;
      status: string;
      receivedAt: Date;
      respondedAt: Date | null;
      errorMessage: string | null;
    }>
  > {
    const records = await this.prisma.ondcSubscription.findMany({
      take: limit,
      orderBy: { receivedAt: 'desc' },
      select: {
        id: true,
        subscriberId: true,
        status: true,
        receivedAt: true,
        respondedAt: true,
        errorMessage: true,
      },
    });

    return records;
  }
}
