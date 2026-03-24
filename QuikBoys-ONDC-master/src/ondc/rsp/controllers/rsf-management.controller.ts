// ============================================
// RSF Management Controller
// File: src/ondc/rsp/controllers/rsf-management.controller.ts
// ONDC RSF 2.0 Internal Management APIs
// ============================================

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../auth/guards/roles.guard.js';
import { Roles } from '../../../auth/decorators/roles.decorator.js';
import {
  NBBLIntegrationService,
  NBBLBankAccount,
} from '../services/nbbl-integration.service';
import { PayoutReconciliationService } from '../services/payout-reconciliation.service';
import { GstInvoiceService } from '../services/gst-invoice.service';
import { OnSettlementService } from '../services/on-settlement.service';

// DTOs
class RegisterBankAccountDto {
  userId: string;
  networkParticipantId: string;
  accountNumber: string;
  ifscCode: string;
  accountHolderName: string;
  bankName?: string;
  isPrimary?: boolean;
}

class GenerateReconFileDto {
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  networkParticipantId?: string;
  format?: 'xlsx' | 'csv';
}

class GenerateInvoiceDto {
  settlementBatchId: string;
  driverId: string;
}

class GenerateCommissionInvoiceDto {
  driverId: string;
  periodStart: string;
  periodEnd: string;
}

/**
 * RSF Management Controller - Internal APIs for RSF 2.0 Operations
 *
 * Provides admin/internal endpoints for:
 * - Bank account verification and registration
 * - Reconciliation file generation
 * - GST invoice generation
 * - Settlement status tracking
 */
@ApiTags('RSF 2.0 Management')
@Controller('admin/rsf')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth('JWT-auth')
export class RsfManagementController {
  private readonly logger = new Logger(RsfManagementController.name);

  constructor(
    private readonly nbblService: NBBLIntegrationService,
    private readonly payoutReconService: PayoutReconciliationService,
    private readonly gstInvoiceService: GstInvoiceService,
    private readonly onSettlementService: OnSettlementService,
  ) {}

  // ==========================================
  // Bank Account Management (NBBL Integration)
  // ==========================================

  @Post('bank-account/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify bank account via NBBL/NPCI' })
  @ApiResponse({ status: 200, description: 'Verification result' })
  async verifyBankAccount(
    @Body()
    dto: {
      accountNumber: string;
      ifscCode: string;
      accountHolderName: string;
    },
  ) {
    this.logger.log(`Verifying bank account: ${dto.ifscCode}`);

    const bankAccount: NBBLBankAccount = {
      accountNumber: dto.accountNumber,
      ifscCode: dto.ifscCode,
      accountHolderName: dto.accountHolderName,
    };

    const result = await this.nbblService.verifyBankAccount(bankAccount);

    return {
      success: result.valid,
      data: result,
    };
  }

  @Post('bank-account/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register settlement account for NBBL' })
  @ApiResponse({ status: 201, description: 'Settlement account registered' })
  async registerSettlementAccount(@Body() dto: RegisterBankAccountDto) {
    this.logger.log(`Registering settlement account for user: ${dto.userId}`);

    const bankAccount: NBBLBankAccount = {
      accountNumber: dto.accountNumber,
      ifscCode: dto.ifscCode,
      accountHolderName: dto.accountHolderName,
      bankName: dto.bankName,
    };

    const result = await this.nbblService.registerSettlementAccount(
      dto.userId,
      dto.networkParticipantId,
      bankAccount,
      dto.isPrimary ?? true,
    );

    return {
      success: true,
      message: 'Settlement account registered successfully',
      data: result,
    };
  }

  @Get('bank-account/:userId')
  @ApiOperation({ summary: 'Get settlement account details' })
  @ApiResponse({ status: 200, description: 'Settlement account details' })
  async getSettlementAccount(@Param('userId') userId: string) {
    const account = await this.nbblService.getSettlementAccount(userId);

    if (!account) {
      return {
        success: false,
        message: 'No settlement account found',
      };
    }

    return {
      success: true,
      data: account,
    };
  }

  @Get('bank/ifsc/:ifscCode')
  @ApiOperation({ summary: 'Get bank details by IFSC code' })
  @ApiResponse({ status: 200, description: 'Bank details' })
  async getBankByIFSC(@Param('ifscCode') ifscCode: string) {
    const bankInfo = await this.nbblService.getBankByIFSC(ifscCode);

    if (!bankInfo) {
      return {
        success: false,
        message: 'Invalid IFSC code',
      };
    }

    return {
      success: true,
      data: bankInfo,
    };
  }

  // ==========================================
  // Reconciliation File Generation
  // ==========================================

  @Post('reconciliation/generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate Annexure 2 reconciliation file' })
  @ApiResponse({ status: 200, description: 'File generated' })
  async generateReconciliationFile(
    @Body() dto: GenerateReconFileDto,
    @Res() res: Response,
  ) {
    this.logger.log(
      `Generating reconciliation file: ${dto.periodStart} to ${dto.periodEnd}`,
    );

    const result = await this.payoutReconService.generateReconciliationFile(
      new Date(dto.periodStart),
      new Date(dto.periodEnd),
      dto.networkParticipantId,
      dto.format || 'xlsx',
    );

    // Set headers for file download
    const contentType =
      dto.format === 'csv'
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.fileName}"`,
    );
    res.setHeader('X-Record-Count', result.recordCount.toString());
    res.setHeader('X-Total-Amount', result.totalAmount.toFixed(2));

    res.send(result.fileBuffer);
  }

  @Get('reconciliation/summary')
  @ApiOperation({ summary: 'Get reconciliation summary for period' })
  @ApiResponse({ status: 200, description: 'Reconciliation summary' })
  async getReconciliationSummary(
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
    @Query('networkParticipantId') networkParticipantId?: string,
  ) {
    const summary = await this.payoutReconService.getReconciliationSummary(
      new Date(periodStart),
      new Date(periodEnd),
      networkParticipantId,
    );

    return {
      success: true,
      data: summary,
    };
  }

  // ==========================================
  // GST Invoice Generation
  // ==========================================

  @Post('invoice/settlement')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate GST invoice for settlement' })
  @ApiResponse({ status: 201, description: 'Invoice generated' })
  async generateSettlementInvoice(
    @Body() dto: GenerateInvoiceDto,
    @Res() res: Response,
  ) {
    this.logger.log(
      `Generating settlement invoice for batch: ${dto.settlementBatchId}`,
    );

    const result = await this.gstInvoiceService.generateSettlementInvoice(
      dto.settlementBatchId,
      dto.driverId,
    );

    // Return PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Invoice_${result.invoiceNumber.replace(/\//g, '-')}.pdf"`,
    );
    res.setHeader('X-Invoice-Number', result.invoiceNumber);

    res.send(result.pdfBuffer);
  }

  @Post('invoice/commission')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate commission invoice for driver' })
  @ApiResponse({ status: 201, description: 'Commission invoice generated' })
  async generateCommissionInvoice(
    @Body() dto: GenerateCommissionInvoiceDto,
    @Res() res: Response,
  ) {
    this.logger.log(
      `Generating commission invoice for driver: ${dto.driverId}`,
    );

    const result = await this.gstInvoiceService.generateCommissionInvoice(
      dto.driverId,
      new Date(dto.periodStart),
      new Date(dto.periodEnd),
    );

    // Return PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Invoice_${result.invoiceNumber.replace(/\//g, '-')}.pdf"`,
    );
    res.setHeader('X-Invoice-Number', result.invoiceNumber);

    res.send(result.pdfBuffer);
  }

  // ==========================================
  // Settlement Status
  // ==========================================

  @Get('settlement/:settlementId/status')
  @ApiOperation({ summary: 'Get settlement status' })
  @ApiResponse({ status: 200, description: 'Settlement status' })
  async getSettlementStatus(@Param('settlementId') settlementId: string) {
    const status =
      await this.onSettlementService.getSettlementStatus(settlementId);

    if (!status) {
      return {
        success: false,
        message: 'Settlement not found',
      };
    }

    return {
      success: true,
      data: status,
    };
  }
}
