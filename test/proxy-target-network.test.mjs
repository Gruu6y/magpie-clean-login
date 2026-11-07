// The provider leg of a proxy test must be an honest reachability check: it
// goes through the proxy's own TLS tunnel to the provider's API host, sends a
// bare GET with no credentials, and stops at the response headers. These
// tests use a real loopback CONNECT proxy and a self-signed TLS origin, so the
// wire behaviour (status handling, header-only reads, WAF resets, timeouts)
// is exercised rather than mocked away. No provider is contacted.

import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { join } from "node:path";
import { testProxy } from "../lib/proxy-test.mjs";

const key = readFileSync(join(import.meta.dir, "fixtures", "localhost-key.pem"));
const cert = readFileSync(join(import.meta.dir, "fixtures", "localhost-cert.pem"));
const servers = [];
const sockets = new Set();

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function track(server) {
  servers.push(server);
  return server;
}

function trackSocket(socket) {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  return socket;
}

afterAll(async () => {
  for (const socket of [...sockets]) socket.destroy();
  for (const server of servers.splice(0)) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function startHttps(handler) {
  const server = track(https.createServer({ key, cert }, handler));
  const port = await listen(server);
  return { port, server };
}

async function startTls(handler) {
  const server = track(tls.createServer({ key, cert }, handler));
  const port = await listen(server);
  return { port, server };
}

// A minimal CONNECT proxy. It records the CONNECT line and pipes the tunnel
// to a loopback TLS origin, so the probe's TLS handshake is real.
async function startTunnelProxy(targetPort, { refuse = false } = {}) {
  const connects = [];
  const server = track(
    net.createServer((socket) => {
      trackSocket(socket);
      let buffer = Buffer.alloc(0);
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) return;
        socket.removeListener("data", onData);
        connects.push(buffer.subarray(0, end).toString("latin1"));
        const rest = buffer.subarray(end + 4);
        if (refuse) {
          socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
          return;
        }
        const upstream = trackSocket(net.connect(targetPort, "127.0.0.1", () => {
          socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
          if (rest.length) upstream.write(rest);
          socket.pipe(upstream);
          upstream.pipe(socket);
        }));
        upstream.on("error", () => socket.destroy());
      };
      socket.on("data", onData);
    }),
  );
  const port = await listen(server);
  return { port, connects };
}

function targetFor(port) {
  return {
    kind: "provider",
    provider: "fixture",
    host: `127.0.0.1:${port}`,
    url: `https://127.0.0.1:${port}/`,
  };
}

function proxyFor(port) {
  return { type: "http", host: "127.0.0.1", port };
}

test("any application status proves the provider answered; the body is never read", async () => {
  for (const status of [200, 401, 403, 404]) {
    const seen = [];
    const origin = await startHttps((req, res) => {
      seen.push({ url: req.url, headers: { ...req.headers } });
      // Deliberately oversized and never finished: a probe that tried to read
      // the body would either time out or be rejected as too large.
      res.writeHead(status, { "content-length": "1000000" });
      res.flushHeaders();
    });
    const proxy = await startTunnelProxy(origin.port);
    const endpoint = `https://127.0.0.1:${origin.port}/`;
    const result = await testProxy(proxyFor(proxy.port), {
      endpoint,
      timeoutMs: 900,
      tlsRejectUnauthorized: false,
      target: targetFor(origin.port),
    });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(status);
    expect(result.provider).toBe("fixture");
    expect(result.tlsOnly).toBe(false);
    expect(result.latency).toBeGreaterThanOrEqual(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("/");
    expect(seen[0].headers.authorization).toBeUndefined();
    expect(seen[0].headers["proxy-authorization"]).toBeUndefined();
    expect(seen[0].headers["user-agent"]).toBe("magpie-clean-login");
    expect(proxy.connects[0]).toContain(`CONNECT 127.0.0.1:${origin.port}`);

    // The same origin without a target is the historical generic probe: it
    // must still read the body and therefore refuse this reply.
    const generic = await testProxy(proxyFor(proxy.port), {
      endpoint,
      timeoutMs: 900,
      tlsRejectUnauthorized: false,
    });
    expect(generic.ok).toBe(false);
  }
});

test("a provider that closes or answers non-HTTP after TLS reports handshake-only", async () => {
  for (const mode of ["garbage", "reset"]) {
    const origin = await startTls((socket) => {
      trackSocket(socket);
      if (mode === "garbage") socket.write("NOT-HTTP/1.1 whatever\r\n\r\n");
      setTimeout(() => socket.destroy(), 15);
    });
    const proxy = await startTunnelProxy(origin.port);
    const result = await testProxy(proxyFor(proxy.port), {
      endpoint: `https://127.0.0.1:${origin.port}/`,
      timeoutMs: 900,
      tlsRejectUnauthorized: false,
      target: targetFor(origin.port),
    });
    expect(result.ok).toBe(true);
    expect(result.tlsOnly).toBe(true);
    expect(result.statusCode).toBe(0);
    expect(result.latency).toBeGreaterThanOrEqual(0);
  }
});

test("a timeout is never laundered into a small handshake latency", async () => {
  const origin = await startTls((socket) => trackSocket(socket));
  const proxy = await startTunnelProxy(origin.port);
  const result = await testProxy(proxyFor(proxy.port), {
    endpoint: `https://127.0.0.1:${origin.port}/`,
    timeoutMs: 250,
    tlsRejectUnauthorized: false,
    target: targetFor(origin.port),
  });
  expect(result.ok).toBe(false);
  expect(result.errorCode).toBe("timeout");
  expect(result.latency).toBeNull();
});

test("a proxy that refuses the tunnel is a failure, not a provider answer", async () => {
  const proxy = await startTunnelProxy(9, { refuse: true });
  const result = await testProxy(proxyFor(proxy.port), {
    endpoint: "https://gateway.qoder.com.cn/",
    timeoutMs: 900,
    tlsRejectUnauthorized: false,
    target: targetFor(443),
  });
  expect(result.ok).toBe(false);
  expect(result.errorCode).toBe("proxy_tunnel");
  expect(proxy.connects[0]).toContain("CONNECT gateway.qoder.com.cn:443");
});
