/**
 * ICICI Service Contracts
 *
 * These are the interfaces the ONDC RSP module depends on from the monolith's
 * IciciModule. Used for NBBL payouts and corporate banking operations.
 */

export interface IIciciCompositePayService {
  initiatePayment(params: {
    amount: number;
    beneficiaryAccount: string;
    beneficiaryIfsc: string;
    beneficiaryName: string;
    remarks: string;
    referenceId: string;
  }): Promise<{ status: string; transactionId?: string; error?: string }>;
  initiateTransfer(params: {
    uniqueId: string;
    creditAccount: string;
    ifsc: string;
    amount: number;
    payeeName: string;
    transferMode: string;
    remarks?: string;
  }): Promise<{ RESPONSE?: string; STATUS?: string; UTRNUMBER?: string; MESSAGE?: string }>;
}

export interface IIciciCibService {
  getAccountBalance(): Promise<{
    balance: number;
    currency: string;
    accountNumber: string;
  }>;
  getTransactionHistory(params: {
    fromDate: string;
    toDate: string;
  }): Promise<unknown[]>;
  inquireTransaction(transferId: string): Promise<{ STATUS?: string; RESPONSE?: string; UTRNUMBER?: string; MESSAGE?: string }>;
}

export interface IIciciPayoutOrchestratorService {
  processPayout(params: {
    amount: number;
    beneficiaryId: string;
    purpose: string;
    referenceId: string;
  }): Promise<{ status: string; payoutId?: string; error?: string }>;
}

export interface IIciciConfigService {
  getConfig(): {
    debitAccount: string;
    urn: string;
    environment: string;
  };
  isConfigured(): boolean;
}

export const ICICI_COMPOSITE_PAY_SERVICE = 'ICICI_COMPOSITE_PAY_SERVICE';
export const ICICI_CIB_SERVICE = 'ICICI_CIB_SERVICE';
export const ICICI_PAYOUT_ORCHESTRATOR_SERVICE =
  'ICICI_PAYOUT_ORCHESTRATOR_SERVICE';
export const ICICI_CONFIG_SERVICE = 'ICICI_CONFIG_SERVICE';
