import isPortReachable from "is-port-reachable";
import { ENV } from "../src/env";

let ready = false;
let retries = 20;

while (!ready && retries--) {
  console.log("🔄 Waiting for database to be ready...");
  ready = await isPortReachable(ENV.DB_PORT, { host: ENV.DB_HOST });
  if (!ready) await new Promise((res) => setTimeout(res, 500));
}

if (!ready) {
  console.error("❌ Database not reachable after timeout.");
  process.exit(1);
}

console.log("✅ Database is reachable.");