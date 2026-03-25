/**
 * Cashfree Payout Service
 * Handles NEFT/RTGS/UPI/IMPS payouts to drivers
 * Documentation: https://docs.cashfree.com/docs/payouts-api
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';

export type PayoutMode = 'banktransfer' | 'upi' | 'imps' | 'neft' | 'rtgs';
export type PayoutStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REVERSED'
  | 'CANCELLED';

export interface PayoutBeneficiary {
  beneficiaryId: string;
  name: string;
  email?: string;
  phone: string;
  bankAccount?: string;
  ifsc?: string;
  vpa?: string; // UPI VPA
  address1?: string;
}

export interface InitiatePayoutParams {
  transferId: string;
  amount: number;
  beneficiary: PayoutBeneficiary;
  transferMode: PayoutMode;
  remarks?: string;
}

export interface PayoutResponse {
  success: boolean;
  referenceId?: string;
  utr?: string; // Unique Transaction Reference
  status: PayoutStatus;
  message?: string;
  processedAt?: Date;
}

export interface PayoutStatusResponse {
  transferId: string;
  referenceId?: string;
  utr?: string;
  status: PayoutStatus;
  statusDescription?: string;
  amount: number;
  processedAt?: Date;
  failureReason?: string;
}

export interface PayoutWebhookPayload {
  event: string;
  transferId: string;
  referenceId?: string;
  utr?: string;
  status: PayoutStatus;
  amount: number;
  timestamp: Date;
  failureReason?: string;
  rawPayload: Record<string, unknown>;
}

@Injectable()
export class CashfreePayoutService {
  private readonly logger = new Logger(CashfreePayoutService.name);
  private readonly httpClient: AxiosInstance;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly publicKey: string;
  private readonly webhookSecret: string;
  private readonly isProduction: boolean;
  private authToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.configService.get<string>(
      'CASHFREE_PAYOUT_CLIENT_ID',
      '',
    );
    this.clientSecret = this.configService.get<string>(
      'CASHFREE_PAYOUT_CLIENT_SECRET',
      '',
    );
    this.publicKey = this.configService.get<string>(
      'CASHFREE_PAYOUT_PUBLIC_KEY',
      '',
    );
    this.webhookSecret = this.configService.get<string>(
      'CASHFREE_PAYOUT_WEBHOOK_SECRET',
      '',
    );
    this.isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    const baseURL = this.isProduction
      ? 'https://payout-api.cashfree.com/payout/v1'
      : 'https://payout-gamma.cashfree.com/payout/v1';

    this.httpClient = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30000,
    });

    // Add request interceptor for auth token
    this.httpClient.interceptors.request.use(async (config) => {
      const token = await this.getAuthToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    if (!this.clientId || !this.clientSecret) {
      this.logger.warn(
        'Cashfree Payout credentials not configured - payouts will not work',
      );
    } else {
      this.logger.log(
        `Cashfree Payout service initialized (${this.isProduction ? 'PRODUCTION' : 'SANDBOX'})`,
      );
    }
  }

  /**
   * Get or refresh authentication token
   */
  private async getAuthToken(): Promise<string | null> {
    // Check if we have a valid token
    if (this.authToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.authToken;
    }

    if (!this.clientId || !this.clientSecret) {
      return null;
    }

    try {
      const baseURL = this.isProduction
        ? 'https://payout-api.cashfree.com/payout/v1'
        : 'https://payout-gamma.cashfree.com/payout/v1';

      const response = await axios.post(
        `${baseURL}/authorize`,
        {},
        {
          headers: {
            'X-Client-Id': this.clientId,
            'X-Client-Secret': this.clientSecret,
          },
        },
      );

      if (response.data.status === 'SUCCESS') {
        this.authToken = response.data.data.token;
        // Token expires in 5 minutes, refresh at 4 minutes
        this.tokenExpiry = new Date(Date.now() + 4 * 60 * 1000);
        this.logger.debug('Cashfree Payout auth token refreshed');
        return this.authToken;
      }

      this.logger.error('Failed to get Cashfree auth token:', response.data);
      return null;
    } catch (error: unknown) {
      this.logger.error(
        `Failed to authenticate with Cashfree: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return null;
    }
  }

  /**
   * Add beneficiary (required before first payout to a new account)
   */
  async addBeneficiary(beneficiary: PayoutBeneficiary): Promise<boolean> {
    this.logger.log(`Adding beneficiary: ${beneficiary.beneficiaryId}`);

    try {
      const payload: Record<string, unknown> = {
        beneId: beneficiary.beneficiaryId,
        name: beneficiary.name,
        email: beneficiary.email || `${beneficiary.phone}@quikboys.com`,
        phone: beneficiary.phone.replace('+91', ''),
        address1: beneficiary.address1 || 'India',
      };

      // Add bank details or UPI
      if (beneficiary.bankAccount && beneficiary.ifsc) {
        payload.bankAccount = beneficiary.bankAccount;
        payload.ifsc = beneficiary.ifsc;
      }

      if (beneficiary.vpa) {
        payload.vpa = beneficiary.vpa;
      }

      const response = await this.httpClient.post('/addBeneficiary', payload);

      if (
        response.data.status === 'SUCCESS' ||
        response.data.subCode === '200'
      ) {
        this.logger.log(
          `Beneficiary added successfully: ${beneficiary.beneficiaryId}`,
        );
        return true;
      }

      // Check if beneficiary already exists
      if (response.data.subCode === '409') {
        this.logger.debug(
          `Beneficiary already exists: ${beneficiary.beneficiaryId}`,
        );
        return true;
      }

      this.logger.error(
        `Failed to add beneficiary: ${response.data.message}`,
        response.data,
      );
      return false;
    } catch (error: unknown) {
      // Handle beneficiary already exists error
      if (
        error &&
        typeof error === 'object' &&
        'response' in error &&
        error.response &&
        typeof error.response === 'object' &&
        'data' in error.response &&
        error.response.data &&
        typeof error.response.data === 'object' &&
        'subCode' in error.response.data &&
        error.response.data.subCode === '409'
      ) {
        this.logger.debug(
          `Beneficiary already exists: ${beneficiary.beneficiaryId}`,
        );
        return true;
      }

      this.logger.error(
        `Error adding beneficiary: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  /**
   * Get beneficiary details
   */
  async getBeneficiary(
    beneficiaryId: string,
  ): Promise<PayoutBeneficiary | null> {
    try {
      const response = await this.httpClient.get('/getBeneficiary', {
        params: { beneId: beneficiaryId },
      });

      if (response.data.status === 'SUCCESS') {
        const data = response.data.data;
        return {
          beneficiaryId: data.beneId,
          name: data.name,
          email: data.email,
          phone: data.phone,
          bankAccount: data.bankAccount,
          ifsc: data.ifsc,
          vpa: data.vpa,
        };
      }

      return null;
    } catch (error: unknown) {
      this.logger.error(
        `Error fetching beneficiary: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return null;
    }
  }

  /**
   * Initiate payout to beneficiary
   * Supports IMPS, NEFT, RTGS, and UPI transfers
   */
  async initiatePayout(params: InitiatePayoutParams): Promise<PayoutResponse> {
    this.logger.log(
      `Initiating ${params.transferMode.toUpperCase()} payout: ${params.transferId}, Amount: ₹${params.amount}`,
    );

    try {
      // Ensure beneficiary exists
      const beneficiaryExists = await this.addBeneficiary(params.beneficiary);
      if (!beneficiaryExists) {
        return {
          success: false,
          status: 'FAILED',
          message: 'Failed to add/verify beneficiary',
        };
      }

      const payload = {
        beneId: params.beneficiary.beneficiaryId,
        amount: params.amount.toFixed(2),
        transferId: params.transferId,
        transferMode: this.mapTransferMode(params.transferMode),
        remarks: params.remarks || `Payout for ${params.transferId}`,
      };

      const response = await this.httpClient.post('/requestTransfer', payload);

      if (response.data.status === 'SUCCESS') {
        this.logger.log(
          `Payout initiated successfully: ${params.transferId}, Ref: ${response.data.data?.referenceId}`,
        );

        return {
          success: true,
          referenceId: response.data.data?.referenceId,
          utr: response.data.data?.utr,
          status: 'PENDING',
          message: response.data.message,
        };
      }

      this.logger.error(
        `Payout initiation failed: ${response.data.message}`,
        response.data,
      );

      return {
        success: false,
        status: 'FAILED',
        message: response.data.message || 'Payout initiation failed',
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error initiating payout: ${errorMessage}`);

      return {
        success: false,
        status: 'FAILED',
        message: errorMessage,
      };
    }
  }

  /**
   * Initiate batch payout (multiple transfers)
   */
  async initiateBatchPayout(
    batchTransferId: string,
    payouts: InitiatePayoutParams[],
  ): Promise<{
    success: boolean;
    batchId?: string;
    results: PayoutResponse[];
  }> {
    this.logger.log(
      `Initiating batch payout: ${batchTransferId}, Count: ${payouts.length}`,
    );

    const results: PayoutResponse[] = [];

    // Add all beneficiaries first
    for (const payout of payouts) {
      await this.addBeneficiary(payout.beneficiary);
    }

    // Process payouts
    for (const payout of payouts) {
      const result = await this.initiatePayout(payout);
      results.push(result);

      // Small delay between requests to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const successCount = results.filter((r) => r.success).length;

    return {
      success: successCount > 0,
      batchId: batchTransferId,
      results,
    };
  }

  /**
   * Get payout status
   */
  async getPayoutStatus(
    transferId: string,
    referenceId?: string,
  ): Promise<PayoutStatusResponse> {
    this.logger.debug(`Checking payout status: ${transferId}`);

    try {
      const params: Record<string, string> = { transferId };
      if (referenceId) {
        params.referenceId = referenceId;
      }

      const response = await this.httpClient.get('/getTransferStatus', {
        params,
      });

      if (response.data.status === 'SUCCESS') {
        const data = response.data.data;

        return {
          transferId: data.transfer?.transferId || transferId,
          referenceId: data.transfer?.referenceId,
          utr: data.transfer?.utr,
          status: this.mapCashfreeStatus(data.transfer?.status),
          statusDescription: data.transfer?.reason,
          amount: parseFloat(data.transfer?.amount || '0'),
          processedAt: data.transfer?.processedOn
            ? new Date(data.transfer.processedOn)
            : undefined,
          failureReason: data.transfer?.reason,
        };
      }

      return {
        transferId,
        status: 'PENDING',
        statusDescription: 'Status check failed',
        amount: 0,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error checking payout status: ${errorMessage}`);

      return {
        transferId,
        status: 'PENDING',
        statusDescription: errorMessage,
        amount: 0,
      };
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.publicKey) {
      this.logger.warn(
        'Payout webhook public key not configured - skipping verification',
      );
      return true;
    }

    try {
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(payload);
      return verifier.verify(this.publicKey, signature, 'base64');
    } catch (error) {
      this.logger.error('Webhook signature verification failed', error);
      return false;
    }
  }

  /**
   * Parse webhook payload
   */
  parseWebhookPayload(payload: Record<string, unknown>): PayoutWebhookPayload {
    const data =
      (payload.transfer as Record<string, unknown>) ||
      (payload as Record<string, unknown>);
    const event = (payload.event as string) || 'TRANSFER_STATUS_UPDATE';

    return {
      event,
      transferId:
        (data.transferId as string) || (data.transfer_id as string) || '',
      referenceId:
        (data.referenceId as string) || (data.reference_id as string),
      utr: data.utr as string,
      status: this.mapCashfreeStatus(
        (data.status as string) || (data.transferStatus as string),
      ),
      amount: parseFloat((data.amount as string) || '0'),
      timestamp: new Date(
        (data.eventTime as string) || (data.timestamp as string) || Date.now(),
      ),
      failureReason: (data.reason as string) || (data.failure_reason as string),
      rawPayload: payload,
    };
  }

  /**
   * Check service availability
   */
  async checkBalance(): Promise<{
    available: number;
    currency: string;
  } | null> {
    try {
      const response = await this.httpClient.get('/getBalance');

      if (response.data.status === 'SUCCESS') {
        return {
          available: parseFloat(response.data.data.availableBalance || '0'),
          currency: 'INR',
        };
      }

      return null;
    } catch (error: unknown) {
      this.logger.error(
        `Error checking balance: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return null;
    }
  }

  /**
   * Map transfer mode to Cashfree format
   */
  private mapTransferMode(mode: PayoutMode): string {
    const modeMap: Record<PayoutMode, string> = {
      banktransfer: 'banktransfer',
      imps: 'imps',
      neft: 'neft',
      rtgs: 'rtgs',
      upi: 'upi',
    };

    return modeMap[mode] || 'banktransfer';
  }

  /**
   * Map Cashfree status to internal status
   */
  private mapCashfreeStatus(status: string): PayoutStatus {
    const statusMap: Record<string, PayoutStatus> = {
      SUCCESS: 'SUCCESS',
      PENDING: 'PENDING',
      PROCESSING: 'PROCESSING',
      FAILED: 'FAILED',
      REVERSED: 'REVERSED',
      CANCELLED: 'CANCELLED',
      ERROR: 'FAILED',
      REJECTED: 'FAILED',
    };

    return statusMap[status?.toUpperCase()] || 'PENDING';
  }
}
