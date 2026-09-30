/**
 * v17: Fallback Strategies for Graceful Degradation
 * StandIn Long-Running Task System Production Optimization
 */

export interface FallbackContext {
  serviceName: string;
  circuitState: string;
  error?: Error;
  attempts: number;
  timestamp: number;
  [key: string]: any;
}

export interface FallbackStrategy {
  readonly name: string;
  fallback(context: FallbackContext): Promise<any>;
}

/**
 * CachedFallback - Returns cached value when service is unavailable
 */
export class CachedFallback implements FallbackStrategy {
  readonly name = 'cached';
  private cache = new Map<string, any>();
  private cacheTTL = 300000; // 5 minutes
  
  async fallback(context: FallbackContext): Promise<any> {
    const cacheKey = `${context.serviceName}:${context.error?.message || 'unknown'}`;
    
    // Return from cache if available and not expired
    const cached = this.cache.get(cacheKey);
    if (cached && !this.isExpired(cached)) {
      console.log(`[CachedFallback] Returning cached data for ${context.serviceName}`);
      return cached.value;
    }
    
    throw new Error('No valid cache available');
  }
  
  setCache(serviceName: string, key: string, value: any): void {
    const cacheKey = `${serviceName}:${key}`;
    this.cache.set(cacheKey, {
      value,
      timestamp: Date.now(),
    });
  }
  
  private isExpired(entry: { timestamp: number }): boolean {
    return Date.now() - entry.timestamp > this.cacheTTL;
  }
  
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * RetryFallback - Automatically retries operation with backoff
 */
export class RetryFallback implements FallbackStrategy {
  readonly name = 'retry';
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  
  constructor(config?: { 
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  }) {
    this.maxRetries = config?.maxRetries ?? 3;
    this.baseDelayMs = config?.baseDelayMs ?? 1000;
    this.maxDelayMs = config?.maxDelayMs ?? 10000;
  }
  
  async fallback(context: FallbackContext): Promise<any> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const delay = Math.min(
        this.baseDelayMs * Math.pow(2, attempt),
        this.maxDelayMs
      );
      
      await this.sleep(delay);
      
      try {
        // Attempt to re-execute original operation
        const retryResult = await context.retryOperation?.();
        
        if (retryResult) {
          console.log(`[RetryFallback] Success after ${attempt + 1} attempt(s)`);
          return retryResult;
        }
      } catch (error) {
        lastError = error as Error;
        console.warn(`[RetryFallback] Attempt ${attempt + 1}/${this.maxRetries} failed`);
      }
    }
    
    throw new Error(
      `Retry fallback exhausted after ${this.maxRetries} attempts. Last error: ${lastError?.message}`
    );
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * DefaultFallback - Returns default/predefined value
 */
export class DefaultFallback implements FallbackStrategy {
  readonly name = 'default';
  private defaultValue: any;
  private valueFactory?: () => any;
  
  constructor(defaultValue?: any, valueFactory?: () => any) {
    this.defaultValue = defaultValue;
    this.valueFactory = valueFactory;
  }
  
  async fallback(context: FallbackContext): Promise<any> {
    let result: any;
    
    if (this.valueFactory) {
      result = await this.valueFactory();
    } else if (this.defaultValue !== undefined) {
      result = this.defaultValue;
    } else {
      throw new Error('DefaultFallback has no configured default value or factory');
    }
    
    console.log(`[DefaultFallback] Returning default value for ${context.serviceName}`);
    return result;
  }
}

/**
 * ChainFallback - Combines multiple fallback strategies in sequence
 */
export class ChainFallback implements FallbackStrategy {
  readonly name = 'chain';
  private strategies: FallbackStrategy[] = [];
  
  addStrategy(strategy: FallbackStrategy): ChainFallback {
    this.strategies.push(strategy);
    return this;
  }
  
  async fallback(context: FallbackContext): Promise<any> {
    let lastError: Error | undefined;
    
    for (const strategy of this.strategies) {
      try {
        return await strategy.fallback(context);
      } catch (error) {
        lastError = error as Error;
        console.warn(`[ChainFallback] Strategy "${strategy.name}" failed, trying next`);
      }
    }
    
    throw new Error(
      `All fallback strategies failed. Last error: ${lastError?.message}`
    );
  }
}

/**
 * AdvancedFallbackWithCircuit - Integrated fallback with circuit breaker management
 */
export class AdvancedFallbackWithCircuit implements FallbackStrategy {
  readonly name = 'advanced-circuit';
  private fallbackStrategies: Map<string, FallbackStrategy> = new Map();
  
  register(name: string, strategy: FallbackStrategy): void {
    this.fallbackStrategies.set(name, strategy);
  }
  
  async fallback(context: FallbackContext): Promise<any> {
    const breakerName = context.serviceName.replace(/[^a-zA-Z0-9]/g, '-');
    
    // Try different strategies based on failure type
    if (context.error?.message?.includes('timeout')) {
      return await new RetryFallback({ maxRetries: 2 }).fallback(context);
    }
    
    if (context.circuitState === 'OPEN') {
      return await new DefaultFallback(null).fallback(context);
    }
    
    // Default to cached
    try {
      return await new CachedFallback().fallback(context);
    } catch {
      return await new DefaultFallback(undefined).fallback(context);
    }
  }
  
  getStrategies(): Map<string, FallbackStrategy> {
    return new Map(this.fallbackStrategies);
  }
}

// Export singleton instances
export const cachedFallback = new CachedFallback();
export const retryFallback = new RetryFallback();
export const defaultFallback = new DefaultFallback(null);
export const chainFallback = new ChainFallback()
  .addStrategy(new RetryFallback())
  .addStrategy(new DefaultFallback(null));
