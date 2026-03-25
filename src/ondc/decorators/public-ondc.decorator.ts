import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_ONDC_KEY = 'isPublicOndc';

/**
 * Decorator to mark ONDC endpoints as public (skip signature verification)
 * Use sparingly - only for health checks and subscription endpoints
 */
export const PublicOndc = () => SetMetadata(IS_PUBLIC_ONDC_KEY, true);
