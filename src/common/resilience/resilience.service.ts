import { Injectable, Logger } from '@nestjs/common';
import {
  CircuitBreakerPolicy,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleAll,
  IPolicy,
  retry,
  circuitBreaker,
  timeout,
  TimeoutStrategy,
  wrap,
  bulkhead,
} from 'cockatiel';

export interface BreakerConfig {
  name: string;
  maxFailures?: number;
  halfOpenAfterMs?: number;
  retryAttempts?: number;
  retryInitialDelayMs?: number;
  timeoutMs?: number;
  maxConcurrency?: number;
}

export interface BreakerState {
  name: string;
  state: string;
  failures: number;
}

@Injectable()
export class ResilienceService {
  private readonly logger = new Logger(ResilienceService.name);
  private readonly breakers = new Map<
    string,
    { circuit: CircuitBreakerPolicy; policy: IPolicy }
  >();

  createBreaker(config: BreakerConfig): IPolicy {
    const {
      name,
      maxFailures = 5,
      halfOpenAfterMs = 30000,
      retryAttempts = 3,
      retryInitialDelayMs = 1000,
      timeoutMs = 10000,
      maxConcurrency = 10,
    } = config;

    const retryPolicy = retry(handleAll, {
      maxAttempts: retryAttempts,
      backoff: new ExponentialBackoff({
        initialDelay: retryInitialDelayMs,
      }),
    });

    const circuit = circuitBreaker(handleAll, {
      halfOpenAfter: halfOpenAfterMs,
      breaker: new ConsecutiveBreaker(maxFailures),
    });

    const timeoutPolicy = timeout(timeoutMs, TimeoutStrategy.Aggressive);
    const bulkheadPolicy = bulkhead(maxConcurrency);

    const policy = wrap(retryPolicy, circuit, timeoutPolicy, bulkheadPolicy);

    this.breakers.set(name, { circuit, policy });
    this.logger.log(`Circuit breaker created: ${name}`);

    return policy;
  }

  getBreaker(name: string): IPolicy {
    const entry = this.breakers.get(name);
    if (!entry) {
      throw new Error(`Circuit breaker "${name}" not found`);
    }
    return entry.policy;
  }

  getStates(): BreakerState[] {
    const states: BreakerState[] = [];
    for (const [name, { circuit }] of this.breakers) {
      states.push({
        name,
        state: circuit.state.toString(),
        failures: 0,
      });
    }
    return states;
  }
}
