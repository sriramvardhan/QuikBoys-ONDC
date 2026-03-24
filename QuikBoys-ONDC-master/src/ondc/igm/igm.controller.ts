import {
  Controller,
  Post,
  Body,
  Logger,
  HttpCode,
  HttpStatus,
  Get,
  Param,
  Patch,
} from '@nestjs/common';
import { IgmService } from './igm.service';
import {
  CreateIssueRequestDto,
  IssueStatusRequestDto,
  UpdateIssueStatusDto,
} from './dto/issue.dto';
import { IssueRequest, IssueStatusRequest } from './interfaces/issue.interface';

/**
 * ACK Response for immediate acknowledgment
 */
const ACK_RESPONSE = {
  message: {
    ack: {
      status: 'ACK',
    },
  },
};

/**
 * NACK Response for errors
 */
const createNackResponse = (code: string, message: string) => ({
  message: {
    ack: {
      status: 'NACK',
    },
  },
  error: {
    type: 'DOMAIN-ERROR',
    code,
    message,
  },
});

/**
 * IGM Controller - Handles Issue & Grievance Management endpoints
 *
 * Endpoints:
 * - POST /ondc/issue - Receive issue from BAP
 * - POST /ondc/issue_status - Receive status request from BAP
 * - GET /ondc/igm/issues - List all issues (internal)
 * - GET /ondc/igm/issues/:issueId - Get issue details (internal)
 * - PATCH /ondc/igm/issues/:issueId/status - Update issue status (internal)
 */
@Controller('ondc')
export class IgmController {
  private readonly logger = new Logger(IgmController.name);

  constructor(private readonly igmService: IgmService) {}

  /**
   * POST /ondc/issue
   * Receive issue from BAP and send on_issue callback
   */
  @Post('issue')
  @HttpCode(HttpStatus.OK)
  async handleIssue(@Body() body: CreateIssueRequestDto) {
    const { context, message } = body;

    this.logger.log(
      `Received /issue request - Transaction: ${context.transaction_id}, Issue: ${message.issue.id}`,
    );

    try {
      // Validate required fields
      if (!context?.transaction_id || !context?.message_id) {
        this.logger.error('Missing required context fields');
        return createNackResponse('40001', 'Missing required context fields');
      }

      if (!message?.issue?.id) {
        this.logger.error('Missing issue ID');
        return createNackResponse('40002', 'Missing issue ID');
      }

      // Immediately acknowledge receipt
      // Process asynchronously
      setImmediate(() => {
        this.igmService
          .processIssue(body as unknown as IssueRequest)
          .catch((error) => {
            this.logger.error(
              `Async issue processing failed: ${error.message}`,
            );
          });
      });

      return ACK_RESPONSE;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error handling /issue: ${errorMessage}`);
      return createNackResponse('50000', `Internal error: ${errorMessage}`);
    }
  }

  /**
   * POST /ondc/issue_status
   * Receive issue status request from BAP and send on_issue_status callback
   */
  @Post('issue_status')
  @HttpCode(HttpStatus.OK)
  async handleIssueStatus(@Body() body: IssueStatusRequestDto) {
    const { context, message } = body;

    this.logger.log(
      `Received /issue_status request - Transaction: ${context.transaction_id}, Issue: ${message.issue_id}`,
    );

    try {
      // Validate required fields
      if (!context?.transaction_id || !context?.message_id) {
        this.logger.error('Missing required context fields');
        return createNackResponse('40001', 'Missing required context fields');
      }

      if (!message?.issue_id) {
        this.logger.error('Missing issue_id');
        return createNackResponse('40002', 'Missing issue_id');
      }

      // Immediately acknowledge receipt
      // Process asynchronously
      setImmediate(() => {
        this.igmService
          .processIssueStatus(body as unknown as IssueStatusRequest)
          .catch((error) => {
            this.logger.error(
              `Async issue_status processing failed: ${error.message}`,
            );
          });
      });

      return ACK_RESPONSE;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error handling /issue_status: ${errorMessage}`);
      return createNackResponse('50000', `Internal error: ${errorMessage}`);
    }
  }

  // ==========================================
  // Internal API Endpoints for Admin/Dashboard
  // ==========================================

  /**
   * GET /ondc/igm/issues
   * List all issues (for internal admin use)
   */
  @Get('igm/issues')
  async listIssues() {
    this.logger.log('Listing all issues');
    try {
      const issues = await this.igmService.getOpenIssues();
      return {
        success: true,
        data: issues,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error listing issues: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * GET /ondc/igm/issues/:issueId
   * Get specific issue details (for internal admin use)
   */
  @Get('igm/issues/:issueId')
  async getIssue(@Param('issueId') issueId: string) {
    this.logger.log(`Getting issue: ${issueId}`);
    try {
      const issue = await this.igmService.getIssueById(issueId);
      if (!issue) {
        return {
          success: false,
          error: 'Issue not found',
        };
      }
      return {
        success: true,
        data: issue,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error getting issue: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * GET /ondc/igm/orders/:orderId/issues
   * Get all issues for a specific order (for internal admin use)
   */
  @Get('igm/orders/:orderId/issues')
  async getOrderIssues(@Param('orderId') orderId: string) {
    this.logger.log(`Getting issues for order: ${orderId}`);
    try {
      const issues = await this.igmService.getIssuesByOrderId(orderId);
      return {
        success: true,
        data: issues,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error getting order issues: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * PATCH /ondc/igm/issues/:issueId/status
   * Update issue status (for internal admin use)
   */
  @Patch('igm/issues/:issueId/status')
  async updateIssueStatus(
    @Param('issueId') issueId: string,
    @Body() body: UpdateIssueStatusDto,
  ) {
    this.logger.log(`Updating issue status: ${issueId} -> ${body.status}`);
    try {
      await this.igmService.updateIssueStatus(
        issueId,
        body.status,
        body.respondentAction || 'STATUS_UPDATE',
        body.shortDesc || `Status updated to ${body.status}`,
        undefined,
        body.resolution
          ? {
              type: body.resolution.action_triggered,
              description: body.resolution.short_desc,
              refundAmount: body.resolution.refund_amount
                ? parseFloat(body.resolution.refund_amount)
                : undefined,
            }
          : undefined,
      );

      return {
        success: true,
        message: `Issue status updated to ${body.status}`,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error updating issue status: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}
