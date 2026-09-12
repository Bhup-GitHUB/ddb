export type MetadataMode = "steady" | "cache-fallback";

export class MetadataService {
  private readonly cache = new Map<string, number>();
  private requests = 0;
  private cacheHits = 0;
  private lookups = 0;
  private invalidated = false;

  constructor(private readonly mode: MetadataMode = "steady") {}

  lookup(key: string, partitionId: number): number {
    this.lookups += 1;
    const cached = this.cache.get(key);
    const hit = cached === partitionId && !this.invalidated;
    if (hit) this.cacheHits += 1;
    this.requests += this.mode === "steady" ? 1 : hit ? 0 : 1;
    this.cache.set(key, partitionId);
    return partitionId;
  }

  invalidate(): void {
    this.invalidated = true;
  }

  reset(): void {
    this.cache.clear();
    this.requests = 0;
    this.cacheHits = 0;
    this.lookups = 0;
    this.invalidated = false;
  }

  getMetrics(): { requests: number; cacheHits: number; cacheHitRate: number } {
    return {
      requests: this.requests,
      cacheHits: this.cacheHits,
      cacheHitRate: this.lookups === 0 ? 0 : this.cacheHits / this.lookups
    };
  }
}
