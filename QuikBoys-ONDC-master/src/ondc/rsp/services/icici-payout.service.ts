/**
 * ICICI Bank Payout Service (Legacy Adapter)
 *
 * This is a thin adapter that delegates to the new IciciPayoutOrchestratorService
 * in src/icici/. It preserves the existing interface contract for any ONDC code
 * that references ICICIPayoutService.
 *
 * New code should import directly from src/icici/ instead.
 *
 * @deprecated Use IciciPayoutOrchestratorService from src/icici/ directly
 */

import { Injectable, Logger } from '@nestjs/common';
import { IciciPayoutOrchestratorService } from '../../../stubs/icici.stub.js';
import { IciciCompositePayService } from '../../../stubs/icici.stub.js';
import { IciciCibService } from '../../../stubs/icici.stub.js';
import { IciciConfigService } from '../../../stubs/icici.stub.js';

export type ICICIPayoutStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'PENDING'
  | 'PROCESSING'
  | 'REJECTED'
  | 'REVERSED';

export interface ICICIPayoutParams {
  transferId: string;
  amount: number;
  beneficiaryName: string;
  beneficiaryAccount: string;
  beneficiaryIfsc: string;
  beneficiaryEmail?: string;
  beneficiaryPhone?: string;
  transferMode: 'NEFT' | 'RTGS' | 'IMPS' | 'UPI';
  remarks?: string;
  upiVpa?: string;
}

export interface ICICIPayoutResponse {
  success: boolean;
  transferId: string;
  status: ICICIPayoutStatus;
  utr?: string;
  bankRefNo?: string;
  message?: string;
  errorCode?: string;
}

@Injectable()
export class ICICIPayoutService {
  private readonly logger = new Logger(ICICIPayoutService.name);

  constructor(
    private readonly orchestrator: IciciPayoutOrchestratorService,
    private readonly compositePayService: IciciCompositePayService,
    private readonly cibService: IciciCibService,
    private readonly iciciConfig: IciciConfigService,
  ) {
    this.logger.log(
      'ICICIPayoutService (legacy adapter) initialized -- delegates to IciciModule',
    );
  }

  isConfigured(): boolean {
    return this.iciciConfig.isConfigured();
  }

  /**
   * @deprecated Use IciciPayoutOrchestratorService.processWithdrawal() instead
   */
  async initiatePayout(params: ICICIPayoutParams): Promise<ICICIPayoutResponse> {
    try {
      const result = await this.compositePayService.initiateTransfer({
        uniqueId: params.transferId,
        creditAccount: params.beneficiaryAccount,
        ifsc: params.beneficiaryIfsc,
        amount: params.amount,
        payeeName: params.beneficiaryName,
        transferMode: params.transferMode,
        remarks: params.remarks,
      });

      return {
        success: result.RESPONSE === 'SUCCESS',
        transferId: params.transferId,
        status: this.mapStatus(result.RESPONSE || result.STATUS || ''),
        utr: result.UTRNUMBER,
        message: result.MESSAGE,
      };
    } catch (error) {
      return {
        success: false,
        transferId: params.transferId,
        status: 'FAILED',
        message: error.message,
      };
    }
  }

  async getPayoutStatus(transferId: string): Promise<{
    transferId: string;
    status: ICICIPayoutStatus;
    utr?: string;
    message?: string;
  }> {
    try {
      const result = await this.cibService.inquireTransaction(transferId);
      return {
        transferId,
        status: this.mapStatus(result.STATUS || result.RESPONSE || ''),
        utr: result.UTRNUMBER,
        message: result.MESSAGE,
      };
    } catch (error) {
      return {
        transferId,
        status: 'FAILED',
        message: error.message,
      };
    }
  }

  /**
   * @deprecated Use IciciWebhookController instead
   */
  verifyWebhookSignature(_payload: string, _signature: string): boolean {
    this.logger.warn(
      'verifyWebhookSignature called on legacy adapter -- use IciciWebhookController instead',
    );
    return true;
  }

  private mapStatus(status: string): ICICIPayoutStatus {
    const upper = status?.toUpperCase() || '';
    if (['SUCCESS', 'SUCCESSFUL', 'S', '00'].includes(upper)) return 'SUCCESS';
    if (['FAILURE', 'FAILED', 'F', '02'].includes(upper)) return 'FAILED';
    if (['REJECTED', 'R', '03'].includes(upper)) return 'REJECTED';
    if (['REVERSED'].includes(upper)) return 'REVERSED';
    if (['PROCESSING', 'IN_PROGRESS'].includes(upper)) return 'PROCESSING';
    return 'PENDING';
  }
}
