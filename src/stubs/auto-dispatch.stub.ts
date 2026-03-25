import { Injectable, Logger } from '@nestjs/common';
import { IAutoDispatchService } from '../contracts/auto-dispatch.contract.js';

/**
 * Stub AutoDispatchService for standalone ONDC development.
 *
 * In production (monolith), the real AutoDispatchService handles:
 * - Phase 1: Sequential auto-assign to nearest drivers (60s timeout each)
 * - Phase 2: Wide broadcast with progressive radius expansion
 *
 * This stub logs the calls so the ONDC team can develop and test
 * the confirm/cancel flows without needing the full dispatch pipeline.
 */
@Injectable()
export class AutoDispatchStub implements IAutoDispatchService {
  private readonly logger = new Logger('AutoDispatchStub');

  async dispatchOrder(orderId: string): Promise<void> {
    this.logger.warn(
      `[STUB] dispatchOrder called for order ${orderId} — no-op in standalone mode`,
    );
  }

  async retrySequentialAssign(
    orderId: string,
    expiredBroadcastId: string,
  ): Promise<boolean> {
    this.logger.warn(
      `[STUB] retrySequentialAssign called for order ${orderId}, broadcast ${expiredBroadcastId}`,
    );
    return false;
  }

  async broadcastFallback(orderId: string): Promise<void> {
    this.logger.warn(
      `[STUB] broadcastFallback called for order ${orderId}`,
    );
  }

  async retryBroadcast(orderId: string): Promise<void> {
    this.logger.warn(
      `[STUB] retryBroadcast called for order ${orderId}`,
    );
  }
}

// Alias matching the monolith class name
export { AutoDispatchStub as AutoDispatchService };
