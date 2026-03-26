import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator.js';
import { PublicOndc } from '../decorators/public-ondc.decorator';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';

@Controller()
@ApiTags('ondc-verification')
export class OndcVerificationController {
  private readonly signedRequestId =
    process.env.ONDC_SIGNED_REQUEST_ID || 'PENDING';

  @Get('ondc-site-verification.html')
  @Public()
  @PublicOndc()
  @Header('Content-Type', 'text/html')
  @ApiExcludeEndpoint()
  getVerification(): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta name="ondc-site-verification" content="${this.signedRequestId}" />
</head>
<body>ONDC Site Verification Page</body>
</html>`;
  }

  @Get('ondc-verification-status')
  @Public()
  @PublicOndc()
  @ApiOperation({ summary: 'Check ONDC verification status' })
  @ApiResponse({ status: 200, description: 'Verification status' })
  getVerificationStatus() {
    return {
      configured: this.signedRequestId !== 'PENDING',
      signedRequestId: this.signedRequestId === 'PENDING'
        ? 'PENDING - Run sign-ondc-request.js script'
        : `${this.signedRequestId.substring(0, 20)}...`,
      verificationUrl: 'https://dev.quikboys.com/ondc-site-verification.html',
    };
  }

  @Get('ondc/api-contract')
  @Public()
  @PublicOndc()
  @Header('Content-Type', 'text/html')
  @ApiExcludeEndpoint()
  getApiContract(): string {
    const filePath = path.join(process.cwd(), 'public', 'api-contract.html');
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return '<h1>API Contract not found</h1>';
    }
  }
}
