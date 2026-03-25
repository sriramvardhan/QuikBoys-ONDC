import { BecknContext } from '../../interfaces/beckn-context.interface';
import {
  IssueStatus,
  IssueCategory,
  IssueSubCategory,
  RespondentType,
  ResolutionType,
  ResolutionStatus,
  IssueRating,
} from '../constants/igm-actions';

/**
 * IGM Issue Context - extends Beckn context for IGM
 */
export interface IgmContext extends BecknContext {
  domain: string;
  action: string;
  core_version: string;
  bap_id: string;
  bap_uri: string;
  bpp_id?: string;
  bpp_uri?: string;
  transaction_id: string;
  message_id: string;
  timestamp: string;
  ttl?: string;
}

/**
 * Complainant Information
 */
export interface Complainant {
  person: {
    name: string;
  };
  contact: {
    phone: string;
    email?: string;
  };
}

/**
 * Issue Order Details
 */
export interface IssueOrder {
  id: string;
  provider?: {
    id: string;
    name?: string;
  };
  items?: Array<{
    id: string;
    quantity?: number;
  }>;
  fulfillments?: Array<{
    id: string;
    state?: string;
  }>;
  created_at?: string;
}

/**
 * Issue Description
 */
export interface IssueDescription {
  short_desc: string;
  long_desc?: string;
  additional_desc?: {
    url?: string;
    content_type?: string;
  };
  images?: string[];
}

/**
 * Issue Source
 */
export interface IssueSource {
  network_participant_id: string;
  type: 'CONSUMER' | 'SELLER' | 'INTERFACING-NP';
}

/**
 * Expected Response Time
 */
export interface ExpectedResponseTime {
  duration: string; // ISO 8601 duration format (e.g., "PT1H" for 1 hour)
}

/**
 * Expected Resolution Time
 */
export interface ExpectedResolutionTime {
  duration: string; // ISO 8601 duration format
}

/**
 * Respondent Actions
 */
export interface RespondentAction {
  respondent_action: string;
  short_desc: string;
  updated_at: string;
  updated_by: {
    org: {
      name: string;
    };
    contact: {
      phone: string;
      email?: string;
    };
    person: {
      name: string;
    };
  };
  cascaded_level?: number;
}

/**
 * Resolution Details
 */
export interface Resolution {
  short_desc: string;
  long_desc?: string;
  action_triggered: ResolutionType;
  refund_amount?: string;
}

/**
 * Issue Rating
 */
export interface Rating {
  value: IssueRating;
  rating_category?: string;
}

/**
 * Issue Object - Core issue data structure
 */
export interface Issue {
  id: string;
  category: IssueCategory;
  sub_category: IssueSubCategory;
  complainant_info: Complainant;
  order_details: IssueOrder;
  description: IssueDescription;
  source: IssueSource;
  expected_response_time?: ExpectedResponseTime;
  expected_resolution_time?: ExpectedResolutionTime;
  status: IssueStatus;
  issue_type: 'ISSUE' | 'GRIEVANCE';
  issue_actions?: {
    complainant_actions?: RespondentAction[];
    respondent_actions?: RespondentAction[];
  };
  resolution?: Resolution;
  resolution_provider?: {
    respondent_info: {
      type: RespondentType;
      organization: {
        org: {
          name: string;
        };
        contact: {
          phone: string;
          email?: string;
        };
        person: {
          name: string;
        };
      };
      resolution_support: {
        chat_link?: string;
        contact: {
          phone: string;
          email?: string;
        };
        gros?: Array<{
          person: {
            name: string;
          };
          contact: {
            phone: string;
            email?: string;
          };
          gro_type: string;
        }>;
      };
    };
  };
  rating?: Rating;
  created_at: string;
  updated_at: string;
}

/**
 * Issue Message - for /issue request
 */
export interface IssueMessage {
  issue: Issue;
}

/**
 * On Issue Message - for /on_issue response
 */
export interface OnIssueMessage {
  issue: Issue;
}

/**
 * Issue Status Message - for /issue_status request
 */
export interface IssueStatusMessage {
  issue_id: string;
}

/**
 * On Issue Status Message - for /on_issue_status response
 */
export interface OnIssueStatusMessage {
  issue: Issue;
}

/**
 * IGM API Request Types
 */
export interface IssueRequest {
  context: IgmContext;
  message: IssueMessage;
}

export interface IssueStatusRequest {
  context: IgmContext;
  message: IssueStatusMessage;
}

/**
 * IGM API Response Types
 */
export interface OnIssueResponse {
  context: IgmContext;
  message: OnIssueMessage;
  error?: {
    type: string;
    code: string;
    message: string;
  };
}

export interface OnIssueStatusResponse {
  context: IgmContext;
  message: OnIssueStatusMessage;
  error?: {
    type: string;
    code: string;
    message: string;
  };
}

/**
 * Stored Issue Entity (for database)
 */
export interface StoredIssue {
  id: string;
  issueId: string;
  transactionId: string;
  orderId: string;
  bapId: string;
  bapUri: string;
  category: IssueCategory;
  subCategory: IssueSubCategory;
  status: IssueStatus;
  complainantName: string;
  complainantPhone: string;
  complainantEmail?: string;
  description: string;
  longDescription?: string;
  issueType: 'ISSUE' | 'GRIEVANCE';
  sourceType: string;
  sourceParticipantId: string;
  expectedResponseTime?: string;
  expectedResolutionTime?: string;
  resolutionType?: ResolutionType;
  resolutionStatus?: ResolutionStatus;
  resolutionDescription?: string;
  refundAmount?: number;
  rating?: IssueRating;
  respondentActions: RespondentAction[];
  requestPayload: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  closedAt?: Date;
}
