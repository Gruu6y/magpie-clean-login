// End-to-end coverage for the two-leg proxy probe. The real service runs on a
// loopback port with an injected probe seam, so the tests exercise the actual
// routes, validation, persistence and target catalogue without opening a
// socket to a provider (and without ever touching ~/.config/magpie).

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "clean-login-provider-probe-"));
const dataDir = join(tmp, "data");
const serverEnv = {
  ...process.env,
  MAGPIE_CONFIG_DIR: join(tmp, "magpie-config"),
  MAGPIE_CLEAN_LOGIN_DATA: dataDir,
};

const PROVIDERS = [
  {
    id: "qoder-cn",
    name: "Qoder CN",
    api: "https://gateway.qoder.com.cn",
    package: "@magpie-community/opencode-qoder-auth",
    methods: [],
  },
  { id: "plain", name: "Plain", api: "http://insecure.example.com", methods: [] },
  { id: "no-api", name: "No API", methods: [] },
];

let service;
let port;
let token;
let calls = [];
let probeOutcome = "ok";

const scanner = {
  get: () => ({
    available: true,
    providers: PROVIDERS,
    scanned: true,
    stale: false,
    scanning: false,
    error: null,
  }),
  warm: () => {},
};

// A fake probe that records every leg. The generic leg answers like ipinfo;
// the provider leg answers with a status code and a round-trip number. No
// network, no credentials, no chat request.
const proxyTester = async (_proxy, options) => {
  calls.push({ endpoint: options.endpoint, target: options.target || null, timeoutMs: options.timeoutMs });
  if (options.target?.kind === "provider") {
    if (probeOutcome === "fail") {
      return {
        ok: false,
        error: "The provider could not be reached through this proxy.",
        errorCode: "proxy_tunnel",
        latency: null,
        checkedAt: "2026-11-08T01:00:00.000Z",
      };
    }
    return {
      ok: true,
      provider: options.target.provider,
      host: options.target.host,
      statusCode: 401,
      tlsOnly: false,
      latency: 233,
      checkedAt: "2026-11-08T01:00:00.000Z",
    };
  }
  return {
    ok: true,
    exitIp: "203.0.113.20",
    region: "Proxyland",
    latency: 41,
    checkedAt: "2026-11-08T01:00:00.000Z",
  };
};

function raw(method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: { host: `127.0.0.1:${port}`, ...headers },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: text }));
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function auth(extra = {}) {
  return { "x-clean-login-token": token, ...extra };
}

async function post(path, body) {
  const response = await raw(
    "POST",
    path,
    auth({ "content-type": "application/json" }),
    body === undefined ? undefined : JSON.stringify(body),
  );
  return { status: response.status, body: response.body, data: JSON.parse(response.body) };
}

async function newProxy() {
  const response = await post("/api/proxies", {
    name: "Exit A",
    type: "http",
    host: "127.0.0.1",
    port: 7890,
    password: "s3cret",
  });
  expect(response.status).toBe(201);
  return response.data.proxy;
}

beforeAll(async () => {
  const { startServer } = await import("../lib/server.mjs");
  service = await startServer({
    port: 0,
    dataDir,
    env: serverEnv,
    proxyEndpoint: "https://ipinfo.io/json",
    proxyTimeoutMs: 250,
    proxyTester,
    pluginScanner: scanner,
  });
  port = service.port;
  await service.prune();
  const page = await raw("GET", "/");
  token = /name="clean-login-token" content="([0-9a-f]+)"/.exec(page.body)?.[1];
  expect(token).toMatch(/^[0-9a-f]{64}$/);
});

afterAll(async () => {
  await service?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("GET /api/proxy-targets exposes only hosts, never accounts or credentials", async () => {
  const response = await raw("GET", "/api/proxy-targets", auth());
  expect(response.status).toBe(200);
  const data = JSON.parse(response.body);
  expect(data.generic).toEqual({ id: "", host: "ipinfo.io", url: "https://ipinfo.io/json" });
  expect(data.targets).toEqual([
    {
      id: "qoder-cn",
      name: "Qoder CN",
      host: "gateway.qoder.com.cn",
      url: "https://gateway.qoder.com.cn/",
    },
  ]);
  expect(data.available).toBe(true);
  expect(data.scanning).toBe(false);
  expect(response.body).not.toContain("account");
  expect(response.body).not.toContain("token");
  expect(response.body).not.toContain("insecure.example.com");
});

test("the unmodified request shape stays a single generic leg", async () => {
  calls = [];
  probeOutcome = "ok";
  const created = await newProxy();
  const response = await post(`/api/proxies/${encodeURIComponent(created.id)}/test`);
  expect(response.status).toBe(200);
  expect(response.data.ok).toBe(true);
  expect(response.data.result.exitIp).toBe("203.0.113.20");
  expect(response.data.result.region).toBe("Proxyland");
  expect(response.data.result.latency).toBe(41);
  expect(response.data.result.target).toBeUndefined();
  expect(calls).toEqual([
    { endpoint: "https://ipinfo.io/json", target: null, timeoutMs: 250 },
  ]);
  expect(response.data.proxy.latency).toBe(41);
  expect(response.data.proxy.latencyByProvider).toEqual({});
});

test("a named provider runs two legs and reports only the provider round trip", async () => {
  calls = [];
  probeOutcome = "ok";
  const created = await newProxy();
  const response = await post(`/api/proxies/${encodeURIComponent(created.id)}/test`, {
    provider: "qoder-cn",
  });
  expect(response.status).toBe(200);
  expect(response.data.ok).toBe(true);
  const result = response.data.result;
  expect(result.latency).toBe(233);
  expect(result.exitIp).toBe("203.0.113.20");
  expect(result.region).toBe("Proxyland");
  expect(result.provider).toBe("qoder-cn");
  expect(result.host).toBe("gateway.qoder.com.cn");
  expect(result.statusCode).toBe(401);
  expect(result.tlsOnly).toBe(false);
  expect(result.target).toEqual({ kind: "provider", provider: "qoder-cn", host: "gateway.qoder.com.cn" });
  // Sequential: the exit lookup first, then the provider's own origin.
  expect(calls.map((call) => call.endpoint)).toEqual([
    "https://ipinfo.io/json",
    "https://gateway.qoder.com.cn/",
  ]);
  expect(calls[1].timeoutMs).toBe(250);
  // Both legs receive the same proxy connection fields, and the credential
  // never appears in the response.
  expect(response.body).not.toContain("s3cret");
  expect(JSON.stringify(calls)).not.toContain("s3cret");
  // The row's own `latency` stays the generic exit measurement (41 ms); the
  // provider round trip (233 ms) lives only in latencyByProvider. Switching
  // the picker back to Generic therefore cannot show a provider's number.
  expect(response.data.persisted).toBe(true);
  expect(response.data.proxy.latency).toBe(41);
  expect(result.exitLatency).toBe(41);
  expect(response.data.proxy.latencyByProvider["qoder-cn"]).toMatchObject({
    ms: 233,
    host: "gateway.qoder.com.cn",
  });
  const stored = await raw("GET", "/api/proxies", auth());
  expect(JSON.parse(stored.body).proxies.find((p) => p.id === created.id).latencyByProvider["qoder-cn"].ms).toBe(233);
});

test("the draft route takes the same target without creating a row", async () => {
  calls = [];
  const response = await post("/api/proxies/test", {
    name: "Draft",
    type: "http",
    host: "127.0.0.1",
    port: 7891,
    provider: "qoder-cn",
  });
  expect(response.status).toBe(200);
  expect(response.data.result.latency).toBe(233);
  expect(calls.map((call) => call.endpoint)).toEqual([
    "https://ipinfo.io/json",
    "https://gateway.qoder.com.cn/",
  ]);
});

test("an unknown target is a 400 and runs no probe at all", async () => {
  calls = [];
  const created = await newProxy();
  const response = await post(`/api/proxies/${encodeURIComponent(created.id)}/test`, {
    provider: "uninstalled",
  });
  expect(response.status).toBe(400);
  expect(response.data.error).toBeTruthy();
  expect(calls).toEqual([]);
});

test("a failed provider leg keeps the row's exit IP and region", async () => {
  calls = [];
  probeOutcome = "fail";
  const created = await newProxy();
  const first = await post(`/api/proxies/${encodeURIComponent(created.id)}/test`);
  expect(first.data.result.exitIp).toBe("203.0.113.20");
  const failed = await post(`/api/proxies/${encodeURIComponent(created.id)}/test`, {
    provider: "qoder-cn",
  });
  expect(failed.status).toBe(200);
  expect(failed.data.ok).toBe(false);
  expect(failed.data.result.errorCode).toBe("proxy_tunnel");
  expect(failed.data.result.latency).toBeNull();
  expect(failed.data.proxy.status).toBe("error");
  // A two-leg test must not erase a good exit IP just because the provider leg
  // failed: the exit lookup still succeeded and returned the same address.
  expect(failed.data.proxy.exitIp).toBe("203.0.113.20");
  expect(failed.data.proxy.region).toBe("Proxyland");
  probeOutcome = "ok";
});
