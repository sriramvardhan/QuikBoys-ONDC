/**
 * IGM (Issue & Grievance Management) Actions for ONDC
 */
export enum IgmAction {
  // Incoming requests from BAP
  ISSUE = 'issue',
  ISSUE_STATUS = 'issue_status',

  // Outgoing callbacks to BAP
  ON_ISSUE = 'on_issue',
  ON_ISSUE_STATUS = 'on_issue_status',
}

/**
 * Map incoming action to outgoing callback action
 */
export const IGM_ACTION_TO_CALLBACK: Record<string, IgmAction> = {
  [IgmAction.ISSUE]: IgmAction.ON_ISSUE,
  [IgmAction.ISSUE_STATUS]: IgmAction.ON_ISSUE_STATUS,
};

/**
 * IGM Issue Status States (as per ONDC IGM spec)
 */
export enum IssueStatus {
  OPEN = 'OPEN',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  PROCESSING = 'PROCESSING',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

/**
 * IGM Issue Category (as per ONDC spec)
 */
export enum IssueCategory {
  ORDER = 'ORDER',
  FULFILLMENT = 'FULFILLMENT',
  ITEM = 'ITEM',
  PAYMENT = 'PAYMENT',
  AGENT = 'AGENT',
}

/**
 * IGM Issue Sub-Category
 */
export enum IssueSubCategory {
  // ORDER
  ORDER_NOT_RECEIVED = 'ORD01',
  ORDER_DELAYED = 'ORD02',
  ORDER_WRONG = 'ORD03',
  ORDER_CANCELLED = 'ORD04',

  // FULFILLMENT
  FULFILLMENT_DELAYED = 'FLM01',
  FULFILLMENT_CANCELLED = 'FLM02',
  FULFILLMENT_TRACKING_ISSUE = 'FLM03',

  // ITEM
  ITEM_DAMAGED = 'ITM01',
  ITEM_MISSING = 'ITM02',
  ITEM_QUALITY = 'ITM03',
  ITEM_WRONG = 'ITM04',

  // PAYMENT
  PAYMENT_OVERCHARGED = 'PMT01',
  PAYMENT_REFUND = 'PMT02',
  PAYMENT_COD_ISSUE = 'PMT03',

  // AGENT
  AGENT_BEHAVIOR = 'AGT01',
  AGENT_NOT_AVAILABLE = 'AGT02',
}

/**
 * Issue Rating Scale
 */
export enum IssueRating {
  THUMBS_UP = 'THUMBS_UP',
  THUMBS_DOWN = 'THUMBS_DOWN',
}

/**
 * Respondent Type
 */
export enum RespondentType {
  INTERFACING_NP = 'INTERFACING-NP', // The NP that received the issue
  TRANSACTION_COUNTERPARTY_NP = 'TRANSACTION-COUNTERPARTY-NP', // Other party
  CASCADED_COUNTERPARTY_NP = 'CASCADED-COUNTERPARTY-NP', // Third party
}

/**
 * Resolution Type
 */
export enum ResolutionType {
  REFUND = 'REFUND',
  REPLACEMENT = 'REPLACEMENT',
  RETURN = 'RETURN',
  CANCEL = 'CANCEL',
  NO_ACTION = 'NO-ACTION',
}

/**
 * Resolution Status
 */
export enum ResolutionStatus {
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}
