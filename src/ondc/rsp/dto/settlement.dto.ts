// ============================================
// Settlement DTOs
// File: src/ondc/rsp/dto/settlement.dto.ts
// ONDC RSF 2.0 Settlement API types
// ============================================

import { BecknContext } from '../../interfaces/beckn-context.interface';

/**
 * Settlement request from ONDC network
 */
export interface SettlementRequest {
  context: BecknContext;
  message: {
    settlement: SettlementDetails;
  };
}

/**
 * Settlement details from ONDC
 */
export interface SettlementDetails {
  settlement_id: string;
  settlement_reference_no: string;
  settlement_status: 'PAID' | 'PENDING' | 'FAILED' | 'IN_PROGRESS';
  settlement_timestamp: string;
  settlement_type:
    | 'NEFT'
    | 'RTGS'
    | 'IMPS'
    | 'UPI'
    | 'ON-ORDER'
    | 'POST-FULFILLMENT';
  settlement_bank_account_no?: string;
  settlement_ifsc_code?: string;
  utr_number?: string;
  reason_code?: string;
  message?: string;
  orders: SettlementOrderItem[];
}

/**
 * Order item in settlement
 */
export interface SettlementOrderItem {
  order_id: string;
  transaction_id: string;
  collector_app_id: string;
  receiver_app_id: string;
  settlement_amount: string;
  settlement_status: 'PAID' | 'PENDING' | 'FAILED';
  settlement_reference?: string;
  settlement_timestamp?: string;
  currency: string;
}

/**
 * on_settlement callback message
 */
export interface OnSettlementMessage {
  settlement_id: string;
  status: 'RECEIVED' | 'ACCEPTED' | 'REJECTED' | 'PARTIAL';
  acknowledgement: {
    received_count: number;
    accepted_count: number;
    rejected_count: number;
    total_amount: string;
    timestamp: string;
  };
  rejections?: SettlementRejection[];
}

/**
 * Settlement rejection details
 */
export interface SettlementRejection {
  order_id: string;
  reason_code: string;
  reason_message: string;
}

/**
 * Settlement status update request (internal)
 */
export interface UpdateSettlementStatusDto {
  settlementId: string;
  status: 'ACCEPTED' | 'REJECTED' | 'PARTIAL';
  rejectionReason?: string;
  rejectedOrderIds?: string[];
}
