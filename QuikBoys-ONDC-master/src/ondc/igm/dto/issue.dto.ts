import {
  IsString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  IssueStatus,
  IssueCategory,
  IssueSubCategory,
  ResolutionType,
} from '../constants/igm-actions';

/**
 * Context DTO for IGM requests
 */
export class IgmContextDto {
  @IsString()
  @IsNotEmpty()
  domain: string;

  @IsString()
  @IsNotEmpty()
  action: string;

  @IsString()
  @IsNotEmpty()
  core_version: string;

  @IsString()
  @IsNotEmpty()
  bap_id: string;

  @IsString()
  @IsNotEmpty()
  bap_uri: string;

  @IsString()
  @IsOptional()
  bpp_id?: string;

  @IsString()
  @IsOptional()
  bpp_uri?: string;

  @IsString()
  @IsNotEmpty()
  transaction_id: string;

  @IsString()
  @IsNotEmpty()
  message_id: string;

  @IsString()
  @IsNotEmpty()
  timestamp: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  ttl?: string;
}

/**
 * Person DTO
 */
export class PersonDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

/**
 * Contact DTO
 */
export class ContactDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsOptional()
  email?: string;
}

/**
 * Complainant DTO
 */
export class ComplainantDto {
  @IsObject()
  @ValidateNested()
  @Type(() => PersonDto)
  person: PersonDto;

  @IsObject()
  @ValidateNested()
  @Type(() => ContactDto)
  contact: ContactDto;
}

/**
 * Provider DTO
 */
export class ProviderDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsOptional()
  name?: string;
}

/**
 * Item DTO
 */
export class ItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsNumber()
  @IsOptional()
  quantity?: number;
}

/**
 * Fulfillment DTO
 */
export class FulfillmentDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsOptional()
  state?: string;
}

/**
 * Order Details DTO
 */
export class OrderDetailsDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderDto)
  provider?: ProviderDto;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items?: ItemDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => FulfillmentDto)
  fulfillments?: FulfillmentDto[];

  @IsString()
  @IsOptional()
  created_at?: string;
}

/**
 * Additional Description DTO
 */
export class AdditionalDescDto {
  @IsString()
  @IsOptional()
  url?: string;

  @IsString()
  @IsOptional()
  content_type?: string;
}

/**
 * Issue Description DTO
 */
export class IssueDescriptionDto {
  @IsString()
  @IsNotEmpty()
  short_desc: string;

  @IsString()
  @IsOptional()
  long_desc?: string;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => AdditionalDescDto)
  additional_desc?: AdditionalDescDto;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  images?: string[];
}

/**
 * Issue Source DTO
 */
export class IssueSourceDto {
  @IsString()
  @IsNotEmpty()
  network_participant_id: string;

  @IsEnum(['CONSUMER', 'SELLER', 'INTERFACING-NP'])
  type: 'CONSUMER' | 'SELLER' | 'INTERFACING-NP';
}

/**
 * Expected Time DTO
 */
export class ExpectedTimeDto {
  @IsString()
  @IsNotEmpty()
  duration: string;
}

/**
 * Organization DTO
 */
export class OrganizationDto {
  @IsObject()
  @ValidateNested()
  @Type(() => PersonDto)
  org: PersonDto;

  @IsObject()
  @ValidateNested()
  @Type(() => ContactDto)
  contact: ContactDto;

  @IsObject()
  @ValidateNested()
  @Type(() => PersonDto)
  person: PersonDto;
}

/**
 * Respondent Action DTO
 */
export class RespondentActionDto {
  @IsString()
  @IsNotEmpty()
  respondent_action: string;

  @IsString()
  @IsNotEmpty()
  short_desc: string;

  @IsString()
  @IsNotEmpty()
  updated_at: string;

  @IsObject()
  @ValidateNested()
  @Type(() => OrganizationDto)
  updated_by: OrganizationDto;

  @IsNumber()
  @IsOptional()
  cascaded_level?: number;
}

/**
 * Resolution DTO
 */
export class ResolutionDto {
  @IsString()
  @IsNotEmpty()
  short_desc: string;

  @IsString()
  @IsOptional()
  long_desc?: string;

  @IsEnum(ResolutionType)
  action_triggered: ResolutionType;

  @IsString()
  @IsOptional()
  refund_amount?: string;
}

/**
 * Issue Actions DTO
 */
export class IssueActionsDto {
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RespondentActionDto)
  complainant_actions?: RespondentActionDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RespondentActionDto)
  respondent_actions?: RespondentActionDto[];
}

/**
 * Issue DTO - Core issue data structure
 */
export class IssueDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsEnum(IssueCategory)
  category: IssueCategory;

  @IsEnum(IssueSubCategory)
  sub_category: IssueSubCategory;

  @IsObject()
  @ValidateNested()
  @Type(() => ComplainantDto)
  complainant_info: ComplainantDto;

  @IsObject()
  @ValidateNested()
  @Type(() => OrderDetailsDto)
  order_details: OrderDetailsDto;

  @IsObject()
  @ValidateNested()
  @Type(() => IssueDescriptionDto)
  description: IssueDescriptionDto;

  @IsObject()
  @ValidateNested()
  @Type(() => IssueSourceDto)
  source: IssueSourceDto;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => ExpectedTimeDto)
  expected_response_time?: ExpectedTimeDto;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => ExpectedTimeDto)
  expected_resolution_time?: ExpectedTimeDto;

  @IsEnum(IssueStatus)
  status: IssueStatus;

  @IsEnum(['ISSUE', 'GRIEVANCE'])
  issue_type: 'ISSUE' | 'GRIEVANCE';

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => IssueActionsDto)
  issue_actions?: IssueActionsDto;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => ResolutionDto)
  resolution?: ResolutionDto;

  @IsObject()
  @IsOptional()
  resolution_provider?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  rating?: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  created_at: string;

  @IsString()
  @IsNotEmpty()
  updated_at: string;
}

/**
 * Issue Message DTO - for /issue request
 */
export class IssueMessageDto {
  @IsObject()
  @ValidateNested()
  @Type(() => IssueDto)
  issue: IssueDto;
}

/**
 * Issue Status Message DTO - for /issue_status request
 */
export class IssueStatusMessageDto {
  @IsString()
  @IsNotEmpty()
  issue_id: string;
}

/**
 * Create Issue Request DTO
 */
export class CreateIssueRequestDto {
  @IsObject()
  @ValidateNested()
  @Type(() => IgmContextDto)
  context: IgmContextDto;

  @IsObject()
  @ValidateNested()
  @Type(() => IssueMessageDto)
  message: IssueMessageDto;
}

/**
 * Issue Status Request DTO
 */
export class IssueStatusRequestDto {
  @IsObject()
  @ValidateNested()
  @Type(() => IgmContextDto)
  context: IgmContextDto;

  @IsObject()
  @ValidateNested()
  @Type(() => IssueStatusMessageDto)
  message: IssueStatusMessageDto;
}

/**
 * Update Issue Status DTO - for internal use
 */
export class UpdateIssueStatusDto {
  @IsString()
  @IsNotEmpty()
  issueId: string;

  @IsEnum(IssueStatus)
  status: IssueStatus;

  @IsString()
  @IsOptional()
  shortDesc?: string;

  @IsString()
  @IsOptional()
  respondentAction?: string;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => ResolutionDto)
  resolution?: ResolutionDto;
}
