import { KvService } from "./core/service";
import { configFromEnvironment, createServer } from "./http/server";

const environment = configFromEnvironment();
const service = new KvService({ policy: environment.policy, metadataMode: environment.metadataMode });
const server = createServer(service, environment.port);

console.log(`ddb prototype listening on http://localhost:${server.port} with ${environment.policy} policy`);
