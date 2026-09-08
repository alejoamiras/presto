// Manual review page: `bun run dev` from packages/banners. Bun bundles main.ts on the fly.
import index from "./index.html";

const server = Bun.serve({ hostname: "127.0.0.1", port: 0, routes: { "/": index } });
console.log(`presto-banner demo → ${server.url}`);
