import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

/**
 * Stub JWT auth guard for standalone ONDC development.
 * In production, this is replaced by the monolith's full JWT guard.
 * For ONDC, most endpoints use BecknSignatureGuard instead.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // In standalone mode, allow all requests (ONDC uses Beckn signature auth)
    return true;
  }
}
