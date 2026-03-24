// ============================================
// PCC/DCC Confirmation Code Service
// File: src/ondc/services/confirmation-code.service.ts
// ONDC Logistics - Pickup/Delivery Confirmation Codes
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import * as crypto from 'crypto';

/**
 * Code Types
 * - PCC: Pickup Confirmation Code (shared with pickup person)
 * - DCC: Delivery Confirmation Code (shared with recipient)
 */
export enum ConfirmationCodeType {
  PCC = 'PCC', // Pickup Confirmation Code
  DCC = 'DCC', // Delivery Confirmation Code
}

/**
 * Confirmation Code Details
 */
export interface ConfirmationCode {
  code: string;
  type: ConfirmationCodeType;
  orderId: string;
  fulfillmentId: string;
  validFrom: Date;
  validTo: Date;
  isUsed: boolean;
  usedAt?: Date;
}

/**
 * Code Verification Result
 */
export interface CodeVerificationResult {
  isValid: boolean;
  errorCode?: string;
  errorMessage?: string;
  codeDetails?: ConfirmationCode;
}

/**
 * ConfirmationCodeService - Manages PCC and DCC for ONDC Logistics
 *
 * ONDC Requirement:
 * - PCC: Agent must collect code from pickup person to confirm pickup
 * - DCC: Recipient must provide code to confirm delivery
 * - Codes help prevent fraudulent delivery claims
 *
 * Note: Codes are stored in OndcFulfillment.pickupAddress JSON field
 * under the key "_confirmationCodes" since there's no dedicated metadata field.
 */
@Injectable()
export class ConfirmationCodeService {
  private readonly logger = new Logger(ConfirmationCodeService.name);
  private readonly codeLength: number;
  private readonly codeValidityMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.codeLength = this.configService.get<number>(
      'CONFIRMATION_CODE_LENGTH',
      6,
    );
    this.codeValidityMinutes = this.configService.get<number>(
      'CONFIRMATION_CODE_VALIDITY_MINUTES',
      1440, // 24 hours default
    );
  }

  /**
   * Generate PCC (Pickup Confirmation Code)
   * Called when order is confirmed and agent is assigned
   */
  async generatePCC(
    orderId: string,
    fulfillmentId: string,
  ): Promise<ConfirmationCode> {
    return this.generateCode(orderId, fulfillmentId, ConfirmationCodeType.PCC);
  }

  /**
   * Generate DCC (Delivery Confirmation Code)
   * Called when order is picked up and out for delivery
   */
  async generateDCC(
    orderId: string,
    fulfillmentId: string,
  ): Promise<ConfirmationCode> {
    return this.generateCode(orderId, fulfillmentId, ConfirmationCodeType.DCC);
  }

  /**
   * Generate confirmation code
   */
  private async generateCode(
    orderId: string,
    fulfillmentId: string,
    type: ConfirmationCodeType,
  ): Promise<ConfirmationCode> {
    // Generate secure random code
    const code = this.generateSecureCode();
    const now = new Date();
    const validTo = new Date(
      now.getTime() + this.codeValidityMinutes * 60 * 1000,
    );

    // Store code in fulfillment's pickupAddress JSON field
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId, fulfillmentId },
    });

    if (fulfillment) {
      const pickupAddress =
        (fulfillment.pickupAddress as Record<string, unknown>) || {};
      const confirmationCodes =
        (pickupAddress._confirmationCodes as Record<string, unknown>) || {};
      const codeKey = type === ConfirmationCodeType.PCC ? 'pcc' : 'dcc';

      const updatedPickupAddress = {
        ...pickupAddress,
        _confirmationCodes: {
          ...confirmationCodes,
          [codeKey]: {
            code,
            generatedAt: now.toISOString(),
            validTo: validTo.toISOString(),
            isUsed: false,
          },
        },
      };

      await this.prisma.ondcFulfillment.update({
        where: { id: fulfillment.id },
        data: {
          pickupAddress: updatedPickupAddress as Prisma.InputJsonValue,
        },
      });
    }

    // Also update order OTP field for DCC (delivery verification)
    if (type === ConfirmationCodeType.DCC) {
      await this.prisma.order.updateMany({
        where: { id: orderId },
        data: { otp: code },
      });
    }

    this.logger.log(
      `Generated ${type} for order ${orderId}: ${code.substring(0, 2)}****`,
    );

    return {
      code,
      type,
      orderId,
      fulfillmentId,
      validFrom: now,
      validTo,
      isUsed: false,
    };
  }

  /**
   * Verify PCC at pickup
   */
  async verifyPCC(
    orderId: string,
    code: string,
  ): Promise<CodeVerificationResult> {
    return this.verifyCode(orderId, code, ConfirmationCodeType.PCC);
  }

  /**
   * Verify DCC at delivery
   */
  async verifyDCC(
    orderId: string,
    code: string,
  ): Promise<CodeVerificationResult> {
    return this.verifyCode(orderId, code, ConfirmationCodeType.DCC);
  }

  /**
   * Verify confirmation code
   */
  private async verifyCode(
    orderId: string,
    providedCode: string,
    type: ConfirmationCodeType,
  ): Promise<CodeVerificationResult> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      return {
        isValid: false,
        errorCode: '65001',
        errorMessage: 'Fulfillment not found',
      };
    }

    const pickupAddress = fulfillment.pickupAddress as Record<
      string,
      unknown
    > | null;
    const confirmationCodes = pickupAddress?._confirmationCodes as
      | Record<string, unknown>
      | undefined;
    const codeKey = type === ConfirmationCodeType.PCC ? 'pcc' : 'dcc';
    const codeData = confirmationCodes?.[codeKey] as
      | {
          code: string;
          generatedAt: string;
          validTo: string;
          isUsed: boolean;
          usedAt?: string;
        }
      | undefined;

    if (!codeData) {
      return {
        isValid: false,
        errorCode: '65002',
        errorMessage: `${type} not generated for this order`,
      };
    }

    // Check if code is already used
    if (codeData.isUsed) {
      return {
        isValid: false,
        errorCode: '65003',
        errorMessage: `${type} has already been used`,
      };
    }

    // Check validity period
    const now = new Date();
    const validTo = new Date(codeData.validTo);
    if (now > validTo) {
      return {
        isValid: false,
        errorCode: '65004',
        errorMessage: `${type} has expired`,
      };
    }

    // Verify code matches
    if (codeData.code !== providedCode) {
      return {
        isValid: false,
        errorCode: '65005',
        errorMessage: `Invalid ${type}`,
      };
    }

    // Mark code as used
    await this.markCodeAsUsed(fulfillment.id, codeKey, pickupAddress || {});

    this.logger.log(`${type} verified successfully for order ${orderId}`);

    return {
      isValid: true,
      codeDetails: {
        code: codeData.code,
        type,
        orderId,
        fulfillmentId: fulfillment.fulfillmentId,
        validFrom: new Date(codeData.generatedAt),
        validTo,
        isUsed: true,
        usedAt: now,
      },
    };
  }

  /**
   * Mark code as used
   */
  private async markCodeAsUsed(
    fulfillmentId: string,
    codeKey: string,
    pickupAddress: Record<string, unknown>,
  ): Promise<void> {
    const confirmationCodes =
      (pickupAddress._confirmationCodes as Record<string, unknown>) || {};
    const codeData = confirmationCodes[codeKey] as Record<string, unknown>;

    const updatedPickupAddress = {
      ...pickupAddress,
      _confirmationCodes: {
        ...confirmationCodes,
        [codeKey]: {
          ...codeData,
          isUsed: true,
          usedAt: new Date().toISOString(),
        },
      },
    };

    await this.prisma.ondcFulfillment.update({
      where: { id: fulfillmentId },
      data: {
        pickupAddress: updatedPickupAddress as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Generate secure random code
   */
  private generateSecureCode(): string {
    // Use crypto for secure random number generation
    const randomBytes = crypto.randomBytes(4);
    const randomNumber = randomBytes.readUInt32BE(0);
    const maxValue = Math.pow(10, this.codeLength);
    const code = (randomNumber % maxValue)
      .toString()
      .padStart(this.codeLength, '0');
    return code;
  }

  /**
   * Get codes for an order (for display to appropriate parties)
   */
  async getCodesForOrder(orderId: string): Promise<{
    pcc?: Partial<ConfirmationCode>;
    dcc?: Partial<ConfirmationCode>;
  }> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      return {};
    }

    const pickupAddress = fulfillment.pickupAddress as Record<
      string,
      unknown
    > | null;
    const confirmationCodes = pickupAddress?._confirmationCodes as
      | Record<string, unknown>
      | undefined;
    const result: {
      pcc?: Partial<ConfirmationCode>;
      dcc?: Partial<ConfirmationCode>;
    } = {};

    if (confirmationCodes?.pcc) {
      const pccData = confirmationCodes.pcc as Record<string, unknown>;
      result.pcc = {
        type: ConfirmationCodeType.PCC,
        orderId,
        fulfillmentId: fulfillment.fulfillmentId,
        validFrom: new Date(pccData.generatedAt as string),
        validTo: new Date(pccData.validTo as string),
        isUsed: pccData.isUsed as boolean,
        // Code is not exposed in response - only shared with pickup contact
      };
    }

    if (confirmationCodes?.dcc) {
      const dccData = confirmationCodes.dcc as Record<string, unknown>;
      result.dcc = {
        type: ConfirmationCodeType.DCC,
        orderId,
        fulfillmentId: fulfillment.fulfillmentId,
        validFrom: new Date(dccData.generatedAt as string),
        validTo: new Date(dccData.validTo as string),
        isUsed: dccData.isUsed as boolean,
        // Code is not exposed in response - only shared with delivery recipient
      };
    }

    return result;
  }

  /**
   * Build authorization tags for ONDC fulfillment
   * Required per ONDC Logistics spec
   */
  buildAuthorizationForPickup(pcc: ConfirmationCode): {
    type: string;
    token: string;
    valid_from: string;
    valid_to: string;
  } {
    return {
      type: 'PCC',
      token: pcc.code,
      valid_from: pcc.validFrom.toISOString(),
      valid_to: pcc.validTo.toISOString(),
    };
  }

  /**
   * Build authorization tags for delivery
   */
  buildAuthorizationForDelivery(dcc: ConfirmationCode): {
    type: string;
    token: string;
    valid_from: string;
    valid_to: string;
  } {
    return {
      type: 'DCC',
      token: dcc.code,
      valid_from: dcc.validFrom.toISOString(),
      valid_to: dcc.validTo.toISOString(),
    };
  }

  /**
   * Regenerate expired code
   */
  async regenerateCode(
    orderId: string,
    type: ConfirmationCodeType,
  ): Promise<ConfirmationCode> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      throw new Error(`Fulfillment not found for order: ${orderId}`);
    }

    this.logger.log(`Regenerating ${type} for order ${orderId}`);

    return this.generateCode(orderId, fulfillment.fulfillmentId, type);
  }
}
