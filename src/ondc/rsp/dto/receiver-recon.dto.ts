import { BecknContext } from '../../interfaces/beckn-context.interface';

/**
 * ReceiverReconRequest - Main request structure for receiver_recon endpoint
 * Receives reconciliation data from ONDC network for daily settlements
 */
export interface ReceiverReconRequest {
  context: BecknContext;
  message: ReceiverReconMessage;
}

/**
 * ReceiverReconMessage - Reconciliation message payload
 */
export interface ReceiverReconMessage {
  recon: ReconciliationData;
}

/**
 * ReconciliationData - Core reconciliation data structure
 */
export interface ReconciliationData {
  recon_id: string; // Unique reconciliation ID
  period: {
    start_time: string; // ISO 8601 timestamp
    end_time: string; // ISO 8601 timestamp
  };
  counter_party: {
    subscriber_id: string; // BAP ID
    subscriber_uri: string; // BAP URI
  };
  orders: ReconOrderItem[]; // List of orders to reconcile
  summary: ReconciliationSummary; // Summary totals from counter-party
}

/**
 * ReconOrderItem - Individual order for reconciliation
 */
export interface ReconOrderItem {
  order_id: string; // ONDC Order ID
  transaction_id: string; // ONDC Transaction ID
  state: string; // Order state (Created, Accepted, Completed, Cancelled)
  // Financial details
  order_value: string; // Base order value
  delivery_charges: string; // Delivery fee
  platform_fee: string; // Platform commission
  tax: string; // Tax amount
  total_amount: string; // Total order amount
  // Payment details
  payment_type: 'PREPAID' | 'COD';
  cod_collected?: string; // COD amount collected (if applicable)
  settlement_amount: string; // Net amount to settle
  // Timestamps
  created_at: string; // ISO 8601
  updated_at?: string; // ISO 8601
  completed_at?: string; // ISO 8601
  cancelled_at?: string; // ISO 8601
}

/**
 * ReconciliationSummary - Summary totals from counter-party
 */
export interface ReconciliationSummary {
  total_orders: number;
  total_order_value: string;
  total_delivery_charges: string;
  total_platform_fees?: string;
  total_cod_collected?: string;
  net_settlement_amount: string;
  currency?: string; // Default: INR
}

/**
 * OnReceiverReconMessage - Response message for on_receiver_recon callback
 */
export interface OnReceiverReconMessage {
  acknowledgement: ReconciliationAcknowledgement;
  discrepancies?: DiscrepancyDetail[];
}

/**
 * ReconciliationAcknowledgement - Acknowledgement of reconciliation processing
 */
export interface ReconciliationAcknowledgement {
  recon_id: string; // Same as received recon_id
  status: 'ACCEPTED' | 'PARTIAL' | 'REJECTED';
  received_count: number; // Number of orders received
  matched_count: number; // Number of orders successfully matched
  discrepancy_count: number; // Number of discrepancies found
  settled_amount: string; // Amount settled (matched transactions)
  held_amount: string; // Amount held (discrepant transactions)
  timestamp: string; // ISO 8601
}

/**
 * DiscrepancyDetail - Details of a discrepancy found during reconciliation
 */
export interface DiscrepancyDetail {
  transaction_id?: string;
  order_id?: string;
  type:
    | 'AMOUNT_MISMATCH'
    | 'MISSING_TRANSACTION'
    | 'DUPLICATE_TRANSACTION'
    | 'TAX_MISMATCH'
    | 'STATUS_MISMATCH'
    | 'COD_AMOUNT_MISMATCH';
  ondc_amount?: string;
  internal_amount?: string;
  difference?: string;
  reason: string;
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * ReconciliationResult - Internal result structure after processing
 */
export interface ReconciliationResult {
  reconId: string;
  periodStart: Date;
  periodEnd: Date;
  networkParticipantId: string;
  receivedCount: number;
  matchedCount: number;
  discrepancyCount: number;
  reconciledAmount: number;
  discrepancyAmount: number;
  matchedOrders: MatchedOrder[];
  discrepancies: DiscrepancyDetail[];
  status: 'ACCEPTED' | 'PARTIAL' | 'REJECTED';
}

/**
 * MatchedOrder - Internal structure for matched orders
 */
export interface MatchedOrder {
  ondcOrderId: string;
  internalOrderId: string;
  ondcAmount: number;
  internalAmount: number;
  matchStatus: 'MATCHED' | 'PARTIAL_MATCH' | 'AMOUNT_MISMATCH';
}

/**
 * SettlementReportDto - Settlement batch report
 */
export interface SettlementReportDto {
  batchId: string;
  networkParticipantId: string;
  period: {
    start: string;
    end: string;
  };
  summary: {
    totalTransactions: number;
    totalAmount: number;
    reconciledAmount: number;
    discrepancyAmount: number;
  };
  settlementDetails?: {
    method: string;
    type: string;
    beneficiaryName?: string;
    accountNumber?: string;
    ifscCode?: string;
    upiAddress?: string;
  };
  transactions: SettlementTransactionDto[];
  discrepancies: SettlementDiscrepancyDto[];
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';
}

/**
 * SettlementTransactionDto - Individual transaction in settlement batch
 */
export interface SettlementTransactionDto {
  ondcOrderId: string;
  internalOrderId?: string;
  ondcAmount: number;
  internalAmount?: number;
  matchStatus: string;
  reconciledAt?: string;
}

/**
 * SettlementDiscrepancyDto - Discrepancy in settlement batch
 */
export interface SettlementDiscrepancyDto {
  orderId: string;
  type: string;
  ondcAmount: number;
  internalAmount: number;
  difference: number;
  reason: string;
}
