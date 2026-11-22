import { afterAll, beforeAll, expect, test } from "bun:test";
import { request } from "node:http";
import { connect } from "node:net";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buttonIds } from "./button-ids.mjs";

const root = join(import.meta.dir, "..");
// Read the version instead of pinning it here: the suite should not need an
// edit every time the package is released.
const pkgVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const tmp = mkdtempSync(join(tmpdir(), "clean-login-"));
let service;
let port;
let token;
let tokenHeader;

// Injected so the suite never imports a provider plugin and never spawns a
// child process. It reports one installed plugin entry that matches magpie's
// `brand-new` provider and exposes a browser method.
const pluginScanner = {
  get: () => ({
    available: true,
    providers: [
      {
        id: "brand-new",
        package: "@magpie-community/opencode-brand-new-auth",
        methods: [
          { type: "oauth", label: "Brand New (browser)", browser: true, category: "browser", runnable: true },
          { type: "oauth", label: "brand-new CLI's sign-in", browser: false, category: "local", runnable: true },
          { type: "api", label: "Brand New API key", browser: false, category: "key", runnable: false },
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
  const { startServer, TOKEN_HEADER } = await import("../lib/server.mjs");
  tokenHeader = TOKEN_HEADER;
  service = await startServer({
    port: 0,
    dataDir: join(tmp, "data"),
    // Keep both the plugin data directory and magpie's config directory inside
    // the temp root, so the startup orphan sweep never reads or writes the
    // real ~/.config/magpie.
    env: {
      ...process.env,
      MAGPIE_CONFIG_DIR: join(tmp, "magpie-config"),
      MAGPIE_CLEAN_LOGIN_DATA: join(tmp, "data"),
      // Same rule for the catalogue: point the cache at the temp root so a
      // test never reads the developer's real ~/.cache/magpie and a machine
      // with a large market cannot change an expected card count.
      MAGPIE_CACHE_DIR: join(tmp, "magpie-cache"),
    },
    pluginScanner,
  });
  port = service.port;
  // The startup sweep is fire-and-forget; wait for it so the health assertion
  // below is not racing it.
  await service.prune();
  const page = await raw("GET", "/");
  token = /name="clean-login-token" content="([0-9a-f]+)"/.exec(page.body)?.[1];
});

afterAll(async () => {
  await service?.close();
  rmSync(tmp, { recursive: true, force: true });
});

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
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

const auth = () => ({ "x-clean-login-token": token });

// Same request helper against an ad-hoc service on another port (the seam
// tests below each start their own instance).
function rawWith(targetPort, method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: targetPort,
        method,
        path,
        headers: { host: `127.0.0.1:${targetPort}`, ...headers },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

// One request written byte for byte, so a request-target no HTTP client would
// send (`http://[::1/`) reaches the server as-is.
function rawRequest(text) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (data += chunk));
    socket.on("end", () => resolve(data));
    socket.on("close", () => resolve(data));
    socket.on("error", reject);
    socket.write(text);
  });
}

// ---------- the Host side ----------

test("a malformed request-target is a 400 and the service keeps serving", async () => {
  // `new URL("http://[::1/", ...)` throws ERR_INVALID_URL. It used to run
  // outside the route `try`, so this one request killed the process.
  const answer = await rawRequest(
    `GET http://[::1/ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
  );
  expect(answer.split("\r\n")[0]).toBe("HTTP/1.1 400 Bad Request");
  const next = await raw("GET", "/");
  expect(next.status).toBe(200);
  const health = await raw("GET", "/api/health", auth());
  expect(health.status).toBe(200);
});

test("serves the UI with a per-process token", () => {
  expect(token).toMatch(/^[0-9a-f]{64}$/);
});

test("refuses API calls without the page token", async () => {
  for (const path of ["/api/health", "/api/bootstrap", "/api/providers"]) {
    const res = await raw("GET", path);
    expect(res.status).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.reload).toBe(true);
    // Same error shape as every other API error: a code plus a message.
    expect(typeof body.message).toBe("string");
  }
});

test("a refused Origin is a JSON 403 with the same shape", async () => {
  const res = await raw("GET", "/api/health", { origin: "https://evil.example" });
  expect(res.status).toBe(403);
  const body = JSON.parse(res.body);
  expect(body.error).toBe("forbidden");
  expect(typeof body.message).toBe("string");
});

test("a bad percent-encoding in a static path is a 400, never a 500", async () => {
  const res = await raw("GET", "/%");
  expect(res.status).toBe(400);
  expect(JSON.parse(res.body).error).toBe("invalid_path");
  const asset = await raw("GET", "/assets/%");
  expect(asset.status).toBe(400);
});

test("environment routes publish no host paths and an idle job shape", async () => {
  const res = await raw("GET", "/api/environment", auth());
  expect(res.status).toBe(200);
  const body = JSON.parse(res.body);
  // `installDir` stays public so the UI can render the sandbox browser location;
  // internal launch details (`executablePath`, `modelDir`) and service data
  // paths (`tmp`) stay stripped.
  expect(typeof body.environment.installDir).toBe("string");
  expect(body.environment.installDir.length).toBeGreaterThan(0);
  expect(body.environment.modelDir).toBeUndefined();
  expect(body.environment.executablePath).toBeUndefined();
  expect(res.body).not.toContain(tmp);
  // "Never ran" is the same idle shape the other job routes use, not null.
  expect(body.job).toEqual({ state: "idle" });

  const job = await raw("GET", "/api/environment/job", auth());
  expect(job.status).toBe(200);
  expect(JSON.parse(job.body).job).toEqual({ state: "idle" });
});

test("GET /api/signin reports the idle flow shape when nothing ran", async () => {
  const res = await raw("GET", "/api/signin", auth());
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body).flow).toEqual({ state: "idle" });
});

test("GET check and GET hosting are 404 for an account with no ledger", async () => {
  const check = await raw("GET", "/api/accounts/workbuddy/workbuddy%23nope/check", auth());
  expect(check.status).toBe(404);
  expect(JSON.parse(check.body).error).toBe("not_found");
  const hosting = await raw("GET", "/api/accounts/workbuddy/workbuddy%23nope/hosting", auth());
  expect(hosting.status).toBe(404);
  expect(JSON.parse(hosting.body).error).toBe("not_found");
});

test("DELETE works on a fresh install, and a corrupt auth file still refuses", async () => {
  const { writeAccountMeta, accountDir } = await import("../lib/account-identity.mjs");
  const config = join(tmp, "magpie-config");
  const env = { ...process.env, MAGPIE_CONFIG_DIR: config, MAGPIE_CLEAN_LOGIN_DATA: join(tmp, "data") };
  const retired = accountDir(env, "workbuddy", "workbuddy#gone");
  await writeAccountMeta(retired, {
    version: 1,
    provider: "workbuddy",
    key: "workbuddy#gone",
    accountId: "gone",
    uid: "u-g",
    signedInAt: null,
  });

  // No plugin-auth.json and no logins.json: "no credential exists" is a real
  // answer, so a retired directory can be deleted instead of refused.
  const res = await raw("DELETE", "/api/accounts/workbuddy/workbuddy%23gone", auth());
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ ok: true });
  expect(existsSync(retired)).toBe(false);

  // A store that EXISTS but cannot be read stays a refusal.
  await mkdir(config, { recursive: true });
  await writeFile(join(config, "plugin-auth.json"), "{ not json");
  const second = accountDir(env, "workbuddy", "workbuddy#gone2");
  await writeAccountMeta(second, {
    version: 1,
    provider: "workbuddy",
    key: "workbuddy#gone2",
    accountId: "gone2",
    uid: "u-g2",
    signedInAt: null,
  });
  const refused = await raw("DELETE", "/api/accounts/workbuddy/workbuddy%23gone2", auth());
  expect(refused.status).toBe(503);
  expect(JSON.parse(refused.body).error).toBe("auth_unreadable");
  expect(existsSync(second)).toBe(true);

  // Leave the temp tree as the surrounding tests expect: no auth file, no
  // accounts root.
  rmSync(join(config, "plugin-auth.json"), { force: true });
  rmSync(second, { recursive: true, force: true });
  rmSync(join(tmp, "data", "accounts"), { recursive: true, force: true });
});

test("bootstrap returns the Host-driven shape with the public provider registry", async () => {
  const res = await raw("GET", "/api/bootstrap", auth());
  expect(res.status).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.version).toBe(pkgVersion);
  expect(body.service).toEqual({ status: "ready" });
  expect(body.providers.map((provider) => provider.id)).toEqual([
    "antigravity",
    "codex",
    "claude",
  ]);
  for (const provider of body.providers) {
    expect(provider.capability.state).not.toBe("ready");
    // No verification reason is published any more: a card carries no state a
    // user could ever clear, so there is nothing to explain away.
    expect(provider.capability.reason).toEqual({});
    expect(provider.clientSecret).toBeUndefined();
    expect(provider.clientId).toBeUndefined();
    expect(provider.token).toBeUndefined();
  }
  expect(body.proxies).toEqual([]);
  // No data directory or other host paths leak through the API.
  expect(body.dataDir).toBeUndefined();
  expect(res.body).not.toContain(tmp);
});

test("/api/providers is token-protected and returns the same public capabilities", async () => {
  const res = await raw("GET", "/api/providers", auth());
  expect(res.status).toBe(200);
  const body = JSON.parse(res.body);
  const bootstrap = JSON.parse((await raw("GET", "/api/bootstrap", auth())).body);
  expect(body.providers).toEqual(bootstrap.providers);
  expect(res.body).not.toMatch(/client[_-]?secret|client[_-]?id|access[_-]?token|refresh[_-]?token|api[_-]?key|password/i);
});

test("/api/provider-sources merges magpie's list and reports the source", async () => {
  const res = await raw(
    "POST",
    "/api/provider-sources",
    { ...auth(), "content-type": "application/json" },
    JSON.stringify({ magpie: { v: 1, ok: true, value: ["codex", "brand-new"] } }),
  );
  expect(res.status).toBe(200);
  const view = JSON.parse(res.body).providerSources;
  expect(view.source).toBe("magpie");
  expect(view.magpie).toEqual({ available: true, count: 2 });
  expect(view.counts).toEqual({ total: 4, both: 1, localOnly: 2, magpieOnly: 1, pluginOnly: 0, catalogOnly: 0 });
  const byId = Object.fromEntries(view.providers.map((provider) => [provider.id, provider]));
  expect(byId.codex.presence).toBe("both");
  expect(byId.antigravity.presence).toBe("local-only");
  expect(byId.claude.presence).toBe("local-only");
  expect(byId["brand-new"].presence).toBe("magpie-only");
  expect(byId["brand-new"].sources).toEqual({ local: false, magpie: true });
  expect(res.body).not.toMatch(/client[_-]?secret|access[_-]?token|api[_-]?key|password/i);
});

test("/api/provider-sources keeps installed-plugin cards when magpie's list is missing", async () => {
  for (const body of [undefined, JSON.stringify({}), JSON.stringify({ magpie: null })]) {
    const res = await raw(
      "POST",
      "/api/provider-sources",
      { ...auth(), "content-type": "application/json" },
      body,
    );
    expect(res.status).toBe(200);
    const view = JSON.parse(res.body).providerSources;
    expect(view.source).toBe("local");
    expect(view.magpie.available).toBe(false);
    const byId = Object.fromEntries(view.providers.map((provider) => [provider.id, provider]));
    // The three local entries keep the honest "unknown" presence: nobody read
    // magpie's list, so nothing is claimed about it.
    for (const id of ["antigravity", "codex", "claude"]) {
      expect(byId[id].presence).toBe("local-unknown");
    }
    // An installed plugin that exposes a provider is evidence on its own, so
    // its card survives the missing magpie list. This is the bug that used to
    // delete every plugin card on the launcher path.
    expect(byId["brand-new"].presence).toBe("plugin-only");
    // What the card may not do is claim the unread list omits the provider.
    // It now says nothing about the list at all, which is the same honesty
    // with fewer words: there is no sentence to be wrong.
    expect(byId["brand-new"].notice).toBeNull();
    expect(byId["brand-new"].description).toEqual({});
  }
});

test("/api/provider-sources reports the injected plugin scan and its derived methods", async () => {
  const res = await raw(
    "POST",
    "/api/provider-sources",
    { ...auth(), "content-type": "application/json" },
    JSON.stringify({ magpie: { v: 1, ok: true, value: ["codex", "brand-new"] } }),
  );
  expect(res.status).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.pluginScan).toEqual({
    available: true,
    count: 1,
    scanned: true,
    stale: false,
    scanning: false,
    error: null,
  });
  const byId = Object.fromEntries(body.providerSources.providers.map((provider) => [provider.id, provider]));
  expect(byId["brand-new"].presence).toBe("magpie-only");
  expect(byId["brand-new"].browserMethod).toBe(true);
  expect(byId["brand-new"].signInProvider).toBe("brand-new");
  expect(byId["brand-new"].authMethods).toEqual([
    { type: "oauth", label: "Brand New (browser)", browser: true, category: "browser", prompts: [], runnable: true, fields: [] },
    { type: "oauth", label: "brand-new CLI's sign-in", browser: false, category: "local", prompts: [], runnable: true, fields: [] },
    { type: "api", label: "Brand New API key", browser: false, category: "key", prompts: [], runnable: false, fields: [] },
  ]);
  // A card for a provider magpie lists prints no paragraph, so its reason is
  // empty. It is offered through its own installed plugin door.
  expect(byId["brand-new"].capability.reason).toEqual({});
  expect(byId["brand-new"].description).toEqual({});
  expect(byId["brand-new"].notice).toBeNull();
  expect(byId["brand-new"].presenceNote).toBeNull();
  // The response still carries no button wording and no authorize function.
  expect(res.body).not.toMatch(/Add Account|authorize/i);
});

test("/api/provider-sources is token-protected", async () => {
  const res = await raw("POST", "/api/provider-sources", {}, JSON.stringify({ magpie: [] }));
  expect(res.status).toBe(403);
});

test("health stays a secretless liveness probe", async () => {
  const res = await raw("GET", "/api/health", auth());
  expect(res.status).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.ok).toBe(true);
  expect(body.version).toBe(pkgVersion);
  expect(body.dataDir).toBeUndefined();
  // The most recent orphan sweep is reported as counts and a short skip
  // reason; no account key, provider or path leaks through health.
  expect(body.accounts).toEqual({
    ran: true,
    // `kept` and `retired` are read now, not taken from the sweep's report.
    kept: 0,
    retired: 0,
    // No directory carries an ownership ledger in this temp data directory.
    live: true,
    pruned: 0,
    skippedLive: 0,
    failed: 0,
    // The temp MAGPIE_CONFIG_DIR has no plugin-auth.json and no logins.json.
    // Both stores absent is "no credential exists", so the sweep runs (and
    // finds nothing to do) instead of bailing out.
    skipped: null,
    sweptAt: expect.any(String),
  });
  expect(res.body).not.toContain(tmp);
});

// The point of reading the counts at request time: a sign-out between two
// sweeps must show up immediately, instead of waiting for the next sweep (or a
// restart) to move the number.
test("health counts accounts now, not at the last sweep", async () => {
  const { writeAccountMeta } = await import("../lib/account-identity.mjs");
  const config = join(tmp, "magpie-config");
  const authFile = join(config, "plugin-auth.json");
  const key = "health-probe";
  const dir = join(tmp, "data", "accounts", key, key);
  await mkdir(dir, { recursive: true });
  await mkdir(config, { recursive: true });
  await writeAccountMeta(dir, {
    version: 1,
    provider: key,
    key,
    accountId: "Health Probe",
    uid: "uid-health",
    signedInAt: null,
  });

  // Signed in: the key is in the auth file.
  await writeFile(authFile, JSON.stringify({ [key]: { type: "oauth", accountId: "Health Probe", uid: "uid-health" } }));
  let body = JSON.parse((await raw("GET", "/api/health", auth())).body);
  expect(body.accounts.live).toBe(true);
  expect(body.accounts.kept).toBe(1);
  expect(body.accounts.retired).toBe(0);

  // Signed out: the key is gone from the auth file. No sweep runs here, so
  // the flipped numbers can only come from reading the state at request time.
  await writeFile(authFile, JSON.stringify({}));
  body = JSON.parse((await raw("GET", "/api/health", auth())).body);
  expect(body.accounts.live).toBe(true);
  expect(body.accounts.kept).toBe(0);
  expect(body.accounts.retired).toBe(1);

  // Signed in again: the same directory moves back, still without a sweep.
  await writeFile(authFile, JSON.stringify({ [key]: { type: "oauth", accountId: "Health Probe", uid: "uid-health" } }));
  body = JSON.parse((await raw("GET", "/api/health", auth())).body);
  expect(body.accounts.kept).toBe(1);
  expect(body.accounts.retired).toBe(0);

  // Leave the temp tree exactly as the earlier tests found it: the next test
  // expects no plugin-auth.json at all (the sweep runs and prunes nothing)
  // and no `accounts/` root left behind.
  rmSync(join(tmp, "data", "accounts"), { recursive: true, force: true });
  rmSync(authFile, { force: true });
});

test("POST /api/accounts/prune runs the orphan sweep and returns its report", async () => {
  const res = await raw("POST", "/api/accounts/prune", auth());
  expect(res.status).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.report).toEqual({
    removed: [],
    kept: [],
    retired: [],
    skippedLive: [],
    failed: [],
    // Both auth stores missing means "nothing signed in", not "cannot tell":
    // the sweep runs and has nothing to reclaim.
    skipped: null,
  });
});

test("POST /api/accounts/prune is token-protected and rejects other methods", async () => {
  const anonymous = await raw("POST", "/api/accounts/prune");
  expect(anonymous.status).toBe(403);
  const wrongMethod = await raw("GET", "/api/accounts/prune", auth());
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.allow).toBe("POST");
});

// ---------- the trust-score browser directory ----------
//
// The scoring browser keeps its own persistent identity. It must NOT live
// under `accounts/`, because the startup orphan sweep removes every account
// directory whose key is not in plugin-auth.json -- which would delete the
// pinned fingerprint (and the profile) on the next service start.

test("the scoring browser directory survives the account orphan sweep", async () => {
  const dataDir = join(tmp, "data");
  const scoreDir = join(dataDir, "score-browser", "profile");
  await mkdir(scoreDir, { recursive: true });
  await writeFile(join(scoreDir, "marker.txt"), "keep me");
  const report = await raw("POST", "/api/accounts/prune", auth());
  expect(report.status).toBe(200);
  expect(existsSync(join(scoreDir, "marker.txt"))).toBe(true);
  // It is not an account directory at all.
  expect(existsSync(join(dataDir, "accounts"))).toBe(false);
});

test("refuses another site's Origin even with the token", async () => {
  const res = await raw("GET", "/api/bootstrap", {
    origin: "https://evil.example",
    ...auth(),
  });
  expect(res.status).toBe(403);
  // A refused Origin must not receive any CORS header either.
  for (const key of Object.keys(res.headers)) {
    expect(key.startsWith("access-control-")).toBe(false);
  }
});

// ---------- sandbox (opaque-origin) CORS ----------
//
// magpie loads this UI in <iframe sandbox="allow-scripts">, which the browser
// treats as an opaque origin: the app module and every fetch are cross-origin
// with `Origin: null`. Without these headers the UI never boots.

test("preflight OPTIONS /api/bootstrap is answered before the token gate", async () => {
  const res = await raw("OPTIONS", "/api/bootstrap", {
    origin: "null",
    "access-control-request-method": "GET",
    "access-control-request-headers": `${tokenHeader}, content-type`,
  });
  expect(res.status).toBe(204);
  expect(res.headers["access-control-allow-origin"]).toBe("null");
  expect(res.headers["access-control-allow-methods"]).toBe("GET, POST, PATCH, DELETE");
  expect(res.headers["access-control-allow-headers"]).toBe(`${tokenHeader}, content-type`);
  expect(res.headers.vary).toBe("Origin");
});

test("a foreign-Origin preflight is still refused and gets no CORS headers", async () => {
  const res = await raw("OPTIONS", "/api/bootstrap", {
    origin: "https://evil.example",
    "access-control-request-method": "GET",
  });
  expect(res.status).toBe(403);
  for (const key of Object.keys(res.headers)) {
    expect(key.startsWith("access-control-")).toBe(false);
  }
});

test("bootstrap echoes an opaque Origin and varies on it", async () => {
  const res = await raw("GET", "/api/bootstrap", { origin: "null", ...auth() });
  expect(res.status).toBe(200);
  expect(res.headers["access-control-allow-origin"]).toBe("null");
  expect(res.headers.vary).toBe("Origin");
});

test("the UI modules are readable from an opaque origin", async () => {
  for (const path of [
    "/app.js",
    "/account-state.js",
    "/asset-view.js",
    "/reload-guard.js",
    "/provider-state.js",
    "/proxy-state.js",
    "/environment-state.js",
    "/style.css",
    "/assets/icon.svg",
  ]) {
    const res = await raw("GET", path, { origin: "null" });
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("null");
    expect(res.headers.vary).toBe("Origin");
  }
});

test("assets without an Origin fall back to a wildcard CORS header", async () => {
  const res = await raw("GET", "/app.js");
  expect(res.status).toBe(200);
  expect(res.headers["access-control-allow-origin"]).toBe("*");
  expect(res.headers.vary).toBe("Origin");
});

test("the token-bearing HTML document is never CORS-readable", async () => {
  for (const path of ["/", "/index.html"]) {
    const res = await raw("GET", path, { origin: "null" });
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    for (const key of Object.keys(res.headers)) {
      expect(key.startsWith("access-control-")).toBe(false);
    }
  }
});

// Guards against the Apple WKWebView / Safari opaque-sandbox CSP regression
// caught on macos-latest (`wails://wails` and `magpie web`): bare `connect-src 'self';`
// causes WebKit to block relative `/api/*` fetches inside `<iframe sandbox="allow-scripts">`.
test("HTML CSP permits http/https connect-src for WKWebView opaque sandbox while keeping script/document locks", async () => {
  for (const path of ["/", "/index.html"]) {
    const res = await raw("GET", path, { origin: "null" });
    expect(res.status).toBe(200);
    const csp = res.headers["content-security-policy"] || "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' http: https:;");
    expect(csp).not.toContain("connect-src 'self';");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
  }
});

test("refuses a DNS-rebound Host", async () => {
  const res = await raw("GET", "/", { host: "evil.example" });
  expect(res.status).toBe(403);
});

test("does not serve files outside the UI folders", async () => {
  for (const path of ["/..%2Fpackage.json", "/assets/..%2F..%2Fpackage.json", "/%2e%2e/package.json"]) {
    const res = await raw("GET", path);
    expect(res.status).toBe(404);
  }
});

// ---------- the UI is served, not leaked ----------

test("the UI is served with the token placeholder replaced", async () => {
  const res = await raw("GET", "/");
  expect(res.status).toBe(200);
  expect(res.body).toContain(`content="${token}"`);
  expect(res.body).not.toContain("__CLEAN_LOGIN_TOKEN__");
});

test("static assets carry no token and no placeholder", async () => {
  for (const path of ["/app.js", "/style.css", "/assets/icon.svg"]) {
    const res = await raw("GET", path);
    expect(res.status).toBe(200);
    expect(res.body).not.toContain(token);
    expect(res.body).not.toContain("__CLEAN_LOGIN_TOKEN__");
  }
});

test("a non-iframe embed fetch gets a token-free stub", async () => {
  // magpie's launcher navigates here in an iframe. A `<embed>`/`<object>`
  // (nested-document) load is never legitimate, so the served document must
  // not carry the API token into it. Top-level (`document`) and iframe
  // navigations still get the real page; the in-page embed gate is what
  // refuses a bare tab.
  const stub = await raw("GET", "/", { "sec-fetch-dest": "nested-document" });
  expect(stub.status).toBe(200);
  expect(stub.body).not.toContain("__CLEAN_LOGIN_TOKEN__");
  expect(stub.body).not.toContain(token);
  const frame = await raw("GET", "/", { "sec-fetch-dest": "iframe" });
  expect(frame.body).toContain(token);
  const document_ = await raw("GET", "/", { "sec-fetch-dest": "document" });
  expect(document_.body).toContain(token);
});

test("the UI is genuinely Host-driven", () => {
  const app = readFileSync(join(root, "ui", "app.js"), "utf8");
  expect(app).toContain('api("api/bootstrap")');
  expect(app).toContain("fetch(path");
  expect(app).toContain('meta[name="clean-login-token"]');
  expect(app).toContain("x-clean-login-token");
  // No mock data and no unshipped actions.
  expect(app).not.toMatch(/innerHTML/);
  expect(app).not.toMatch(/\bmock\b|simulat|preview|example\.com|data-add/i);
});

test("static files exist and carry no mock data or dead action buttons", () => {
  for (const file of ["ui/index.html", "ui/style.css", "ui/app.js", "ui/account-state.js", "ui/account-view.js", "ui/asset-view.js", "ui/proxy-state.js", "ui/provider-state.js", "ui/signin-state.js", "lib/provider-registry.mjs"]) {
    expect(existsSync(join(root, file))).toBe(true);
  }
  const html = readFileSync(join(root, "ui", "index.html"), "utf8");
  // Four tabs, the one-time browser setup, the proxy dialog, delete
  // confirmation, the add-account dialog, and the accounts page v2 toolbar,
  // filter chips and both account dialogs. Every button is wired in app.js.
  // The id list itself lives in test/button-ids.mjs: one copy, so two open
  // pull requests that each add a button no longer collide on a hand-merged
  // array.
  expect((html.match(/<button\b/g) || []).length).toBe(buttonIds.length);
  for (const id of buttonIds) expect(html).toContain(`id="${id}"`);
  expect(html).not.toMatch(/preview-badge|data-add|account-menu|mock/i);
  // The provider grid and its empty state stay an honest empty state with no
  // dead action; the browser setup card above them owns its own wired
  // buttons.
  const providerArea = /<div class="empty" id="providers-empty">[\s\S]*?<\/section>/.exec(html)?.[0] || "";
  expect(providerArea).toContain('id="providers-list"');
  expect(providerArea).not.toContain("<button");
  // The proxy dialog has the fields the API accepts and never fills the
  // password back in.
  for (const id of [
    "proxy-name",
    "proxy-type",
    "proxy-host",
    "proxy-port",
    "proxy-username",
    "proxy-password",
    "proxy-test-result",
    "proxy-form-error",
  ]) {
    expect(html).toContain(`id="${id}"`);
  }
  expect(html).toContain('type="password"');
  expect(html).toContain('id="confirm-dialog"');
  const app = readFileSync(join(root, "ui", "app.js"), "utf8");
  for (const id of buttonIds.filter((id) => id !== "save-proxy")) {
    expect(app).toContain(`byId("${id}").addEventListener`);
  }
  expect(app).toContain('byId("proxy-form").addEventListener("submit"');
  expect(app).toContain("createConfirmController");
  expect(app).toContain("createRequestGuard");
});

// ---------- the startServer data seam ----------
//
// startServer({ env }) must isolate the proxy store too. The default used to
// read process.env, so a caller that passed an isolated env still wrote into
// the real ~/.config/magpie/magpie-clean-login. These tests rebuild that trap
// with temporary directories and never touch the real home.

const seamScanner = {
  get: () => ({ available: false, providers: [], scanned: false, stale: false, scanning: false, error: null }),
  warm: () => {},
};

function snapshotEnv() {
  return {
    MAGPIE_CONFIG_DIR: process.env.MAGPIE_CONFIG_DIR,
    MAGPIE_CLEAN_LOGIN_DATA: process.env.MAGPIE_CLEAN_LOGIN_DATA,
  };
}

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const seamProxy = { name: "probe", type: "http", host: "127.0.0.1", port: 8080, username: "", password: "" };

test("startServer({ env }) defaults dataDir to the caller's env, not process.env", async () => {
  const { startServer } = await import("../lib/server.mjs");
  const envRoot = mkdtempSync(join(tmpdir(), "clean-login-env-"));
  const realConfig = mkdtempSync(join(tmpdir(), "clean-login-real-"));
  const isolatedData = join(envRoot, "data");
  const previous = snapshotEnv();
  // Point process.env at the "real" config root. The buggy default would
  // write the store there even though the caller passed its own env.
  process.env.MAGPIE_CONFIG_DIR = realConfig;
  delete process.env.MAGPIE_CLEAN_LOGIN_DATA;
  let service;
  try {
    service = await startServer({
      port: 0,
      env: {
        ...process.env,
        MAGPIE_CONFIG_DIR: envRoot,
        MAGPIE_CLEAN_LOGIN_DATA: isolatedData,
      },
      pluginScanner: seamScanner,
    });
    expect(service.dataDir).toBe(isolatedData);
    await service.prune();
    await service.store.create(seamProxy);
    expect(existsSync(join(isolatedData, "proxies.json"))).toBe(true);
    // The real config root must stay empty: no magpie-clean-login directory,
    // no proxies.json.
    expect(readdirSync(realConfig)).toEqual([]);
  } finally {
    await service?.close();
    restoreEnv(previous);
    rmSync(envRoot, { recursive: true, force: true });
    rmSync(realConfig, { recursive: true, force: true });
  }
});

test("an explicit dataDir still wins over env", async () => {
  const { startServer } = await import("../lib/server.mjs");
  const rootDir = mkdtempSync(join(tmpdir(), "clean-login-explicit-"));
  const explicit = join(rootDir, "explicit");
  const envData = join(rootDir, "env-data");
  const previous = snapshotEnv();
  let service;
  try {
    service = await startServer({
      port: 0,
      dataDir: explicit,
      env: {
        ...process.env,
        MAGPIE_CONFIG_DIR: rootDir,
        MAGPIE_CLEAN_LOGIN_DATA: envData,
      },
      pluginScanner: seamScanner,
    });
    expect(service.dataDir).toBe(explicit);
    await service.prune();
    await service.store.create(seamProxy);
    expect(existsSync(join(explicit, "proxies.json"))).toBe(true);
    expect(existsSync(envData)).toBe(false);
  } finally {
    await service?.close();
    restoreEnv(previous);
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// A corrupt proxies.json must report `recovered` on the very first GET: the
// store only flags the quarantine while loading, so the route has to read the
// flag after store.list() finishes, not before.
test("GET /api/proxies reports recovered on the first request against a corrupt store", async () => {
  const { startServer } = await import("../lib/server.mjs");
  const root = mkdtempSync(join(tmpdir(), "clean-login-recovered-"));
  const data = join(root, "data");
  await mkdir(data, { recursive: true });
  await writeFile(join(data, "proxies.json"), "{ this is not json !!!");
  let local;
  try {
    local = await startServer({
      port: 0,
      dataDir: data,
      env: {
        ...process.env,
        MAGPIE_CONFIG_DIR: join(root, "magpie-config"),
        MAGPIE_CLEAN_LOGIN_DATA: data,
      },
      pluginScanner: seamScanner,
    });
    const page = await rawWith(local.port, "GET", "/");
    const localToken = /name="clean-login-token" content="([0-9a-f]+)"/.exec(page.body)?.[1];
    const response = await rawWith(local.port, "GET", "/api/proxies", {
      "x-clean-login-token": localToken,
    });
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.proxies).toEqual([]);
    expect(body.recovered).toBeTruthy();
    expect(body.recovered.corruptFile).toMatch(/^proxies\.json\.corrupt-/);
    // The quarantined bytes stay on disk for manual salvage.
    expect(existsSync(join(data, body.recovered.corruptFile))).toBe(true);
  } finally {
    await local?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// The environment manager defaults to process.env; a caller with an isolated
// env must not read the real browser cache root. The test points
// process.env at a decoy root and plants an install record only in the
// caller's env root: installed only flips when the manager honored the env.
test("startServer({ env }) builds the environment manager from the caller's env", async () => {
  const { startServer } = await import("../lib/server.mjs");
  const root = mkdtempSync(join(tmpdir(), "clean-login-envmgr-"));
  const envBrowserRoot = join(root, "env-browser");
  const decoyBrowserRoot = join(root, "decoy-browser");
  const executable = join(envBrowserRoot, "camoufox.exe");
  await mkdir(envBrowserRoot, { recursive: true });
  await writeFile(executable, "fake");
  await writeFile(
    join(envBrowserRoot, "install.json"),
    JSON.stringify({ version: "0.0.0", executablePath: executable, checksumVerified: true }),
  );
  const previous = process.env.MAGPIE_CLEAN_LOGIN_BROWSER_DIR;
  process.env.MAGPIE_CLEAN_LOGIN_BROWSER_DIR = decoyBrowserRoot;
  let local;
  try {
    local = await startServer({
      port: 0,
      dataDir: join(root, "data"),
      env: {
        ...process.env,
        MAGPIE_CONFIG_DIR: join(root, "magpie-config"),
        MAGPIE_CLEAN_LOGIN_DATA: join(root, "data"),
        MAGPIE_CLEAN_LOGIN_BROWSER_DIR: envBrowserRoot,
      },
      pluginScanner: seamScanner,
    });
    const page = await rawWith(local.port, "GET", "/");
    const localToken = /name="clean-login-token" content="([0-9a-f]+)"/.exec(page.body)?.[1];
    const response = await rawWith(local.port, "GET", "/api/environment", {
      "x-clean-login-token": localToken,
    });
    expect(response.status).toBe(200);
    // The record only exists in the env's root; the decoy root has none.
    expect(JSON.parse(response.body).environment.installed).toBe(true);
  } finally {
    await local?.close();
    if (previous === undefined) delete process.env.MAGPIE_CLEAN_LOGIN_BROWSER_DIR;
    else process.env.MAGPIE_CLEAN_LOGIN_BROWSER_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

// The plugin scanner's child scan resolves the plugin root from
// MAGPIE_CONFIG_DIR. With no env passed it would scan the real config root
// and miss the provider planted under the caller's env root.
test("startServer({ env }) builds the plugin scanner from the caller's env", { timeout: 30_000 }, async () => {
  const { startServer } = await import("../lib/server.mjs");
  const root = mkdtempSync(join(tmpdir(), "clean-login-scanner-"));
  const config = join(root, "magpie-config");
  const pkg = join(config, "plugins", "node_modules", "@seam", "seam-provider");
  await mkdir(pkg, { recursive: true });
  await writeFile(
    join(pkg, "package.json"),
    JSON.stringify({ name: "@seam/seam-provider", main: "index.mjs" }),
  );
  await writeFile(
    join(pkg, "index.mjs"),
    `export default () => ({ auth: { provider: "seam-provider", methods: [{ type: "api", label: "Seam key", authorize: async () => {} }] } });\n`,
  );
  const callerEnv = { ...process.env, MAGPIE_CONFIG_DIR: config };
  // The suite runs under NODE_ENV=test, which disables the scanner; the
  // caller's env overrides that just for this service.
  delete callerEnv.NODE_ENV;
  let local;
  try {
    local = await startServer({
      port: 0,
      dataDir: join(root, "data"),
      env: { ...callerEnv, MAGPIE_CLEAN_LOGIN_DATA: join(root, "data") },
    });
    const page = await rawWith(local.port, "GET", "/");
    const localToken = /name="clean-login-token" content="([0-9a-f]+)"/.exec(page.body)?.[1];
    const authHeaders = {
      "x-clean-login-token": localToken,
      "content-type": "application/json",
    };
    // refresh kicks the cache synchronously; the child scan finishes in the
    // background, so poll until it lands.
    await rawWith(local.port, "POST", "/api/provider-sources", authHeaders, JSON.stringify({ refresh: true }));
    let plugins = null;
    for (let i = 0; i < 60; i += 1) {
      const scan = JSON.parse(
        (await rawWith(local.port, "POST", "/api/provider-sources", authHeaders, "{}")).body,
      ).pluginScan;
      if (scan.scanned) {
        plugins = scan;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    expect(plugins).toBeTruthy();
    expect(plugins.error).toBe(null);
    expect(plugins.available).toBe(true);
    const merged = JSON.parse(
      (await rawWith(local.port, "POST", "/api/provider-sources", authHeaders, "{}")).body,
    );
    expect(merged.providerSources.providers.some((item) => item.id === "seam-provider")).toBe(true);
  } finally {
    await local?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- the launcher ----------

test("page/boot.js uses magpie.ready/options/service and does not fetch", () => {
  const boot = readFileSync(join(root, "page", "boot.js"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  expect(boot).toContain("magpie?.ready");
  expect(boot).toContain("magpie?.options");
  expect(boot).toContain("magpie?.service");
  expect(boot).toContain("location.replace");
  expect(boot).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts/);
});

// Run page/boot.js the way the sandboxed frame runs it: with a fake window
// and location, and timers that do not keep the test process alive.
async function runBoot(magpie, { hostname = "127.0.0.1", search = "", dom, timers } = {}) {
  const src = readFileSync(join(root, "page", "boot.js"), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .trim();
  let went = "";
  const location = {
    hostname,
    href: `http://${hostname}/`,
    search,
    replace: (url) => { went = url; },
    reload: () => {},
  };
  const win = {
    magpie,
    setTimeout: timers?.setTimeout || (() => 1),
    clearTimeout: timers?.clearTimeout || (() => {}),
    addEventListener: () => {},
  };
  const document = dom || {
    documentElement: {},
    title: "",
    getElementById: () => null,
    createElement: () => ({ addEventListener() {} }),
  };
  await new Function("window", "location", "document", "return " + src)(win, location, document);
  return { went, document };
}

test("the launcher goes to the service with theme and language preserved", async () => {
  const ready = Promise.resolve({ dark: true, lang: "ja" });
  const options = { get: async () => ({ port: 3999 }) };
  const { went } = await runBoot({ ready, options, service: "" });
  const url = new URL(went);
  expect(url.origin).toBe("http://127.0.0.1:3999");
  expect(url.searchParams.get("theme")).toBe("dark");
  expect(url.searchParams.get("lang")).toBe("ja");
});

test("the launcher follows magpie.service for remote frames", async () => {
  const ready = Promise.resolve({ dark: false, lang: "zh-Hant" });
  const options = { get: async () => ({ port: 3999 }) };
  const svc = "http://server.lan:3430/_magpie/plugin/aaaa/_magpie/service/";
  const { went } = await runBoot({ ready, options, service: svc }, { hostname: "server.lan" });
  expect(went.startsWith(svc)).toBe(true);
  const url = new URL(went);
  expect(url.searchParams.get("theme")).toBe("light");
  expect(url.searchParams.get("lang")).toBe("zh-Hant");
});

test("without a bridge the launcher still reaches the default port", async () => {
  const { went } = await runBoot(undefined, { hostname: "127.0.0.1" });
  expect(new URL(went).origin).toBe("http://127.0.0.1:3492");
});

test("a remote frame without magpie.service gets a clear local message, not a refused port", async () => {
  const writes = {};
  const dom = {
    documentElement: {},
    title: "",
    getElementById: (id) => {
      if (id === "title") return { set textContent(value) { writes.title = value; } };
      if (id === "status") return { set textContent(value) { writes.status = value; }, after() {} };
      return null;
    },
    createElement: () => ({ addEventListener() {} }),
  };
  const { went } = await runBoot({ ready: Promise.resolve({ dark: false }) }, { hostname: "server.lan", dom });
  expect(went).toBe("");
  expect(writes.status).toMatch(/only on the computer/);
});

// The provider read must never block navigation. Every failure mode still
// lands on the loopback service with an ok:false envelope in the hash.
function providerEnvelope(went) {
  const hash = String(went).split("#")[1] || "";
  return JSON.parse(new URLSearchParams(hash).get("providers"));
}

test("boot carries a good providers:list read through the hash fragment", async () => {
  const magpie = {
    ready: Promise.resolve({ dark: false, lang: "en" }),
    options: { get: async () => ({ port: 3999 }) },
    read: async (name) => {
      expect(name).toBe("providers:list");
      return ["codex", { id: "mystery-ai", name: "Mystery AI" }];
    },
  };
  const { went } = await runBoot(magpie);
  expect(providerEnvelope(went)).toEqual({
    v: 1,
    ok: true,
    value: ["codex", { id: "mystery-ai", name: "Mystery AI" }],
  });
});

test("boot keeps navigating when the bridge has no read", async () => {
  const { went } = await runBoot({ ready: Promise.resolve({ dark: false }) });
  expect(new URL(went).origin).toBe("http://127.0.0.1:3492");
  // The reason travels with the envelope: "ok: false" alone cannot be told
  // apart from a throw or a timeout when reading the logs later.
  expect(providerEnvelope(went)).toEqual({ v: 1, ok: false, kind: "bridge-missing" });
});

test("boot keeps navigating when providers:list throws", async () => {
  const magpie = {
    ready: Promise.resolve({ dark: false }),
    options: { get: async () => ({}) },
    read: async () => { throw new Error("boom"); },
  };
  const { went } = await runBoot(magpie);
  expect(providerEnvelope(went)).toEqual({ v: 1, ok: false, kind: "threw", error: "boom" });
});

test("boot forwards an empty providers:list instead of treating it as a failure", async () => {
  const magpie = {
    ready: Promise.resolve({ dark: false }),
    options: { get: async () => ({}) },
    read: async () => [],
  };
  const { went } = await runBoot(magpie);
  expect(providerEnvelope(went)).toEqual({ v: 1, ok: true, value: [] });
});

test("boot times out a hanging providers:list and still navigates", async () => {
  const magpie = {
    ready: Promise.resolve({ dark: false }),
    options: { get: async () => ({}) },
    read: () => new Promise(() => {}),
  };
  const timers = {
    setTimeout: (fn) => { queueMicrotask(fn); return 1; },
    clearTimeout: () => {},
  };
  const { went } = await runBoot(magpie, { timers });
  expect(providerEnvelope(went)).toEqual({
    v: 1,
    ok: false,
    kind: "timeout",
    error: "providers:list timed out",
  });
});

test("GET and POST /api/market/install validate and dispatch", async () => {
  // GET with no state
  const getInitial = await fetch(`http://127.0.0.1:${port}/api/market/install`, {
    headers: { [tokenHeader]: token },
  });
  expect(getInitial.status).toBe(200);
  const initialBody = await getInitial.json();
  expect(initialBody).toEqual({ install: null });

  // POST without package is 400
  const postEmpty = await fetch(`http://127.0.0.1:${port}/api/market/install`, {
    method: "POST",
    headers: { [tokenHeader]: token, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(postEmpty.status).toBe(400);

  // POST with package not in market is 400
  const postUnknown = await fetch(`http://127.0.0.1:${port}/api/market/install`, {
    method: "POST",
    headers: { [tokenHeader]: token, "content-type": "application/json" },
    body: JSON.stringify({ package: "malicious-pkg" }),
  });
  expect(postUnknown.status).toBe(400);
  const unknownBody = await postUnknown.json();
  expect(unknownBody.error).toBe("not_in_market");
});
