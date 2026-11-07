// Contract-first tests for lib/account-import.mjs (TDD: the module and its
// routes do not exist yet, so this file is expected to be red until they do).
//
// Pinned contract:
//   A) planImport({ entries, ledgers, authKeys, classify }) is a pure function
//      returning { items, counts: { new, existing, skipped } }. `entries` is an
//      array of raw auth entries `{ key, type, accountId?, uid?, email?, ... }`
//      (extra credential-bearing fields may be present and must never leak);
//      `ledgers` is an array of existing account.json metas; `authKeys` is the
//      set of keys currently in plugin-auth.json; `classify(entry)` returns
//      { relogin: "plugin" | "native" | "none", reason? }. Each item has the
//      shape { provider, key, accountId, uid, email, credentialType,
//      state: "new" | "existing" | "skipped", relogin, reason? }. An entry
//      whose key already has a ledger is "existing"; an entry with no identity
//      fields (accountId/uid/email) is "skipped"; the rest are "new".
//   B) importAccounts(env, deps) reads plugin-auth.json from MAGPIE_CONFIG_DIR
//      and the account layout from MAGPIE_CLEAN_LOGIN_DATA, and for each
//      state=new item creates the account directory, draws the initial pin
//      (identity.json) and writes the ledger (account.json). deps may inject
//      generate / writeAccountMeta / classify / fs. It returns the same
//      { items, counts } report as planImport.
//   C) GET /api/accounts/import/plan is read-only and returns the report;
//      POST /api/accounts/import (body { keys? }) returns the import report.
//      When plugin-auth.json cannot be read, both routes answer 409 with a
//      code shaped like auth_missing / auth_unreadable.
//
// Everything runs against mkdtemp directories via MAGPIE_CONFIG_DIR and
// MAGPIE_CLEAN_LOGIN_DATA; the real ~/.config/magpie is never touched. The
// POST happy path is exercised through importAccounts with an injected
// fingerprint generator, because drawing a real pin needs the camoufox model
// that test environments do not install.
import { afterEach, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKEN_HEADER, startServer } from "../lib/server.mjs";
import { accountDir, writeAccountMeta } from "../lib/account-identity.mjs";
import { providerOf } from "../lib/account-keys.mjs";
import { planImport, importAccounts } from "../lib/account-import.mjs";

// The three strings the fixture buries in credential fields. No response and
// no file written by the import may ever contain any of them.
const SECRETS = ["ACCESS-SECRET", "REFRESH-SECRET", "KEY-SECRET"];

const AUTH_FIXTURE = {
  quill: {
    type: "oauth",
    accountId: "acct-q",
    uid: "u-q",
    email: "q@example.com",
    access: "ACCESS-SECRET",
    refresh: "REFRESH-SECRET",
    metadata: { token: "KEY-SECRET" },
  },
  "quill#zz9": {
    type: "oauth",
    accountId: "acct-q2",
    uid: "u-q2",
    email: "q2@example.com",
    access: "ACCESS-SECRET",
    refresh: "REFRESH-SECRET",
    metadata: { token: "KEY-SECRET" },
  },
  "demo-ai": {
    type: "apikey",
    accountId: "acct-d",
    uid: "u-d",
    email: "d@example.com",
    access: "ACCESS-SECRET",
    refresh: "REFRESH-SECRET",
    metadata: { token: "KEY-SECRET" },
  },
  workbuddy: {
    type: "oauth",
    accountId: "acct-w",
    uid: "u-w",
    email: "w@example.com",
    access: "ACCESS-SECRET",
    refresh: "REFRESH-SECRET",
    metadata: { token: "KEY-SECRET" },
  },
  // No accountId, uid or email: nothing to identify, so it must be skipped.
  ghost: { type: "oauth", access: "ACCESS-SECRET", refresh: "REFRESH-SECRET" },
};

const NEW_KEYS = ["quill", "quill#zz9", "demo-ai"];
const WORKBUDDY_LEDGER = {
  version: 1,
  provider: "workbuddy",
  key: "workbuddy",
  accountId: "acct-w",
  uid: "u-w",
  signedInAt: "2026-11-03T10:00:00.000Z",
};

const entries = Object.entries(AUTH_FIXTURE).map(([key, value]) => ({ ...value, key }));
const authKeys = new Set(Object.keys(AUTH_FIXTURE));
const pluginClassify = () => ({ relogin: "plugin" });

const tempDirs = [];
const services = [];

// A fully real environment: an on-disk magpie config directory holding the
// fixture plugin-auth.json and an on-disk data directory holding the account
// layout. `ledger: true` pre-writes the workbuddy ledger so that entry counts
// as existing; `auth: null` leaves plugin-auth.json absent.
async function realEnv({ auth = AUTH_FIXTURE, ledger = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "clean-login-account-import-"));
  tempDirs.push(root);
  const configDir = join(root, "magpie-config");
  const dataDir = join(root, "data");
  await mkdir(configDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  if (auth) await writeFile(join(configDir, "plugin-auth.json"), JSON.stringify(auth));
  const env = { MAGPIE_CONFIG_DIR: configDir, MAGPIE_CLEAN_LOGIN_DATA: dataDir };
  if (ledger) await writeAccountMeta(accountDir(env, "workbuddy", "workbuddy"), WORKBUDDY_LEDGER);
  return { root, configDir, dataDir, env };
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const scannerStub = {
  get: () => ({ available: false, providers: [], scanned: false, stale: false, scanning: false, error: null }),
  warm: () => {},
};

async function startService(env) {
  const service = await startServer({
    port: 0,
    env: { ...process.env, ...env },
    pluginScanner: scannerStub,
  });
  services.push(service);
  const html = await (await fetch(`http://127.0.0.1:${service.port}/`)).text();
  const token = /name="clean-login-token" content="([0-9a-f]+)"/.exec(html)?.[1];
  expect(token).toBeTruthy();
  const api = (method, path, body) =>
    fetch(`http://127.0.0.1:${service.port}${path}`, {
      method,
      headers: {
        [TOKEN_HEADER]: token,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return { service, api };
}

function assertNoSecrets(text) {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

// Every file under a directory as sorted [relative path, content] pairs; an
// absent directory is an empty list. Used both to prove the plan read wrote
// nothing and to scan everything the import did write.
function snapshotTree(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...snapshotTree(path, base));
    else found.push([path.slice(base.length + 1), readFileSync(path, "utf8")]);
  }
  return found.sort((a, b) => a[0].localeCompare(b[0]));
}

function stubDeps() {
  const calls = { generate: 0, meta: [] };
  const identity = { seed: 42, screen: { width: 1280, height: 800 } };
  return {
    calls,
    identity,
    deps: {
      generate: async () => {
        calls.generate += 1;
        return identity;
      },
      classify: pluginClassify,
      writeAccountMeta: async (dir, meta) => {
        calls.meta.push({ dir, meta });
        return writeAccountMeta(dir, meta);
      },
    },
  };
}

// --- 1. planImport classification -----------------------------------------

test("planImport marks magpie-only entries new, a ledgered entry existing and an identity-less entry skipped", () => {
  const plan = planImport({ entries, ledgers: [WORKBUDDY_LEDGER], authKeys, classify: pluginClassify });
  expect(plan.counts).toEqual({ new: 3, existing: 1, skipped: 1 });
  expect(plan.items).toHaveLength(5);
  const byKey = Object.fromEntries(plan.items.map((item) => [item.key, item]));
  for (const key of NEW_KEYS) {
    const fixture = AUTH_FIXTURE[key];
    expect(byKey[key]).toEqual({
      provider: providerOf(key),
      key,
      accountId: fixture.accountId,
      uid: fixture.uid,
      email: fixture.email,
      credentialType: fixture.type,
      state: "new",
      relogin: "plugin",
    });
  }
  expect(byKey.workbuddy.state).toBe("existing");
  expect(byKey.workbuddy.provider).toBe("workbuddy");
  expect(byKey.ghost.state).toBe("skipped");
});

// --- 2. the security red line: no credential ever leaves the module -------

test("planImport output never contains the fixture's credential values", () => {
  const plan = planImport({ entries, ledgers: [WORKBUDDY_LEDGER], authKeys, classify: pluginClassify });
  assertNoSecrets(JSON.stringify(plan));
});

// --- 6. classify says there is no relogin path: the item must say why -----

test("a classify result of relogin=none puts a reason on the item", () => {
  const plan = planImport({ entries, ledgers: [WORKBUDDY_LEDGER], authKeys, classify: () => ({ relogin: "none" }) });
  const none = plan.items.filter((item) => item.relogin === "none");
  expect(none.length).toBeGreaterThan(0);
  for (const item of none) {
    expect(typeof item.reason).toBe("string");
    expect(item.reason.length).toBeGreaterThan(0);
  }
});

// --- 3. the plan route is read-only ------------------------------------

test("GET /api/accounts/import/plan returns the plan without writing anything", async () => {
  const { root, dataDir, env } = await realEnv();
  const { api } = await startService(env);
  const accountsRoot = join(dataDir, "accounts");
  const before = snapshotTree(accountsRoot);
  const res = await api("GET", "/api/accounts/import/plan");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.counts).toEqual({ new: 3, existing: 1, skipped: 1 });
  expect(body.items).toHaveLength(5);
  // The plan read must not have created, removed or changed a single file.
  expect(snapshotTree(accountsRoot)).toEqual(before);
  // And neither a credential nor a filesystem path may appear in the reply.
  const text = JSON.stringify(body);
  assertNoSecrets(text);
  expect(text).not.toContain(root);
});

// --- 4. import writes the pin and the ledger for every new account --------

test("importAccounts creates identity.json and account.json for each new account", async () => {
  const { env } = await realEnv();
  const { calls, identity, deps } = stubDeps();
  const report = await importAccounts(env, deps);
  expect(report.counts).toEqual({ new: 3, existing: 1, skipped: 1 });
  expect(calls.generate).toBe(3);
  expect(calls.meta).toHaveLength(3);
  for (const key of NEW_KEYS) {
    const dir = accountDir(env, providerOf(key), key);
    expect(existsSync(join(dir, "identity.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "identity.json"), "utf8"))).toEqual(identity);
    const meta = JSON.parse(readFileSync(join(dir, "account.json"), "utf8"));
    expect(meta.version).toBe(1);
    expect(meta.provider).toBe(providerOf(key));
    expect(meta.key).toBe(key);
    expect(meta.accountId).toBe(AUTH_FIXTURE[key].accountId);
    expect(calls.meta.some((call) => call.dir === dir)).toBe(true);
  }
  // The existing account keeps its ledger untouched and gains no new pin;
  // the skipped entry gets no directory at all.
  const workbuddyDir = accountDir(env, "workbuddy", "workbuddy");
  expect(JSON.parse(readFileSync(join(workbuddyDir, "account.json"), "utf8"))).toEqual(WORKBUDDY_LEDGER);
  expect(existsSync(join(workbuddyDir, "identity.json"))).toBe(false);
  expect(existsSync(accountDir(env, "ghost", "ghost"))).toBe(false);
});

// --- 5. a second import is a no-op ----------------------------------------

test("importing twice creates nothing new and never rewrites an existing pin", async () => {
  const { env } = await realEnv();
  const { calls, deps } = stubDeps();
  await importAccounts(env, deps);
  const pins = NEW_KEYS.map((key) => {
    const file = join(accountDir(env, providerOf(key), key), "identity.json");
    return { file, content: readFileSync(file, "utf8"), mtimeMs: statSync(file).mtimeMs };
  });
  const second = await importAccounts(env, deps);
  expect(second.counts.new).toBe(0);
  expect(second.counts.existing).toBe(4);
  expect(calls.generate).toBe(3);
  for (const pin of pins) {
    expect(readFileSync(pin.file, "utf8")).toBe(pin.content);
    expect(statSync(pin.file).mtimeMs).toBe(pin.mtimeMs);
  }
});

// --- 2 (disk side). Nothing the import writes may carry a credential ------

test("the import report and every file it writes are free of the fixture secrets", async () => {
  const { dataDir, env } = await realEnv();
  const { deps } = stubDeps();
  const report = await importAccounts(env, deps);
  assertNoSecrets(JSON.stringify(report));
  const written = snapshotTree(join(dataDir, "accounts"));
  expect(written.length).toBeGreaterThan(0);
  for (const [path, content] of written) {
    assertNoSecrets(content);
    expect(content).not.toContain("access");
    expect(content).not.toContain("refresh");
    void path;
  }
});

// --- 7. an unreadable plugin-auth.json is a 409, not a guess --------------

test("both import routes answer 409 when plugin-auth.json is missing or unreadable", async () => {
  const { configDir, env } = await realEnv({ auth: null, ledger: false });
  const { api } = await startService(env);
  const codeOf = (body) => body.code ?? body.error;

  // Missing file: the route must refuse rather than plan against an empty set.
  const preview = await api("GET", "/api/accounts/import/plan");
  expect(preview.status).toBe(409);
  expect(codeOf(await preview.json())).toMatch(/^auth_(missing|unreadable)$/);
  const post = await api("POST", "/api/accounts/import", {});
  expect(post.status).toBe(409);
  expect(codeOf(await post.json())).toMatch(/^auth_(missing|unreadable)$/);

  // Malformed file: still a refusal, never a silent empty plan.
  await writeFile(join(configDir, "plugin-auth.json"), "{ not json");
  const broken = await api("GET", "/api/accounts/import/plan");
  expect(broken.status).toBe(409);
  expect(codeOf(await broken.json())).toMatch(/^auth_(missing|unreadable|invalid)$/);
  const brokenPost = await api("POST", "/api/accounts/import", { keys: ["quill"] });
  expect(brokenPost.status).toBe(409);
  expect(codeOf(await brokenPost.json())).toMatch(/^auth_(missing|unreadable|invalid)$/);
});