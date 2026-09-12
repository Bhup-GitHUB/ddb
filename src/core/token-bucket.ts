import type { Clock } from "./types";

export interface TokenBucketConfig {
  refillRatePerSecond: number;
  capacity: number;
  clock: Clock;
}

export class TokenBucket {
  private refillRatePerMs: number;
  private capacity: number;
  private tokens: number;
  private lastRefillMs: number;

  constructor(config: TokenBucketConfig) {
    if (config.refillRatePerSecond <= 0) throw new Error("refill rate must be positive");
    if (config.capacity <= 0) throw new Error("capacity must be positive");
    this.refillRatePerMs = config.refillRatePerSecond / 1000;
    this.capacity = config.capacity;
    this.tokens = config.capacity;
    this.lastRefillMs = config.clock.nowMs();
    this.clock = config.clock;
  }

  private readonly clock: Clock;

  consume(cost: number): boolean {
    if (cost < 0) throw new Error("cost cannot be negative");
    this.refill();
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  refill(): void {
    const nowMs = this.clock.nowMs();
    const elapsedMs = Math.max(0, nowMs - this.lastRefillMs);
    this.tokens = Math.min(this.capacity, this.tokens + elapsedMs * this.refillRatePerMs);
    this.lastRefillMs = nowMs;
  }

  setRateAndCapacity(refillRatePerSecond: number, capacity: number): void {
    if (refillRatePerSecond <= 0 || capacity <= 0) throw new Error("bucket settings must be positive");
    this.refill();
    this.capacity = capacity;
    this.tokens = Math.min(this.tokens, capacity);
    this.refillRatePerMs = refillRatePerSecond / 1000;
  }

  getRemaining(): number {
    this.refill();
    return this.tokens;
  }
}
