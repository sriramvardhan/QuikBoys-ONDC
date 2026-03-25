/**
 * AutoDispatchService Contract
 *
 * This is the interface that the ONDC module depends on from the monolith's
 * OrdersModule. The stub implementation below is used for standalone development.
 * In production (monolith), this is provided by the real AutoDispatchService.
 *
 * Integration point: When an ONDC order is confirmed, ConfirmProcessor calls
 * autoDispatchService.dispatchOrder(orderId) to kick off driver assignment.
 */

export interface IAutoDispatchService {
  dispatchOrder(orderId: string): Promise<void>;
  retrySequentialAssign(
    orderId: string,
    expiredBroadcastId: string,
  ): Promise<boolean>;
  broadcastFallback(orderId: string): Promise<void>;
  retryBroadcast(orderId: string): Promise<void>;
}

export const AUTO_DISPATCH_SERVICE = 'AUTO_DISPATCH_SERVICE';
