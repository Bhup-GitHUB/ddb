import { KvService } from "../core/service";
import type { MetadataMode } from "../core/metadata";
import type { PolicyMode } from "../core/types";

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { "content-type": "application/json", ...headers } });
}

export function createServer(service: KvService, port = 3000): ReturnType<typeof Bun.serve> {
  return Bun.serve({ hostname: "127.0.0.1", port, fetch: createFetchHandler(service) });
}

export function createFetchHandler(service: KvService): (request: Request) => Response | Promise<Response> {
  return async (request) => {
      const url = new URL(request.url);
      const path = url.pathname;
      const headers = { "x-service": "ddb-hot-partition-prototype" };

      if (request.method === "GET" && path === "/health") return json({ status: "ok" }, 200, headers);
      if (request.method === "GET" && path === "/v1/metrics") return json(service.metrics(), 200, headers);
      if (request.method === "GET" && path === "/v1/config") return json(service.configSnapshot(), 200, headers);
      if (request.method === "POST" && path === "/v1/admin/reset") {
        service.reset();
        return json({ status: "reset" }, 200, headers);
      }
      if (request.method === "POST" && path === "/v1/admin/invalidate-metadata") {
        service.invalidateMetadata();
        return json({ status: "invalidated" }, 200, headers);
      }

      const match = path.match(/^\/v1\/items\/(.+)$/);
      if (!match) return json({ error: "not_found" }, 404, headers);
      const key = decodeURIComponent(match[1]);
      const result = request.method === "GET"
        ? service.get(key)
        : request.method === "DELETE"
          ? service.delete(key)
          : request.method === "PUT"
            ? service.put(key, await readValue(request))
            : undefined;
      if (!result) return json({ error: "method_not_allowed" }, 405, headers);

      const resultHeaders = {
        ...headers,
        "x-partition-id": String(result.partitionId),
        "x-admission-policy": service.config.policy
      };
      if (result.status === 429) {
        return json({ error: "throttled", reason: result.throttleReason }, 429, resultHeaders);
      }
      if (result.status === 204) return new Response(null, { status: 204, headers: resultHeaders });
      return json(result.value === undefined ? { status: "ok" } : { value: result.value }, result.status, resultHeaders);
  };
}

async function readValue(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json() as { value?: unknown };
    if (typeof body.value !== "string") throw new Error("value must be a string");
    return body.value;
  }
  return await request.text();
}

export function configFromEnvironment(): { policy: PolicyMode; metadataMode: MetadataMode; port: number } {
  const policy = (Bun.env.POLICY ?? "fixed") as PolicyMode;
  const metadataMode = (Bun.env.METADATA_MODE ?? "steady") as MetadataMode;
  return { policy, metadataMode, port: Number(Bun.env.PORT ?? 3000) };
}
