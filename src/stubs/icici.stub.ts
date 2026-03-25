import { Injectable, Logger } from '@nestjs/common';
import {
  IIciciCompositePayService,
  IIciciCibService,
  IIciciPayoutOrchestratorService,
  IIciciConfigService,
} from '../contracts/icici.contract.js';

/**
 * Stub ICICI services for standalone ONDC development.
 * Replace with real ICICI module integration in production.
 */

@Injectable()
export class IciciCompositePayStub implements IIciciCompositePayService {
  private readonly logger = new Logger('IciciCompositePayStub');

  async initiatePayment(params: {
    amount: number;
    referenceId: string;
  }) {
    this.logger.warn(
      `[STUB] initiatePayment called: ${params.amount} INR, ref=${params.referenceId}`,
    );
    return { status: 'STUB_SUCCESS', transactionId: `STUB-${Date.now()}` };
  }

  async initiateTransfer(params: {
    uniqueId: string;
    creditAccount: string;
    ifsc: string;
    amount: number;
    payeeName: string;
    transferMode: string;
    remarks?: string;
  }) {
    this.logger.warn(
      `[STUB] initiateTransfer called: ${params.amount} INR, id=${params.uniqueId}`,
    );
    return { RESPONSE: 'SUCCESS', STATUS: 'SUCCESS', UTRNUMBER: `STUB_UTR_${Date.now()}`, MESSAGE: 'Transfer success (stub)' };
  }
}

@Injectable()
export class IciciCibStub implements IIciciCibService {
  private readonly logger = new Logger('IciciCibStub');

  async getAccountBalance() {
    this.logger.warn('[STUB] getAccountBalance called');
    return {
      balance: 100000,
      currency: 'INR',
      accountNumber: 'STUB-000405002777',
    };
  }

  async getTransactionHistory(_params: {
    fromDate: string;
    toDate: string;
  }) {
    this.logger.warn('[STUB] getTransactionHistory called');
    return [];
  }

  async inquireTransaction(transferId: string) {
    this.logger.warn(`[STUB] inquireTransaction called for ${transferId}`);
    return { STATUS: 'SUCCESS', RESPONSE: 'SUCCESS', UTRNUMBER: `STUB_UTR_${Date.now()}`, MESSAGE: 'Success (stub)' };
  }
}

@Injectable()
export class IciciPayoutOrchestratorStub
  implements IIciciPayoutOrchestratorService
{
  private readonly logger = new Logger('IciciPayoutOrchestratorStub');

  async processPayout(params: { amount: number; referenceId: string }) {
    this.logger.warn(
      `[STUB] processPayout called: ${params.amount} INR, ref=${params.referenceId}`,
    );
    return { status: 'STUB_SUCCESS', payoutId: `PAYOUT-STUB-${Date.now()}` };
  }
}

@Injectable()
export class IciciConfigStub implements IIciciConfigService {
  getConfig() {
    return {
      debitAccount: 'STUB-000405002777',
      urn: 'STUB-URN',
      environment: 'sandbox',
    };
  }

  isConfigured(): boolean {
    return true;
  }
}

// Aliases matching the monolith class names so ONDC imports resolve without changes
export {
  IciciCompositePayStub as IciciCompositePayService,
  IciciCibStub as IciciCibService,
  IciciPayoutOrchestratorStub as IciciPayoutOrchestratorService,
  IciciConfigStub as IciciConfigService,
};
