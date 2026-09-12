import { AdmissionController, type AdmissionConfig } from "./admission";
import { SystemClock } from "./clock";
import { MetadataService, type MetadataMode } from "./metadata";
import { Partition } from "./partition";
import { partitionForKey } from "./hash";
import type { Clock, Operation, PolicyMode, ServiceMetrics } from "./types";

export interface KvServiceConfig extends AdmissionConfig {
  policy: PolicyMode;
  metadataMode: MetadataMode;
}

export interface KvResult {
  status: number;
  value?: string;
  partitionId: number;
  throttleReason?: string;
}

export class KvService {
  readonly config: KvServiceConfig;
  private readonly partitions: Partition[];
  private readonly metadata: MetadataService;
  private readonly admission: AdmissionController;
  private readonly clock: Clock;
  private readonly latencyMs: number[] = [];
  private requests = 0;
  private accepted = 0;
  private throttled = 0;

  constructor(config: Partial<KvServiceConfig> = {}, clock: Clock = new SystemClock()) {
    this.clock = clock;
    this.config = {
      partitionCount: config.partitionCount ?? 5,
      partitionCapacityPerSecond: config.partitionCapacityPerSecond ?? 100,
      burstWindowSeconds: config.burstWindowSeconds ?? 300,
      tableCapacityPerSecond: config.tableCapacityPerSecond ?? (config.partitionCount ?? 5) * (config.partitionCapacityPerSecond ?? 100),
      adaptiveIntervalMs: config.adaptiveIntervalMs ?? 1000,
      policy: config.policy ?? "fixed",
      metadataMode: config.metadataMode ?? "steady",
      clock
    };
    this.partitions = Array.from({ length: this.config.partitionCount }, (_, id) => new Partition(id));
    this.metadata = new MetadataService(this.config.metadataMode);
    this.admission = new AdmissionController(this.config.policy, this.config);
  }

  get(key: string): KvResult {
    return this.execute("get", key, undefined);
  }

  put(key: string, value: string): KvResult {
    return this.execute("put", key, value);
  }

  delete(key: string): KvResult {
    return this.execute("delete", key, undefined);
  }

  metrics(): ServiceMetrics {
    const metadata = this.metadata.getMetrics();
    return {
      requests: this.requests,
      accepted: this.accepted,
      throttled: this.throttled,
      throttleRate: this.requests === 0 ? 0 : this.throttled / this.requests,
      metadataRequests: metadata.requests,
      metadataCacheHits: metadata.cacheHits,
      metadataCacheHitRate: metadata.cacheHitRate,
      latencyMs: [...this.latencyMs],
      partitions: Object.fromEntries(this.partitions.map((partition) => [String(partition.id), { ...partition.metrics }]))
    };
  }

  configSnapshot(): Omit<KvServiceConfig, "clock"> {
    const { clock: _clock, ...config } = this.config;
    return config;
  }

  reset(): void {
    for (const partition of this.partitions) {
      partition.metrics.requests = 0;
      partition.metrics.accepted = 0;
      partition.metrics.throttled = 0;
      partition.metrics.capacityConsumed = 0;
      partition.metrics.lastDemand = 0;
    }
    this.metadata.reset();
    this.admission.reset();
    this.latencyMs.length = 0;
    this.requests = 0;
    this.accepted = 0;
    this.throttled = 0;
  }

  invalidateMetadata(): void {
    this.metadata.invalidate();
  }

  private execute(operation: Operation, key: string, value: string | undefined): KvResult {
    const started = this.clock.nowMs();
    const partitionId = partitionForKey(key, this.config.partitionCount);
    this.metadata.lookup(key, partitionId);
    const partition = this.partitions[partitionId];
    const decision = this.admission.admit({ key, operation, cost: 1, partitionId, nowMs: this.clock.nowMs() });
    this.requests += 1;
    if (!decision.admitted) {
      partition.recordRequest(false, 1);
      this.throttled += 1;
      this.latencyMs.push(Math.max(0, this.clock.nowMs() - started));
      return { status: 429, partitionId, throttleReason: decision.reason };
    }

    partition.recordRequest(true, 1);
    this.accepted += 1;
    let status = 200;
    let resultValue: string | undefined;
    if (operation === "get") {
      resultValue = partition.get(key);
      status = resultValue === undefined ? 404 : 200;
    } else if (operation === "put") {
      partition.put(key, value ?? "");
      status = 201;
    } else {
      partition.delete(key);
      status = 204;
    }
    this.latencyMs.push(Math.max(0, this.clock.nowMs() - started));
    return { status, value: resultValue, partitionId };
  }
}
