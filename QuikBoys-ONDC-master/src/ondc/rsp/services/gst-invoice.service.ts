// ============================================
// GST Invoice Generation Service
// File: src/ondc/rsp/services/gst-invoice.service.ts
// ONDC RSF 2.0 - B2B GST Compliant Invoice Generation
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service.js';
import PDFDocument from 'pdfkit';

/**
 * GST Invoice line item
 */
export interface GstInvoiceItem {
  description: string;
  hsnCode: string;
  quantity: number;
  unit: string;
  rate: number;
  taxableValue: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  totalAmount: number;
}

/**
 * GST Invoice data structure
 */
export interface GstInvoiceData {
  // Invoice details
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate?: Date;
  placeOfSupply: string;

  // Seller (QuikBoys)
  seller: {
    name: string;
    gstin: string;
    pan: string;
    address: string;
    city: string;
    state: string;
    stateCode: string;
    pincode: string;
    email?: string;
    phone?: string;
  };

  // Buyer (Driver/Network Participant)
  buyer: {
    name: string;
    gstin?: string;
    pan?: string;
    address?: string;
    city?: string;
    state?: string;
    stateCode?: string;
    pincode?: string;
    email?: string;
    phone?: string;
  };

  // Invoice items
  items: GstInvoiceItem[];

  // Totals
  subtotal: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalTax: number;
  grandTotal: number;
  amountInWords: string;

  // Settlement reference
  settlementId?: string;
  settlementBatchId?: string;
  orderIds?: string[];

  // Additional info
  notes?: string;
  terms?: string;
}

export interface GeneratedInvoice {
  invoiceNumber: string;
  invoiceData: GstInvoiceData;
  pdfBuffer: Buffer;
  generatedAt: Date;
}

/**
 * GstInvoiceService - ONDC RSF 2.0 GST Invoice Generator
 *
 * Handles:
 * 1. GST compliant invoice generation for settlements
 * 2. Commission invoices with proper HSN codes
 * 3. PDF invoice generation
 * 4. Invoice number sequence management
 */
@Injectable()
export class GstInvoiceService {
  private readonly logger = new Logger(GstInvoiceService.name);

  // Company details (QuikBoys)
  private readonly companyDetails: GstInvoiceData['seller'];

  // HSN Codes for logistics services
  private readonly HSN_CODES = {
    DELIVERY_SERVICE: '996812', // Courier services
    PLATFORM_FEE: '998314', // Information technology design and development services
    COMMISSION: '997212', // Commission on transactions
  };

  // GST Rates
  private readonly GST_RATES = {
    STANDARD: 18, // 18% GST on services
    REDUCED: 12, // 12% for certain services
    NIL: 0, // Exempt services
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    // Initialize company details from config
    this.companyDetails = {
      name: this.configService.get<string>(
        'COMPANY_NAME',
        'QuikBoys Logistics Pvt Ltd',
      ),
      gstin: this.configService.get<string>('COMPANY_GSTIN', '29AABCQ1234A1ZZ'),
      pan: this.configService.get<string>('COMPANY_PAN', 'AABCQ1234A'),
      address: this.configService.get<string>(
        'COMPANY_ADDRESS',
        '123, Tech Park',
      ),
      city: this.configService.get<string>('COMPANY_CITY', 'Bengaluru'),
      state: this.configService.get<string>('COMPANY_STATE', 'Karnataka'),
      stateCode: this.configService.get<string>('COMPANY_STATE_CODE', '29'),
      pincode: this.configService.get<string>('COMPANY_PINCODE', '560001'),
      email: this.configService.get<string>(
        'COMPANY_EMAIL',
        'billing@quikboys.com',
      ),
      phone: this.configService.get<string>('COMPANY_PHONE', '+91-80-12345678'),
    };
  }

  /**
   * Generate GST invoice for settlement payout
   */
  async generateSettlementInvoice(
    settlementBatchId: string,
    driverId: string,
  ): Promise<GeneratedInvoice> {
    this.logger.log(
      `Generating GST invoice for settlement: ${settlementBatchId}, driver: ${driverId}`,
    );

    // Get settlement batch details
    const batch = await this.prisma.settlementBatch.findUnique({
      where: { id: settlementBatchId },
      include: {
        reconciliationRecords: true,
      },
    });

    if (!batch) {
      throw new Error(`Settlement batch not found: ${settlementBatchId}`);
    }

    // Get driver details (profile fields are directly on User model)
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      include: {
        bankDetails: true,
      },
    });

    if (!driver) {
      throw new Error(`Driver not found: ${driverId}`);
    }

    // Generate invoice number
    const invoiceNumber = await this.generateInvoiceNumber();

    // Calculate invoice items
    const items = this.calculateInvoiceItems(
      batch,
      batch.reconciliationRecords,
    );

    // Build invoice data
    const invoiceData = this.buildInvoiceData(
      invoiceNumber,
      driver,
      items,
      batch,
    );

    // Generate PDF
    const pdfBuffer = await this.generatePdf(invoiceData);

    // Store invoice record
    await this.storeInvoiceRecord(invoiceData, driverId, settlementBatchId);

    this.logger.log(`Invoice generated: ${invoiceNumber}`);

    return {
      invoiceNumber,
      invoiceData,
      pdfBuffer,
      generatedAt: new Date(),
    };
  }

  /**
   * Generate commission invoice for platform fees
   */
  async generateCommissionInvoice(
    driverId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<GeneratedInvoice> {
    this.logger.log(`Generating commission invoice for driver: ${driverId}`);

    // Get driver details (profile fields are directly on User model)
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
    });

    if (!driver) {
      throw new Error(`Driver not found: ${driverId}`);
    }

    // Get completed orders for the period
    const orders = await this.prisma.order.findMany({
      where: {
        driverId,
        status: 'DELIVERED',
        deliveredAt: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
    });

    if (orders.length === 0) {
      throw new Error('No completed orders found for the period');
    }

    // Generate invoice number
    const invoiceNumber = await this.generateInvoiceNumber('COMM');

    // Calculate commission items
    const items = this.calculateCommissionItems(orders);

    // Build invoice data (profile fields are directly on User)
    const invoiceData: GstInvoiceData = {
      invoiceNumber,
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days
      placeOfSupply: driver.city || this.companyDetails.state,
      seller: this.companyDetails,
      buyer: {
        name:
          driver.name ||
          `${driver.firstName || ''} ${driver.lastName || ''}`.trim(),
        gstin: undefined, // GSTIN not on User model
        pan: undefined, // PAN not on User model
        address: driver.address || undefined,
        city: driver.city || undefined,
        state: driver.city || undefined, // Using city as proxy for state
        stateCode: this.getStateCode(driver.city || undefined),
        pincode: undefined, // Pincode not on User model
        email: driver.email || undefined,
        phone: driver.phone,
      },
      items,
      subtotal: items.reduce<number>((sum, item) => sum + item.taxableValue, 0),
      totalCgst: items.reduce<number>((sum, item) => sum + item.cgstAmount, 0),
      totalSgst: items.reduce<number>((sum, item) => sum + item.sgstAmount, 0),
      totalIgst: items.reduce<number>((sum, item) => sum + item.igstAmount, 0),
      totalTax: 0,
      grandTotal: 0,
      amountInWords: '',
      orderIds: orders.map((o) => o.id),
      notes: `Commission invoice for deliveries from ${periodStart.toDateString()} to ${periodEnd.toDateString()}`,
    };

    // Calculate totals
    invoiceData.totalTax =
      invoiceData.totalCgst + invoiceData.totalSgst + invoiceData.totalIgst;
    invoiceData.grandTotal = invoiceData.subtotal + invoiceData.totalTax;
    invoiceData.amountInWords = this.numberToWords(invoiceData.grandTotal);

    // Generate PDF
    const pdfBuffer = await this.generatePdf(invoiceData);

    // Store invoice record
    await this.storeInvoiceRecord(invoiceData, driverId);

    return {
      invoiceNumber,
      invoiceData,
      pdfBuffer,
      generatedAt: new Date(),
    };
  }

  /**
   * Generate unique invoice number
   */
  private async generateInvoiceNumber(prefix: string = 'INV'): Promise<string> {
    const financialYear = this.getFinancialYear();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    // Get sequence number for today
    const count = await this.prisma.gstInvoice.count({
      where: {
        invoiceNumber: {
          startsWith: `${prefix}/${financialYear}/${dateStr}`,
        },
      },
    });

    const sequence = (count + 1).toString().padStart(4, '0');
    return `${prefix}/${financialYear}/${dateStr}/${sequence}`;
  }

  /**
   * Get current financial year in YY-YY format
   */
  private getFinancialYear(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // Financial year starts from April
    if (month >= 3) {
      return `${year.toString().slice(2)}-${(year + 1).toString().slice(2)}`;
    }
    return `${(year - 1).toString().slice(2)}-${year.toString().slice(2)}`;
  }

  /**
   * Calculate invoice items from settlement batch
   */
  private calculateInvoiceItems(
    _batch: unknown,
    reconRecords: unknown[],
  ): GstInvoiceItem[] {
    const items: GstInvoiceItem[] = [];

    // Aggregate by type
    let totalDeliveryAmount = 0;
    let totalCommission = 0;

    for (const record of reconRecords) {
      const reconRecord = record as Record<string, unknown>;
      totalDeliveryAmount += Number(reconRecord.ondcNetAmount || 0);
      totalCommission += Number(reconRecord.ondcCommission || 0);
    }

    // Delivery services item
    if (totalDeliveryAmount > 0) {
      const gstRate = this.GST_RATES.STANDARD;
      const taxableValue = totalDeliveryAmount;
      const cgstRate = gstRate / 2;
      const sgstRate = gstRate / 2;

      items.push({
        description: 'Delivery Services - ONDC Settlement',
        hsnCode: this.HSN_CODES.DELIVERY_SERVICE,
        quantity: reconRecords.length,
        unit: 'Nos',
        rate: taxableValue / reconRecords.length,
        taxableValue,
        cgstRate,
        cgstAmount: (taxableValue * cgstRate) / 100,
        sgstRate,
        sgstAmount: (taxableValue * sgstRate) / 100,
        igstRate: 0,
        igstAmount: 0,
        totalAmount: taxableValue + (taxableValue * gstRate) / 100,
      });
    }

    // Platform fee/commission item (if applicable)
    if (totalCommission > 0) {
      const gstRate = this.GST_RATES.STANDARD;
      const cgstRate = gstRate / 2;
      const sgstRate = gstRate / 2;

      items.push({
        description: 'Platform Service Fee',
        hsnCode: this.HSN_CODES.PLATFORM_FEE,
        quantity: 1,
        unit: 'Nos',
        rate: totalCommission,
        taxableValue: totalCommission,
        cgstRate,
        cgstAmount: (totalCommission * cgstRate) / 100,
        sgstRate,
        sgstAmount: (totalCommission * sgstRate) / 100,
        igstRate: 0,
        igstAmount: 0,
        totalAmount: totalCommission + (totalCommission * gstRate) / 100,
      });
    }

    return items;
  }

  /**
   * Calculate commission items from orders
   */
  private calculateCommissionItems(orders: unknown[]): GstInvoiceItem[] {
    const totalCommission = orders.reduce<number>(
      (sum, order) =>
        sum + (Number((order as Record<string, unknown>).platformFee) || 0),
      0,
    );

    const gstRate = this.GST_RATES.STANDARD;
    const cgstRate = gstRate / 2;
    const sgstRate = gstRate / 2;

    return [
      {
        description: 'Platform Commission - Delivery Services',
        hsnCode: this.HSN_CODES.COMMISSION,
        quantity: orders.length,
        unit: 'Nos',
        rate: totalCommission / orders.length,
        taxableValue: totalCommission,
        cgstRate,
        cgstAmount: (totalCommission * cgstRate) / 100,
        sgstRate,
        sgstAmount: (totalCommission * sgstRate) / 100,
        igstRate: 0,
        igstAmount: 0,
        totalAmount: totalCommission + (totalCommission * gstRate) / 100,
      },
    ];
  }

  /**
   * Build complete invoice data
   */
  private buildInvoiceData(
    invoiceNumber: string,
    driver: Record<string, unknown>,
    items: GstInvoiceItem[],
    batch: Record<string, unknown>,
  ): GstInvoiceData {
    // Profile fields are directly on User model
    const buyerState = (driver.city as string) || this.companyDetails.state;
    const isInterState = buyerState !== this.companyDetails.state;

    // Adjust GST for inter-state transactions
    if (isInterState) {
      for (const item of items) {
        item.igstRate = item.cgstRate + item.sgstRate;
        item.igstAmount = item.cgstAmount + item.sgstAmount;
        item.cgstRate = 0;
        item.cgstAmount = 0;
        item.sgstRate = 0;
        item.sgstAmount = 0;
      }
    }

    const subtotal = items.reduce<number>(
      (sum, item) => sum + item.taxableValue,
      0,
    );
    const totalCgst = items.reduce<number>(
      (sum, item) => sum + item.cgstAmount,
      0,
    );
    const totalSgst = items.reduce<number>(
      (sum, item) => sum + item.sgstAmount,
      0,
    );
    const totalIgst = items.reduce<number>(
      (sum, item) => sum + item.igstAmount,
      0,
    );
    const totalTax = totalCgst + totalSgst + totalIgst;
    const grandTotal = subtotal + totalTax;

    return {
      invoiceNumber,
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      placeOfSupply: buyerState,
      seller: this.companyDetails,
      buyer: {
        name:
          (driver.name as string) ||
          `${(driver.firstName as string) || ''} ${(driver.lastName as string) || ''}`.trim(),
        gstin: undefined, // GSTIN not on User model
        pan: undefined, // PAN not on User model
        address: (driver.address as string) || undefined,
        city: (driver.city as string) || undefined,
        state: buyerState,
        stateCode: this.getStateCode(buyerState),
        pincode: undefined, // Pincode not on User model
        email: (driver.email as string) || undefined,
        phone: driver.phone as string,
      },
      items,
      subtotal,
      totalCgst,
      totalSgst,
      totalIgst,
      totalTax,
      grandTotal,
      amountInWords: this.numberToWords(grandTotal),
      settlementBatchId: batch.id as string,
      orderIds: (
        batch.reconciliationRecords as Array<Record<string, unknown>>
      )?.map((r) => r.ondcOrderId as string),
      notes: `Settlement for period: ${(batch.periodStart as Date)?.toDateString()} - ${(batch.periodEnd as Date)?.toDateString()}`,
      terms:
        'Payment terms as per agreement. All disputes subject to Bengaluru jurisdiction.',
    };
  }

  /**
   * Generate PDF invoice
   */
  private async generatePdf(invoiceData: GstInvoiceData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header
        doc.fontSize(20).text('TAX INVOICE', { align: 'center' });
        doc.moveDown();

        // Invoice details
        doc.fontSize(10);
        doc.text(`Invoice Number: ${invoiceData.invoiceNumber}`);
        doc.text(`Invoice Date: ${invoiceData.invoiceDate.toDateString()}`);
        if (invoiceData.dueDate) {
          doc.text(`Due Date: ${invoiceData.dueDate.toDateString()}`);
        }
        doc.text(`Place of Supply: ${invoiceData.placeOfSupply}`);
        doc.moveDown();

        // Seller details
        doc.fontSize(12).text('From:', { underline: true });
        doc.fontSize(10);
        doc.text(invoiceData.seller.name);
        doc.text(`GSTIN: ${invoiceData.seller.gstin}`);
        doc.text(`PAN: ${invoiceData.seller.pan}`);
        doc.text(`${invoiceData.seller.address}`);
        doc.text(
          `${invoiceData.seller.city}, ${invoiceData.seller.state} - ${invoiceData.seller.pincode}`,
        );
        doc.moveDown();

        // Buyer details
        doc.fontSize(12).text('To:', { underline: true });
        doc.fontSize(10);
        doc.text(invoiceData.buyer.name);
        if (invoiceData.buyer.gstin)
          doc.text(`GSTIN: ${invoiceData.buyer.gstin}`);
        if (invoiceData.buyer.pan) doc.text(`PAN: ${invoiceData.buyer.pan}`);
        if (invoiceData.buyer.address) doc.text(invoiceData.buyer.address);
        if (invoiceData.buyer.city) {
          doc.text(
            `${invoiceData.buyer.city}, ${invoiceData.buyer.state || ''} - ${invoiceData.buyer.pincode || ''}`,
          );
        }
        doc.moveDown();

        // Items table header
        doc.fontSize(10);
        const tableTop = doc.y;
        doc.text('Description', 50, tableTop, { width: 150 });
        doc.text('HSN', 200, tableTop, { width: 50 });
        doc.text('Qty', 250, tableTop, { width: 30 });
        doc.text('Rate', 280, tableTop, { width: 60 });
        doc.text('Taxable', 340, tableTop, { width: 60 });
        doc.text('GST', 400, tableTop, { width: 50 });
        doc.text('Total', 450, tableTop, { width: 60 });

        doc
          .moveTo(50, tableTop + 15)
          .lineTo(520, tableTop + 15)
          .stroke();

        // Items
        let y = tableTop + 20;
        for (const item of invoiceData.items) {
          doc.text(item.description.substring(0, 25), 50, y, { width: 150 });
          doc.text(item.hsnCode, 200, y, { width: 50 });
          doc.text(item.quantity.toString(), 250, y, { width: 30 });
          doc.text(`₹${item.rate.toFixed(2)}`, 280, y, { width: 60 });
          doc.text(`₹${item.taxableValue.toFixed(2)}`, 340, y, { width: 60 });
          const gst = item.cgstAmount + item.sgstAmount + item.igstAmount;
          doc.text(`₹${gst.toFixed(2)}`, 400, y, { width: 50 });
          doc.text(`₹${item.totalAmount.toFixed(2)}`, 450, y, { width: 60 });
          y += 20;
        }

        doc.moveTo(50, y).lineTo(520, y).stroke();
        y += 10;

        // Totals
        doc.text(`Subtotal: ₹${invoiceData.subtotal.toFixed(2)}`, 350, y);
        y += 15;
        if (invoiceData.totalCgst > 0) {
          doc.text(`CGST: ₹${invoiceData.totalCgst.toFixed(2)}`, 350, y);
          y += 15;
        }
        if (invoiceData.totalSgst > 0) {
          doc.text(`SGST: ₹${invoiceData.totalSgst.toFixed(2)}`, 350, y);
          y += 15;
        }
        if (invoiceData.totalIgst > 0) {
          doc.text(`IGST: ₹${invoiceData.totalIgst.toFixed(2)}`, 350, y);
          y += 15;
        }
        doc
          .fontSize(12)
          .text(`Grand Total: ₹${invoiceData.grandTotal.toFixed(2)}`, 350, y);
        y += 20;

        // Amount in words
        doc
          .fontSize(10)
          .text(`Amount in Words: ${invoiceData.amountInWords}`, 50, y);
        y += 30;

        // Notes
        if (invoiceData.notes) {
          doc.text(`Notes: ${invoiceData.notes}`, 50, y);
          y += 20;
        }

        // Terms
        if (invoiceData.terms) {
          doc.text(`Terms: ${invoiceData.terms}`, 50, y);
        }

        // Footer
        doc
          .fontSize(8)
          .text(
            'This is a computer generated invoice and does not require signature.',
            50,
            750,
            { align: 'center' },
          );

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Store invoice record in database
   */
  private async storeInvoiceRecord(
    invoiceData: GstInvoiceData,
    driverId: string,
    settlementBatchId?: string,
  ): Promise<void> {
    await this.prisma.gstInvoice.create({
      data: {
        invoiceNumber: invoiceData.invoiceNumber,
        invoiceDate: invoiceData.invoiceDate,
        dueDate: invoiceData.dueDate,
        driverId,
        settlementBatchId,
        sellerGstin: invoiceData.seller.gstin,
        buyerGstin: invoiceData.buyer.gstin || null,
        subtotal: invoiceData.subtotal,
        cgstAmount: invoiceData.totalCgst,
        sgstAmount: invoiceData.totalSgst,
        igstAmount: invoiceData.totalIgst,
        totalTax: invoiceData.totalTax,
        grandTotal: invoiceData.grandTotal,
        placeOfSupply: invoiceData.placeOfSupply,
        status: 'GENERATED',
        metadata: JSON.parse(
          JSON.stringify({
            items: invoiceData.items,
            orderIds: invoiceData.orderIds,
            amountInWords: invoiceData.amountInWords,
          }),
        ),
      },
    });
  }

  /**
   * Get state code for GST
   */
  private getStateCode(state?: string): string {
    if (!state) return '29'; // Default Karnataka

    const stateCodes: Record<string, string> = {
      'Andhra Pradesh': '37',
      'Arunachal Pradesh': '12',
      Assam: '18',
      Bihar: '10',
      Chhattisgarh: '22',
      Delhi: '07',
      Goa: '30',
      Gujarat: '24',
      Haryana: '06',
      'Himachal Pradesh': '02',
      Jharkhand: '20',
      Karnataka: '29',
      Kerala: '32',
      'Madhya Pradesh': '23',
      Maharashtra: '27',
      Manipur: '14',
      Meghalaya: '17',
      Mizoram: '15',
      Nagaland: '13',
      Odisha: '21',
      Punjab: '03',
      Rajasthan: '08',
      Sikkim: '11',
      'Tamil Nadu': '33',
      Telangana: '36',
      Tripura: '16',
      'Uttar Pradesh': '09',
      Uttarakhand: '05',
      'West Bengal': '19',
    };

    return stateCodes[state] || '29';
  }

  /**
   * Convert number to words (Indian format)
   */
  private numberToWords(num: number): string {
    if (num === 0) return 'Zero Rupees Only';

    const rupees = Math.floor(num);
    const paise = Math.round((num - rupees) * 100);

    let words = '';

    // Crores
    if (rupees >= 10000000) {
      words += this.convertChunk(Math.floor(rupees / 10000000)) + ' Crore ';
    }

    // Lakhs
    const lakhs = Math.floor((rupees % 10000000) / 100000);
    if (lakhs > 0) {
      words += this.convertChunk(lakhs) + ' Lakh ';
    }

    // Thousands
    const thousands = Math.floor((rupees % 100000) / 1000);
    if (thousands > 0) {
      words += this.convertChunk(thousands) + ' Thousand ';
    }

    // Hundreds
    const hundreds = rupees % 1000;
    if (hundreds > 0) {
      words += this.convertChunk(hundreds);
    }

    words += ' Rupees';

    if (paise > 0) {
      words += ' and ' + this.convertChunk(paise) + ' Paise';
    }

    words += ' Only';

    return words.replace(/\s+/g, ' ').trim();
  }

  /**
   * Convert a chunk (up to 999) to words
   */
  private convertChunk(_num: number): string {
    let num = _num;
    const ones = [
      '',
      'One',
      'Two',
      'Three',
      'Four',
      'Five',
      'Six',
      'Seven',
      'Eight',
      'Nine',
    ];
    const tens = [
      '',
      '',
      'Twenty',
      'Thirty',
      'Forty',
      'Fifty',
      'Sixty',
      'Seventy',
      'Eighty',
      'Ninety',
    ];
    const teens = [
      'Ten',
      'Eleven',
      'Twelve',
      'Thirteen',
      'Fourteen',
      'Fifteen',
      'Sixteen',
      'Seventeen',
      'Eighteen',
      'Nineteen',
    ];

    let words = '';

    if (num >= 100) {
      words += ones[Math.floor(num / 100)] + ' Hundred ';
      num %= 100;
    }

    if (num >= 20) {
      words += tens[Math.floor(num / 10)] + ' ';
      num %= 10;
    }

    if (num >= 10) {
      words += teens[num - 10] + ' ';
      num = 0;
    }

    if (num > 0) {
      words += ones[num] + ' ';
    }

    return words.trim();
  }
}
