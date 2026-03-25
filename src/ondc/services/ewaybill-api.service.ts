// ============================================
// E-Waybill API Integration Service
// File: src/ondc/services/ewaybill-api.service.ts
// ONDC Logistics - Full GST E-Waybill Portal API Integration
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

/**
 * E-Waybill API authentication response
 */
interface EWaybillAuthResponse {
  status: number;
  authToken: string;
  sek: string; // Session Encryption Key
  tokenExpiry: number;
}

/**
 * E-Waybill API generation request (GST Format)
 */
export interface EWaybillAPIRequest {
  supplyType: 'O' | 'I'; // Outward or Inward
  subSupplyType: number; // 1-12 based on GST rules
  subSupplyDesc?: string;
  docType: 'INV' | 'BIL' | 'BOE' | 'CHL' | 'OTH';
  docNo: string;
  docDate: string; // DD/MM/YYYY
  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromAddr2?: string;
  fromPlace: string;
  fromPincode: number;
  fromStateCode: number;
  toGstin: string;
  toTrdName: string;
  toAddr1: string;
  toAddr2?: string;
  toPlace: string;
  toPincode: number;
  toStateCode: number;
  transMode: number; // 1-Road, 2-Rail, 3-Air, 4-Ship
  transDistance: number;
  transporterName?: string;
  transporterId?: string;
  transDocNo?: string;
  transDocDate?: string;
  vehicleNo?: string;
  vehicleType: 'R' | 'O'; // Regular or Over Dimensional Cargo
  itemList: Array<{
    productName: string;
    productDesc: string;
    hsnCode: number;
    quantity: number;
    qtyUnit: string;
    cgstRate: number;
    sgstRate: number;
    igstRate: number;
    cessRate: number;
    cessAdvol: number;
    taxableAmount: number;
  }>;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  totInvValue: number;
}

/**
 * E-Waybill API response
 */
export interface EWaybillAPIResponse {
  ewayBillNo: number;
  ewayBillDate: string;
  validUpto: string;
  alert?: string;
  error?: {
    errorCodes: string;
    message: string;
  };
}

/**
 * Part-B update request
 */
export interface PartBUpdateRequest {
  ewbNo: number;
  vehicleNo: string;
  fromPlace: string;
  fromState: number;
  reasonCode: string;
  reasonRem?: string;
  transDocNo?: string;
  transDocDate?: string;
  transMode: string;
  vehicleType: 'R' | 'O';
}

/**
 * E-Waybill cancel request
 */
export interface EWaybillCancelRequest {
  ewbNo: number;
  cancelRsnCode: number; // 1-4 based on GST rules
  cancelRmrk: string;
}

/**
 * E-Waybill extend request
 */
export interface EWaybillExtendRequest {
  ewbNo: number;
  vehicleNo: string;
  fromPlace: string;
  fromState: number;
  remainingDistance: number;
  transDocNo?: string;
  transDocDate?: string;
  transMode: string;
  extnRsnCode: number; // Extension reason code
  extnRemarks: string;
  consignmentStatus: 'M' | 'T'; // In Movement or In Transit
  transitType?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
}

/**
 * E-Waybill details response from API
 */
export interface EWaybillDetailsResponse {
  ewayBillNo: number;
  ewbDate: string;
  genMode: string;
  userGstin: string;
  supplyType: string;
  subSupplyType: number;
  docType: string;
  docNo: string;
  docDate: string;
  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromAddr2: string;
  fromPlace: string;
  fromPincode: number;
  fromStateCode: number;
  toGstin: string;
  toTrdName: string;
  toAddr1: string;
  toAddr2: string;
  toPlace: string;
  toPincode: number;
  toStateCode: number;
  totalValue: number;
  totInvValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  transMode: string;
  transDistance: number;
  transporterName: string;
  transporterId: string;
  vehicleNo: string;
  vehicleType: string;
  status: string;
  validUpto: string;
  extendedTimes: number;
  rejectStatus: string;
  vehicleListDetails: Array<{
    vehicleNo: string;
    fromPlace: string;
    fromState: number;
    transDocNo: string;
    transDocDate: string;
    transMode: string;
    vehicleType: string;
    entryDate: string;
  }>;
  itemList: Array<{
    itemNo: number;
    productName: string;
    productDesc: string;
    hsnCode: number;
    quantity: number;
    qtyUnit: string;
    taxableAmount: number;
    cgstRate: number;
    sgstRate: number;
    igstRate: number;
    cessRate: number;
  }>;
}

/**
 * Consolidated E-Waybill request
 */
export interface ConsolidatedEWaybillRequest {
  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromAddr2?: string;
  fromPlace: string;
  fromPincode: number;
  fromStateCode: number;
  vehicleNo: string;
  transMode: string;
  transDocNo?: string;
  transDocDate?: string;
  tripSheetEwbBills: Array<{
    ewbNo: number;
  }>;
}

/**
 * EWaybillAPIService - Full integration with GST E-Waybill Portal
 *
 * GST E-Waybill Portal: https://ewaybillgst.gov.in
 * API Documentation: https://docs.ewaybillgst.gov.in
 *
 * Authentication Flow:
 * 1. Encrypt credentials using public key from GST portal
 * 2. Get auth token and SEK (Session Encryption Key)
 * 3. Use auth token for all subsequent requests
 * 4. Encrypt request payload using SEK
 */
@Injectable()
export class EWaybillAPIService {
  private readonly logger = new Logger(EWaybillAPIService.name);
  private readonly apiBaseUrl: string;
  private readonly gstinNo: string;
  private readonly username: string;
  private readonly password: string;
  private readonly appKey: string;

  // Authentication state
  private authToken: string | null = null;
  private sek: string | null = null;
  private tokenExpiry: Date | null = null;

  // Sub-supply type codes per GST rules
  private readonly subSupplyTypes: Record<string, number> = {
    SUPPLY: 1,
    IMPORT: 2,
    EXPORT: 3,
    JOB_WORK: 4,
    JOB_WORK_RETURNS: 5,
    SALE_RETURN: 6,
    SKD_CKD: 7,
    LINE_SALES: 8,
    RECIPIENT_NOT_KNOWN: 9,
    FOR_OWN_USE: 10,
    EXHIBITION_FAIR: 11,
    OTHERS: 12,
  };

  // Cancel reason codes
  private readonly cancelReasonCodes: Record<string, number> = {
    DUPLICATE: 1,
    ORDER_CANCELLED: 2,
    DATA_ENTRY_MISTAKE: 3,
    OTHERS: 4,
  };

  // State codes for E-Waybill
  private readonly stateCodes: Record<string, number> = {
    'JAMMU AND KASHMIR': 1,
    'HIMACHAL PRADESH': 2,
    PUNJAB: 3,
    CHANDIGARH: 4,
    UTTARAKHAND: 5,
    HARYANA: 6,
    DELHI: 7,
    RAJASTHAN: 8,
    'UTTAR PRADESH': 9,
    BIHAR: 10,
    SIKKIM: 11,
    'ARUNACHAL PRADESH': 12,
    NAGALAND: 13,
    MANIPUR: 14,
    MIZORAM: 15,
    TRIPURA: 16,
    MEGHALAYA: 17,
    ASSAM: 18,
    'WEST BENGAL': 19,
    JHARKHAND: 20,
    ODISHA: 21,
    CHHATTISGARH: 22,
    'MADHYA PRADESH': 23,
    GUJARAT: 24,
    'DAMAN AND DIU': 25,
    'DADRA AND NAGAR HAVELI': 26,
    MAHARASHTRA: 27,
    KARNATAKA: 29,
    GOA: 30,
    LAKSHADWEEP: 31,
    KERALA: 32,
    'TAMIL NADU': 33,
    PUDUCHERRY: 34,
    'ANDAMAN AND NICOBAR': 35,
    TELANGANA: 36,
    'ANDHRA PRADESH': 37,
    LADAKH: 38,
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    // E-Waybill API Configuration
    // Production: https://api.gst.gov.in/ewaybill
    // Sandbox: https://gsp.adaequare.com/eiewb (NIC Sandbox)
    this.apiBaseUrl = this.configService.get<string>(
      'EWAYBILL_API_URL',
      'https://gsp.adaequare.com/eiewb', // Sandbox by default
    );
    this.gstinNo = this.configService.get<string>('EWAYBILL_GSTIN', '');
    this.username = this.configService.get<string>('EWAYBILL_USERNAME', '');
    this.password = this.configService.get<string>('EWAYBILL_PASSWORD', '');
    this.appKey = this.configService.get<string>('EWAYBILL_APP_KEY', '');
  }

  /**
   * Authenticate with E-Waybill API
   */
  async authenticate(): Promise<boolean> {
    // Check if existing token is valid
    if (this.authToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return true;
    }

    try {
      // In production, encrypt credentials using RSA public key from GST
      const encryptedPassword = this.encryptPassword(this.password);

      const response = await firstValueFrom(
        this.httpService.post<EWaybillAuthResponse>(
          `${this.apiBaseUrl}/authenticate`,
          {
            action: 'ACCESSTOKEN',
            username: this.username,
            password: encryptedPassword,
            app_key: this.appKey,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              gstin: this.gstinNo,
            },
          },
        ),
      );

      if (response.data.status === 1) {
        this.authToken = response.data.authToken;
        this.sek = this.decryptSEK(response.data.sek);
        this.tokenExpiry = new Date(Date.now() + response.data.tokenExpiry);

        this.logger.log('E-Waybill API authentication successful');
        return true;
      }

      this.logger.error('E-Waybill API authentication failed');
      return false;
    } catch (error) {
      this.logger.error('E-Waybill API authentication error', error);

      // For development/testing, allow mock mode
      if (this.configService.get<string>('EWAYBILL_MODE') === 'MOCK') {
        this.authToken = 'mock_token';
        this.sek = 'mock_sek';
        this.tokenExpiry = new Date(Date.now() + 6 * 60 * 60 * 1000);
        return true;
      }

      return false;
    }
  }

  /**
   * Generate E-Waybill via API
   */
  async generateEWaybill(
    request: EWaybillAPIRequest,
  ): Promise<EWaybillAPIResponse> {
    await this.ensureAuthenticated();

    try {
      // Check if in mock mode
      if (this.configService.get<string>('EWAYBILL_MODE') === 'MOCK') {
        return this.generateMockEWaybill(request);
      }

      // Encrypt request payload
      const encryptedData = this.encryptPayload(JSON.stringify(request));

      const response = await firstValueFrom(
        this.httpService.post<{ status: number; data: string; error?: string }>(
          `${this.apiBaseUrl}/ewayapi/ewb/gen`,
          {
            action: 'GENEWAYBILL',
            data: encryptedData,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              gstin: this.gstinNo,
              authtoken: this.authToken,
            },
          },
        ),
      );

      if (response.data.status === 1) {
        const decryptedData = this.decryptPayload(response.data.data);
        const ewbResponse = JSON.parse(decryptedData) as EWaybillAPIResponse;

        this.logger.log(`E-Waybill generated: ${ewbResponse.ewayBillNo}`);
        return ewbResponse;
      }

      throw new Error(response.data.error || 'E-Waybill generation failed');
    } catch (error) {
      this.logger.error('E-Waybill generation error', error);
      throw error;
    }
  }

  /**
   * Update Part-B (Vehicle details)
   */
  async updatePartB(request: PartBUpdateRequest): Promise<EWaybillAPIResponse> {
    await this.ensureAuthenticated();

    try {
      if (this.configService.get<string>('EWAYBILL_MODE') === 'MOCK') {
        return {
          ewayBillNo: request.ewbNo,
          ewayBillDate: new Date().toISOString(),
          validUpto: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        };
      }

      const encryptedData = this.encryptPayload(JSON.stringify(request));

      const response = await firstValueFrom(
        this.httpService.post<{ status: number; data: string; error?: string }>(
          `${this.apiBaseUrl}/ewayapi/ewb/upd`,
          {
            action: 'VEHEWB',
            data: encryptedData,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              gstin: this.gstinNo,
              authtoken: this.authToken,
            },
          },
        ),
      );

      if (response.data.status === 1) {
        const decryptedData = this.decryptPayload(response.data.data);
        return JSON.parse(decryptedData) as EWaybillAPIResponse;
      }

      throw new Error(response.data.error || 'Part-B update failed');
    } catch (error) {
      this.logger.error('Part-B update error', error);
      throw error;
    }
  }

  /**
   * Cancel E-Waybill
   */
  async cancelEWaybill(
    request: EWaybillCancelRequest,
  ): Promise<{ success: boolean; message: string }> {
    await this.ensureAuthenticated();

    try {
      if (this.configService.get<string>('EWAYBILL_MODE') === 'MOCK') {
        return {
          success: true,
          message: `E-Waybill ${request.ewbNo} cancelled successfully`,
        };
      }

      const encryptedData = this.encryptPayload(JSON.stringify(request));

      const response = await firstValueFrom(
        this.httpService.post<{ status: number; data: string; error?: string }>(
          `${this.apiBaseUrl}/ewayapi/ewb/cancel`,
          {
            action: 'CANEWB',
            data: encryptedData,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              gstin: this.gstinNo,
              authtoken: this.authToken,
            },
          },
        ),
      );

      if (response.data.status === 1) {
        return {
          success: true,
          message: `E-Waybill ${request.ewbNo} cancelled`,
        };
      }

      return {
        success: false,
        message: response.data.error || 'Cancel failed',
      };
    } catch (error) {
      this.logger.error('E-Waybill cancel error', error);
      throw error;
    }
  }

  /**
   * Extend E-Waybill validity
   */
  async extendValidity(
    request: EWaybillExtendRequest,
  ): Promise<EWaybillAPIResponse> {
    await this.ensureAuthenticated();

    try {
      if (this.configService.get<string>('EWAYBILL_MODE') === 'MOCK') {
        return {
          ewayBillNo: request.ewbNo,
          ewayBillDate: new Date().toISOString(),
          validUpto: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        };
      }

      const encryptedData = this.encryptPayload(JSON.stringify(request));

      const response = await firstValueFrom(
        this.httpService.post<{ status: number; data: string; error?: string }>(
          `${this.apiBaseUrl}/ewayapi/ewb/ext`,
          {
            action: 'EXTVALIDITY',
            data: encryptedData,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              gstin: this.gstinNo,
              authtoken: this.authToken,
            },
          },
        ),
      );

      if (response.data.status === 1) {
        const decryptedData = this.decryptPayload(response.data.data);
        return JSON.parse(decryptedData) as EWaybillAPIResponse;
      }

      throw new Error(response.data.error || 'Validity extension failed');
    } catch (error) {
      this.logger.error('E-Waybill extend error', error);
      throw error;
    }
  }

  /**
   * Get E-Waybill details by number
   */
  async getEWaybillDetails(ewbNo: number): Promise<EWaybillDetailsResponse> {
    await this.ensureAuthenticated();

    try {
      if (this.configService.get<string>('EWAYBILL_MODE') === 'MOCK') {
        return this.getMockEWaybillDetails(ewbNo);
      }

      const response = await firstValueFrom(
        this.httpService.get<{ status: number; data: string; error?: string }>(
          `${this.apiBaseUrl}/ewayapi/GetEwayBill`,
          {
            params: { ewbNo },
            headers: {
              'Content-Type': 'application/json',
              gstin: this.gstinNo,
              authtoken: this.authToken,
            },
          },
        ),
      );

      if (response.data.status === 1) {
        const decryptedData = this.decryptPayload(response.data.data);
        return JSON.parse(decryptedData) as EWaybillDetailsResponse;
      }

      throw new Error(response.data.error || 'Failed to get E-Waybill details');
    } catch (error) {
      this.logger.error('Get E-Waybill details error', error);
      throw error;
    }
  }

  /**
   * Generate Consolidated E-Waybill
   */
  async generateConsolidatedEWaybill(
    request: ConsolidatedEWaybillRequest,
  ): Promise<{ cewbNo: number; cewbDate: string }> {
    await this.ensureAuthenticated();

    try {
      if (this.configService.get<string>('EWAYBILL_MODE') === 'MOCK') {
        return {
          cewbNo: Math.floor(Math.random() * 1000000000000),
          cewbDate: new Date().toISOString(),
        };
      }

      const encryptedData = this.encryptPayload(JSON.stringify(request));

      const response = await firstValueFrom(
        this.httpService.post<{ status: number; data: string; error?: string }>(
          `${this.apiBaseUrl}/ewayapi/ewb/genc`,
          {
            action: 'GENCEWB',
            data: encryptedData,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              gstin: this.gstinNo,
              authtoken: this.authToken,
            },
          },
        ),
      );

      if (response.data.status === 1) {
        const decryptedData = this.decryptPayload(response.data.data);
        return JSON.parse(decryptedData);
      }

      throw new Error(
        response.data.error || 'Consolidated E-Waybill generation failed',
      );
    } catch (error) {
      this.logger.error('Consolidated E-Waybill error', error);
      throw error;
    }
  }

  /**
   * Get list of E-Waybills by date
   */
  async getEWaybillsByDate(date: string): Promise<EWaybillDetailsResponse[]> {
    await this.ensureAuthenticated();

    try {
      if (this.configService.get<string>('EWAYBILL_MODE') === 'MOCK') {
        return [];
      }

      const response = await firstValueFrom(
        this.httpService.get<{
          status: number;
          data: string;
          error?: string;
        }>(`${this.apiBaseUrl}/ewayapi/GetEwayBillsbyDate`, {
          params: { date },
          headers: {
            'Content-Type': 'application/json',
            gstin: this.gstinNo,
            authtoken: this.authToken,
          },
        }),
      );

      if (response.data.status === 1) {
        const decryptedData = this.decryptPayload(response.data.data);
        return JSON.parse(decryptedData) as EWaybillDetailsResponse[];
      }

      throw new Error(
        response.data.error || 'Failed to get E-Waybills by date',
      );
    } catch (error) {
      this.logger.error('Get E-Waybills by date error', error);
      throw error;
    }
  }

  /**
   * Ensure authenticated before API calls
   */
  private async ensureAuthenticated(): Promise<void> {
    const isAuthenticated = await this.authenticate();
    if (!isAuthenticated) {
      throw new Error('E-Waybill API authentication failed');
    }
  }

  /**
   * Encrypt password using RSA public key
   */
  private encryptPassword(password: string): string {
    // In production, use actual GST public key
    // For mock/development, return base64 encoded
    if (this.configService.get<string>('EWAYBILL_MODE') === 'MOCK') {
      return Buffer.from(password).toString('base64');
    }

    const publicKey = this.configService.get<string>('EWAYBILL_PUBLIC_KEY', '');
    if (!publicKey) {
      return Buffer.from(password).toString('base64');
    }

    return crypto
      .publicEncrypt(publicKey, Buffer.from(password))
      .toString('base64');
  }

  /**
   * Decrypt Session Encryption Key
   */
  private decryptSEK(encryptedSEK: string): string {
    // In production, decrypt using app key
    if (this.configService.get<string>('EWAYBILL_MODE') === 'MOCK') {
      return encryptedSEK;
    }

    try {
      const key = Buffer.from(this.appKey, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
      let decrypted = decipher.update(encryptedSEK, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return encryptedSEK;
    }
  }

  /**
   * Encrypt request payload using SEK
   */
  private encryptPayload(payload: string): string {
    if (
      this.configService.get<string>('EWAYBILL_MODE') === 'MOCK' ||
      !this.sek
    ) {
      return Buffer.from(payload).toString('base64');
    }

    try {
      const key = Buffer.from(this.sek, 'base64');
      const cipher = crypto.createCipheriv('aes-256-ecb', key, null);
      let encrypted = cipher.update(payload, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      return encrypted;
    } catch {
      return Buffer.from(payload).toString('base64');
    }
  }

  /**
   * Decrypt response payload using SEK
   */
  private decryptPayload(encryptedPayload: string): string {
    if (
      this.configService.get<string>('EWAYBILL_MODE') === 'MOCK' ||
      !this.sek
    ) {
      return Buffer.from(encryptedPayload, 'base64').toString('utf8');
    }

    try {
      const key = Buffer.from(this.sek, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
      let decrypted = decipher.update(encryptedPayload, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return Buffer.from(encryptedPayload, 'base64').toString('utf8');
    }
  }

  /**
   * Generate mock E-Waybill for testing
   */
  private generateMockEWaybill(
    request: EWaybillAPIRequest,
  ): EWaybillAPIResponse {
    const ewbNo = Math.floor(100000000000 + Math.random() * 900000000000);
    const validDays = Math.ceil(request.transDistance / 100);

    return {
      ewayBillNo: ewbNo,
      ewayBillDate: new Date().toISOString(),
      validUpto: new Date(
        Date.now() + validDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
    };
  }

  /**
   * Get mock E-Waybill details
   */
  private getMockEWaybillDetails(ewbNo: number): EWaybillDetailsResponse {
    return {
      ewayBillNo: ewbNo,
      ewbDate: new Date().toISOString(),
      genMode: 'API',
      userGstin: this.gstinNo,
      supplyType: 'O',
      subSupplyType: 1,
      docType: 'INV',
      docNo: `INV-${Date.now()}`,
      docDate: new Date().toISOString().split('T')[0],
      fromGstin: this.gstinNo,
      fromTrdName: 'QuikBoys Logistics',
      fromAddr1: 'Test Address',
      fromAddr2: '',
      fromPlace: 'Hyderabad',
      fromPincode: 500081,
      fromStateCode: 36,
      toGstin: '',
      toTrdName: 'Customer',
      toAddr1: 'Delivery Address',
      toAddr2: '',
      toPlace: 'Mumbai',
      toPincode: 400001,
      toStateCode: 27,
      totalValue: 50000,
      totInvValue: 59000,
      cgstValue: 0,
      sgstValue: 0,
      igstValue: 9000,
      cessValue: 0,
      transMode: '1',
      transDistance: 700,
      transporterName: 'QuikBoys Transport',
      transporterId: this.gstinNo,
      vehicleNo: 'TS01AB1234',
      vehicleType: 'R',
      status: 'ACT',
      validUpto: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      extendedTimes: 0,
      rejectStatus: 'N',
      vehicleListDetails: [],
      itemList: [],
    };
  }

  /**
   * Get state code from state name
   */
  getStateCode(stateName: string): number | null {
    return this.stateCodes[stateName.toUpperCase()] || null;
  }

  /**
   * Get sub-supply type code
   */
  getSubSupplyTypeCode(type: string): number {
    return this.subSupplyTypes[type.toUpperCase()] || 12;
  }

  /**
   * Get cancel reason code
   */
  getCancelReasonCode(reason: string): number {
    return this.cancelReasonCodes[reason.toUpperCase()] || 4;
  }

  /**
   * Build E-Waybill request from order data
   */
  buildEWaybillRequest(orderData: {
    docNo: string;
    docDate: Date;
    fromGstin: string;
    fromTrdName: string;
    fromAddress: {
      line1: string;
      line2?: string;
      place: string;
      pincode: number;
      state: string;
    };
    toGstin?: string;
    toTrdName: string;
    toAddress: {
      line1: string;
      line2?: string;
      place: string;
      pincode: number;
      state: string;
    };
    items: Array<{
      name: string;
      description: string;
      hsnCode: number;
      quantity: number;
      unit: string;
      taxableAmount: number;
      gstRate: number;
    }>;
    transDistance: number;
    vehicleNo?: string;
    transportMode?: number;
  }): EWaybillAPIRequest {
    const fromStateCode = this.getStateCode(orderData.fromAddress.state);
    const toStateCode = this.getStateCode(orderData.toAddress.state);
    const isInterState = fromStateCode !== toStateCode;

    const totalValue = orderData.items.reduce(
      (sum, item) => sum + item.taxableAmount,
      0,
    );
    const totalTax = orderData.items.reduce(
      (sum, item) => sum + (item.taxableAmount * item.gstRate) / 100,
      0,
    );

    return {
      supplyType: 'O',
      subSupplyType: 1,
      docType: 'INV',
      docNo: orderData.docNo,
      docDate: orderData.docDate.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      fromGstin: orderData.fromGstin,
      fromTrdName: orderData.fromTrdName,
      fromAddr1: orderData.fromAddress.line1,
      fromAddr2: orderData.fromAddress.line2,
      fromPlace: orderData.fromAddress.place,
      fromPincode: orderData.fromAddress.pincode,
      fromStateCode: fromStateCode || 36,
      toGstin: orderData.toGstin || 'URP',
      toTrdName: orderData.toTrdName,
      toAddr1: orderData.toAddress.line1,
      toAddr2: orderData.toAddress.line2,
      toPlace: orderData.toAddress.place,
      toPincode: orderData.toAddress.pincode,
      toStateCode: toStateCode || 27,
      transMode: orderData.transportMode || 1,
      transDistance: orderData.transDistance,
      vehicleNo: orderData.vehicleNo,
      vehicleType: 'R',
      itemList: orderData.items.map((item) => ({
        productName: item.name,
        productDesc: item.description,
        hsnCode: item.hsnCode,
        quantity: item.quantity,
        qtyUnit: item.unit,
        cgstRate: isInterState ? 0 : item.gstRate / 2,
        sgstRate: isInterState ? 0 : item.gstRate / 2,
        igstRate: isInterState ? item.gstRate : 0,
        cessRate: 0,
        cessAdvol: 0,
        taxableAmount: item.taxableAmount,
      })),
      totalValue,
      cgstValue: isInterState ? 0 : totalTax / 2,
      sgstValue: isInterState ? 0 : totalTax / 2,
      igstValue: isInterState ? totalTax : 0,
      cessValue: 0,
      totInvValue: totalValue + totalTax,
    };
  }
}
