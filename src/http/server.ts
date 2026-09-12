import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { KvService, type KvResult } from "../core/service";
import type { MetadataMode } from "../core/metadata";
import type { PolicyMode } from "../core/types";

export function createApp(service: KvService): Hono {
  const app = new Hono();

  app.use("*", async (context, next) => {
    context.header("x-service", "ddb-hot-partition-prototype");
    await next();
  });

  app.get("/health", (context) => context.json({ status: "ok" }));
  app.get("/v1/metrics", (context) => context.json(service.metrics()));
  app.get("/v1/config", (context) => context.json(service.configSnapshot()));

  app.post("/v1/admin/reset", (context) => {
    service.reset();
    return context.json({ status: "reset" });
  });

  app.post("/v1/admin/invalidate-metadata", (context) => {
    service.invalidateMetadata();
    return context.json({ status: "invalidated" });
  });

  app.get("/v1/items/:key", (context) => respond(context, service.get(context.req.param("key")), service));
  app.put("/v1/items/:key", async (context) => {
    const value = await readValue(context);
    return respond(context, service.put(context.req.param("key"), value), service);
  });
  app.delete("/v1/items/:key", (context) => respond(context, service.delete(context.req.param("key")), service));

  app.notFound((context) => context.json({ error: "not_found" }, 404));
  app.onError((error, context) => context.json({ error: error.message }, 400));

  return app;
}

export function createFetchHandler(service: KvService): (request: Request) => Response | Promise<Response> {
  return createApp(service).fetch;
}

export function createServer(service: KvService, port = 3000): ReturnType<typeof Bun.serve> {
  return Bun.serve({ hostname: "127.0.0.1", port, fetch: createApp(service).fetch });
}

export function configFromEnvironment(): { policy: PolicyMode; metadataMode: MetadataMode; port: number } {
  const policy = (Bun.env.POLICY ?? "fixed") as PolicyMode;
  const metadataMode = (Bun.env.METADATA_MODE ?? "steady") as MetadataMode;
  return { policy, metadataMode, port: Number(Bun.env.PORT ?? 3000) };
}

function respond(context: Context, result: KvResult, service: KvService): Response {
  context.header("x-partition-id", String(result.partitionId));
  context.header("x-admission-policy", service.config.policy);
  if (result.status === 429) return context.json({ error: "throttled", reason: result.throttleReason }, 429);
  if (result.status === 204) return context.body(null, 204);
  const body = result.value === undefined ? { status: "ok" } : { value: result.value };
  return context.json(body, result.status as ContentfulStatusCode);
}

async function readValue(context: Context): Promise<string> {
  const contentType = context.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await context.req.json<{ value?: unknown }>();
    if (typeof body.value !== "string") throw new Error("value must be a string");
    return body.value;
  }
  return context.req.text();
}
