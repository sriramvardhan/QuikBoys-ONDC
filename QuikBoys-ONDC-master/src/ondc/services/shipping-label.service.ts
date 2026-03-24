// ============================================
// Shipping Label Service
// File: src/ondc/services/shipping-label.service.ts
// ONDC Logistics - Shipping label generation for packages
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

/**
 * Shipping label details
 */
export interface ShippingLabel {
  labelId: string;
  orderId: string;
  awbNumber?: string;
  barcode: string;
  qrCode: string;
  labelUrl?: string;
  labelFormat: 'PDF' | 'PNG' | 'ZPL';
  labelSize: '4x6' | '4x4' | 'A4';
  generatedAt: Date;
  status: 'GENERATED' | 'PRINTED' | 'APPLIED' | 'DAMAGED';
  printCount: number;
}

/**
 * Shipping label content - data included in the label
 */
export interface ShippingLabelContent {
  // Order info
  orderId: string;
  orderDate: string;
  awbNumber?: string;

  // Sender details
  senderName: string;
  senderAddress: string;
  senderCity: string;
  senderState: string;
  senderPincode: string;
  senderPhone: string;

  // Recipient details
  recipientName: string;
  recipientAddress: string;
  recipientCity: string;
  recipientState: string;
  recipientPincode: string;
  recipientPhone: string;

  // Package details
  packageWeight: string;
  packageDimensions?: string;
  packageCount: number;
  packageContents?: string;

  // Delivery details
  deliveryType: 'P2P' | 'P2H2P';
  serviceType: string;
  paymentMode: 'PREPAID' | 'COD';
  codAmount?: number;

  // Compliance
  ewaybillNumber?: string;
  gstinSender?: string;
  gstinRecipient?: string;

  // Routing
  routingCode?: string;
  hubCode?: string;
  zoneCode?: string;
}

/**
 * Label generation request
 */
export interface LabelGenerationRequest {
  orderId: string;
  format?: 'PDF' | 'PNG' | 'ZPL';
  size?: '4x6' | '4x4' | 'A4';
  includeReturnLabel?: boolean;
}

/**
 * ShippingLabelService - Generates shipping labels for ONDC logistics
 *
 * ONDC Requirement: Logistics providers must generate standardized
 * shipping labels with barcodes/QR codes for package tracking.
 */
@Injectable()
export class ShippingLabelService {
  private readonly logger = new Logger(ShippingLabelService.name);
  private readonly companyName: string;
  private readonly companyLogo: string;
  private readonly labelBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.companyName = this.configService.get<string>(
      'COMPANY_NAME',
      'QuikBoys Logistics',
    );
    this.companyLogo = this.configService.get<string>('COMPANY_LOGO_URL', '');
    this.labelBaseUrl = this.configService.get<string>(
      'LABEL_BASE_URL',
      '/api/labels',
    );
  }

  /**
   * Generate shipping label for an order
   */
  async generateLabel(request: LabelGenerationRequest): Promise<ShippingLabel> {
    const { orderId, format = 'PDF', size = '4x6' } = request;

    // Get order details
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
      },
    });

    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // Get fulfillment details
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    // Generate unique label ID
    const labelId = this.generateLabelId(orderId);

    // Generate barcode (based on AWB or order ID)
    const pickupAddress =
      (fulfillment?.pickupAddress as Record<string, unknown>) || {};
    const awbData = pickupAddress._awbData as
      | { awbNumber?: string }
      | undefined;
    const awbNumber = awbData?.awbNumber || '';
    const barcode = this.generateBarcode(awbNumber || orderId);

    // Generate QR code data
    const qrCode = this.generateQRCodeData(orderId, awbNumber);

    // Generate label URL
    const labelUrl = `${this.labelBaseUrl}/${labelId}.${format.toLowerCase()}`;

    const label: ShippingLabel = {
      labelId,
      orderId,
      awbNumber,
      barcode,
      qrCode,
      labelUrl,
      labelFormat: format,
      labelSize: size,
      generatedAt: new Date(),
      status: 'GENERATED',
      printCount: 0,
    };

    // Store label in fulfillment
    await this.storeLabelDetails(orderId, label);

    this.logger.log(
      `Shipping label generated: ${labelId} for order ${orderId}`,
    );

    return label;
  }

  /**
   * Get label content data for rendering
   */
  async getLabelContent(orderId: string): Promise<ShippingLabelContent> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
      },
    });

    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    // Parse addresses from fulfillment
    const pickupAddress =
      (fulfillment?.pickupAddress as Record<string, unknown>) || {};
    const deliveryAddress =
      (fulfillment?.deliveryAddress as Record<string, unknown>) || {};

    // Get AWB and E-Waybill data
    const awbData = pickupAddress._awbData as
      | { awbNumber?: string; deliveryType?: string }
      | undefined;
    const ewaybillData = pickupAddress._ewaybillData as
      | { ewbNumber?: string }
      | undefined;

    // Calculate package weight
    const items = order.items as Array<{ weight?: number }> | null;
    const totalWeight =
      items?.reduce((sum, item) => sum + (item.weight || 0), 0) || 0;

    // Determine payment mode
    const paymentMode: 'PREPAID' | 'COD' =
      order.paymentMethod === 'COD' ? 'COD' : 'PREPAID';

    return {
      orderId: order.id,
      orderDate: order.createdAt.toISOString().split('T')[0],
      awbNumber: awbData?.awbNumber,

      // Sender details (from pickup address)
      senderName: (pickupAddress.name as string) || 'Sender',
      senderAddress: this.formatAddress(pickupAddress),
      senderCity: (pickupAddress.city as string) || '',
      senderState: (pickupAddress.state as string) || '',
      senderPincode: (pickupAddress.pincode as string) || '',
      senderPhone: (pickupAddress.phone as string) || '',

      // Recipient details (from delivery address)
      recipientName:
        order.customer?.name ||
        String(deliveryAddress.name || '') ||
        'Recipient',
      recipientAddress:
        String(order.deliveryAddress || '') ||
        this.formatAddress(deliveryAddress),
      recipientCity: String(deliveryAddress.city || ''),
      recipientState: String(deliveryAddress.state || ''),
      recipientPincode:
        String(deliveryAddress.pincode || '') ||
        this.extractPincode(String(order.deliveryAddress || '')),
      recipientPhone:
        order.customer?.phone || String(deliveryAddress.phone || ''),

      // Package details
      packageWeight: `${totalWeight.toFixed(2)} kg`,
      packageCount: 1,
      packageContents: this.getPackageContents(items),

      // Delivery details
      deliveryType: (awbData?.deliveryType as 'P2P' | 'P2H2P') || 'P2P',
      serviceType: fulfillment?.type || 'IMMEDIATE',
      paymentMode,
      codAmount: paymentMode === 'COD' ? Number(order.totalAmount) : undefined,

      // Compliance
      ewaybillNumber: ewaybillData?.ewbNumber,

      // Routing
      routingCode: this.generateRoutingCode(
        String(deliveryAddress.pincode || ''),
      ),
      zoneCode: this.getZoneCode(String(deliveryAddress.state || '')),
    };
  }

  /**
   * Generate label HTML for printing
   */
  async generateLabelHtml(orderId: string): Promise<string> {
    const content = await this.getLabelContent(orderId);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Shipping Label - ${content.orderId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 12px; }
    .label { width: 4in; height: 6in; padding: 10px; border: 2px solid #000; }
    .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 10px; }
    .company-name { font-size: 18px; font-weight: bold; }
    .section { margin-bottom: 10px; padding: 5px; }
    .section-title { font-weight: bold; font-size: 10px; color: #666; }
    .address-box { border: 1px solid #000; padding: 8px; margin-top: 5px; }
    .from-address { background: #f0f0f0; }
    .to-address { background: #fff; font-size: 14px; }
    .to-address .name { font-size: 16px; font-weight: bold; }
    .barcode { text-align: center; margin: 10px 0; padding: 10px; border: 1px dashed #000; }
    .barcode-text { font-family: 'Libre Barcode 39', monospace; font-size: 40px; }
    .awb { font-size: 14px; font-weight: bold; letter-spacing: 2px; }
    .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
    .detail-item { font-size: 10px; }
    .detail-label { color: #666; }
    .cod-box { background: #ff0; padding: 5px; text-align: center; font-weight: bold; font-size: 14px; }
    .footer { text-align: center; font-size: 8px; color: #666; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="label">
    <div class="header">
      <div class="company-name">${this.companyName}</div>
      <div class="awb">${content.awbNumber || content.orderId}</div>
    </div>

    <div class="section">
      <div class="section-title">FROM:</div>
      <div class="address-box from-address">
        <strong>${content.senderName}</strong><br>
        ${content.senderAddress}<br>
        ${content.senderCity}, ${content.senderState} - ${content.senderPincode}<br>
        Ph: ${content.senderPhone}
      </div>
    </div>

    <div class="section">
      <div class="section-title">TO:</div>
      <div class="address-box to-address">
        <div class="name">${content.recipientName}</div>
        ${content.recipientAddress}<br>
        ${content.recipientCity}, ${content.recipientState} - ${content.recipientPincode}<br>
        Ph: ${content.recipientPhone}
      </div>
    </div>

    <div class="barcode">
      <div class="barcode-text">*${content.awbNumber || content.orderId}*</div>
      <div>${content.awbNumber || content.orderId}</div>
    </div>

    ${content.paymentMode === 'COD' ? `<div class="cod-box">COD: ₹${content.codAmount}</div>` : ''}

    <div class="details-grid">
      <div class="detail-item">
        <span class="detail-label">Weight:</span> ${content.packageWeight}
      </div>
      <div class="detail-item">
        <span class="detail-label">Service:</span> ${content.serviceType}
      </div>
      <div class="detail-item">
        <span class="detail-label">Type:</span> ${content.deliveryType}
      </div>
      <div class="detail-item">
        <span class="detail-label">Date:</span> ${content.orderDate}
      </div>
      ${content.ewaybillNumber ? `<div class="detail-item"><span class="detail-label">E-Waybill:</span> ${content.ewaybillNumber}</div>` : ''}
      ${content.routingCode ? `<div class="detail-item"><span class="detail-label">Route:</span> ${content.routingCode}</div>` : ''}
    </div>

    <div class="footer">
      Order ID: ${content.orderId} | Generated: ${new Date().toISOString()}
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Generate ZPL (Zebra Printer Language) for thermal printers
   */
  async generateLabelZpl(orderId: string): Promise<string> {
    const content = await this.getLabelContent(orderId);

    // Basic ZPL format for 4x6 label
    return `
^XA
^FO50,50^A0N,40,40^FD${this.companyName}^FS
^FO50,100^A0N,30,30^FD${content.awbNumber || content.orderId}^FS

^FO50,150^A0N,20,20^FDFROM:^FS
^FO50,175^A0N,25,25^FD${content.senderName}^FS
^FO50,205^A0N,20,20^FD${content.senderAddress}^FS
^FO50,230^A0N,20,20^FD${content.senderCity}, ${content.senderState} ${content.senderPincode}^FS

^FO50,280^A0N,20,20^FDTO:^FS
^FO50,305^A0N,35,35^FD${content.recipientName}^FS
^FO50,345^A0N,25,25^FD${content.recipientAddress}^FS
^FO50,375^A0N,25,25^FD${content.recipientCity}, ${content.recipientState} ${content.recipientPincode}^FS
^FO50,405^A0N,20,20^FDPh: ${content.recipientPhone}^FS

^FO50,450^BY3^BCN,100,Y,N,N^FD${content.awbNumber || content.orderId}^FS

${content.paymentMode === 'COD' ? `^FO50,580^A0N,40,40^FDCOD: Rs.${content.codAmount}^FS` : ''}

^FO50,630^A0N,20,20^FDWeight: ${content.packageWeight} | Service: ${content.serviceType}^FS
^FO50,660^A0N,15,15^FDOrder: ${content.orderId}^FS
^XZ`;
  }

  /**
   * Update label status
   */
  async updateLabelStatus(
    orderId: string,
    status: ShippingLabel['status'],
  ): Promise<ShippingLabel | null> {
    const label = await this.getLabelByOrderId(orderId);

    if (!label) {
      return null;
    }

    const updatedLabel: ShippingLabel = {
      ...label,
      status,
      printCount:
        status === 'PRINTED' ? label.printCount + 1 : label.printCount,
    };

    await this.storeLabelDetails(orderId, updatedLabel);

    this.logger.debug(`Label status updated for order ${orderId}: ${status}`);

    return updatedLabel;
  }

  /**
   * Get label by order ID
   */
  async getLabelByOrderId(orderId: string): Promise<ShippingLabel | null> {
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
    const labelData = pickupAddress?._labelData as
      | {
          labelId: string;
          orderId: string;
          awbNumber?: string;
          barcode: string;
          qrCode: string;
          labelUrl?: string;
          labelFormat: string;
          labelSize: string;
          generatedAt: string;
          status: string;
          printCount: number;
        }
      | undefined;

    if (!labelData?.labelId) {
      return null;
    }

    return {
      labelId: labelData.labelId,
      orderId: labelData.orderId,
      awbNumber: labelData.awbNumber,
      barcode: labelData.barcode,
      qrCode: labelData.qrCode,
      labelUrl: labelData.labelUrl,
      labelFormat: labelData.labelFormat as ShippingLabel['labelFormat'],
      labelSize: labelData.labelSize as ShippingLabel['labelSize'],
      generatedAt: new Date(labelData.generatedAt),
      status: labelData.status as ShippingLabel['status'],
      printCount: labelData.printCount,
    };
  }

  /**
   * Generate return label for RTO
   */
  async generateReturnLabel(orderId: string): Promise<ShippingLabel> {
    const originalLabel = await this.getLabelByOrderId(orderId);

    if (!originalLabel) {
      throw new Error(`Original label not found for order: ${orderId}`);
    }

    // Generate return label with swapped addresses
    const returnLabelId = `RTN-${originalLabel.labelId}`;

    const returnLabel: ShippingLabel = {
      ...originalLabel,
      labelId: returnLabelId,
      generatedAt: new Date(),
      status: 'GENERATED',
      printCount: 0,
    };

    // Store return label separately
    await this.storeReturnLabelDetails(orderId, returnLabel);

    this.logger.log(
      `Return label generated: ${returnLabelId} for order ${orderId}`,
    );

    return returnLabel;
  }

  /**
   * Extract pincode from address string
   */
  private extractPincode(address: string | null | undefined): string {
    if (!address) return '';
    const match = address.match(/\d{6}/);
    return match ? match[0] : '';
  }

  /**
   * Generate unique label ID
   */
  private generateLabelId(orderId: string): string {
    const timestamp = Date.now().toString(36);
    return `LBL-${orderId.slice(0, 8)}-${timestamp}`.toUpperCase();
  }

  /**
   * Generate barcode string (Code 128)
   */
  private generateBarcode(identifier: string): string {
    // Return identifier formatted for Code 128 barcode
    return identifier.replace(/[^A-Z0-9-]/gi, '').toUpperCase();
  }

  /**
   * Generate QR code data
   */
  private generateQRCodeData(orderId: string, awbNumber?: string): string {
    const data = {
      o: orderId,
      a: awbNumber,
      t: Date.now(),
      p: 'QBZ', // Provider code
    };
    return JSON.stringify(data);
  }

  /**
   * Format address object to string
   */
  private formatAddress(address: Record<string, unknown>): string {
    const parts: string[] = [];

    if (address.building) parts.push(String(address.building));
    if (address.street) parts.push(String(address.street));
    if (address.locality) parts.push(String(address.locality));
    if (address.landmark) parts.push(`Near ${address.landmark}`);

    return parts.join(', ') || 'Address not available';
  }

  /**
   * Get package contents description
   */
  private getPackageContents(
    items: Array<{ name?: string; weight?: number }> | null,
  ): string {
    if (!items?.length) return 'General merchandise';

    return items
      .slice(0, 3)
      .map((item) => item.name || 'Item')
      .join(', ');
  }

  /**
   * Generate routing code based on pincode
   */
  private generateRoutingCode(pincode: string): string {
    if (!pincode) return '';

    // First 3 digits indicate region
    const region = pincode.slice(0, 3);
    return `R${region}`;
  }

  /**
   * Get zone code based on state
   */
  private getZoneCode(state: string): string {
    const zoneMapping: Record<string, string> = {
      // North Zone
      DELHI: 'N1',
      'UTTAR PRADESH': 'N2',
      HARYANA: 'N3',
      PUNJAB: 'N4',
      RAJASTHAN: 'N5',
      // South Zone
      KARNATAKA: 'S1',
      'TAMIL NADU': 'S2',
      KERALA: 'S3',
      'ANDHRA PRADESH': 'S4',
      TELANGANA: 'S5',
      // East Zone
      'WEST BENGAL': 'E1',
      ODISHA: 'E2',
      BIHAR: 'E3',
      JHARKHAND: 'E4',
      // West Zone
      MAHARASHTRA: 'W1',
      GUJARAT: 'W2',
      GOA: 'W3',
    };

    return zoneMapping[state.toUpperCase()] || 'XX';
  }

  /**
   * Store label details in fulfillment
   */
  private async storeLabelDetails(
    orderId: string,
    label: ShippingLabel,
  ): Promise<void> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      this.logger.warn(
        `No fulfillment found for order ${orderId} to store label`,
      );
      return;
    }

    const pickupAddress =
      (fulfillment.pickupAddress as Record<string, unknown>) || {};

    const updatedPickupAddress = {
      ...pickupAddress,
      _labelData: {
        labelId: label.labelId,
        orderId: label.orderId,
        awbNumber: label.awbNumber,
        barcode: label.barcode,
        qrCode: label.qrCode,
        labelUrl: label.labelUrl,
        labelFormat: label.labelFormat,
        labelSize: label.labelSize,
        generatedAt: label.generatedAt.toISOString(),
        status: label.status,
        printCount: label.printCount,
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
   * Store return label details
   */
  private async storeReturnLabelDetails(
    orderId: string,
    label: ShippingLabel,
  ): Promise<void> {
    const fulfillment = await this.prisma.ondcFulfillment.findFirst({
      where: { orderId },
    });

    if (!fulfillment) {
      return;
    }

    const pickupAddress =
      (fulfillment.pickupAddress as Record<string, unknown>) || {};

    const updatedPickupAddress = {
      ...pickupAddress,
      _returnLabelData: {
        labelId: label.labelId,
        orderId: label.orderId,
        awbNumber: label.awbNumber,
        barcode: label.barcode,
        qrCode: label.qrCode,
        labelUrl: label.labelUrl,
        labelFormat: label.labelFormat,
        labelSize: label.labelSize,
        generatedAt: label.generatedAt.toISOString(),
        status: label.status,
        printCount: label.printCount,
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
   * Build label tags for ONDC response
   */
  buildLabelTags(label: ShippingLabel): Array<{
    descriptor: { code: string };
    list: Array<{ descriptor: { code: string }; value: string }>;
  }> {
    if (!label.labelId) {
      return [];
    }

    return [
      {
        descriptor: { code: 'shipping_label' },
        list: [
          {
            descriptor: { code: 'label_id' },
            value: label.labelId,
          },
          {
            descriptor: { code: 'label_url' },
            value: label.labelUrl || '',
          },
          {
            descriptor: { code: 'barcode' },
            value: label.barcode,
          },
          {
            descriptor: { code: 'status' },
            value: label.status,
          },
        ],
      },
    ];
  }
}
