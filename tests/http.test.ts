import { describe, expect, test } from "bun:test";
import { KvService } from "../src/core/service";
import { createFetchHandler } from "../src/http/server";

const handler = createFetchHandler(new KvService({ partitionCount: 1, partitionCapacityPerSecond: 10 }));

describe("http api", () => {
  test("serves health and item operations", async () => {
    expect((await handler(new Request("http://localhost/health"))).status).toBe(200);
    expect((await handler(new Request("http://localhost/v1/items/a", { method: "PUT", body: "one" }))).status).toBe(201);
    const response = await handler(new Request("http://localhost/v1/items/a"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: "one" });
    expect(response.headers.get("x-partition-id")).toBe("0");
  });

  test("exposes metrics and reset", async () => {
    expect((await handler(new Request("http://localhost/v1/metrics"))).status).toBe(200);
    expect((await handler(new Request("http://localhost/v1/admin/reset", { method: "POST" }))).status).toBe(200);
    expect((await (await handler(new Request("http://localhost/v1/metrics"))).json()).requests).toBe(0);
  });
});
