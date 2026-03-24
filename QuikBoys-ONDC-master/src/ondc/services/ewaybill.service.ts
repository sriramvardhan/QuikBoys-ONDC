// ============================================
// E-Waybill Service
// File: src/ondc/services/ewaybill.service.ts
// ONDC Logistics - E-Waybill generation for inter-state shipments
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import type { Prisma } from '@prisma/client';

/**
 * E-Waybill details structure
 * E-Waybill is mandatory for inter-state movement of goods > ₹50,000
 * as per GST regulations
 */
export interface EWaybillDetails {
  ewbNumber: string; // 12-digit E-Waybill number
  ewbDate: Date;
  validUpto: Date;
  generatedBy: string;
  fromGstin: string;
  toGstin?: string;
  fromPlace: string;
  toPlace: string;
  fromState: string;
  toState: string;
  totalValue: number;
  vehicleNumber?: string;
  transporterGstin?: string;
  transportMode: 'ROAD' | 'RAIL' | 'AIR' | 'SHIP';
  status:
    | 'GENERATED'
    | 'ACTIVE'
    | 'CANCELLED'
    | 'EXPIRED'
    | 'EXTENDED'
    | 'COMPLETED';
  partB?: PartBDetails;
}

/**
 * Part-B of E-Waybill - Vehicle details
 */
export interface PartBDetails {
  vehicleNumber: string;
  vehicleType: 'REGULAR' | 'OVER_DIMENSIONAL_CARGO';
  transporterDocNumber?: string;
  transporterDocDate?: string;
  updatedAt: Date;
}

/**
 * E-Waybill generation request
 */
export interface EWaybillRequest {
  orderId: string;
  fromGstin: string;
  toGstin?: string;
  fromAddress: {
    place: string;
    state: string;
    pincode: string;
  };
  toAddress: {
    place: string;
    state: string;
    pincode: string;
  };
  items: Array<{
    hsnCode: string;
    description: string;
    quantity: number;
    unit: string;
    value: number;
    taxRate: number;
  }>;
  transportMode: 'ROAD' | 'RAIL' | 'AIR' | 'SHIP';
  vehicleNumber?: string;
  transporterGstin?: string;
  subSupplyType:
    | 'SUPPLY'
    | 'EXPORT'
    | 'JOB_WORK'
    | 'SKD_CKD'
    | 'RECIPIENT_NOT_KNOWN'
    | 'FOR_OWN_USE'
    | 'EXHIBITION'
    | 'LINE_SALES'
    | 'OTHERS';
  documentType: 'INVOICE' | 'BILL' | 'CHALLAN' | 'CREDIT_NOTE' | 'OTHERS';
  documentNumber: string;
  documentDate: Date;
}

/**
 * State code mapping for E-Waybill
 */
const STATE_CODES: Record<string, string> = {
  'ANDHRA PRADESH': '37',
  'ARUNACHAL PRADESH': '12',
  ASSAM: '18',
  BIHAR: '10',
  CHHATTISGARH: '22',
  GOA: '30',
  GUJARAT: '24',
  HARYANA: '06',
  'HIMACHAL PRADESH': '02',
  JHARKHAND: '20',
  KARNATAKA: '29',
  KERALA: '32',
  'MADHYA PRADESH': '23',
  MAHARASHTRA: '27',
  MANIPUR: '14',
  MEGHALAYA: '17',
  MIZORAM: '15',
  NAGALAND: '13',
  ODISHA: '21',
  PUNJAB: '03',
  RAJASTHAN: '08',
  SIKKIM: '11',
  'TAMIL NADU': '33',
  TELANGANA: '36',
  TRIPURA: '16',
  'UTTAR PRADESH': '09',
  UTTARAKHAND: '05',
  'WEST BENGAL': '19',
  'ANDAMAN AND NICOBAR': '35',
  CHANDIGARH: '04',
  'DADRA AND NAGAR HAVELI': '26',
  'DAMAN AND DIU': '25',
  DELHI: '07',
  'JAMMU AND KASHMIR': '01',
  LADAKH: '38',
  LAKSHADWEEP: '31',
  PUDUCHERRY: '34',
};

/**
 * EWaybillService - Manages E-Waybill generation and validation
 *
 * ONDC Requirement: Inter-state shipments of goods > ₹50,000
 * require E-Waybill as per GST regulations. LSPs must track
 * and update E-Waybill status during transit.
 */
@Injectable()
export class EWaybillService {
  private readonly logger = new Logger(EWaybillService.name);
  private readonly ewbApiUrl: string;
  private readonly ewbUsername: string;
  private readonly ewbPassword: string;
  private readonly gstin: string;
  private readonly ewbThreshold: number; // Value threshold for E-Waybill
  private readonly ewbValidityKm: number; // Validity in km/day

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    // E-Waybill API configuration (GST E-Waybill Portal)
    this.ewbApiUrl = this.configService.get<string>(
      'EWAYBILL_API_URL',
      'https://einvoice1.gst.gov.in',
    );
    this.ewbUsername = this.configService.get<string>('EWAYBILL_USERNAME', '');
    this.ewbPassword = this.configService.get<string>('EWAYBILL_PASSWORD', '');
    this.gstin = this.configService.get<string>('COMPANY_GSTIN', '');

    // E-Waybill is mandatory for inter-state movement > ₹50,000
    this.ewbThreshold = this.configService.get<number>(
      'EWAYBILL_THRESHOLD',
      50000,
    );

    // Validity: 100km per day for regular cargo
    this.ewbValidityKm = this.configService.get<number>(
      'EWAYBILL_VALIDITY_KM_PER_DAY',
      100,
    );
  }

  /**
   * Check if E-Waybill is required for shipment
   */
  isEWaybillRequired(
    fromState: string,
    toState: string,
    totalValue: number,
  ): boolean {
    // E-Waybill required for inter-state movement > threshold
    const isInterState = fromState.toUpperCase() !== toState.toUpperCase();
    const exceedsThreshold = totalValue > this.ewbThreshold;

    return isInterState && exceedsThreshold;
  }

  /**
   * Generate E-Waybill for inter-state shipment
   */
  async generateEWaybill(request: EWaybillRequest): Promise<EWaybillDetails> {
    const {
      orderId,
      fromGstin,
      toGstin,
      fromAddress,
      toAddress,
      items,
      transportMode,
      vehicleNumber,
    } = request;

    // Check if E-Waybill is required
    const totalValue = items.reduce((sum, item) => sum + item.value, 0);
    if (
      !this.isEWaybillRequired(fromAddress.state, toAddress.state, totalValue)
    ) {
      this.logger.debug(
        `E-Waybill not required for order ${orderId} (intra-state or below threshold)`,
      );
      return this.createPlaceholderEWaybill(orderId, 'NOT_REQUIRED');
    }

    try {
      // In production, this would call the actual GST E-Waybill API
      // For now, generate a mock E-Waybill number
      const ewbNumber = await this.generateMockEWaybill(request);

      const ewbDetails: EWaybillDetails = {
        ewbNumber,
        ewbDate: new Date(),
        validUpto: this.calculateValidity(
          fromAddress.pincode,
          toAddress.pincode,
        ),
        generatedBy: this.gstin || fromGstin,
        fromGstin,
        toGstin,
        fromPlace: fromAddress.place,
        toPlace: toAddress.place,
        fromState: fromAddress.state,
        toState: toAddress.state,
        totalValue,
        vehicleNumber,
        transporterGstin: request.transporterGstin,
        transportMode,
        status: 'GENERATED',
      };

      // Store E-Waybill details in fulfillment
      await this.storeEWaybillDetails(orderId, ewbDetails);

      this.logger.log(`E-Waybill generated: ${ewbNumber} for order ${orderId}`);

      return ewbDetails;
    } catch (error) {
      this.logger.error(
        `E-Waybill generation failed for order ${orderId}`,
        error,
      );
      throw new Error(`E-Waybill generation failed: ${error}`);
    }
  }

  /**
   * Update Part-B (Vehicle details) of E-Waybill
   */
  async updatePartB(
    orderId: string,
    vehicleNumber: string,
    vehicleType: 'REGULAR' | 'OVER_DIMENSIONAL_CARGO' = 'REGULAR',
    transporterDocNumber?: string,
  ): Promise<EWaybillDetails> {
    const existingDetails = await this.getEWaybillByOrderId(orderId);

    if (!existingDetails) {
      throw new Error(`No E-Waybill found for order: ${orderId}`);
    }

    if (existingDetails.status === 'CANCELLED') {
      throw new Error(
        `Cannot update cancelled E-Waybill: ${existingDetails.ewbNumber}`,
      );
    }

    const partB: PartBDetails = {
      vehicleNumber,
      vehicleType,
      transporterDocNumber,
      transporterDocDate: new Date().toISOString().split('T')[0],
      updatedAt: new Date(),
    };

    const updatedDetails: EWaybillDetails = {
      ...existingDetails,
      vehicleNumber,
      partB,
      status: 'ACTIVE',
    };

    await this.storeEWaybillDetails(orderId, updatedDetails);

    this.logger.log(
      `E-Waybill Part-B updated: ${existingDetails.ewbNumber}, Vehicle: ${vehicleNumber}`,
    );

    return updatedDetails;
  }

  /**
   * Extend E-Waybill validity
   */
  async extendValidity(
    orderId: string,
    reason: string,
    newVehicleNumber?: string,
  ): Promise<EWaybillDetails> {
    const existingDetails = await this.getEWaybillByOrderId(orderId);

    if (!existingDetails) {
      throw new Error(`No E-Waybill found for order: ${orderId}`);
    }

    // Check if extension is allowed (within 8 hours of expiry or after expiry)
    const now = new Date();
    const hoursToExpiry =
      (existingDetails.validUpto.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursToExpiry > 8) {
      throw new Error(
        `E-Waybill extension not allowed - validity expires in ${Math.round(hoursToExpiry)} hours`,
      );
    }

    // Extend by 1 day (can be extended up to 8 times)
    const newValidUpto = new Date(existingDetails.validUpto);
    newValidUpto.setDate(newValidUpto.getDate() + 1);

    const updatedDetails: EWaybillDetails = {
      ...existingDetails,
      validUpto: newValidUpto,
      vehicleNumber: newVehicleNumber || existingDetails.vehicleNumber,
      status: 'EXTENDED',
    };

    await this.storeEWaybillDetails(orderId, updatedDetails);

    this.logger.log(
      `E-Waybill extended: ${existingDetails.ewbNumber}, New validity: ${newValidUpto.toISOString()}`,
    );

    return updatedDetails;
  }

  /**
   * Cancel E-Waybill
   */
  async cancelEWaybill(
    orderId: string,
    reason: string,
  ): Promise<{ success: boolean; message: string }> {
    const existingDetails = await this.getEWaybillByOrderId(orderId);

    if (!existingDetails) {
      return { success: false, message: 'No E-Waybill found' };
    }

    // E-Waybill can only be cancelled within 24 hours of generation
    const hoursSinceGeneration =
      (Date.now() - existingDetails.ewbDate.getTime()) / (1000 * 60 * 60);

    if (hoursSinceGeneration > 24) {
      return {
        success: false,
        message:
          'E-Waybill can only be cancelled within 24 hours of generation',
      };
    }

    const updatedDetails: EWaybillDetails = {
      ...existingDetails,
      status: 'CANCELLED',
    };

    await this.storeEWaybillDetails(orderId, updatedDetails);

    this.logger.log(
      `E-Waybill cancelled: ${existingDetails.ewbNumber}, Reason: ${reason}`,
    );

    return {
      success: true,
      message: `E-Waybill ${existingDetails.ewbNumber} cancelled`,
    };
  }

  /**
   * Complete E-Waybill (mark as delivered)
   */
  async completeEWaybill(orderId: string): Promise<EWaybillDetails> {
    const existingDetails = await this.getEWaybillByOrderId(orderId);

    if (!existingDetails) {
      throw new Error(`No E-Waybill found for order: ${orderId}`);
    }

    const updatedDetails: EWaybillDetails = {
      ...existingDetails,
      status: 'COMPLETED',
    };

    await this.storeEWaybillDetails(orderId, updatedDetails);

    this.logger.log(`E-Waybill completed: ${existingDetails.ewbNumber}`);

    return updatedDetails;
  }

  /**
   * Get E-Waybill details by order ID
   */
  async getEWaybillByOrderId(orderId: string): Promise<EWaybillDetails | null> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      return null;
    }

    const pickupAddress = fulfillment.pickupAddress as Record<
      string,
      unknown
    > | null;
    const ewbData = pickupAddress?._ewaybillData as
      | {
          ewbNumber: string;
          ewbDate: string;
          validUpto: string;
          generatedBy: string;
          fromGstin: string;
          toGstin?: string;
          fromPlace: string;
          toPlace: string;
          fromState: string;
          toState: string;
          totalValue: number;
          vehicleNumber?: string;
          transporterGstin?: string;
          transportMode: string;
          status: string;
          partB?: PartBDetails;
        }
      | undefined;

    if (!ewbData?.ewbNumber) {
      return null;
    }

    return {
      ewbNumber: ewbData.ewbNumber,
      ewbDate: new Date(ewbData.ewbDate),
      validUpto: new Date(ewbData.validUpto),
      generatedBy: ewbData.generatedBy,
      fromGstin: ewbData.fromGstin,
      toGstin: ewbData.toGstin,
      fromPlace: ewbData.fromPlace,
      toPlace: ewbData.toPlace,
      fromState: ewbData.fromState,
      toState: ewbData.toState,
      totalValue: ewbData.totalValue,
      vehicleNumber: ewbData.vehicleNumber,
      transporterGstin: ewbData.transporterGstin,
      transportMode: ewbData.transportMode as EWaybillDetails['transportMode'],
      status: ewbData.status as EWaybillDetails['status'],
      partB: ewbData.partB,
    };
  }

  /**
   * Validate E-Waybill status
   */
  async validateEWaybill(
    ewbNumber: string,
  ): Promise<{ isValid: boolean; message: string }> {
    // In production, this would call the GST E-Waybill validation API
    // For now, perform basic validation
    if (!this.isValidEWaybillFormat(ewbNumber)) {
      return { isValid: false, message: 'Invalid E-Waybill format' };
    }

    return { isValid: true, message: 'E-Waybill is valid' };
  }

  /**
   * Check if E-Waybill format is valid
   */
  private isValidEWaybillFormat(ewbNumber: string): boolean {
    // E-Waybill number is 12 digits
    return /^\d{12}$/.test(ewbNumber);
  }

  /**
   * Generate mock E-Waybill number for testing
   * In production, this would call the actual GST E-Waybill API
   */
  private async generateMockEWaybill(
    _request: EWaybillRequest,
  ): Promise<string> {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 9999)
      .toString()
      .padStart(4, '0');
    return `${timestamp}${random}`;
  }

  /**
   * Calculate E-Waybill validity based on distance
   */
  private calculateValidity(fromPincode: string, toPincode: string): Date {
    // Estimate distance based on pincode difference (simplified)
    // In production, use actual distance calculation
    const estimatedDistance = this.estimateDistance(fromPincode, toPincode);

    // Validity: 1 day per 100km (minimum 1 day)
    const validityDays = Math.max(
      1,
      Math.ceil(estimatedDistance / this.ewbValidityKm),
    );

    const validUpto = new Date();
    validUpto.setDate(validUpto.getDate() + validityDays);
    validUpto.setHours(23, 59, 59, 999); // Valid until end of day

    return validUpto;
  }

  /**
   * Estimate distance between two pincodes (simplified)
   */
  private estimateDistance(fromPincode: string, toPincode: string): number {
    // Simple estimation based on pincode difference
    // In production, use actual distance API
    const fromNum = parseInt(fromPincode.slice(0, 3), 10);
    const toNum = parseInt(toPincode.slice(0, 3), 10);
    const diff = Math.abs(fromNum - toNum);

    // Rough estimate: 50km per pincode prefix difference
    return diff * 50 + 100; // Minimum 100km
  }

  /**
   * Create placeholder for orders not requiring E-Waybill
   */
  private createPlaceholderEWaybill(
    _orderId: string,
    _reason: string,
  ): EWaybillDetails {
    return {
      ewbNumber: '',
      ewbDate: new Date(),
      validUpto: new Date(),
      generatedBy: '',
      fromGstin: '',
      fromPlace: '',
      toPlace: '',
      fromState: '',
      toState: '',
      totalValue: 0,
      transportMode: 'ROAD',
      status: 'COMPLETED', // Mark as completed since not required
    };
  }

  /**
   * Store E-Waybill details in fulfillment
   */
  private async storeEWaybillDetails(
    orderId: string,
    details: EWaybillDetails,
  ): Promise<void> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      this.logger.warn(
        `No fulfillment found for order ${orderId} to store E-Waybill`,
      );
      return;
    }

    const pickupAddress =
      (fulfillment.pickupAddress as Record<string, unknown>) || {};

    const updatedPickupAddress = {
      ...pickupAddress,
      _ewaybillData: {
        ewbNumber: details.ewbNumber,
        ewbDate: details.ewbDate.toISOString(),
        validUpto: details.validUpto.toISOString(),
        generatedBy: details.generatedBy,
        fromGstin: details.fromGstin,
        toGstin: details.toGstin,
        fromPlace: details.fromPlace,
        toPlace: details.toPlace,
        fromState: details.fromState,
        toState: details.toState,
        totalValue: details.totalValue,
        vehicleNumber: details.vehicleNumber,
        transporterGstin: details.transporterGstin,
        transportMode: details.transportMode,
        status: details.status,
        partB: details.partB,
      },
    };

    await this.prisma.ondcFulfillment.update({
      where: { id: fulfillment.id },
      data: {
        pickupAddress: updatedPickupAddress as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Get state code from state name
   */
  getStateCode(stateName: string): string | null {
    return STATE_CODES[stateName.toUpperCase()] || null;
  }

  /**
   * Build E-Waybill tags for ONDC response
   */
  buildEWaybillTags(details: EWaybillDetails): Array<{
    descriptor: { code: string };
    list: Array<{ descriptor: { code: string }; value: string }>;
  }> {
    if (!details.ewbNumber) {
      return [];
    }

    return [
      {
        descriptor: { code: 'ewaybill' },
        list: [
          {
            descriptor: { code: 'ewb_number' },
            value: details.ewbNumber,
          },
          {
            descriptor: { code: 'ewb_date' },
            value: details.ewbDate.toISOString().split('T')[0],
          },
          {
            descriptor: { code: 'valid_upto' },
            value: details.validUpto.toISOString().split('T')[0],
          },
          {
            descriptor: { code: 'from_state' },
            value: details.fromState,
          },
          {
            descriptor: { code: 'to_state' },
            value: details.toState,
          },
          {
            descriptor: { code: 'status' },
            value: details.status,
          },
          ...(details.vehicleNumber
            ? [
                {
                  descriptor: { code: 'vehicle_number' },
                  value: details.vehicleNumber,
                },
              ]
            : []),
        ],
      },
    ];
  }
}
