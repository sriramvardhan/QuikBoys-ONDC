/**
 * Payout DTOs
 * Data Transfer Objects for payment gateway integration
 * Supports NEFT, RTGS, IMPS, and UPI payouts
 */

import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsBoolean,
  Min,
  MaxLength,
  IsNotEmpty,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ============================================
// Enums
// ============================================

export enum PayoutMode {
  BANK_TRANSFER = 'banktransfer',
  IMPS = 'imps',
  NEFT = 'neft',
  RTGS = 'rtgs',
  UPI = 'upi',
}

export enum PayoutStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
  CANCELLED = 'CANCELLED',
}

export enum BeneficiaryType {
  DRIVER = 'DRIVER',
  VENDOR = 'VENDOR',
  MERCHANT = 'MERCHANT',
}

// ============================================
// Beneficiary DTOs
// ============================================

export class BeneficiaryBankDetailsDto {
  @ApiProperty({ description: 'Bank account number' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  accountNumber: string;

  @ApiProperty({ description: 'IFSC code of the bank branch' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'Invalid IFSC code format' })
  ifscCode: string;

  @ApiPropertyOptional({ description: 'Bank name' })
  @IsString()
  @IsOptional()
  bankName?: string;

  @ApiPropertyOptional({ description: 'Branch name' })
  @IsString()
  @IsOptional()
  branchName?: string;
}

export class BeneficiaryUpiDetailsDto {
  @ApiProperty({ description: 'UPI VPA (Virtual Payment Address)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[\w.-]+@[\w]+$/, { message: 'Invalid UPI VPA format' })
  vpa: string;
}

export class CreateBeneficiaryDto {
  @ApiProperty({ description: 'Unique beneficiary ID (driver/vendor ID)' })
  @IsString()
  @IsNotEmpty()
  beneficiaryId: string;

  @ApiProperty({ description: 'Beneficiary full name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Beneficiary phone number' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[6-9]\d{9}$/, { message: 'Invalid Indian phone number' })
  phone: string;

  @ApiPropertyOptional({ description: 'Beneficiary email' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'Bank account details' })
  @ValidateNested()
  @Type(() => BeneficiaryBankDetailsDto)
  @IsOptional()
  bankDetails?: BeneficiaryBankDetailsDto;

  @ApiPropertyOptional({ description: 'UPI details' })
  @ValidateNested()
  @Type(() => BeneficiaryUpiDetailsDto)
  @IsOptional()
  upiDetails?: BeneficiaryUpiDetailsDto;

  @ApiPropertyOptional({ description: 'Beneficiary address' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({
    description: 'Beneficiary type',
    enum: BeneficiaryType,
  })
  @IsEnum(BeneficiaryType)
  @IsOptional()
  type?: BeneficiaryType;
}

// ============================================
// Single Payout DTOs
// ============================================

export class InitiatePayoutDto {
  @ApiProperty({ description: 'Unique transfer ID for this payout' })
  @IsString()
  @IsNotEmpty()
  transferId: string;

  @ApiProperty({ description: 'Beneficiary ID to send payout to' })
  @IsString()
  @IsNotEmpty()
  beneficiaryId: string;

  @ApiProperty({ description: 'Amount to transfer in INR', minimum: 1 })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiProperty({ description: 'Transfer mode', enum: PayoutMode })
  @IsEnum(PayoutMode)
  transferMode: PayoutMode;

  @ApiPropertyOptional({ description: 'Remarks for the transfer' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  remarks?: string;

  @ApiPropertyOptional({ description: 'Settlement batch ID reference' })
  @IsString()
  @IsOptional()
  settlementBatchId?: string;

  @ApiPropertyOptional({ description: 'Internal reference ID' })
  @IsString()
  @IsOptional()
  internalRefId?: string;
}

export class PayoutResponseDto {
  @ApiProperty({ description: 'Whether payout was initiated successfully' })
  success: boolean;

  @ApiPropertyOptional({ description: 'Payment gateway reference ID' })
  referenceId?: string;

  @ApiPropertyOptional({ description: 'UTR (Unique Transaction Reference)' })
  utr?: string;

  @ApiProperty({ description: 'Payout status', enum: PayoutStatus })
  status: PayoutStatus;

  @ApiPropertyOptional({ description: 'Response message' })
  message?: string;

  @ApiPropertyOptional({ description: 'When the payout was processed' })
  processedAt?: Date;
}

// ============================================
// Batch Payout DTOs
// ============================================

export class BatchPayoutItemDto {
  @ApiProperty({ description: 'Unique transfer ID for this payout' })
  @IsString()
  @IsNotEmpty()
  transferId: string;

  @ApiProperty({ description: 'Beneficiary ID' })
  @IsString()
  @IsNotEmpty()
  beneficiaryId: string;

  @ApiProperty({ description: 'Amount to transfer', minimum: 1 })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiProperty({ description: 'Transfer mode', enum: PayoutMode })
  @IsEnum(PayoutMode)
  transferMode: PayoutMode;

  @ApiPropertyOptional({ description: 'Remarks' })
  @IsString()
  @IsOptional()
  remarks?: string;
}

export class InitiateBatchPayoutDto {
  @ApiProperty({ description: 'Unique batch ID' })
  @IsString()
  @IsNotEmpty()
  batchId: string;

  @ApiProperty({ description: 'Settlement batch ID reference' })
  @IsString()
  @IsNotEmpty()
  settlementBatchId: string;

  @ApiProperty({
    description: 'List of payouts in this batch',
    type: [BatchPayoutItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchPayoutItemDto)
  payouts: BatchPayoutItemDto[];
}

export class BatchPayoutResultDto {
  @ApiProperty({ description: 'Transfer ID' })
  transferId: string;

  @ApiProperty({ description: 'Whether this payout succeeded' })
  success: boolean;

  @ApiPropertyOptional({ description: 'Reference ID if successful' })
  referenceId?: string;

  @ApiProperty({ description: 'Status', enum: PayoutStatus })
  status: PayoutStatus;

  @ApiPropertyOptional({ description: 'Error message if failed' })
  errorMessage?: string;
}

export class BatchPayoutResponseDto {
  @ApiProperty({ description: 'Whether batch was processed' })
  success: boolean;

  @ApiProperty({ description: 'Batch ID' })
  batchId: string;

  @ApiProperty({ description: 'Total payouts in batch' })
  totalCount: number;

  @ApiProperty({ description: 'Successful payouts count' })
  successCount: number;

  @ApiProperty({ description: 'Failed payouts count' })
  failedCount: number;

  @ApiProperty({ description: 'Total amount processed' })
  totalAmount: number;

  @ApiProperty({
    description: 'Individual payout results',
    type: [BatchPayoutResultDto],
  })
  results: BatchPayoutResultDto[];
}

// ============================================
// Payout Status DTOs
// ============================================

export class GetPayoutStatusDto {
  @ApiProperty({ description: 'Transfer ID to check status for' })
  @IsString()
  @IsNotEmpty()
  transferId: string;

  @ApiPropertyOptional({ description: 'Reference ID from payment gateway' })
  @IsString()
  @IsOptional()
  referenceId?: string;
}

export class PayoutStatusResponseDto {
  @ApiProperty({ description: 'Transfer ID' })
  transferId: string;

  @ApiPropertyOptional({ description: 'Reference ID' })
  referenceId?: string;

  @ApiPropertyOptional({ description: 'UTR' })
  utr?: string;

  @ApiProperty({ description: 'Current status', enum: PayoutStatus })
  status: PayoutStatus;

  @ApiPropertyOptional({ description: 'Status description' })
  statusDescription?: string;

  @ApiProperty({ description: 'Payout amount' })
  amount: number;

  @ApiPropertyOptional({ description: 'When processed' })
  processedAt?: Date;

  @ApiPropertyOptional({ description: 'Failure reason if failed' })
  failureReason?: string;
}

// ============================================
// Webhook DTOs
// ============================================

export class PayoutWebhookDto {
  @ApiProperty({ description: 'Event type' })
  @IsString()
  event: string;

  @ApiProperty({ description: 'Transfer ID' })
  @IsString()
  transferId: string;

  @ApiPropertyOptional({ description: 'Reference ID' })
  @IsString()
  @IsOptional()
  referenceId?: string;

  @ApiPropertyOptional({ description: 'UTR' })
  @IsString()
  @IsOptional()
  utr?: string;

  @ApiProperty({ description: 'Payout status', enum: PayoutStatus })
  @IsEnum(PayoutStatus)
  status: PayoutStatus;

  @ApiProperty({ description: 'Amount' })
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({ description: 'Timestamp' })
  @IsOptional()
  timestamp?: Date;

  @ApiPropertyOptional({ description: 'Failure reason' })
  @IsString()
  @IsOptional()
  failureReason?: string;
}

// ============================================
// Settlement Payout DTOs
// ============================================

export class SettlementPayoutRequestDto {
  @ApiProperty({ description: 'Settlement batch ID' })
  @IsString()
  @IsNotEmpty()
  settlementBatchId: string;

  @ApiPropertyOptional({
    description: 'Force payout even if already processed',
  })
  @IsBoolean()
  @IsOptional()
  force?: boolean;

  @ApiPropertyOptional({
    description: 'Preferred transfer mode',
    enum: PayoutMode,
  })
  @IsEnum(PayoutMode)
  @IsOptional()
  preferredMode?: PayoutMode;
}

export class SettlementPayoutResponseDto {
  @ApiProperty({ description: 'Settlement batch ID' })
  settlementBatchId: string;

  @ApiProperty({ description: 'Whether payouts were initiated' })
  success: boolean;

  @ApiProperty({ description: 'Total amount to be paid out' })
  totalAmount: number;

  @ApiProperty({ description: 'Number of beneficiaries' })
  beneficiaryCount: number;

  @ApiProperty({ description: 'Batch payout ID' })
  batchPayoutId?: string;

  @ApiProperty({
    description: 'Individual payout results',
    type: [BatchPayoutResultDto],
  })
  results: BatchPayoutResultDto[];

  @ApiPropertyOptional({ description: 'Error message if failed' })
  errorMessage?: string;
}

// ============================================
// Balance & Health DTOs
// ============================================

export class PayoutBalanceDto {
  @ApiProperty({ description: 'Available balance for payouts' })
  available: number;

  @ApiProperty({ description: 'Currency code' })
  currency: string;

  @ApiPropertyOptional({ description: 'Last updated timestamp' })
  lastUpdated?: Date;
}

export class PayoutHealthDto {
  @ApiProperty({ description: 'Whether payout service is healthy' })
  isHealthy: boolean;

  @ApiProperty({ description: 'Service name' })
  service: string;

  @ApiPropertyOptional({ description: 'Available balance' })
  balance?: PayoutBalanceDto;

  @ApiPropertyOptional({ description: 'Error message if unhealthy' })
  error?: string;

  @ApiProperty({ description: 'Check timestamp' })
  checkedAt: Date;
}

// ============================================
// Driver Payout DTOs (specific use case)
// ============================================

export class DriverPayoutSettingsDto {
  @ApiProperty({ description: 'Driver ID' })
  @IsString()
  @IsNotEmpty()
  driverId: string;

  @ApiProperty({ description: 'Preferred payout mode', enum: PayoutMode })
  @IsEnum(PayoutMode)
  preferredMode: PayoutMode;

  @ApiPropertyOptional({ description: 'Minimum payout threshold' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  minimumThreshold?: number;

  @ApiPropertyOptional({ description: 'Auto-payout enabled' })
  @IsBoolean()
  @IsOptional()
  autoPayoutEnabled?: boolean;
}

export class DriverPayoutHistoryDto {
  @ApiProperty({ description: 'Payout ID' })
  payoutId: string;

  @ApiProperty({ description: 'Amount' })
  amount: number;

  @ApiProperty({ description: 'Status', enum: PayoutStatus })
  status: PayoutStatus;

  @ApiProperty({ description: 'Transfer mode', enum: PayoutMode })
  transferMode: PayoutMode;

  @ApiPropertyOptional({ description: 'UTR' })
  utr?: string;

  @ApiProperty({ description: 'Initiated at' })
  initiatedAt: Date;

  @ApiPropertyOptional({ description: 'Completed at' })
  completedAt?: Date;

  @ApiPropertyOptional({ description: 'Failure reason' })
  failureReason?: string;
}
