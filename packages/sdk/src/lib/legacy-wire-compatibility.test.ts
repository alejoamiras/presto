import { expect, test } from "bun:test";
import legacy from "../../../../audit/fixtures/legacy-wire-contract.json";
import { isRecognizedHealthBody, PrestoTransport } from "./presto-transport.js";

test.each([legacy.minimalHealth, legacy.detailedHealth])(
  "Presto transport accepts the historical native health/prove contract %#",
  async (health) => {
    const requests: Array<{
      path: string;
      method: string;
      type: string | null;
      version: string | null;
      bytes: number[];
    }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        requests.push({
          path,
          method: request.method,
          type: request.headers.get("content-type"),
          version: request.headers.get("x-aztec-version"),
          bytes: [...new Uint8Array(await request.arrayBuffer())],
        });
        if (path === "/health") return Response.json(health);
        if (path === "/prove") return Response.json(legacy.proveResponse);
        return new Response(null, { status: 404 });
      },
    });
    try {
      const transport = new PrestoTransport("127.0.0.1", server.port!, server.port!, false);
      const probe = await transport.probeHealth();
      expect(probe.protocol).toBe("http");
      expect(probe.body).toEqual(health);
      expect(isRecognizedHealthBody(probe.body)).toBe(true);
      expect(
        requests.every((request) => request.path === "/health" && request.bytes.length === 0),
      ).toBe(true);
      transport.setProtocol(probe.protocol);
      const witness = new Uint8Array([31, 139, 0, 1, 2, 255]);
      const response = await transport.postProve(witness, "5.2.0");
      expect(await transport.readProveBody(response)).toBe(legacy.proveResponse.proof);
      expect(requests.filter((request) => request.path === "/prove")).toEqual([
        {
          path: "/prove",
          method: "POST",
          type: "application/octet-stream",
          version: "5.2.0",
          bytes: [...witness],
        },
      ]);
    } finally {
      await server.stop(true);
    }
  },
);
