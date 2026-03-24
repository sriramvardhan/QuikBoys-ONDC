import { BecknError } from '../../interfaces/beckn-message.interface';
import { OndcErrorType } from '../../constants/error-codes';

/**
 * RSP (Reconciliation, Settlement & Payouts) Error Codes
 * Range: 80000-82999
 */
export enum RspErrorCode {
  // Reconciliation Errors (80xxx)
  INVALID_RECONCILIATION_ID = '80001',
  INVALID_RECONCILIATION_PERIOD = '80002',
  INVALID_TRANSACTION_DATA = '80003',
  RECONCILIATION_ALREADY_PROCESSED = '80004',
  RECONCILIATION_PERIOD_OVERLAP = '80005',
  INVALID_REQUEST_FORMAT = '80006',
  MISSING_RECONCILIATION_DATA = '80007',

  // Matching Errors (81xxx)
  TRANSACTION_NOT_FOUND = '81001',
  AMOUNT_MISMATCH = '81002',
  DUPLICATE_TRANSACTION = '81003',
  MISSING_INTERNAL_DATA = '81004',
  ORDER_NOT_FOUND = '81005',
  STATUS_MISMATCH = '81006',

  // Settlement Errors (82xxx)
  SETTLEMENT_BATCH_NOT_FOUND = '82001',
  SETTLEMENT_ALREADY_PROCESSED = '82002',
  INVALID_SETTLEMENT_DETAILS = '82003',
  SETTLEMENT_AMOUNT_ZERO = '82004',
  INSUFFICIENT_RECONCILED_TRANSACTIONS = '82005',
  SETTLEMENT_PROCESSING_FAILED = '82006',

  // General Errors
  RECONCILIATION_FAILED = '80999',
  INTERNAL_ERROR = '10004', // Reuse ONDC standard error code
}

/**
 * Error messages for RSP error codes
 */
export const RSP_ERROR_MESSAGES: Record<RspErrorCode, string> = {
  // Reconciliation Errors
  [RspErrorCode.INVALID_RECONCILIATION_ID]:
    'Invalid or missing reconciliation ID',
  [RspErrorCode.INVALID_RECONCILIATION_PERIOD]: 'Invalid reconciliation period',
  [RspErrorCode.INVALID_TRANSACTION_DATA]:
    'Invalid transaction data in reconciliation request',
  [RspErrorCode.RECONCILIATION_ALREADY_PROCESSED]:
    'Reconciliation for this period has already been processed',
  [RspErrorCode.RECONCILIATION_PERIOD_OVERLAP]:
    'Reconciliation period overlaps with existing reconciliation',
  [RspErrorCode.INVALID_REQUEST_FORMAT]:
    'Invalid reconciliation request format',
  [RspErrorCode.MISSING_RECONCILIATION_DATA]:
    'Missing required reconciliation data',

  // Matching Errors
  [RspErrorCode.TRANSACTION_NOT_FOUND]:
    'Transaction not found in internal records',
  [RspErrorCode.AMOUNT_MISMATCH]:
    'Amount mismatch between ONDC and internal records',
  [RspErrorCode.DUPLICATE_TRANSACTION]: 'Duplicate transaction detected',
  [RspErrorCode.MISSING_INTERNAL_DATA]: 'Missing internal transaction data',
  [RspErrorCode.ORDER_NOT_FOUND]: 'Order not found in internal records',
  [RspErrorCode.STATUS_MISMATCH]:
    'Order status mismatch between ONDC and internal records',

  // Settlement Errors
  [RspErrorCode.SETTLEMENT_BATCH_NOT_FOUND]: 'Settlement batch not found',
  [RspErrorCode.SETTLEMENT_ALREADY_PROCESSED]:
    'Settlement batch has already been processed',
  [RspErrorCode.INVALID_SETTLEMENT_DETAILS]: 'Invalid settlement details',
  [RspErrorCode.SETTLEMENT_AMOUNT_ZERO]:
    'Settlement amount is zero - no transactions to settle',
  [RspErrorCode.INSUFFICIENT_RECONCILED_TRANSACTIONS]:
    'Insufficient reconciled transactions for settlement',
  [RspErrorCode.SETTLEMENT_PROCESSING_FAILED]: 'Settlement processing failed',

  // General Errors
  [RspErrorCode.RECONCILIATION_FAILED]: 'Reconciliation processing failed',
  [RspErrorCode.INTERNAL_ERROR]: 'Internal server error',
};

/**
 * Build RSP error response
 */
export function buildRspError(
  code: RspErrorCode,
  customMessage?: string,
  type: OndcErrorType = OndcErrorType.DOMAIN_ERROR,
): BecknError {
  return {
    type,
    code,
    message: customMessage || RSP_ERROR_MESSAGES[code] || 'Unknown RSP error',
  };
}

/**
 * Check if error code is an RSP error
 */
export function isRspError(code: string): boolean {
  return (
    code.startsWith('80') || code.startsWith('81') || code.startsWith('82')
  );
}
