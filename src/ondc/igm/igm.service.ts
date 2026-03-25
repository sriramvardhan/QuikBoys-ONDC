import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../database/prisma.service.js';
import { SignatureService } from '../services/signature.service';
import { getErrorMessage } from '../../common/utils/error.utils.js';
import { getOndcBaseUrl } from '../../config/environment.config.js';
import {
  OndcIssueStatus,
  OndcResolutionType,
  OndcIssueCategory,
  OndcIssueSubCategory,
} from '@prisma/client';
import {
  IgmAction,
  IssueStatus,
  ResolutionType,
  RespondentType,
} from './constants/igm-actions';
import {
  IssueRequest,
  IssueStatusRequest,
  Issue,
  OnIssueMessage,
  OnIssueStatusMessage,
  IgmContext,
  RespondentAction,
} from './interfaces/issue.interface';
import {
  BECKN_VERSION,
  ONDC_LOGISTICS_DOMAIN,
} from '../constants/beckn-actions';

/**
 * IGM Service - Handles Issue & Grievance Management for ONDC
 */
@Injectable()
export class IgmService {
  private readonly logger = new Logger(IgmService.name);
  private readonly bppId: string;
  private readonly bppUri: string;
  private readonly cityCode: string;
  private readonly countryCode: string;
  private readonly providerName: string;
  private readonly supportPhone: string;
  private readonly supportEmail: string;
  private readonly maxRetries = 3;
  private readonly retryDelayMs = 2000;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly signatureService: SignatureService,
  ) {
    this.bppId =
      this.configService.get<string>('ondc.subscriberId') || 'dev.quikboys.com';
    this.bppUri =
      this.configService.get<string>('ondc.subscriberUrl') ||
      getOndcBaseUrl();
    this.cityCode =
      this.configService.get<string>('ondc.cityCode') || 'std:040';
    this.countryCode = this.configService.get<string>('ondc.country') || 'IND';
    this.providerName =
      this.configService.get<string>('ondc.providerName') ||
      'QuikBoys Logistics';
    this.supportPhone =
      this.configService.get<string>('ondc.supportPhone') || '+919876543210';
    this.supportEmail =
      this.configService.get<string>('ondc.supportEmail') ||
      'support@quikboys.com';
  }

  /**
   * Process incoming /issue request from BAP
   */
  async processIssue(request: IssueRequest): Promise<void> {
    const { context, message } = request;
    const { issue } = message;
    const transactionId = context.transaction_id;

    this.logger.log(
      `Processing issue request: ${transactionId}, Issue ID: ${issue.id}`,
    );

    try {
      // Store the issue in database
      await this.storeIssue(context, issue);

      // Acknowledge the issue (change status to ACKNOWLEDGED)
      const acknowledgedIssue = this.acknowledgeIssue(issue);

      // Build on_issue response
      const onIssueMessage: OnIssueMessage = {
        issue: acknowledgedIssue,
      };

      // Send on_issue callback to BAP
      await this.sendIgmCallback(context, IgmAction.ON_ISSUE, onIssueMessage);

      this.logger.log(`Issue ${issue.id} acknowledged successfully`);
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Failed to process issue: ${errorMessage}`);

      // Send error callback
      await this.sendIgmCallback(context, IgmAction.ON_ISSUE, null, {
        type: 'DOMAIN-ERROR',
        code: '50001',
        message: `Failed to process issue: ${errorMessage}`,
      });
    }
  }

  /**
   * Process incoming /issue_status request from BAP
   */
  async processIssueStatus(request: IssueStatusRequest): Promise<void> {
    const { context, message } = request;
    const { issue_id } = message;
    const transactionId = context.transaction_id;

    this.logger.log(
      `Processing issue_status request: ${transactionId}, Issue ID: ${issue_id}`,
    );

    try {
      // Find the issue in database
      const storedIssue = await this.findIssue(issue_id);

      if (!storedIssue) {
        this.logger.warn(`Issue not found: ${issue_id}`);
        await this.sendIgmCallback(context, IgmAction.ON_ISSUE_STATUS, null, {
          type: 'DOMAIN-ERROR',
          code: '50002',
          message: `Issue not found: ${issue_id}`,
        });
        return;
      }

      // Build current issue state
      const currentIssue = this.buildIssueFromStored(storedIssue);

      // Build on_issue_status response
      const onIssueStatusMessage: OnIssueStatusMessage = {
        issue: currentIssue,
      };

      // Send on_issue_status callback to BAP
      await this.sendIgmCallback(
        context,
        IgmAction.ON_ISSUE_STATUS,
        onIssueStatusMessage,
      );

      this.logger.log(`Issue status sent for ${issue_id}`);
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Failed to process issue_status: ${errorMessage}`);

      await this.sendIgmCallback(context, IgmAction.ON_ISSUE_STATUS, null, {
        type: 'DOMAIN-ERROR',
        code: '50001',
        message: `Failed to get issue status: ${errorMessage}`,
      });
    }
  }

  /**
   * Map ONDC issue category to Prisma enum
   */
  private mapCategoryToPrisma(category: string): OndcIssueCategory {
    const mapping: Record<string, OndcIssueCategory> = {
      ORDER: OndcIssueCategory.ORDER,
      FULFILLMENT: OndcIssueCategory.FULFILLMENT,
      ITEM: OndcIssueCategory.ITEM,
      PAYMENT: OndcIssueCategory.PAYMENT,
      AGENT: OndcIssueCategory.AGENT,
    };
    return mapping[category] || OndcIssueCategory.ORDER;
  }

  /**
   * Map ONDC issue sub-category to Prisma enum
   */
  private mapSubCategoryToPrisma(subCategory: string): OndcIssueSubCategory {
    const mapping: Record<string, OndcIssueSubCategory> = {
      ORD01: OndcIssueSubCategory.ORD01,
      ORD02: OndcIssueSubCategory.ORD02,
      ORD03: OndcIssueSubCategory.ORD03,
      ORD04: OndcIssueSubCategory.ORD04,
      FLM01: OndcIssueSubCategory.FLM01,
      FLM02: OndcIssueSubCategory.FLM02,
      FLM03: OndcIssueSubCategory.FLM03,
      ITM01: OndcIssueSubCategory.ITM01,
      ITM02: OndcIssueSubCategory.ITM02,
      ITM03: OndcIssueSubCategory.ITM03,
      ITM04: OndcIssueSubCategory.ITM04,
      PMT01: OndcIssueSubCategory.PMT01,
      PMT02: OndcIssueSubCategory.PMT02,
      PMT03: OndcIssueSubCategory.PMT03,
      AGT01: OndcIssueSubCategory.AGT01,
      AGT02: OndcIssueSubCategory.AGT02,
    };
    return mapping[subCategory] || OndcIssueSubCategory.ORD01;
  }

  /**
   * Map issue status to Prisma enum
   */
  private mapStatusToPrisma(status: IssueStatus): OndcIssueStatus {
    const mapping: Record<IssueStatus, OndcIssueStatus> = {
      [IssueStatus.OPEN]: OndcIssueStatus.OPEN,
      [IssueStatus.ACKNOWLEDGED]: OndcIssueStatus.ACKNOWLEDGED,
      [IssueStatus.PROCESSING]: OndcIssueStatus.PROCESSING,
      [IssueStatus.RESOLVED]: OndcIssueStatus.RESOLVED,
      [IssueStatus.CLOSED]: OndcIssueStatus.CLOSED,
    };
    return mapping[status] || OndcIssueStatus.OPEN;
  }

  /**
   * Map resolution type to Prisma enum
   */
  private mapResolutionTypeToPrisma(type: ResolutionType): OndcResolutionType {
    const mapping: Record<ResolutionType, OndcResolutionType> = {
      [ResolutionType.REFUND]: OndcResolutionType.REFUND,
      [ResolutionType.REPLACEMENT]: OndcResolutionType.REPLACEMENT,
      [ResolutionType.RETURN]: OndcResolutionType.RETURN,
      [ResolutionType.CANCEL]: OndcResolutionType.CANCEL,
      [ResolutionType.NO_ACTION]: OndcResolutionType.NO_ACTION,
    };
    return mapping[type] || OndcResolutionType.NO_ACTION;
  }

  /**
   * Store issue in database
   */
  private async storeIssue(
    context: IgmContext,
    issue: Issue,
  ): Promise<unknown> {
    const now = new Date();

    return this.prisma.ondcIssue.create({
      data: {
        issueId: issue.id,
        transactionId: context.transaction_id,
        messageId: context.message_id,
        orderId: issue.order_details.id,
        bapId: context.bap_id,
        bapUri: context.bap_uri,
        category: this.mapCategoryToPrisma(issue.category),
        subCategory: this.mapSubCategoryToPrisma(issue.sub_category),
        status: OndcIssueStatus.ACKNOWLEDGED, // We acknowledge immediately
        complainantName: issue.complainant_info.person.name,
        complainantPhone: issue.complainant_info.contact.phone,
        complainantEmail: issue.complainant_info.contact.email,
        description: issue.description.short_desc,
        longDescription: issue.description.long_desc,
        issueType: issue.issue_type,
        sourceType: issue.source.type,
        sourceParticipantId: issue.source.network_participant_id,
        expectedResponseTime: issue.expected_response_time?.duration,
        expectedResolutionTime: issue.expected_resolution_time?.duration,
        requestPayload: JSON.parse(
          JSON.stringify({ context, message: { issue } }),
        ),
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  /**
   * Find issue by ID
   */
  private async findIssue(issueId: string): Promise<unknown> {
    return this.prisma.ondcIssue.findUnique({
      where: { issueId },
      include: {
        actions: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  /**
   * Acknowledge issue and return updated issue object
   */
  private acknowledgeIssue(issue: Issue): Issue {
    const now = new Date().toISOString();

    // Add respondent action for acknowledgment
    const acknowledgmentAction: RespondentAction = {
      respondent_action: 'PROCESSING',
      short_desc: 'Issue acknowledged and being processed',
      updated_at: now,
      updated_by: {
        org: {
          name: this.providerName,
        },
        contact: {
          phone: this.supportPhone,
          email: this.supportEmail,
        },
        person: {
          name: 'Support Team',
        },
      },
    };

    return {
      ...issue,
      status: IssueStatus.ACKNOWLEDGED,
      updated_at: now,
      issue_actions: {
        ...issue.issue_actions,
        respondent_actions: [
          ...(issue.issue_actions?.respondent_actions || []),
          acknowledgmentAction,
        ],
      },
      resolution_provider: {
        respondent_info: {
          type: RespondentType.INTERFACING_NP,
          organization: {
            org: {
              name: this.providerName,
            },
            contact: {
              phone: this.supportPhone,
              email: this.supportEmail,
            },
            person: {
              name: 'Support Team',
            },
          },
          resolution_support: {
            contact: {
              phone: this.supportPhone,
              email: this.supportEmail,
            },
            gros: [
              {
                person: {
                  name: 'Grievance Officer',
                },
                contact: {
                  phone: this.supportPhone,
                  email: this.supportEmail,
                },
                gro_type: 'INTERFACING-NP-GRO',
              },
            ],
          },
        },
      },
    };
  }

  /**
   * Build issue object from stored database record
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildIssueFromStored(storedIssue: Record<string, any>): Issue {
    const requestPayload = storedIssue.requestPayload as Record<
      string,
      unknown
    >;
    const originalIssue = (requestPayload?.message as Record<string, unknown>)
      ?.issue as Issue;

    // Get respondent actions from database
    const respondentActions: RespondentAction[] = (
      (storedIssue.actions as Array<Record<string, unknown>>) || []
    ).map((action) => ({
      respondent_action: action.action as string,
      short_desc: action.shortDesc as string,
      updated_at: (action.createdAt as Date).toISOString(),
      updated_by: {
        org: {
          name: this.providerName,
        },
        contact: {
          phone: this.supportPhone,
          email: this.supportEmail,
        },
        person: {
          name: (action.updatedBy as string) || 'Support Team',
        },
      },
    }));

    return {
      ...originalIssue,
      status: storedIssue.status as IssueStatus,
      updated_at: storedIssue.updatedAt.toISOString(),
      issue_actions: {
        ...originalIssue?.issue_actions,
        respondent_actions: respondentActions,
      },
      ...(storedIssue.resolutionType && {
        resolution: {
          short_desc: storedIssue.resolutionDescription || 'Issue resolved',
          action_triggered: storedIssue.resolutionType as ResolutionType,
          refund_amount: storedIssue.refundAmount?.toString(),
        },
      }),
      resolution_provider: {
        respondent_info: {
          type: RespondentType.INTERFACING_NP,
          organization: {
            org: {
              name: this.providerName,
            },
            contact: {
              phone: this.supportPhone,
              email: this.supportEmail,
            },
            person: {
              name: 'Support Team',
            },
          },
          resolution_support: {
            contact: {
              phone: this.supportPhone,
              email: this.supportEmail,
            },
          },
        },
      },
    };
  }

  /**
   * Update issue status
   */
  async updateIssueStatus(
    issueId: string,
    status: IssueStatus,
    action: string,
    shortDesc: string,
    updatedBy?: string,
    resolution?: {
      type: ResolutionType;
      description?: string;
      refundAmount?: number;
    },
  ): Promise<void> {
    const now = new Date();
    const prismaStatus = this.mapStatusToPrisma(status);

    // Update issue status
    await this.prisma.ondcIssue.update({
      where: { issueId },
      data: {
        status: prismaStatus,
        updatedAt: now,
        ...(status === IssueStatus.RESOLVED &&
          resolution && {
            resolvedAt: now,
            resolutionType: this.mapResolutionTypeToPrisma(resolution.type),
            resolutionDescription: resolution.description,
            refundAmount: resolution.refundAmount,
          }),
        ...(status === IssueStatus.CLOSED && {
          closedAt: now,
        }),
      },
    });

    // Add action record
    await this.prisma.ondcIssueAction.create({
      data: {
        issueId,
        action,
        shortDesc,
        updatedBy: updatedBy || 'System',
        createdAt: now,
      },
    });

    this.logger.log(`Issue ${issueId} status updated to ${status}`);
  }

  /**
   * Send IGM callback to BAP
   */
  private async sendIgmCallback<T>(
    originalContext: IgmContext,
    action: IgmAction,
    message: T | null,
    error?: {
      type: string;
      code: string;
      message: string;
    },
  ): Promise<boolean> {
    // Build callback context
    const callbackContext = this.buildCallbackContext(originalContext, action);

    // Build callback payload
    const payload = {
      context: callbackContext,
      ...(error ? { error } : { message }),
    };

    // Get callback URL
    const callbackUrl = `${originalContext.bap_uri}/${action}`;

    // Try to send callback with retries
    return this.sendWithRetry(callbackUrl, payload, action);
  }

  /**
   * Build callback context for IGM response
   */
  private buildCallbackContext(
    originalContext: IgmContext,
    callbackAction: IgmAction,
  ): IgmContext {
    return {
      domain: originalContext.domain || ONDC_LOGISTICS_DOMAIN,
      country: originalContext.country || this.countryCode,
      city: originalContext.city || this.cityCode,
      action: callbackAction,
      core_version: originalContext.core_version || BECKN_VERSION,
      bap_id: originalContext.bap_id,
      bap_uri: originalContext.bap_uri,
      bpp_id: this.bppId,
      bpp_uri: this.bppUri,
      transaction_id: originalContext.transaction_id,
      message_id: originalContext.message_id,
      timestamp: new Date().toISOString(),
      ttl: originalContext.ttl || 'PT30S',
    };
  }

  /**
   * Send callback with retry logic
   */
  private async sendWithRetry(
    url: string,
    payload: unknown,
    action: string,
    retryCount = 0,
  ): Promise<boolean> {
    try {
      // Create authorization header
      const authHeader =
        this.signatureService.createAuthorizationHeader(payload);

      this.logger.debug(`Sending ${action} callback to: ${url}`);

      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          timeout: 10000,
        }),
      );

      // Check for ACK response
      if (response.data?.message?.ack?.status === 'ACK') {
        this.logger.log(`${action} callback sent successfully to ${url}`);
        return true;
      }

      this.logger.warn(
        `${action} callback received non-ACK response: ${JSON.stringify(response.data)}`,
      );

      // Retry on non-ACK
      if (retryCount < this.maxRetries) {
        await this.delay(this.retryDelayMs * (retryCount + 1));
        return this.sendWithRetry(url, payload, action, retryCount + 1);
      }

      return false;
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(
        `${action} callback failed (attempt ${retryCount + 1}): ${errorMessage}`,
      );

      // Retry on error
      if (retryCount < this.maxRetries) {
        await this.delay(this.retryDelayMs * (retryCount + 1));
        return this.sendWithRetry(url, payload, action, retryCount + 1);
      }

      return false;
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get all issues for an order
   */
  async getIssuesByOrderId(orderId: string): Promise<unknown[]> {
    return this.prisma.ondcIssue.findMany({
      where: { orderId },
      include: {
        actions: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get issue by ID
   */
  async getIssueById(issueId: string): Promise<unknown> {
    return this.prisma.ondcIssue.findUnique({
      where: { issueId },
      include: {
        actions: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  /**
   * Get all open issues
   */
  async getOpenIssues(): Promise<unknown[]> {
    return this.prisma.ondcIssue.findMany({
      where: {
        status: {
          in: [
            OndcIssueStatus.OPEN,
            OndcIssueStatus.ACKNOWLEDGED,
            OndcIssueStatus.PROCESSING,
          ],
        },
      },
      include: {
        actions: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
