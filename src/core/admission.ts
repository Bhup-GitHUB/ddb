import { TokenBucket } from "./token-bucket";
import type { AdmissionDecision, Clock, PolicyMode, RequestContext } from "./types";

export interface AdmissionConfig {
  partitionCount: number;
  partitionCapacityPerSecond: number;
  burstWindowSeconds: number;
  tableCapacityPerSecond: number;
  adaptiveIntervalMs: number;
  clock: Clock;
}

interface PartitionAdmissionState {
  baseRate: number;
  currentRate: number;
  bucket: TokenBucket;
  burstBucket: TokenBucket;
  demand: number;
  throttled: number;
}

export class AdmissionController {
  private readonly partitions: PartitionAdmissionState[];
  private readonly tableBucket: TokenBucket;
  private readonly config: AdmissionConfig;
  private lastAdaptiveMs: number;

  constructor(private readonly mode: PolicyMode, config: AdmissionConfig) {
    this.config = config;
    this.lastAdaptiveMs = config.clock.nowMs();
    this.partitions = Array.from({ length: config.partitionCount }, () => {
      const baseRate = config.partitionCapacityPerSecond;
      return {
        baseRate,
        currentRate: baseRate,
        bucket: new TokenBucket({ refillRatePerSecond: baseRate, capacity: baseRate, clock: config.clock }),
        burstBucket: new TokenBucket({
          refillRatePerSecond: baseRate,
          capacity: baseRate * config.burstWindowSeconds,
          clock: config.clock
        }),
        demand: 0,
        throttled: 0
      };
    });
    this.tableBucket = new TokenBucket({
      refillRatePerSecond: config.tableCapacityPerSecond,
      capacity: config.tableCapacityPerSecond,
      clock: config.clock
    });
  }

  admit(context: RequestContext): AdmissionDecision {
    this.maybeAdapt(context.nowMs);
    const state = this.partitions[context.partitionId];
    state.demand += 1;

    if (this.mode === "gac" || this.mode === "full") {
      if (!this.tableBucket.consume(context.cost)) {
        state.throttled += 1;
        return {
          admitted: false,
          reason: "table_capacity",
          partitionId: context.partitionId,
          remainingPartitionTokens: state.bucket.getRemaining(),
          remainingTableTokens: this.tableBucket.getRemaining()
        };
      }
    }

    if (state.bucket.consume(context.cost)) {
      return this.decision(true, context.partitionId);
    }

    if (this.mode === "bursting" || this.mode === "full") {
      if (state.burstBucket.consume(context.cost)) {
        return this.decision(true, context.partitionId);
      }
      state.throttled += 1;
      return this.decision(false, context.partitionId, "burst_exhausted");
    }

    state.throttled += 1;
    return this.decision(false, context.partitionId, "partition_capacity");
  }

  getPartitionRate(partitionId: number): number {
    return this.partitions[partitionId].currentRate;
  }

  reset(): void {
    for (const state of this.partitions) {
      state.currentRate = state.baseRate;
      state.demand = 0;
      state.throttled = 0;
      state.bucket.setRateAndCapacity(state.baseRate, state.baseRate);
      state.burstBucket.setRateAndCapacity(state.baseRate, state.baseRate * this.config.burstWindowSeconds);
    }
    this.tableBucket.setRateAndCapacity(this.config.tableCapacityPerSecond, this.config.tableCapacityPerSecond);
    this.lastAdaptiveMs = this.config.clock.nowMs();
  }

  private decision(admitted: boolean, partitionId: number, reason?: AdmissionDecision["reason"]): AdmissionDecision {
    const state = this.partitions[partitionId];
    return {
      admitted,
      reason,
      partitionId,
      remainingPartitionTokens: state.bucket.getRemaining(),
      remainingTableTokens: this.mode === "gac" || this.mode === "full" ? this.tableBucket.getRemaining() : undefined
    };
  }

  private maybeAdapt(nowMs: number): void {
    if (this.mode !== "adaptive" && this.mode !== "full") return;
    if (nowMs - this.lastAdaptiveMs < this.config.adaptiveIntervalMs) return;
    this.lastAdaptiveMs = nowMs;

    const hot = [...this.partitions].sort((left, right) => right.demand - left.demand);
    const cold = [...this.partitions].sort((left, right) => left.demand - right.demand);
    const hotState = hot[0];
    const coldState = cold[0];
    if (!hotState || !coldState || hotState === coldState || hotState.demand <= coldState.demand * 1.25) {
      for (const state of this.partitions) state.demand = 0;
      return;
    }

    const transfer = Math.max(1, Math.floor(coldState.currentRate * 0.5));
    const minimumRate = Math.max(1, Math.floor(coldState.baseRate * 0.25));
    if (coldState.currentRate - transfer >= minimumRate) {
      coldState.currentRate -= transfer;
      hotState.currentRate += transfer;
      hotState.bucket.setRateAndCapacity(hotState.currentRate, hotState.currentRate);
      coldState.bucket.setRateAndCapacity(coldState.currentRate, coldState.currentRate);
    }

    for (const state of this.partitions) state.demand = 0;
  }
}
