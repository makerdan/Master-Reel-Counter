import type { Server } from "node:http";
import type { HmrOptions } from "vite";

export function createHmrOptions(
  server: Server,
  replitDevDomain = process.env.REPLIT_DEV_DOMAIN,
): HmrOptions {
  const sharedOptions: HmrOptions = {
    server,
    path: "/vite-hmr",
  };

  if (!replitDevDomain) {
    return sharedOptions;
  }

  return {
    ...sharedOptions,
    protocol: "wss",
    host: replitDevDomain,
    clientPort: 443,
  };
}