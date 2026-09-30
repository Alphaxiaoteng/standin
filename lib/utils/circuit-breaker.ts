/**
 * v17: Graceful Degradation & Circuit Breaker Pattern
 * StandIn Long-Running Task System Production Optimization
 */

export enum CircuitState {
  CLOSED = 'CLOSED',      // Normal operation
  OPEN = 'OPEN',          // Failure threshold exceeded, reject calls
  HALF_OPEN = 'HALF_OPEN' // Testing recovery
}

export interface CircuitBreakerConfig {
  failureThreshold: number;        // % failures to trip (default: 50)
  successThreshold: number;        // % successes to close (default: 80)
  slidingWindowSize: number;       // Number of calls to track (default: 100)
  timeoutMs: number;               // Time before attempting recovery (default: 30s)
  halfMaxRequests: number;         // Requests allowed in half-open state (default: 5)
}

interface CallRecord {
  timestamp: number;
  success: boolean;
}

export interface CircuitBreakerContext {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  openUntil?: number;
  halfOpenAttempts: number;
}

/**
 * CircuitBreaker - Implements circuit breaker pattern for fault tolerance
 */
export class CircuitBreaker {
  private config: Required<CircuitBreakerConfig>;
  private callHistory: CallRecord[] = [];
  private state: CircuitState = CircuitState.CLOSED;
  private context: CircuitBreakerContext;
  private timeoutTimer?: NodeJS.Timeout;
  
  constructor(private name: string, config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 50,  // 50% failures
      successThreshold: config?.successThreshold ?? 80,   // 80% successes
      slidingWindowSize: config?.slidingWindowSize ?? 100,
      timeoutMs: config?.timeoutMs ?? 30000,             // 30s timeout
      halfMaxRequests: config?.halfMaxRequests ?? 5,
    };
    
    this.context = {
      name,
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: undefined,
      openUntil: undefined,
      halfOpenAttempts: 0,
    };
  }
  
  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    this.checkTimeout();
    return this.state;
  }
  
  /**
   * Execute operation through circuit breaker
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      throw new Error(`Circuit breaker OPEN for ${this.name}`);
    }
    
    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error as Error);
      throw error;
    }
  }
  
  /**
   * Record successful call
   */
  recordSuccess(): void {
    this.recordCall(true);
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.context.halfOpenAttempts++;
      
      // Check if we should transition to CLOSED
      const successRate = this.getRecentFailureRate() * 100;
      const successCountInWindow = this.slidingWindowSuccessRate();
      
      if (successCountInWindow >= this.config.successThreshold) {
        this.transitionToClosed();
      } else if (this.context.halfOpenAttempts >= this.config.halfMaxRequests) {
        this.transitionToOpen();
      }
    }
  }
  
  /**
   * Record failed call
   */
  recordFailure(error: Error): void {
    this.recordCall(false);
    this.context.lastFailureTime = Date.now();
    
    if (this.state === CircuitState.HALF_OPEN) {
      // Immediate failure trips circuit back to OPEN
      this.transitionToOpen();
    } else if (this.state === CircuitState.CLOSED) {
      const failureRate = this.getRecentFailureRate() * 100;
      
      if (failureRate >= this.config.failureThreshold) {
        this.transitionToOpen();
      }
    }
  }
  
  /**
   * Transition state machine
   */
  private transitionToOpen(): void {
    this.state = CircuitState.OPEN;
    this.context.state = CircuitState.OPEN;
    this.context.openUntil = Date.now() + this.config.timeoutMs;
    
    // Clear any existing timer
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
    }
    
    // Set timer for automatic half-open transition
    this.timeoutTimer = setTimeout(() => {
      this.transitionToHalfOpen();
    }, this.config.timeoutMs);
    
    console.log(`[CircuitBreaker] ${this.name} -> OPEN`);
  }
  
  private transitionToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.context.state = CircuitState.HALF_OPEN;
    this.context.halfOpenAttempts = 0;
    
    console.log(`[CircuitBreaker] ${this.name} -> HALF_OPEN`);
  }
  
  private transitionToClosed(): void {
    this.state = CircuitState.CLOSED;
    this.context.state = CircuitState.CLOSED;
    this.context.failureCount = 0;
    this.context.successCount = 0;
    
    // Clear timer
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
    
    console.log(`[CircuitBreaker] ${this.name} -> CLOSED`);
  }
  
  private checkTimeout(): void {
    if (this.state === CircuitState.OPEN && this.context.openUntil) {
      if (Date.now() >= this.context.openUntil) {
        this.transitionToHalfOpen();
      }
    }
  }
  
  private recordCall(success: boolean): void {
    const now = Date.now();
    
    // Clean old records outside window
    const cutoff = now - this.config.slidingWindowSize;
    this.callHistory = this.callHistory.filter(record => record.timestamp > cutoff);
    
    // Add new record
    this.callHistory.push({ timestamp: now, success });
    
    // Update counters
    if (success) {
      this.context.successCount++;
    } else {
      this.context.failureCount++;
    }
    
    // Keep history bounded
    if (this.callHistory.length > this.config.slidingWindowSize * 2) {
      this.callHistory.shift();
    }
  }
  
  /**
   * Calculate failure rate in recent window
   */
  private getRecentFailureRate(): number {
    if (this.callHistory.length === 0) return 0;
    
    const failures = this.callHistory.filter(r => !r.success).length;
    return failures / this.callHistory.length;
  }
  
  /**
   * Calculate success rate in sliding window
   */
  private slidingWindowSuccessRate(): number {
    const now = Date.now();
    const windowStart = now - this.config.slidingWindowSize;
    
    const recentCalls = this.callHistory.filter(r => r.timestamp >= windowStart);
    if (recentCalls.length === 0) return 100;
    
    const successes = recentCalls.filter(r => r.success).length;
    return (successes / recentCalls.length) * 100;
  }
  
  /**
   * Get breaker context
   */
  getContext(): CircuitBreakerContext {
    this.checkTimeout();
    return { ...this.context };
  }
  
  /**
   * Reset circuit breaker
   */
  reset(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
    }
    
    this.state = CircuitState.CLOSED;
    this.callHistory = [];
    this.context = {
      name: this.name,
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: undefined,
      openUntil: undefined,
      halfOpenAttempts: 0,
    };
  }
  
  /**
   * Force open circuit (for manual control)
   */
  forceOpen(): void {
    this.transitionToOpen();
  }
  
  /**
   * Force close circuit (for manual control)
   */
  forceClose(): void {
    this.transitionToClosed();
  }
}

// Helper function to create multiple circuit breakers
export class CircuitBreakerManager {
  private breakers = new Map<string, CircuitBreaker>();
  
  get(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      const breaker = new CircuitBreaker(name, config);
      this.breakers.set(name, breaker);
    }
    return this.breakers.get(name)!;
  }
  
  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }
  
  reset(name: string): void {
    this.breakers.get(name)?.reset();
  }
  
  clearAll(): void {
    this.breakers.forEach(breaker => breaker.reset());
    this.breakers.clear();
  }
}

export const circuitBreakerManager = new CircuitBreakerManager();
