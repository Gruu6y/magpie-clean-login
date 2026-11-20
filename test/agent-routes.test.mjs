// Integration tests for the program-facing HTTP surface: the compact digest
// and the bounded-wait status routes. Every controller is injected, so no
// browser, provider plugin or child process is ever started; all state stays
// in a temp directory.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKEN_HEADER, startServer } from "../lib/server.mjs";

const root = join(import.meta.dir, "..");
const pkgVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const tmp = mkdtempSync(join(tmpdir(), "clean-login-agent-routes-"));
let service;
let token;

// A queue of states per controller. `take()` shifts until one remains, so a
// test can arrange for a job to still be running on the first read and settle
// on a later one. A single-element queue keeps returning that state.
const ctl = {
  signin: [{ state: "idle" }],
  native: [{ state: "idle" }],
  score: [{ job: { state: "idle" }, browserOpen: false }],
  check: [{ job: { provider: "", key: "", state: "idle" }, browserOpen: false }],
  envJob: [null],
  envStatus: [{ state: "missing", ready: false, installed: false, modelInstalled: false }],
  reads: { signin: 0, native: 0, score: 0, check: 0, envJob: 0 },
};

function take(key, counterKey) {
  ctl.reads[counterKey] += 1;
  return ctl[key].length > 1 ? ctl[key].shift() : ctl[key][0];
}

const signIn = {
  status: () => take("signin", "signin"),
  async startSignIn() {
    return { flowId: "f1", key: "workbuddy", url: "https://example.test", instructions: "Sign in." };
  },
  async submitCode() {
    return { state: "finishing" };
  },
  async cancel() {
    return { cancelled: true, flow: { state: "cancelled" } };
  },
};

const nativeSignIn = {
  status: () => take("native", "native"),
  async start() {
    return { state: "waiting" };
  },
  paste: () => ({ state: "waiting" }),
  cancel: () => ({ state: "cancelled" }),
};

const proxyScore = {
  status: () => take("score", "score"),
  async cancel() {
    return { cancelled: false, job: { state: "idle" } };
  },
  async close() {},
};

const identityCheck = {
  status: () => take("check", "check"),
  async cancel() {
    return { cancelled: false, job: { state: "idle" } };
  },
  async close() {},
};

const environment = {
  status: async () => ({ ...ctl.envStatus[0] }),
  job: () => take("envJob", "envJob"),
  async prepare() {
    return { state: "preparing" };
  },
  cancel: () => null,
};

const pluginScanner = {
  get: () => ({
    available: true,
    providers: [
      {
        id: "workbuddy",
        package: "@magpie/workbuddy",
        methods: [
          {
            type: "oauth",
            label: "WorkBuddy (browser)",
            browser: true,
            category: "browser",
            runnable: true,
          },
        ],
      },
    ],
    scanned: true,
    stale: false,
    scanning: false,
    error: null,
  }),
  warm: () => {},
};

beforeAll(async () => {
  // The check route 404s an account with no ownership ledger, so the account
  // the tests poll gets one.
  const { writeAccountMeta, accountDir } = await import("../lib/account-identity.mjs");
  const env = {
    ...process.env,
    MAGPIE_CONFIG_DIR: join(tmp, "magpie-config"),
    MAGPIE_CLEAN_LOGIN_DATA: join(tmp, "data"),
    MAGPIE_CACHE_DIR: join(tmp, "magpie-cache"),
  };
  await writeAccountMeta(accountDir(env, "workbuddy", "workbuddy"), {
    version: 1,
    provider: "workbuddy",
    key: "workbuddy",
    accountId: "W",
    uid: "u-w",
    signedInAt: null,
  });
  service = await startServer({
    port: 0,
    dataDir: join(tmp, "data"),
    env,
    pluginScanner,
    signIn,
    nativeSignIn,
    proxyScore,
    identityCheck,
    environment,
  });
  await service.prune();
  const html = await (await fetch(`http://127.0.0.1:${service.port}/`)).text();
  token = /name="clean-login-token" content="([0-9a-f]{64})"/.exec(html)?.[1];
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

function resetReads() {
  for (const key of Object.keys(ctl.reads)) ctl.reads[key] = 0;
}

// ---------- /api/agent ----------

test("/api/agent is behind the page token and GET-only", async () => {
  const denied = await api("GET", "/api/agent", undefined, { withToken: false });
  expect(denied.status).toBe(403);
  expect((await denied.json()).reload).toBe(true);
  const wrongMethod = await api("POST", "/api/agent");
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.get("allow")).toBe("GET");
});

test("/api/agent returns a compact, self-describing digest", async () => {
  resetReads();
  ctl.signin = [{ state: "waiting-login" }];
  ctl.native = [{ state: "idle" }];
  ctl.score = [{ job: { state: "measuring" }, browserOpen: true }];
  ctl.check = [{ job: { provider: "", key: "", state: "idle" }, browserOpen: false }];
  ctl.envJob = [{ state: "preparing" }];
  ctl.envStatus = [{ state: "installing", ready: false, installed: true, modelInstalled: false }];

  const res = await api("GET", "/api/agent");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toContain("no-store");
  const body = await res.json();

  expect(body.version).toBe(pkgVersion);
  expect(body.service).toEqual({ status: "ready", port: service.port });
  expect(body.cli).toBe("bin/clean-login.mjs");
  expect(Array.isArray(body.commands)).toBe(true);
  expect(body.commands.map((command) => command.command)).toContain("signin start");
  expect(body.state.jobs).toEqual({
    signin: "waiting-login",
    nativeSignIn: "idle",
    score: "measuring",
    check: "idle",
    environment: "preparing",
  });
  expect(body.state.environment).toEqual({
    state: "installing",
    ready: false,
    installed: true,
    modelInstalled: false,
  });
  expect(body.state.counts.providers).toBe(body.state.providers.length);
  expect(body.state.counts.proxies).toBe(body.state.proxies.length);
  expect(body.state.counts.accounts).toBe(body.state.accounts.length);
  expect(body.state.providers.length).toBeGreaterThan(0);

  // The whole point of the endpoint: no multilingual prose, no raw method
  // objects, no stored credentials.
  for (const provider of body.state.providers) {
    expect(provider.description).toBeUndefined();
    expect(provider.notice).toBeUndefined();
    expect(provider.presenceNote).toBeUndefined();
    expect(provider.capability).not.toBeInstanceOf(Object);
    expect(provider.authMethods).toBeUndefined();
    expect(provider.methods).toBeInstanceOf(Array);
  }
  const workbuddy = body.state.providers.find((provider) => provider.id === "workbuddy");
  expect(workbuddy.methods[0].label).toBe("WorkBuddy (browser)");
  expect(workbuddy.canSignIn).toBe(true);
});

test("/api/agent never publishes a stored proxy credential", async () => {
  const created = await api("POST", "/api/proxies", {
    name: "Home",
    type: "http",
    host: "127.0.0.1",
    port: 8080,
    username: "alice",
    password: "s3cr3t-value",
  });
  expect(created.status).toBe(201);
  const res = await api("GET", "/api/agent");
  const body = await res.json();
  expect(body.state.proxies).toHaveLength(1);
  expect(body.state.proxies[0].hasPassword).toBe(true);
  expect(body.state.proxies[0].password).toBeUndefined();
  expect(body.state.proxies[0].username).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain("s3cr3t-value");
  expect(JSON.stringify(body)).not.toContain("alice");
});

// ---------- ?wait on the status routes ----------

test("GET /api/signin?wait blocks until the flow settles", async () => {
  resetReads();
  ctl.signin = [{ state: "waiting-login" }, { state: "waiting-login" }, { state: "done" }];
  const res = await api("GET", "/api/signin?wait=5000");
  expect(res.status).toBe(200);
  expect((await res.json()).flow).toEqual({ state: "done" });
  expect(ctl.reads.signin).toBe(3);
});

test("GET /api/signin?wait returns immediately when the caller must supply a code", async () => {
  resetReads();
  ctl.signin = [{ state: "waiting-code" }];
  const res = await api("GET", "/api/signin?wait=5000");
  expect((await res.json()).flow).toEqual({ state: "waiting-code" });
  expect(ctl.reads.signin).toBe(1);
});

test("no wait, wait=0 and junk wait all read exactly once", async () => {
  for (const query of ["", "?wait=0", "?wait=-1", "?wait=abc"]) {
    resetReads();
    ctl.signin = [{ state: "waiting-login" }];
    const res = await api("GET", `/api/signin${query}`);
    expect((await res.json()).flow).toEqual({ state: "waiting-login" });
    expect(ctl.reads.signin).toBe(1);
  }
});

test("GET /api/native-signin?wait stops at paste-required and at terminal states", async () => {
  resetReads();
  ctl.native = [{ state: "waiting" }, { state: "paste-required" }];
  let res = await api("GET", "/api/native-signin?wait=5000");
  expect((await res.json()).flow).toEqual({ state: "paste-required" });
  expect(ctl.reads.native).toBe(2);

  resetReads();
  ctl.native = [{ state: "waiting" }, { state: "done" }];
  res = await api("GET", "/api/native-signin?wait=5000");
  expect((await res.json()).flow).toEqual({ state: "done" });
  expect(ctl.reads.native).toBe(2);
});

test("GET /api/proxy-score?wait and /api/environment routes share the same bound", async () => {
  resetReads();
  ctl.score = [{ job: { state: "measuring" }, browserOpen: true }, { job: { state: "done" }, browserOpen: false }];
  let res = await api("GET", "/api/proxy-score?wait=5000");
  expect((await res.json()).job).toEqual({ state: "done" });
  expect(ctl.reads.score).toBe(2);

  resetReads();
  ctl.envJob = [{ state: "preparing" }, { state: "ready" }];
  for (const path of ["/api/environment?wait=5000", "/api/environment/job?wait=5000"]) {
    resetReads();
    ctl.envJob = [{ state: "preparing" }, { state: "ready" }];
    res = await api("GET", path);
    const body = await res.json();
    expect(body.job).toEqual({ state: "ready" });
    expect(ctl.reads.envJob).toBe(2);
  }
});

test("GET /api/accounts/:provider/:key/check?wait waits for this account's job", async () => {
  resetReads();
  const job = (state) => ({ job: { provider: "workbuddy", key: "workbuddy", state }, browserOpen: false });
  ctl.check = [job("checking"), job("checking"), job("done")];
  const res = await api("GET", "/api/accounts/workbuddy/workbuddy/check?wait=5000");
  expect((await res.json()).job.state).toBe("done");
  expect(ctl.reads.check).toBe(3);

  // A job for a different account is not this account's state: it reads idle
  // and the wait ends immediately.
  resetReads();
  ctl.check = [{ job: { provider: "codex", key: "codex", state: "checking" }, browserOpen: false }];
  const other = await api("GET", "/api/accounts/workbuddy/workbuddy/check?wait=5000");
  expect((await other.json()).job.state).toBe("idle");
  expect(ctl.reads.check).toBe(1);
});

test("the existing status routes are unchanged without a wait parameter", async () => {
  resetReads();
  ctl.signin = [{ state: "waiting-login" }];
  ctl.native = [{ state: "waiting" }];
  ctl.score = [{ job: { state: "measuring" }, browserOpen: true }];
  const signin = await (await api("GET", "/api/signin")).json();
  expect(signin.flow).toEqual({ state: "waiting-login" });
  const native = await (await api("GET", "/api/native-signin")).json();
  expect(native.flow).toEqual({ state: "waiting" });
  const score = await (await api("GET", "/api/proxy-score")).json();
  expect(score.job).toEqual({ state: "measuring" });
  expect(score.browserOpen).toBe(true);
});
