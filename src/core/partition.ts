import type { PartitionMetrics } from "./types";

export class Partition {
  readonly id: number;
  private readonly items = new Map<string, string>();
  readonly metrics: PartitionMetrics = {
    requests: 0,
    accepted: 0,
    throttled: 0,
    capacityConsumed: 0,
    lastDemand: 0
  };

  constructor(id: number) {
    this.id = id;
  }

  get(key: string): string | undefined {
    return this.items.get(key);
  }

  put(key: string, value: string): void {
    this.items.set(key, value);
  }

  delete(key: string): boolean {
    return this.items.delete(key);
  }

  recordRequest(accepted: boolean, cost: number): void {
    this.metrics.requests += 1;
    this.metrics.lastDemand += 1;
    if (accepted) {
      this.metrics.accepted += 1;
      this.metrics.capacityConsumed += cost;
    } else {
      this.metrics.throttled += 1;
    }
  }

  resetIntervalDemand(): void {
    this.metrics.lastDemand = 0;
  }
}
