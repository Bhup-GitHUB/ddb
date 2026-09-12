import { KvService } from "./core/service";
import { createFetchHandler } from "./http/server";
import type { PolicyMode } from "./core/types";

interface BenchmarkOptions {
  durationMs: number;
  requestsPerSecond: number;
  keyCount: number;
  zipfAlpha: number;
  seed: number;
  port: number;
  compare: boolean;
}

interface BenchmarkResult {
  policy: PolicyMode;
  config: BenchmarkOptions;
  requests: number;
  accepted: number;
  throttled: number;
  throttleRate: number;
  latency: { p50: number; p95: number; p99: number };
  partitions: Record<string, { requests: number; accepted: number; throttled: number }>;
}

class Random {
  constructor(private state: number) {}

  next(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }
}

function parseOptions(): BenchmarkOptions {
  const args = process.argv.slice(2);
  const value = (name: string, fallback: string): string => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? fallback : args[index + 1] ?? fallback;
  };
  return {
    durationMs: Number(value("duration-ms", "3000")),
    requestsPerSecond: Number(value("rps", "1000")),
    keyCount: Number(value("keys", "1000")),
    zipfAlpha: Number(value("zipf-alpha", "1.2")),
    seed: Number(value("seed", "42")),
    port: Number(value("port", "3210")),
    compare: args.includes("--compare")
  };
}

function zipfSampler(keyCount: number, alpha: number, random: Random): () => string {
  const weights = Array.from({ length: keyCount }, (_, index) => 1 / Math.pow(index + 1, alpha));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const cumulative: number[] = [];
  let sum = 0;
  for (const weight of weights) {
    sum += weight / total;
    cumulative.push(sum);
  }
  return () => {
    const target = random.next();
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (cumulative[middle] < target) low = middle + 1;
      else high = middle;
    }
    return `key-${low}`;
  };
}

async function runPolicy(policy: PolicyMode, options: BenchmarkOptions): Promise<BenchmarkResult> {
  const service = new KvService({
    policy,
    partitionCount: 5,
    partitionCapacityPerSecond: 100,
    tableCapacityPerSecond: 500,
    adaptiveIntervalMs: 250
  });
  const handler = createFetchHandler(service);
  const random = new Random(options.seed);
  const nextKey = zipfSampler(options.keyCount, options.zipfAlpha, random);
  const intervalMs = 100;
  const batchSize = Math.max(1, Math.floor(options.requestsPerSecond * intervalMs / 1000));
  const started = Date.now();

  try {
    while (Date.now() - started < options.durationMs) {
      const batch = Array.from({ length: batchSize }, () => handler(new Request(`http://localhost/v1/items/${nextKey()}`)));
      await Promise.all(batch);
      await Bun.sleep(intervalMs);
    }
    const metrics = await (await handler(new Request("http://localhost/v1/metrics"))).json() as ReturnType<KvService["metrics"]>;
    const latencies = [...metrics.latencyMs].sort((left, right) => left - right);
    return {
      policy,
      config: options,
      requests: metrics.requests,
      accepted: metrics.accepted,
      throttled: metrics.throttled,
      throttleRate: metrics.throttleRate,
      latency: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99)
      },
      partitions: Object.fromEntries(Object.entries(metrics.partitions).map(([id, value]) => [id, {
        requests: value.requests,
        accepted: value.accepted,
        throttled: value.throttled
      }]))
    };
  } finally {
    service.reset();
  }
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.floor(values.length * ratio))];
}

function printResults(results: BenchmarkResult[]): void {
  console.table(results.map((result) => ({
    policy: result.policy,
    requests: result.requests,
    accepted: result.accepted,
    throttled: result.throttled,
    throttleRate: `${(result.throttleRate * 100).toFixed(1)}%`,
    p50: `${result.latency.p50}ms`,
    p95: `${result.latency.p95}ms`,
    p99: `${result.latency.p99}ms`
  })));
}

const options = parseOptions();
const policies: PolicyMode[] = options.compare ? ["fixed", "bursting", "adaptive", "full"] : ["full"];
const results: BenchmarkResult[] = [];
for (const [index, policy] of policies.entries()) {
  results.push(await runPolicy(policy, { ...options, port: options.port + index }));
}
printResults(results);
await Bun.write("benchmark-results.json", JSON.stringify({ results }, null, 2));
console.log("wrote benchmark-results.json");
