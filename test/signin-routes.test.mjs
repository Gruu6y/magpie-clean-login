// The three sign-in routes, with the flow controller injected. No browser is
// started and no provider plugin is imported.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKEN_HEADER, startServer } from "../lib/server.mjs";
import { SignInFlowError } from "../lib/signin-flow.mjs";

const tmp = mkdtempSync(join(tmpdir(), "clean-login-signin-routes-"));
let service;
let token;
let lastStart = null;
let lastCode = null;

const flow = {
  flowId: "flow-1",
  provider: "workbuddy",
  state: "waiting-login",
  key: "workbuddy",
  accountKey: null,
  url: "https://provider/signin",
  instructions: "Sign in; this finishes by itself.",
  identityCreated: true,
  pid: 99,
  createdAt: "2026-01-01T00:00:00.000Z",
  finishedAt: null,
  error: null,
  warning: {
    code: "navigation_failed",
    status: 504,
    message: "The login browser is open, but the page did not finish loading within 60 seconds.",
  },
};

const signIn = {
  async startSignIn({ provider, proxy, single, methodLabel, account, methodInputs }) {
    if (provider === "missing-plugin") {
      throw new SignInFlowError("plugin_missing", 'No installed plugin provides "missing-plugin".', 404);
    }
    lastStart = { provider, proxy, single, methodLabel, account, methodInputs: methodInputs ?? null };
    return {
      flowId: "flow-1",
      key: "workbuddy",
      url: "https://provider/signin",
      instructions: flow.instructions,
    };
  },
  // A code plugin (Loomy) hands the callback the one-time code the user typed.
  async submitCode(code) {
    const trimmed = typeof code === "string" ? code.trim() : "";
    if (!trimmed) throw new SignInFlowError("invalid_code", "A verification code is required.", 400);
    lastCode = trimmed;
    return { ...flow, state: "finishing", codeRequired: false };
  },
  status: () => flow,
  async cancel() {
    return { cancelled: true, flow: { ...flow, state: "cancelled" } };
  },
};

beforeAll(async () => {
  service = await startServer({
    port: 0,
    // Keep the plugin data directory and magpie's config directory inside the
    // temp root, so the startup orphan sweep never touches the real
    // ~/.config/magpie.
    env: {
      ...process.env,
      MAGPIE_CONFIG_DIR: join(tmp, "magpie-config"),
      MAGPIE_CLEAN_LOGIN_DATA: join(tmp, "data"),
    },
    dataDir: join(tmp, "data"),
    pluginScanner: { get: () => ({ available: false, providers: [] }), warm() {} },
    signIn,
  });
  await service.prune?.();
  const html = await (await fetch(`http://127.0.0.1:${service.port}/`)).text();
  token = /content="([0-9a-f]{64})"/.exec(html)?.[1];
});

afterAll(async () => {
  await service?.close();
  rmSync(tmp, { recursive: true, force: true });
});

function api(method, path, body, { withToken = true } = {}) {
  const headers = { "content-type": "application/json" };
  if (withToken) headers[TOKEN_HEADER] = token;
  return fetch(`http://127.0.0.1:${service.port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("POST /api/signin starts a flow and returns the browser URL, not credentials", async () => {
  const res = await api("POST", "/api/signin", { provider: "workbuddy" });
  expect(res.status).toBe(202);
  const body = await res.json();
  expect(body).toEqual({
    flowId: "flow-1",
    key: "workbuddy",
    url: "https://provider/signin",
    instructions: flow.instructions,
  });
  expect(lastStart).toEqual({
    provider: "workbuddy",
    proxy: null,
    single: false,
    methodLabel: null,
    account: null,
    methodInputs: null,
  });
  expect(JSON.stringify(body)).not.toMatch(/access|refresh|token/i);
});

test("POST /api/signin forwards the proxy and the single flag", async () => {
  const proxy = { server: "http://127.0.0.1:8080" };
  const res = await api("POST", "/api/signin", { provider: "workbuddy", proxy, single: true });
  expect(res.status).toBe(202);
  expect(lastStart).toEqual({
    provider: "workbuddy",
    proxy,
    single: true,
    methodLabel: null,
    account: null,
    methodInputs: null,
  });
});

// Continuing a kept identity: only the account key travels; the controller
// verifies the directory's ledger before reusing its fingerprint.
test("POST /api/signin forwards the chosen account key", async () => {
  const res = await api("POST", "/api/signin", {
    provider: "workbuddy",
    account: { key: "workbuddy#ab12" },
  });
  expect(res.status).toBe(202);
  expect(lastStart.account).toEqual({ key: "workbuddy#ab12" });
});

test("POST /api/signin ignores a blank or non-string account key", async () => {
  for (const account of [null, "workbuddy#ab12", {}, { key: "" }, { key: 42 }, { key: "   " }]) {
    const res = await api("POST", "/api/signin", { provider: "workbuddy", account });
    expect(res.status).toBe(202);
    // A whitespace-only key still reaches the controller; it is the
    // controller's `retired_missing` that reports it honestly. Everything
    // that is not an object with a string key is "no claim".
    if (account && typeof account === "object" && typeof account.key === "string" && account.key) {
      expect(lastStart.account).toEqual({ key: account.key });
    } else {
      expect(lastStart.account).toBeNull();
    }
  }
});

test("POST /api/signin forwards a rotation only as a boolean true", async () => {
  const res = await api("POST", "/api/signin", {
    provider: "workbuddy",
    account: { key: "workbuddy#ab12", rotate: true },
  });
  expect(res.status).toBe(202);
  expect(lastStart.account).toEqual({ key: "workbuddy#ab12", rotate: true });

  // Anything else is 'no rotation asked', and the key travels alone exactly as
  // it did before rotations existed. A string, a number or a nested object must
  // never be read as consent to replace an account's machine.
  for (const rotate of [false, "true", "yes", 1, null, {}, undefined]) {
    const plain = await api("POST", "/api/signin", {
      provider: "workbuddy",
      account: { key: "workbuddy#ab12", rotate },
    });
    expect(plain.status).toBe(202);
    expect(lastStart.account).toEqual({ key: "workbuddy#ab12" });
  }
});

test("POST /api/signin drops a rotation that names no account", async () => {
  // The page cannot rotate 'nothing': without a key there is no claim, and the
  // route does not invent one out of the rotate flag.
  const res = await api("POST", "/api/signin", {
    provider: "workbuddy",
    account: { rotate: true },
  });
  expect(res.status).toBe(202);
  expect(lastStart.account).toBeNull();
});

// The plugin exposes several runnable oauth methods (ZCode's per-site flows),
// so the page sends the exact label of the one the user picked.
test("POST /api/signin forwards the chosen method label", async () => {
  const res = await api("POST", "/api/signin", {
    provider: "zcode",
    methodLabel: "ZCode: BigModel (智谱) GLM Coding Plan",
  });
  expect(res.status).toBe(202);
  expect(lastStart.methodLabel).toBe("ZCode: BigModel (智谱) GLM Coding Plan");
});

test("POST /api/signin ignores a blank or non-string method label", async () => {
  for (const methodLabel of ["", "   ", 42, null, { label: "x" }]) {
    const res = await api("POST", "/api/signin", { provider: "zcode", methodLabel });
    expect(res.status).toBe(202);
    expect(lastStart.methodLabel).toBeNull();
  }
});

// A method that asks something before it starts (ZCode's team picker, Qoder
// CN's VPC instance, the PAT prompts) gets its answers from the page. Only the
// strings the page typed travel, and only when there is something to send.
test("POST /api/signin forwards the answers to the method's prompts", async () => {
  const res = await api("POST", "/api/signin", {
    provider: "zcode",
    methodLabel: "ZCode: a team's GLM Coding Plan",
    inputs: { site: "bigmodel" },
  });
  expect(res.status).toBe(202);
  expect(lastStart.methodInputs).toEqual({ site: "bigmodel" });
});

test("POST /api/signin sends no answers when the page left them blank", async () => {
  for (const inputs of [undefined, null, {}, { site: "" }, { site: "   " }]) {
    const res = await api("POST", "/api/signin", { provider: "zcode", inputs });
    expect(res.status).toBe(202);
    expect(lastStart.methodInputs).toBeNull();
  }
});

test("POST /api/signin refuses a malformed answers body", async () => {
  const bodies = [
    ["site"],
    { site: 42 },
    { site: null },
    { site: "x".repeat(513) },
    { "": "value" },
  ];
  for (const inputs of bodies) {
    const res = await api("POST", "/api/signin", { provider: "zcode", inputs });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_inputs");
  }
  // A refused body never reaches the controller.
  expect(lastStart.methodInputs).toBeNull();
});

test("POST /api/signin resolves a stored proxy id server-side", async () => {
  const created = await api("POST", "/api/proxies", {
    name: "SG · 01",
    type: "http",
    host: "127.0.0.1",
    port: 8080,
    username: "user",
    password: "s3cret",
  });
  expect(created.status).toBe(201);
  const proxy = (await created.json()).proxy;
  // The API never returns the password; the page only holds public fields.
  expect(proxy).not.toHaveProperty("password");
  const res = await api("POST", "/api/signin", {
    provider: "workbuddy",
    proxy: { id: proxy.id, type: proxy.type, host: proxy.host, port: proxy.port, username: proxy.username },
  });
  expect(res.status).toBe(202);
  // The record the flow receives is the stored one, credential included.
  expect(lastStart.provider).toBe("workbuddy");
  expect(lastStart.proxy).toMatchObject({
    id: proxy.id,
    type: "http",
    host: "127.0.0.1",
    port: 8080,
    username: "user",
    password: "s3cret",
  });
});

test("POST /api/signin rejects an unknown proxy id with a clear 404", async () => {
  const res = await api("POST", "/api/signin", { provider: "workbuddy", proxy: { id: "no-such-proxy" } });
  expect(res.status).toBe(404);
  expect((await res.json()).error).toBe("not_found");
});

test("POST /api/signin without a provider is a clear 400", async () => {
  const res = await api("POST", "/api/signin", {});
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("invalid_provider");
});

test("a flow error maps to its own status and code", async () => {
  const res = await api("POST", "/api/signin", { provider: "missing-plugin" });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({
    error: "plugin_missing",
    message: 'No installed plugin provides "missing-plugin".',
  });
});

test("GET /api/signin returns the current flow", async () => {
  const res = await api("GET", "/api/signin");
  expect(res.status).toBe(200);
  expect((await res.json()).flow).toEqual(flow);
});

test("GET /api/signin carries the navigation warning without changing the route shape", async () => {
  const res = await api("GET", "/api/signin");
  expect(res.status).toBe(200);
  expect((await res.json()).flow.warning).toEqual(flow.warning);
});

test("POST /api/signin/cancel cancels and returns the new state", async () => {
  const res = await api("POST", "/api/signin/cancel");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ cancelled: true, flow });
});

// The code plugin's own step: the user types the one-time code it sent.
test("POST /api/signin/code hands the code to the waiting flow", async () => {
  const res = await api("POST", "/api/signin/code", { code: " 123456 " });
  expect(res.status).toBe(202);
  expect(lastCode).toBe("123456");
  expect((await res.json()).flow.state).toBe("finishing");
});

test("POST /api/signin/code with an empty code is a clear 400", async () => {
  const res = await api("POST", "/api/signin/code", { code: "  " });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: "invalid_code",
    message: "A verification code is required.",
  });
});

test("the sign-in routes require the page token", async () => {
  for (const [method, path] of [
    ["GET", "/api/signin"],
    ["POST", "/api/signin"],
    ["POST", "/api/signin/cancel"],
    ["POST", "/api/signin/code"],
  ]) {
    const res = await api(method, path, method === "POST" ? { provider: "workbuddy" } : undefined, {
      withToken: false,
    });
    expect(res.status).toBe(403);
  }
});

test("the sign-in routes reject other methods", async () => {
  for (const [method, path, allow] of [
    ["PUT", "/api/signin", "GET, POST"],
    ["GET", "/api/signin/cancel", "POST"],
    ["GET", "/api/signin/code", "POST"],
  ]) {
    const res = await api(method, path);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe(allow);
  }
});
