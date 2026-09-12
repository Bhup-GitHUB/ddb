# DynamoDB Hot Partition Prototype

This is a small TypeScript and Bun prototype for explaining DynamoDB’s hot-partition problem and the design choice of predictability over absolute efficiency.

The 2022 DynamoDB paper reports that, during the 66-hour 2021 Amazon Prime Day event, Amazon systems made trillions of API calls to DynamoDB and peaked at 89.2 million requests per second. The production service evolved mechanisms such as bursting, adaptive capacity, and global admission control to handle skewed traffic while keeping behavior predictable.

Sources:

- [Amazon DynamoDB: A Scalable, Predictably Performant, and Fully Managed NoSQL Database Service](https://www.usenix.org/system/files/atc22-elhemali.pdf)
- [Lessons learned from 10 years of DynamoDB](https://www.amazon.science/blog/lessons-learned-from-10-years-of-dynamodb)

## What the prototype models

The service stores values in a fixed number of logical partitions. A stable hash maps every key to one partition. Each partition has a token bucket representing its assigned throughput.

The available policies are:

- `fixed`: independent partition capacity with no sharing.
- `bursting`: unused capacity is retained in a burst bucket for up to 300 seconds.
- `adaptive`: sustained hot partitions receive capacity from cold partitions.
- `gac`: a table-level token bucket limits total admission.
- `full`: bursting, adaptive capacity, and global admission control together.

This is an educational model. It does not implement replication, persistence, MultiPaxos, failover, or a multi-node deployment. It also uses one capacity unit per request so the admission behavior is easy to observe.

## Run the service

Install dependencies and run the default fixed-policy service:

```sh
bun install
bun run dev
```

Run another policy:

```sh
POLICY=full bun run dev
```

The HTTP API is:

```sh
curl -X PUT http://localhost:3000/v1/items/customer-1 -d 'active'
curl http://localhost:3000/v1/items/customer-1
curl http://localhost:3000/v1/metrics
curl http://localhost:3000/v1/config
curl -X POST http://localhost:3000/v1/admin/reset
```

The item endpoint also accepts JSON bodies such as `{"value":"active"}`. Throttled requests return HTTP `429` and include the partition ID and throttle reason in the response.

## Run the experiment

Run all policies with the same seeded Zipfian workload:

```sh
bun run benchmark:compare -- --duration-ms 3000 --rps 2000 --keys 1000 --zipf-alpha 1.2 --seed 42
```

The command prints a terminal table and writes `benchmark-results.json`. The report includes total throttle rate, hottest-partition throttle rate, latency percentiles, and per-partition request counts.

The benchmark invokes the same HTTP fetch handler in-process. This keeps the experiment reproducible in restricted local environments while exercising the complete request, routing, admission, storage, and metrics path. The standalone service remains available over HTTP for manual requests.

## Predictability experiment

The default metadata mode performs a metadata-service touch for every request, even when routing metadata is locally cached. This keeps metadata work proportional to customer traffic.

To demonstrate the older cache-fallback shape:

```sh
METADATA_MODE=cache-fallback bun run dev
curl -X POST http://localhost:3000/v1/admin/invalidate-metadata
```

The metrics endpoint exposes metadata lookups, cache hits, and cache-hit rate so the difference can be observed without adding a separate metadata database.

## Verification

```sh
bun run typecheck
bun test
```

The tests cover token refill behavior, deterministic routing, CRUD behavior, throttling, metadata work, adaptive capacity, and the HTTP handler.
