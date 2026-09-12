export type PolicyMode = "fixed" | "bursting" | "adaptive" | "gac" | "full";
export type Operation = "get" | "put" | "delete";

export interface Clock {
  nowMs(): number;
}

export interface RequestContext {
  key: string;
  operation: Operation;
  cost: number;
  partitionId: number;
  nowMs: number;
}

export interface AdmissionDecision {
  admitted: boolean;
  reason?: "partition_capacity" | "burst_exhausted" | "table_capacity";
  partitionId: number;
  remainingPartitionTokens: number;
  remainingTableTokens?: number;
}

export interface PartitionMetrics {
  requests: number;
  accepted: number;
  throttled: number;
  capacityConsumed: number;
  lastDemand: number;
}

export interface ServiceMetrics {
  requests: number;
  accepted: number;
  throttled: number;
  throttleRate: number;
  metadataRequests: number;
  metadataCacheHits: number;
  metadataCacheHitRate: number;
  latencyMs: number[];
  partitions: Record<string, PartitionMetrics>;
}
