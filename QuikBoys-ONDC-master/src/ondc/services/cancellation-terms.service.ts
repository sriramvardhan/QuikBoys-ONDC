// ============================================
// Cancellation Terms Service
// File: src/ondc/services/cancellation-terms.service.ts
// ONDC Logistics - Cancellation terms for fulfillment responses
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Cancellation Term structure per ONDC spec
 */
export interface CancellationTerm {
  fulfillment_state: {
    descriptor: {
      code: string;
      short_desc?: string;
    };
  };
  reason_required: boolean;
  cancellation_fee: {
    percentage?: string;
    amount?: {
      currency: string;
      value: string;
    };
  };
  refund_eligible: boolean;
}

/**
 * Cancellation Reason structure
 */
export interface CancellationReason {
  id: string;
  descriptor: {
    code: string;
    name: string;
    short_desc?: string;
  };
  cancellation_by: 'BUYER' | 'SELLER' | 'LSP';
  applicable_states: string[];
}

/**
 * ONDC Standard Cancellation Reason Codes
 * Per ONDC Logistics Protocol v1.2
 */
export enum CancellationReasonCode {
  // Buyer cancellation reasons (001-099)
  BUYER_NOT_FOUND = '001',
  BUYER_REFUSED = '002',
  BUYER_UNAVAILABLE = '003',
  BUYER_REQUESTED = '004',
  WRONG_DELIVERY_ADDRESS = '005',
  DUPLICATE_ORDER = '006',

  // Seller/Merchant cancellation reasons (100-199)
  MERCHANT_REJECTED = '101',
  MERCHANT_UNAVAILABLE = '102',
  ITEM_OUT_OF_STOCK = '103',
  PACKAGE_NOT_READY = '104',
  PRICE_MISMATCH = '105',

  // LSP (Logistics Service Provider) cancellation reasons (200-299)
  NO_AGENT_AVAILABLE = '201',
  WEATHER_CONDITIONS = '202',
  VEHICLE_BREAKDOWN = '203',
  PICKUP_FAILED_MULTIPLE_ATTEMPTS = '204',
  DELIVERY_FAILED_MULTIPLE_ATTEMPTS = '205',
  RESTRICTED_AREA = '206',
  PACKAGE_DAMAGED_IN_TRANSIT = '207',

  // System cancellation reasons (300-399)
  QUOTE_EXPIRED = '301',
  PAYMENT_FAILED = '302',
  SYSTEM_ERROR = '303',
}

/**
 * CancellationTermsService - Manages cancellation terms for ONDC Logistics
 *
 * ONDC Requirement: on_confirm must include cancellation_terms showing:
 * - Which states allow cancellation
 * - Cancellation fees applicable
 * - Refund eligibility
 */
@Injectable()
export class CancellationTermsService {
  private readonly logger = new Logger(CancellationTermsService.name);
  private readonly cancellationFeePercentage: number;
  private readonly noRefundAfterPickupStates: string[];

  constructor(private readonly configService: ConfigService) {
    this.cancellationFeePercentage = this.configService.get<number>(
      'CANCELLATION_FEE_PERCENTAGE',
      10,
    );
    this.noRefundAfterPickupStates = [
      'Order-picked-up',
      'In-transit',
      'Out-for-delivery',
      'At-delivery',
    ];
  }

  /**
   * Get cancellation terms for order confirmation
   * Required in on_confirm response per ONDC spec
   */
  getCancellationTerms(): CancellationTerm[] {
    return [
      // Before agent assignment - Full refund, no fee
      {
        fulfillment_state: {
          descriptor: {
            code: 'Pending',
            short_desc: 'Order is pending',
          },
        },
        reason_required: false,
        cancellation_fee: {
          percentage: '0',
        },
        refund_eligible: true,
      },
      // Searching for agent - Full refund, no fee
      {
        fulfillment_state: {
          descriptor: {
            code: 'Searching-for-Agent',
            short_desc: 'Searching for delivery agent',
          },
        },
        reason_required: false,
        cancellation_fee: {
          percentage: '0',
        },
        refund_eligible: true,
      },
      // Agent assigned - Partial fee applies
      {
        fulfillment_state: {
          descriptor: {
            code: 'Agent-assigned',
            short_desc: 'Agent has been assigned',
          },
        },
        reason_required: true,
        cancellation_fee: {
          percentage: this.cancellationFeePercentage.toString(),
        },
        refund_eligible: true,
      },
      // At pickup - Fee applies
      {
        fulfillment_state: {
          descriptor: {
            code: 'At-pickup',
            short_desc: 'Agent is at pickup location',
          },
        },
        reason_required: true,
        cancellation_fee: {
          percentage: this.cancellationFeePercentage.toString(),
        },
        refund_eligible: true,
      },
      // After pickup - Higher fee, limited refund
      {
        fulfillment_state: {
          descriptor: {
            code: 'Order-picked-up',
            short_desc: 'Order has been picked up',
          },
        },
        reason_required: true,
        cancellation_fee: {
          percentage: '50',
        },
        refund_eligible: true,
      },
      // In transit - High fee, RTO charges apply
      {
        fulfillment_state: {
          descriptor: {
            code: 'In-transit',
            short_desc: 'Order is in transit',
          },
        },
        reason_required: true,
        cancellation_fee: {
          percentage: '50',
        },
        refund_eligible: true,
      },
      // Out for delivery - High fee, RTO charges apply
      {
        fulfillment_state: {
          descriptor: {
            code: 'Out-for-delivery',
            short_desc: 'Order is out for delivery',
          },
        },
        reason_required: true,
        cancellation_fee: {
          percentage: '50',
        },
        refund_eligible: true,
      },
      // At delivery - Cannot cancel
      {
        fulfillment_state: {
          descriptor: {
            code: 'At-delivery',
            short_desc: 'Agent is at delivery location',
          },
        },
        reason_required: true,
        cancellation_fee: {
          percentage: '100',
        },
        refund_eligible: false,
      },
    ];
  }

  /**
   * Get cancellation reasons list
   * Used in cancel request validation
   */
  getCancellationReasons(): CancellationReason[] {
    return [
      // Buyer reasons
      {
        id: CancellationReasonCode.BUYER_NOT_FOUND,
        descriptor: {
          code: '001',
          name: 'Buyer not found',
          short_desc: 'Recipient was not available at delivery location',
        },
        cancellation_by: 'LSP',
        applicable_states: ['Out-for-delivery', 'At-delivery'],
      },
      {
        id: CancellationReasonCode.BUYER_REFUSED,
        descriptor: {
          code: '002',
          name: 'Buyer refused delivery',
          short_desc: 'Recipient refused to accept the delivery',
        },
        cancellation_by: 'LSP',
        applicable_states: ['Out-for-delivery', 'At-delivery'],
      },
      {
        id: CancellationReasonCode.BUYER_REQUESTED,
        descriptor: {
          code: '004',
          name: 'Buyer requested cancellation',
          short_desc: 'Customer requested order cancellation',
        },
        cancellation_by: 'BUYER',
        applicable_states: [
          'Pending',
          'Searching-for-Agent',
          'Agent-assigned',
          'At-pickup',
        ],
      },
      {
        id: CancellationReasonCode.WRONG_DELIVERY_ADDRESS,
        descriptor: {
          code: '005',
          name: 'Wrong delivery address',
          short_desc: 'Delivery address is incorrect or incomplete',
        },
        cancellation_by: 'LSP',
        applicable_states: [
          'Agent-assigned',
          'At-pickup',
          'Order-picked-up',
          'In-transit',
          'Out-for-delivery',
        ],
      },

      // Merchant reasons
      {
        id: CancellationReasonCode.MERCHANT_REJECTED,
        descriptor: {
          code: '101',
          name: 'Merchant rejected order',
          short_desc: 'Merchant cannot fulfill the order',
        },
        cancellation_by: 'SELLER',
        applicable_states: ['Pending', 'Searching-for-Agent', 'Agent-assigned'],
      },
      {
        id: CancellationReasonCode.PACKAGE_NOT_READY,
        descriptor: {
          code: '104',
          name: 'Package not ready',
          short_desc: 'Package was not ready for pickup',
        },
        cancellation_by: 'LSP',
        applicable_states: ['Agent-assigned', 'At-pickup'],
      },

      // LSP reasons
      {
        id: CancellationReasonCode.NO_AGENT_AVAILABLE,
        descriptor: {
          code: '201',
          name: 'No agent available',
          short_desc: 'No delivery agent available in the area',
        },
        cancellation_by: 'LSP',
        applicable_states: ['Pending', 'Searching-for-Agent'],
      },
      {
        id: CancellationReasonCode.PICKUP_FAILED_MULTIPLE_ATTEMPTS,
        descriptor: {
          code: '204',
          name: 'Pickup failed after multiple attempts',
          short_desc: 'Multiple pickup attempts were unsuccessful',
        },
        cancellation_by: 'LSP',
        applicable_states: ['Agent-assigned', 'At-pickup'],
      },
      {
        id: CancellationReasonCode.DELIVERY_FAILED_MULTIPLE_ATTEMPTS,
        descriptor: {
          code: '205',
          name: 'Delivery failed after multiple attempts',
          short_desc: 'Multiple delivery attempts were unsuccessful',
        },
        cancellation_by: 'LSP',
        applicable_states: ['Out-for-delivery', 'At-delivery'],
      },
      {
        id: CancellationReasonCode.PACKAGE_DAMAGED_IN_TRANSIT,
        descriptor: {
          code: '207',
          name: 'Package damaged in transit',
          short_desc: 'Package was damaged during transportation',
        },
        cancellation_by: 'LSP',
        applicable_states: [
          'Order-picked-up',
          'In-transit',
          'Out-for-delivery',
        ],
      },
    ];
  }

  /**
   * Check if cancellation is allowed at current state
   */
  isCancellationAllowed(fulfillmentState: string): boolean {
    const nonCancellableStates = [
      'Order-delivered',
      'Cancelled',
      'RTO-Delivered',
      'RTO-Disposed',
    ];
    return !nonCancellableStates.includes(fulfillmentState);
  }

  /**
   * Calculate cancellation fee based on state
   */
  calculateCancellationFee(
    fulfillmentState: string,
    orderAmount: number,
  ): { fee: number; percentage: number; refundAmount: number } {
    const terms = this.getCancellationTerms();
    const applicableTerm = terms.find(
      (term) => term.fulfillment_state.descriptor.code === fulfillmentState,
    );

    if (!applicableTerm) {
      // Default: no cancellation allowed
      return {
        fee: orderAmount,
        percentage: 100,
        refundAmount: 0,
      };
    }

    const percentage = parseFloat(
      applicableTerm.cancellation_fee.percentage || '0',
    );
    const fee = (orderAmount * percentage) / 100;
    const refundAmount = applicableTerm.refund_eligible ? orderAmount - fee : 0;

    return {
      fee,
      percentage,
      refundAmount,
    };
  }

  /**
   * Validate cancellation reason for given state
   */
  validateCancellationReason(
    reasonCode: string,
    fulfillmentState: string,
    cancelledBy: 'BUYER' | 'SELLER' | 'LSP',
  ): { isValid: boolean; errorMessage?: string } {
    const reasons = this.getCancellationReasons();
    const reason = reasons.find((r) => r.id === reasonCode);

    if (!reason) {
      return {
        isValid: false,
        errorMessage: `Invalid cancellation reason code: ${reasonCode}`,
      };
    }

    if (reason.cancellation_by !== cancelledBy) {
      return {
        isValid: false,
        errorMessage: `Cancellation reason ${reasonCode} can only be used by ${reason.cancellation_by}`,
      };
    }

    if (!reason.applicable_states.includes(fulfillmentState)) {
      return {
        isValid: false,
        errorMessage: `Cancellation reason ${reasonCode} is not applicable in state ${fulfillmentState}`,
      };
    }

    return { isValid: true };
  }

  /**
   * Build cancellation terms tags for ONDC response
   */
  buildCancellationTermsTags(): Array<{
    descriptor: { code: string };
    list: Array<{
      descriptor: { code: string };
      value: string;
    }>;
  }> {
    const terms = this.getCancellationTerms();

    return terms.map((term) => ({
      descriptor: {
        code: 'cancellation_terms',
      },
      list: [
        {
          descriptor: { code: 'fulfillment_state' },
          value: term.fulfillment_state.descriptor.code,
        },
        {
          descriptor: { code: 'reason_required' },
          value: term.reason_required.toString(),
        },
        {
          descriptor: { code: 'cancellation_fee_percentage' },
          value: term.cancellation_fee.percentage || '0',
        },
        {
          descriptor: { code: 'refund_eligible' },
          value: term.refund_eligible.toString(),
        },
      ],
    }));
  }

  /**
   * Get RTO (Return to Origin) charges
   */
  getRTOCharges(orderAmount: number): {
    rtoFee: number;
    rtoFeePercentage: number;
  } {
    // RTO typically charges return shipping cost
    const rtoFeePercentage = this.configService.get<number>(
      'RTO_FEE_PERCENTAGE',
      50,
    );
    const rtoFee = (orderAmount * rtoFeePercentage) / 100;

    return {
      rtoFee,
      rtoFeePercentage,
    };
  }

  /**
   * Log cancellation event for audit
   */
  logCancellation(
    orderId: string,
    fulfillmentId: string,
    reasonCode: string,
    cancelledBy: string,
    fulfillmentState: string,
    fee: number,
  ): void {
    this.logger.log(
      `Cancellation: Order=${orderId}, Fulfillment=${fulfillmentId}, ` +
        `Reason=${reasonCode}, By=${cancelledBy}, State=${fulfillmentState}, Fee=${fee}`,
    );
  }
}
