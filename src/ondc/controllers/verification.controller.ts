import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator.js';
import { PublicOndc } from '../decorators/public-ondc.decorator';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';

/**
 * ONDC Site Verification Controller
 *
 * Serves the ondc-site-verification.html page required for ONDC registry subscription.
 * The page contains a meta tag with the signed request_id from the ONDC portal.
 *
 * @see https://docs.ondc.org/
 */
@Controller()
@ApiTags('ondc-verification')
export class OndcVerificationController {
  private readonly signedRequestId =
    process.env.ONDC_SIGNED_REQUEST_ID || 'PENDING';

  /**
   * Serve ONDC site verification page
   *
   * This endpoint serves the verification HTML page at the root path
   * (not under /api/v1) as required by ONDC for registry subscription.
   *
   * URL: https://dev.quikboys.com/ondc-site-verification.html
   */
  @Get('ondc-site-verification.html')
  @Public() // Skip JWT auth guard
  @PublicOndc() // Skip ONDC signature verification
  @Header('Content-Type', 'text/html')
  @ApiExcludeEndpoint() // Hide from Swagger docs
  getVerification(): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta name="ondc-site-verification" content="${this.signedRequestId}" />
</head>
<body>
ONDC Site Verification Page
</body>
</html>`;
  }

  /**
   * Health check for verification endpoint
   *
   * Returns the current status of the verification configuration.
   */
  @Get('ondc-verification-status')
  @Public()
  @PublicOndc()
  @ApiOperation({
    summary: 'Check ONDC verification status',
    description: 'Returns the current status of ONDC site verification configuration.',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification status',
    schema: {
      type: 'object',
      properties: {
        configured: { type: 'boolean' },
        signedRequestId: { type: 'string' },
        verificationUrl: { type: 'string' },
      },
    },
  })
  getVerificationStatus() {
    return {
      configured: this.signedRequestId !== 'PENDING',
      signedRequestId:
        this.signedRequestId === 'PENDING'
          ? 'PENDING - Run sign-ondc-request.js script'
          : `${this.signedRequestId.substring(0, 20)}...`,
      verificationUrl: 'https://dev.quikboys.com/ondc-site-verification.html',
    };
  }
}
