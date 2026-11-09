// Tests for the bundled CLI. The unit half drives runCli through an injected
// fetch, so no socket is opened; the end-to-end half spawns the real bin
// against a real service on a random port and reads its stdout.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, TOKEN_HEADER as SERVER_TOKEN_HEADER } from "../lib/server.mjs";
import {
  CliError,
  DEFAULT_PORT,
  TOKEN_HEADER,
  TOKEN_META_NAME,
  isLoopbackHost,
  parseArgs,
  parseTokenFromHtml,
  resolveBase,
  resolveToken,
  runCli,
  usage,
} from "../lib/agent-cli.mjs";

const root = join(import.meta.dir, "..");
const pkgVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const TOKEN = "a".repeat(64);
const PAGE = `<!doctype html><html><head><meta name="${TOKEN_META_NAME}" content="${TOKEN}"></head></html>`;

// ---------- pure helpers ----------

test("the CLI uses the same token header as the service", () => {
  expect(TOKEN_HEADER).toBe(SERVER_TOKEN_HEADER);
  expect(DEFAULT_PORT).toBe(3492);
});

test("parseTokenFromHtml reads the meta tag in either attribute order", () => {
  expect(parseTokenFromHtml(PAGE)).toBe(TOKEN);
  expect(
    parseTokenFromHtml(`<meta content="${TOKEN}" name='${TOKEN_META_NAME}'>`),
  ).toBe(TOKEN);
  expect(parseTokenFromHtml("<html><head></head></html>")).toBe("");
  expect(parseTokenFromHtml(`<meta name="${TOKEN_META_NAME}">`)).toBe("");
  // A different meta tag must not be mistaken for the token.
  expect(parseTokenFromHtml('<meta name="other" content="nope">')).toBe("");
  expect(parseTokenFromHtml("")).toBe("");
});

test("isLoopbackHost accepts only this computer", () => {
  for (const host of ["", "localhost", "api.localhost", "::1", "[::1]", "127.0.0.1", "127.9.9.9"]) {
    expect(isLoopbackHost(host)).toBe(true);
  }
  for (const host of ["example.com", "192.168.1.4", "10.0.0.1", "evil-localhost", "::ffff:127.0.0.1"]) {
    expect(isLoopbackHost(host)).toBe(false);
  }
});

test("parseArgs handles values, flags, repeats and --", () => {
  expect(
    parseArgs([
      "signin",
      "start",
      "--provider",
      "workbuddy",
      "--input",
      "email=a@b.com",
      "--input=code=123",
      "--only",
      "antigravity#d13e",
      "--only=codex#1",
      "--single",
      "--raw",
      "--",
      "literal",
      "--not-an-option",
    ]),
  ).toEqual({
    positional: ["signin", "start", "literal", "--not-an-option"],
    options: {
      provider: "workbuddy",
      input: ["email=a@b.com", "code=123"],
      only: ["antigravity#d13e", "codex#1"],
      single: true,
      raw: true,
    },
  });
  // A bare --wait followed by another flag must not swallow that flag.
  expect(parseArgs(["signin", "status", "--wait", "--raw"]).options).toEqual({
    wait: true,
    raw: true,
  });
});

test("resolveBase reads flags, then the environment, then the default port", () => {
  expect(resolveBase({}, {})).toBe("http://127.0.0.1:3492");
  expect(resolveBase({ port: "4321" }, {})).toBe("http://127.0.0.1:4321");
  expect(resolveBase({}, { CLEAN_LOGIN_PORT: "4322" })).toBe("http://127.0.0.1:4322");
  expect(resolveBase({ url: "http://127.0.0.1:5000/" }, {})).toBe("http://127.0.0.1:5000");
  expect(resolveBase({}, { CLEAN_LOGIN_URL: "http://localhost:5001" })).toBe("http://localhost:5001");
  expect(() => resolveBase({ port: "not-a-port" }, {})).toThrow(CliError);
});

// A fetch stub that records every request and serves a fixed response per
// path. The page is served at "/" so token discovery is exercised for real.
function fakeFetch(responses = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(String(url));
    calls.push({
      path: target.pathname + target.search,
      method: init.method || "GET",
      headers: init.headers || {},
      body: init.body === undefined ? null : JSON.parse(init.body),
    });
    const found = responses[target.pathname];
    // A queue lets a test give POST and GET on the same path different bodies;
    // a single value repeats so an idle status route keeps answering.
    let payload;
    if (Array.isArray(found)) payload = found.length > 1 ? found.shift() : found[0];
    else payload = found === undefined ? { ok: true } : found;
    const status = payload?.__status ?? 200;
    const { __status, ...body } = payload ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    };
  };
  return { calls, fetchImpl };
}

function runner(fake) {
  const out = [];
  const err = [];
  return {
    out,
    err,
    run: (argv) =>
      runCli(argv, {
        fetchImpl: fake.fetchImpl,
        write: (text) => out.push(text),
        writeError: (text) => err.push(text),
        env: { CLEAN_LOGIN_URL: "http://127.0.0.1:3492" },
      }),
  };
}

function stdout(r) {
  return JSON.parse(r.out.join(""));
}

test("the page token is discovered automatically on loopback and sent on every API call", async () => {
  const digest = { version: "0.1.40", state: { providers: [], proxies: [], accounts: [] } };
  const fake = fakeFetch({ "/": { __page: true }, "/api/agent": digest });
  // The page is HTML, not JSON; give it its own responder.
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(String(url));
    fake.calls.push({ path: target.pathname + target.search, method: init.method || "GET", headers: init.headers || {} });
    if (target.pathname === "/") return { ok: true, status: 200, text: async () => PAGE };
    return { ok: true, status: 200, text: async () => JSON.stringify(digest) };
  };
  const r = { out: [], err: [] };
  const code = await runCli(["agent"], {
    fetchImpl,
    write: (text) => r.out.push(text),
    writeError: (text) => r.err.push(text),
    env: { CLEAN_LOGIN_URL: "http://127.0.0.1:3492" },
  });
  expect(code).toBe(0);
  expect(JSON.parse(r.out.join(""))).toEqual(digest);
  expect(fake.calls[0].path).toBe("/");
  expect(fake.calls[1].path).toBe("/api/agent");
  expect(fake.calls[1].headers[TOKEN_HEADER]).toBe(TOKEN);
  // The token never reaches stdout.
  expect(r.out.join("")).not.toContain(TOKEN);
  expect(r.err).toEqual([]);
});

test("an explicit --token skips the page fetch", async () => {
  const fake = fakeFetch({ "/api/health": { ok: true, version: "0.1.40" } });
  const r = runner(fake);
  expect(await r.run(["status", "--token", "explicit-token"])).toBe(0);
  expect(fake.calls).toHaveLength(1);
  expect(fake.calls[0].path).toBe("/api/health");
  expect(fake.calls[0].headers[TOKEN_HEADER]).toBe("explicit-token");
});

test("a non-loopback service requires an explicit token", async () => {
  const fake = fakeFetch({});
  await expect(
    runCli(["agent", "--url", "https://remote.example.test"], {
      fetchImpl: fake.fetchImpl,
      write: () => {},
      writeError: () => {},
      env: {},
    }),
  ).rejects.toThrow(/non-loopback/);
  expect(fake.calls).toHaveLength(0);
});

test("providers, proxies and accounts slice the digest instead of dumping it", async () => {
  const digest = {
    version: "0.1.40",
    state: { providers: [{ id: "workbuddy" }], proxies: [{ id: "p1" }], accounts: [{ key: "a1" }] },
  };
  for (const [command, expected] of [
    ["providers", digest.state.providers],
    ["proxies", digest.state.proxies],
    ["accounts", digest.state.accounts],
  ]) {
    const fake = fakeFetch({ "/": {}, "/api/agent": digest });
    const r = runner(fake);
    expect(await r.run([command, "--token", TOKEN])).toBe(0);
    expect(stdout(r)).toEqual(expected);
    expect(fake.calls.map((call) => call.path)).toEqual(["/api/agent"]);
  }
});

test("signin start builds the POST body and then reads the flow with a wait", async () => {
  const fake = fakeFetch({
    "/api/signin": [
      { flowId: "f1", __status: 202 },
      { flow: { flowId: "f1", state: "waiting-login" } },
    ],
  });
  const r = runner(fake);
  expect(
    await r.run([
      "signin",
      "start",
      "--provider",
      "workbuddy",
      "--proxy",
      "p1",
      "--method",
      "WorkBuddy (browser)",
      "--input",
      "email=a@b.com",
      "--single",
      "--wait",
      "3000",
      "--token",
      TOKEN,
    ]),
  ).toBe(0);
  expect(fake.calls[0]).toMatchObject({
    path: "/api/signin",
    method: "POST",
    body: {
      provider: "workbuddy",
      proxy: { id: "p1" },
      methodLabel: "WorkBuddy (browser)",
      inputs: { email: "a@b.com" },
      single: true,
    },
  });
  expect(fake.calls[1].path).toBe("/api/signin?wait=3000");
  expect(stdout(r).flow).toEqual({ flowId: "f1", state: "waiting-login" });
});

test("a bare --wait uses the 60s default and signin code posts the trimmed code", async () => {
  const fake = fakeFetch({ "/api/signin/code": { flow: { state: "finishing" } } });
  const r = runner(fake);
  await r.run(["signin", "status", "--wait", "--token", TOKEN]);
  expect(fake.calls[0].path).toBe("/api/signin?wait=60000");
  await r.run(["signin", "code", "123456", "--token", TOKEN]);
  expect(fake.calls[1].path).toBe("/api/signin/code");
  expect(fake.calls[1].body).toEqual({ code: "123456" });
});

test("native, proxy, env and check commands map to the right routes", async () => {
  const fake = fakeFetch({});
  const r = runner(fake);
  const args = ["--token", TOKEN];
  await r.run(["native", "start", "--provider", "codex", ...args]);
  await r.run(["native", "paste", "https://callback/?code=abc", ...args]);
  await r.run(["proxy", "test", "p1", ...args]);
  await r.run(["proxy", "score", "p1", "--wait", "1000", ...args]);
  await r.run(["env", "prepare", "--wait", "1000", ...args]);
  await r.run(["check", "workbuddy", "workbuddy", "--wait", "1000", ...args]);
  expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
    "POST /api/native-signin",
    "GET /api/native-signin",
    "POST /api/native-signin/paste",
    "POST /api/proxies/p1/test",
    "POST /api/proxies/p1/score",
    "GET /api/proxy-score?wait=1000",
    "POST /api/environment/prepare",
    "GET /api/environment/job?wait=1000",
    "GET /api/accounts/workbuddy/workbuddy/check?wait=1000",
  ]);
  expect(fake.calls[0].body).toEqual({ agent: "codex" });
  expect(fake.calls[2].body).toEqual({ text: "https://callback/?code=abc" });
});

test("--raw emits one line and help never opens a connection", async () => {
  const fake = fakeFetch({ "/api/health": { ok: true } });
  const r = runner(fake);
  await r.run(["status", "--raw", "--token", TOKEN]);
  expect(r.out.join("")).toBe('{"ok":true}\n');
  const helpRunner = runner(fakeFetch({}));
  expect(await helpRunner.run(["help"])).toBe(0);
  expect(helpRunner.out.join("")).toContain("clean-login <command>");
  expect(usage()).toContain("GET /api/agent");
});

test("an API error becomes a CliError with the server's code and status", async () => {
  const fake = fakeFetch({ "/api/signin": { __status: 404, error: "plugin_missing", message: "No plugin." } });
  const r = runner(fake);
  await expect(r.run(["signin", "status", "--token", TOKEN])).rejects.toMatchObject({
    code: "plugin_missing",
    status: 404,
    message: "No plugin.",
  });
});

test("missing arguments and unknown commands fail with a specific code", async () => {
  const fake = fakeFetch({});
  const r = runner(fake);
  await expect(r.run(["signin", "start", "--token", TOKEN])).rejects.toMatchObject({
    code: "missing_argument",
  });
  await expect(r.run(["nonsense", "--token", TOKEN])).rejects.toMatchObject({
    code: "bad_command",
  });
});

test("proxies add, delete and targets map to the proxy routes", async () => {
  const fake = fakeFetch({});
  const r = runner(fake);
  const args = ["--token", TOKEN];
  await r.run(["proxies", "add", "柳老师01", "http", "127.0.0.1", "7102", "--user", "u", "--pass", "p", ...args]);
  await r.run(["proxies", "delete", "p-1", ...args]);
  await r.run(["proxies", "targets", ...args]);
  expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
    "POST /api/proxies",
    "DELETE /api/proxies/p-1",
    "GET /api/proxy-targets",
  ]);
  expect(fake.calls[0].body).toEqual({
    name: "柳老师01",
    type: "http",
    host: "127.0.0.1",
    port: "7102",
    username: "u",
    password: "p",
  });

  // Every positional is required; a short call must not reach the service.
  await expect(r.run(["proxies", "add", "n", "http", "h", ...args])).rejects.toMatchObject({
    code: "missing_argument",
  });
  await expect(r.run(["proxies", "delete", ...args])).rejects.toMatchObject({
    code: "missing_argument",
  });
});

test("accounts import, exit, note, delete, prune and hosting map to the account routes and encode #", async () => {
  const fake = fakeFetch({});
  const r = runner(fake);
  const args = ["--token", TOKEN];
  const slotKey = ["antigravity", "d13e957af937ea32"].join("#");
  await r.run(["accounts", "import", ...args]);
  await r.run(["accounts", "import", "plan", ...args]);
  await r.run(["accounts", "import", "run", ...args]);
  await r.run(["accounts", "import", "run", "--only", slotKey, "--only", "codex#1", ...args]);
  await r.run(["accounts", "exit", "antigravity", slotKey, ...args]);
  await r.run(["accounts", "exit", "antigravity", slotKey, "--mode", "direct", ...args]);
  await r.run(["accounts", "exit", "antigravity", slotKey, "--mode", "custom", "--proxy", "p1", ...args]);
  await r.run(["accounts", "note", "antigravity", slotKey, "备用号", ...args]);
  await r.run(["accounts", "delete", "antigravity", slotKey, ...args]);
  await r.run(["accounts", "prune", ...args]);
  await r.run(["accounts", "hosting", ...args]);
  const encoded = encodeURIComponent(slotKey);
  expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
    "GET /api/accounts/import/plan",
    "GET /api/accounts/import/plan",
    "POST /api/accounts/import",
    "POST /api/accounts/import",
    `GET /api/accounts/antigravity/${encoded}/exit`,
    `PATCH /api/accounts/antigravity/${encoded}/exit`,
    `PATCH /api/accounts/antigravity/${encoded}/exit`,
    `PATCH /api/accounts/antigravity/${encoded}`,
    `DELETE /api/accounts/antigravity/${encoded}`,
    "POST /api/accounts/prune",
    "GET /api/accounts/hosting",
  ]);
  expect(fake.calls[2].body).toEqual({});
  expect(fake.calls[3].body).toEqual({ keys: [slotKey, "codex#1"] });
  expect(fake.calls[5].body).toEqual({ mode: "direct" });
  expect(fake.calls[6].body).toEqual({ mode: "custom", proxyId: "p1" });
  expect(fake.calls[7].body).toEqual({ note: "备用号" });
  // Custom mode without a proxy id is refused before a request is sent.
  await expect(
    r.run(["accounts", "exit", "antigravity", slotKey, "--mode", "custom", ...args]),
  ).rejects.toMatchObject({ code: "missing_argument" });
  // An account command needs both segments, and an unknown import step is refused.
  await expect(r.run(["accounts", "delete", "antigravity", ...args])).rejects.toMatchObject({
    code: "missing_argument",
  });
  await expect(r.run(["accounts", "import", "nonsense", ...args])).rejects.toMatchObject({
    code: "bad_command",
  });
});

test("score cancel, env cancel, report and market map to their routes", async () => {
  const fake = fakeFetch({});
  const r = runner(fake);
  const args = ["--token", TOKEN];
  await r.run(["score", "cancel", ...args]);
  await r.run(["env", "cancel", ...args]);
  await r.run(["report", "--provider", "antigravity", "--note", "403", "--language", "zh-Hans", ...args]);
  await r.run(["market", ...args]);
  await r.run(["market", "status", ...args]);
  await r.run(["market", "install", "@magpie-community/opencode-qoder-auth", ...args]);
  expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
    "POST /api/proxy-score/cancel",
    "POST /api/environment/cancel",
    "POST /api/report",
    "GET /api/market/install",
    "GET /api/market/install",
    "POST /api/market/install",
  ]);
  expect(fake.calls[2].body).toEqual({ provider: "antigravity", note: "403", language: "zh-Hans" });
  expect(fake.calls[5].body).toEqual({ package: "@magpie-community/opencode-qoder-auth" });
});

// ---------- the real binary against a real service ----------

const tmp = mkdtempSync(join(tmpdir(), "clean-login-agent-cli-e2e-"));
let service;

beforeAll(async () => {
  service = await startServer({
    port: 0,
    dataDir: join(tmp, "data"),
    env: {
      ...process.env,
      MAGPIE_CONFIG_DIR: join(tmp, "magpie-config"),
      MAGPIE_CLEAN_LOGIN_DATA: join(tmp, "data"),
      MAGPIE_CACHE_DIR: join(tmp, "magpie-cache"),
    },
    pluginScanner: { get: () => ({ available: false, providers: [] }), warm() {} },
  });
  await service.prune();
});

afterAll(async () => {
  await service?.close();
  rmSync(tmp, { recursive: true, force: true });
});

// Asynchronous spawn is essential here: the service under test lives in this
// same process, so a synchronous spawn would block the event loop and the
// service could never answer the child's requests.
function cli(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(root, "bin", "clean-login.mjs"), "--port", String(service.port), ...args],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill(), 15_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

test("the shipped binary drives the live service end to end", async () => {
  const digest = await cli("agent", "--raw");
  expect(digest.status).toBe(0);
  const body = JSON.parse(digest.stdout.trim());
  expect(body.version).toBe(pkgVersion);
  expect(body.service.port).toBe(service.port);
  expect(body.state.providers.length).toBeGreaterThan(0);
  expect(body.cli).toBe("bin/clean-login.mjs");

  const providers = await cli("providers", "--raw");
  expect(providers.status).toBe(0);
  expect(JSON.parse(providers.stdout.trim()).map((provider) => provider.id)).toContain("antigravity");

  const health = await cli("status", "--raw");
  expect(health.status).toBe(0);
  expect(JSON.parse(health.stdout.trim()).ok).toBe(true);

  const signin = await cli("signin", "status", "--raw");
  expect(signin.status).toBe(0);
  // No flow has run, so the real controller reports null; the CLI passes it
  // through instead of inventing an idle object.
  expect(JSON.parse(signin.stdout.trim()).flow).toBeNull();

  // Round-trip proxy add + delete and the targets list against the live server.
  const added = await cli("proxies", "add", "家宽01", "http", "127.0.0.1", "7102", "--raw");
  expect(added.status).toBe(0);
  const addedId = JSON.parse(added.stdout.trim()).proxy.id;
  expect(addedId).toBeTruthy();
  const removed = await cli("proxies", "delete", addedId, "--raw");
  expect(removed.status).toBe(0);
  expect(JSON.parse(removed.stdout.trim())).toEqual({ ok: true, id: addedId });

  const targets = await cli("proxies", "targets", "--raw");
  expect(targets.status).toBe(0);
  expect(Array.isArray(JSON.parse(targets.stdout.trim()).targets)).toBe(true);
});

test("the shipped binary reports a bad command as a JSON error and exits 1", async () => {
  const result = await cli("nonsense");
  expect(result.status).toBe(1);
  const error = JSON.parse(result.stderr.trim());
  expect(error.error).toBe("bad_command");
  expect(error.message).toContain("nonsense");
});
