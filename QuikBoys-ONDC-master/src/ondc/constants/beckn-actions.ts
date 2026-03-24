/**
 * Beckn Protocol Actions for ONDC Logistics
 */
export enum BecknAction {
  // Incoming requests from BAP
  SEARCH = 'search',
  SELECT = 'select',
  INIT = 'init',
  CONFIRM = 'confirm',
  STATUS = 'status',
  TRACK = 'track',
  CANCEL = 'cancel',
  UPDATE = 'update',

  // Outgoing callbacks to BAP
  ON_SEARCH = 'on_search',
  ON_SELECT = 'on_select',
  ON_INIT = 'on_init',
  ON_CONFIRM = 'on_confirm',
  ON_STATUS = 'on_status',
  ON_TRACK = 'on_track',
  ON_CANCEL = 'on_cancel',
  ON_UPDATE = 'on_update',
}

/**
 * Map incoming action to outgoing callback action
 */
export const ACTION_TO_CALLBACK: Record<string, BecknAction> = {
  [BecknAction.SEARCH]: BecknAction.ON_SEARCH,
  [BecknAction.SELECT]: BecknAction.ON_SELECT,
  [BecknAction.INIT]: BecknAction.ON_INIT,
  [BecknAction.CONFIRM]: BecknAction.ON_CONFIRM,
  [BecknAction.STATUS]: BecknAction.ON_STATUS,
  [BecknAction.TRACK]: BecknAction.ON_TRACK,
  [BecknAction.CANCEL]: BecknAction.ON_CANCEL,
  [BecknAction.UPDATE]: BecknAction.ON_UPDATE,
};

/**
 * Beckn Protocol Version
 */
export const BECKN_VERSION = '1.2.5';

/**
 * ONDC Logistics Domain (LOG10 = B2C, LOG11 = B2B)
 */
export const ONDC_LOGISTICS_DOMAIN = 'ONDC:LOG10';

/**
 * Default TTL in seconds for responses
 */
export const DEFAULT_TTL_SECONDS = 30;
