import { describe, expect, test } from "bun:test";
import { FakeClock } from "../src/core/clock";
import { hashKey, partitionForKey } from "../src/core/hash";
import { KvService } from "../src/core/service";
import { TokenBucket } from "../src/core/token-bucket";

describe("token bucket", () => {
  test("refills based on elapsed time", () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket({ refillRatePerSecond: 10, capacity: 10, clock });
    expect(bucket.consume(10)).toBe(true);
    expect(bucket.consume(1)).toBe(false);
    clock.advance(100);
    expect(bucket.consume(1)).toBe(true);
  });

  test("never exceeds configured capacity", () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket({ refillRatePerSecond: 10, capacity: 10, clock });
    clock.advance(10_000);
    expect(bucket.getRemaining()).toBe(10);
  });
});

describe("partition routing", () => {
  test("is deterministic", () => {
    expect(hashKey("customer-1")).toBe(hashKey("customer-1"));
    expect(partitionForKey("customer-1", 5)).toBe(partitionForKey("customer-1", 5));
  });
});

describe("kv service", () => {
  test("supports put, get, and delete", () => {
    const service = new KvService({ partitionCount: 2, partitionCapacityPerSecond: 100 });
    expect(service.put("a", "one").status).toBe(201);
    expect(service.get("a")).toMatchObject({ status: 200, value: "one" });
    expect(service.delete("a").status).toBe(204);
    expect(service.get("a").status).toBe(404);
  });

  test("returns throttling metrics for exhausted partitions", () => {
    const service = new KvService({ partitionCount: 1, partitionCapacityPerSecond: 1 });
    expect(service.put("a", "one").status).toBe(201);
    expect(service.put("b", "two").status).toBe(429);
    expect(service.metrics()).toMatchObject({ requests: 2, accepted: 1, throttled: 1, throttleRate: 0.5 });
  });

  test("steady metadata mode keeps backend work proportional to requests", () => {
    const service = new KvService({ partitionCount: 1, partitionCapacityPerSecond: 100, metadataMode: "steady" });
    service.put("a", "one");
    service.get("a");
    expect(service.metrics()).toMatchObject({ metadataRequests: 2, metadataCacheHits: 1, metadataCacheHitRate: 0.5 });
  });

  test("adaptive mode moves capacity toward a sustained hot partition", () => {
    const clock = new FakeClock();
    const service = new KvService({
      partitionCount: 2,
      partitionCapacityPerSecond: 10,
      adaptiveIntervalMs: 100,
      policy: "adaptive"
    }, clock);
    const hotKey = "hot";
    const coldKey = "cold";
    const hotPartition = service.put(hotKey, "one").partitionId;
    const coldPartition = hotPartition === 0 ? 1 : 0;
    for (let index = 0; index < 8; index += 1) service.get(hotKey);
    service.get(coldKey);
    clock.advance(100);
    service.get(hotKey);
    expect(service.config.partitionCount).toBe(2);
    const rates = [service.partitionRate(0), service.partitionRate(1)];
    expect(rates[hotPartition]).toBeGreaterThan(rates[coldPartition]);
    expect(rates[hotPartition] + rates[coldPartition]).toBe(20);
  });
});
