// Unit tests for synchronizing magpie's `accountProxies` with clean-login exits.
// Driven through isolated temp roots; never touches ~/.config/magpie.

import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accountProxyKey,
  backfillAccountProxies,
  clearAccountProxy,
  createAccountProxySync,
  exitDisplayUrl,
  parseProxyUrl,
  providersFile,
  proxyUrlFor,
  readAccountExit,
  syncProxyUpdate,
  syncSignInProxy,
  writeAccountExit,
  writeAccountProxies,
} from "../lib/account-proxies.mjs";
import {
  accountExitProjection,
  buildProxyUrlMap,
  publicAccountExit,
  resolveAccountProxyName,
  resolveEffectiveAccountExit,
} from "../lib/account-exit.mjs";
import { toPlaywrightProxy } from "../lib/browser-launcher.mjs";
import { signInProxyUrl } from "../lib/signin-egress.mjs";
import { writeAccountMeta } from "../lib/account-identity.mjs";
import { createProxyStore } from "../lib/proxies.mjs";

const tempDirs = [];

async function tempDir(prefix = "clean-login-proxies-test-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function seedProvidersJson(dir, providers = []) {
  const file = join(dir, "providers.json");
  const payload = {
    providers: [
      {
        id: "minimax-code",
        name: "",
        key: "",
        proxy: "http://127.0.0.1:17801",
        models: ["MiniMax-M3"],
      },
      {
        id: "workbuddy",
        name: "",
        proxy: "",
        accountProxies: {
          "user-hand": "http://127.0.0.1:9999",
        },
      },
      ...providers,
    ],
    groups: [],
  };
  return writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readProviders(dir) {
  return JSON.parse(readFileSync(join(dir, "providers.json"), "utf8"));
}

test("accountProxyKey computes lower-cased user name, handles trimming and blanks", () => {
  expect(accountProxyKey("UserOne")).toBe("userone");
  expect(accountProxyKey("  User_Two  ")).toBe("user_two");
  expect(accountProxyKey("already_lower")).toBe("already_lower");
  expect(accountProxyKey("")).toBe("");
  expect(accountProxyKey(null)).toBe("");
  expect(accountProxyKey(undefined)).toBe("");
});

test("proxyUrlFor formats http, https, socks5 with credentials and handles IPv6", () => {
  expect(proxyUrlFor({ host: "127.0.0.1", port: 17803, type: "http" })).toBe(
    "http://127.0.0.1:17803",
  );
  expect(
    proxyUrlFor({
      host: "exit.proxy.test",
      port: 8443,
      type: "https",
      username: "user name",
      password: "p@ss:word",
    }),
  ).toBe("https://user%20name:p%40ss%3Aword@exit.proxy.test:8443");
  expect(proxyUrlFor({ host: "127.0.0.1", port: 1080, type: "socks5" })).toBe(
    "socks5://127.0.0.1:1080",
  );
  expect(proxyUrlFor({ host: "::1", port: 17802 })).toBe("http://[::1]:17802");
  expect(proxyUrlFor({ host: "[::1]", port: 17802 })).toBe("http://[::1]:17802");
  expect(proxyUrlFor({ url: "socks5://10.0.0.1:1080" })).toBe("socks5://10.0.0.1:1080");

  // Invalid inputs return null
  expect(proxyUrlFor(null)).toBeNull();
  expect(proxyUrlFor({})).toBeNull();
  expect(proxyUrlFor({ host: "127.0.0.1", port: 0 })).toBeNull();
  expect(proxyUrlFor({ host: "127.0.0.1", port: 70000 })).toBeNull();
  expect(proxyUrlFor({ host: "", port: 17801 })).toBeNull();
  expect(proxyUrlFor({ host: "127.0.0.1", port: 17801, type: "ftp" })).toBeNull();
});

test("writeAccountProxies reports missing or invalid providers.json without throwing", async () => {
  const cfg = await tempDir();
  const env = { MAGPIE_CONFIG_DIR: cfg };

  const missing = await writeAccountProxies({
    env,
    entries: [{ provider: "minimax-code", accountId: "u1", url: "http://127.0.0.1:17801" }],
  });
  expect(missing.ok).toBeFalse();
  expect(missing.reason).toBe("providers_missing");

  await writeFile(join(cfg, "providers.json"), "NOT JSON");
  const invalid = await writeAccountProxies({
    env,
    entries: [{ provider: "minimax-code", accountId: "u1", url: "http://127.0.0.1:17801" }],
  });
  expect(invalid.ok).toBeFalse();
  expect(invalid.reason).toBe("providers_invalid");
});

test("syncSignInProxy writes account's own entry, preserving other accounts", async () => {
  const cfg = await tempDir();
  await seedProvidersJson(cfg);
  const env = { MAGPIE_CONFIG_DIR: cfg };

  const res1 = await syncSignInProxy({
    env,
    provider: "minimax-code",
    accountId: "AlphaUser",
    proxy: { host: "127.0.0.1", port: 17803, type: "http" },
  });
  expect(res1.ok).toBeTrue();
  expect(res1.changed.length).toBe(1);

  const res2 = await syncSignInProxy({
    env,
    provider: "minimax-code",
    accountId: "BetaUser",
    proxy: { host: "127.0.0.1", port: 17802, type: "http" },
  });
  expect(res2.ok).toBeTrue();

  const doc = readProviders(cfg);
  const mm = doc.providers.find((p) => p.id === "minimax-code");
  expect(mm.accountProxies).toEqual({
    alphauser: "http://127.0.0.1:17803",
    betauser: "http://127.0.0.1:17802",
  });
  // Provider-wide proxy is untouched
  expect(mm.proxy).toBe("http://127.0.0.1:17801");
  // Other provider's accounts are untouched
  const wb = doc.providers.find((p) => p.id === "workbuddy");
  expect(wb.accountProxies["user-hand"]).toBe("http://127.0.0.1:9999");
});

test("syncSignInProxy with direct login (no proxy) leaves providers.json untouched", async () => {
  const cfg = await tempDir();
  await seedProvidersJson(cfg);
  const env = { MAGPIE_CONFIG_DIR: cfg };

  const res = await syncSignInProxy({
    env,
    provider: "minimax-code",
    accountId: "DirectUser",
    proxy: null,
  });
  expect(res.ok).toBeTrue();
  expect(res.reason).toBe("no_proxy");

  const doc = readProviders(cfg);
  const mm = doc.providers.find((p) => p.id === "minimax-code");
  expect(mm.accountProxies).toBeUndefined();
});

test("backfillAccountProxies populates absent keys and never overwrites hand-set entries", async () => {
  const root = await tempDir();
  const cfg = join(root, "config");
  const data = join(root, "data");
  await mkdir(cfg, { recursive: true });
  await mkdir(data, { recursive: true });
  await seedProvidersJson(cfg);

  // Pre-seed an existing account proxy in minimax-code to prove backfill
  // leaves it alone (the user hand-configured it in magpie).
  const initial = readProviders(cfg);
  initial.providers.find((p) => p.id === "minimax-code").accountProxies = {
    alreadythere: "http://127.0.0.1:1111",
  };
  await writeFile(join(cfg, "providers.json"), JSON.stringify(initial, null, 2));

  const env = {
    MAGPIE_CONFIG_DIR: cfg,
    MAGPIE_CLEAN_LOGIN_DATA: data,
  };

  // Create proxy store with two exits
  const store = createProxyStore({ dataDir: data });
  const p1 = await store.create({
    name: "R2-5",
    type: "http",
    host: "127.0.0.1",
    port: 17803,
    username: "",
    password: "",
  });
  const p2 = await store.create({
    name: "D1-3",
    type: "http",
    host: "127.0.0.1",
    port: 17802,
    username: "",
    password: "",
  });

  // Seed two account ledgers with lastLogin pointing at the proxies
  const dir1 = join(data, "accounts", "minimax-code", "slot1");
  await mkdir(dir1, { recursive: true });
  await writeAccountMeta(dir1, {
    version: 1,
    provider: "minimax-code",
    key: "slot1",
    accountId: "AlphaUser",
    lastLogin: { proxyId: p1.id, proxyName: "R2-5", type: "http" },
  });

  const dir2 = join(data, "accounts", "minimax-code", "slot2");
  await mkdir(dir2, { recursive: true });
  await writeAccountMeta(dir2, {
    version: 1,
    provider: "minimax-code",
    key: "slot2",
    accountId: "BetaUser",
    lastLogin: { proxyId: p2.id, proxyName: "D1-3", type: "http" },
  });

  // An account trying to backfill onto the already-set key: must be skipped
  const dir3 = join(data, "accounts", "minimax-code", "slot3");
  await mkdir(dir3, { recursive: true });
  await writeAccountMeta(dir3, {
    version: 1,
    provider: "minimax-code",
    key: "slot3",
    accountId: "AlreadyThere",
    lastLogin: { proxyId: p1.id, proxyName: "R2-5", type: "http" },
  });

  const report = await backfillAccountProxies({ env, store });
  expect(report.ok).toBeTrue();
  expect(report.changed.length).toBe(2);
  expect(report.skipped.some((s) => s.reason === "already_set")).toBeTrue();

  const doc = readProviders(cfg);
  const mm = doc.providers.find((p) => p.id === "minimax-code");
  expect(mm.accountProxies).toEqual({
    alreadythere: "http://127.0.0.1:1111",
    alphauser: "http://127.0.0.1:17803",
    betauser: "http://127.0.0.1:17802",
  });

  // Second run: everything is already up to date, 0 writes
  const report2 = await backfillAccountProxies({ env, store });
  expect(report2.ok).toBeTrue();
  expect(report2.changed.length).toBe(0);
  expect(report2.reason).toBe("up_to_date");
});

test("writeAccountProxies ignores prototype keys and reserved names", async () => {
  const cfg = await tempDir();
  await seedProvidersJson(cfg);
  const env = { MAGPIE_CONFIG_DIR: cfg };

  const res = await writeAccountProxies({
    env,
    entries: [
      { provider: "minimax-code", accountId: "__proto__", url: "http://127.0.0.1:6666" },
      { provider: "minimax-code", accountId: "constructor", url: "http://127.0.0.1:6666" },
    ],
  });
  expect(res.ok).toBeTrue();
  expect(res.reason).toBe("nothing_to_sync");

  const doc = readProviders(cfg);
  const mm = doc.providers.find((p) => p.id === "minimax-code");
  expect(mm.accountProxies).toBeUndefined();
});

test("createAccountProxySync lazily resolves proxy store when given only an id", async () => {
  const root = await tempDir();
  const cfg = join(root, "config");
  const data = join(root, "data");
  await mkdir(cfg, { recursive: true });
  await mkdir(data, { recursive: true });
  await seedProvidersJson(cfg);

  const store = createProxyStore({ dataDir: data });
  const created = await store.create({
    name: "Exit",
    type: "http",
    host: "127.0.0.1",
    port: 17805,
    username: "",
    password: "",
  });

  const env = {
    MAGPIE_CONFIG_DIR: cfg,
    MAGPIE_CLEAN_LOGIN_DATA: data,
  };

  const sync = createAccountProxySync({ env, store, dataDir: data });
  // Pass an object with only { id } to verify store lookup happens
  const res = await sync.syncSignIn({
    provider: "minimax-code",
    accountId: "LazyUser",
    proxy: { id: created.id },
  });
  expect(res.ok).toBeTrue();

  const doc = readProviders(cfg);
  const mm = doc.providers.find((p) => p.id === "minimax-code");
  expect(mm.accountProxies.lazyuser).toBe("http://127.0.0.1:17805");
});

// ---- readAccountExit / writeAccountExit ----

test("readAccountExit reports inherit, direct and custom plus the provider proxy", async () => {
  const cfg = await tempDir();
  await seedProvidersJson(cfg, [
    {
      id: "read-me",
      proxy: "http://127.0.0.1:17801",
      accountProxies: {
        directuser: "direct",
        customuser: "socks5://127.0.0.1:1080",
      },
    },
    { id: "read-null", accountProxies: {} },
  ]);
  const env = { MAGPIE_CONFIG_DIR: cfg };

  const inherit = await readAccountExit({ env, provider: "read-me", accountId: "NoEntry" });
  expect(inherit).toEqual({
    ok: true,
    mode: "inherit",
    url: null,
    key: "noentry",
    providerProxy: "http://127.0.0.1:17801",
  });

  const direct = await readAccountExit({ env, provider: "read-me", accountId: "DirectUser" });
  expect(direct.ok).toBeTrue();
  expect(direct.mode).toBe("direct");
  expect(direct.url).toBe("direct");
  expect(direct.key).toBe("directuser");
  expect(direct.providerProxy).toBe("http://127.0.0.1:17801");

  const custom = await readAccountExit({ env, provider: "read-me", accountId: "CustomUser" });
  expect(custom.ok).toBeTrue();
  expect(custom.mode).toBe("custom");
  expect(custom.url).toBe("socks5://127.0.0.1:1080");
  expect(custom.providerProxy).toBe("http://127.0.0.1:17801");

  // A provider without a provider-level proxy reports null, not undefined.
  const nullProxy = await readAccountExit({ env, provider: "read-null", accountId: "NoEntry" });
  expect(nullProxy.ok).toBeTrue();
  expect(nullProxy.providerProxy).toBeNull();
});

test("writeAccountExit custom writes only the target account's entry", async () => {
  const cfg = await tempDir();
  await seedProvidersJson(cfg);
  const env = { MAGPIE_CONFIG_DIR: cfg };

  const res = await writeAccountExit({
    env,
    provider: "minimax-code",
    accountId: "AlphaUser",
    mode: "custom",
    url: "http://127.0.0.1:17803",
  });
  expect(res.ok).toBeTrue();
  expect(res.reason).toBe("written");
  expect(res.changed).toBeTrue();
  expect(res.mode).toBe("custom");
  expect(res.before).toBeNull();
  expect(res.after).toBe("http://127.0.0.1:17803");
  expect(res.key).toBe("alphauser");

  const doc = readProviders(cfg);
  const mm = doc.providers.find((p) => p.id === "minimax-code");
  expect(mm.accountProxies).toEqual({ alphauser: "http://127.0.0.1:17803" });
  // Provider-wide proxy and other providers stay exactly as they were.
  expect(mm.proxy).toBe("http://127.0.0.1:17801");
  const wb = doc.providers.find((p) => p.id === "workbuddy");
  expect(wb.accountProxies).toEqual({ "user-hand": "http://127.0.0.1:9999" });
});

test("writeAccountExit direct stores the literal direct marker", async () => {
  const cfg = await tempDir();
  await seedProvidersJson(cfg);
  const env = { MAGPIE_CONFIG_DIR: cfg };

  const res = await writeAccountExit({
    env,
    provider: "minimax-code",
    accountId: "AlphaUser",
    mode: "direct",
  });
  expect(res.ok).toBeTrue();
  expect(res.reason).toBe("written");
  expect(res.after).toBe("direct");

  const read = await readAccountExit({ env, provider: "minimax-code", accountId: "AlphaUser" });
  expect(read.mode).toBe("direct");
  expect(read.url).toBe("direct");
});

test("writeAccountExit inherit removes only that key and keeps the empty map", async () => {
  const cfg = await tempDir();
  await seedProvidersJson(cfg, [
    {
      id: "multi",
      accountProxies: { usera: "http://127.0.0.1:1", userb: "direct" },
    },
  ]);
  const env = { MAGPIE_CONFIG_DIR: cfg };

  const res = await writeAccountExit({
    env,
    provider: "multi",
    accountId: "UserB",
    mode: "inherit",
  });
  expect(res.ok).toBeTrue();
  expect(res.reason).toBe("written");
  expect(res.before).toBe("direct");
  expect(res.after).toBeNull();

  const doc = readProviders(cfg);
  expect(doc.providers.find((p) => p.id === "multi").accountProxies).toEqual({
    usera: "http://127.0.0.1:1",
  });

  // Deleting the last key must keep the (now empty) map, not drop the property.
  const res2 = await writeAccountExit({
    env,
    provider: "multi",
    accountId: "UserA",
    mode: "inherit",
  });
  expect(res2.ok).toBeTrue();
  const entry = readProviders(cfg).providers.find((p) => p.id === "multi");
  expect(entry.accountProxies).toEqual({});
  expect(Object.hasOwn(entry, "accountProxies")).toBeTrue();
});

test("writeAccountExit reports unchanged without rewriting the file", async () => {
  const cfg = await tempDir();
  await seedProvidersJson(cfg, [{ id: "idem", accountProxies: { usera: "http://127.0.0.1:1" } }]);
  const env = { MAGPIE_CONFIG_DIR: cfg };
  const file = join(cfg, "providers.json");
  const beforeText = readFileSync(file, "utf8");
  const beforeStat = await stat(file);

  const res = await writeAccountExit({
    env,
    provider: "idem",
    accountId: "UserA",
    mode: "custom",
    url: "http://127.0.0.1:1",
  });
  expect(res.ok).toBeTrue();
  expect(res.changed).toBeFalse();
  expect(res.reason).toBe("unchanged");
  expect(res.before).toBe("http://127.0.0.1:1");
  expect(res.after).toBe(res.before);

  // An absent key inheriting is also a no-op.
  const inherit = await writeAccountExit({
    env,
    provider: "idem",
    accountId: "Ghost",
    mode: "inherit",
  });
  expect(inherit.changed).toBeFalse();
  expect(inherit.reason).toBe("unchanged");

  expect(readFileSync(file, "utf8")).toBe(beforeText);
  expect((await stat(file)).mtimeMs).toBe(beforeStat.mtimeMs);
});

test("writeAccountExit refuses unknown account names without touching the file", async () => {
  const cfg = await tempDir();
  const env = { MAGPIE_CONFIG_DIR: cfg };
  const file = join(cfg, "providers.json");
  const names = ["", "   ", "__proto__", "constructor", "prototype"];

  // Nothing seeded: validation must short-circuit before any file is created.
  for (const accountId of names) {
    const res = await writeAccountExit({
      env,
      provider: "minimax-code",
      accountId,
      mode: "custom",
      url: "http://127.0.0.1:1",
    });
    expect(res.ok).toBeFalse();
    expect(res.reason).toBe("account_name_unknown");
    expect(res.key).toBe(accountProxyKey(accountId));
  }
  expect(() => readFileSync(file, "utf8")).toThrow();

  // Same refusal on an existing file leaves it byte-for-byte unchanged.
  await seedProvidersJson(cfg);
  const beforeText = readFileSync(file, "utf8");
  const constructorWrite = await writeAccountExit({
    env,
    provider: "minimax-code",
    accountId: "constructor",
    mode: "direct",
  });
  expect(constructorWrite.reason).toBe("account_name_unknown");
  expect(readFileSync(file, "utf8")).toBe(beforeText);
});

test("writeAccountExit rejects invalid mode and custom url", async () => {
  const cfg = await tempDir();
  await seedProvidersJson(cfg);
  const env = { MAGPIE_CONFIG_DIR: cfg };
  const file = join(cfg, "providers.json");
  const beforeText = readFileSync(file, "utf8");

  const badMode = await writeAccountExit({
    env,
    provider: "minimax-code",
    accountId: "u1",
    mode: "bogus",
    url: "http://127.0.0.1:1",
  });
  expect(badMode.ok).toBeFalse();
  expect(badMode.reason).toBe("invalid_mode");

  for (const url of ["", "   ", "not-a-url", null, undefined]) {
    const res = await writeAccountExit({
      env,
      provider: "minimax-code",
      accountId: "u1",
      mode: "custom",
      url,
    });
    expect(res.ok).toBeFalse();
    expect(res.reason).toBe("invalid_url");
  }
  expect(readFileSync(file, "utf8")).toBe(beforeText);
});

test("readAccountExit and writeAccountExit report missing, invalid and unknown providers", async () => {
  const cfg = await tempDir();
  const env = { MAGPIE_CONFIG_DIR: cfg };
  const file = join(cfg, "providers.json");

  const missingRead = await readAccountExit({ env, provider: "minimax-code", accountId: "u1" });
  expect(missingRead.ok).toBeFalse();
  expect(missingRead.reason).toBe("providers_missing");
  const missingWrite = await writeAccountExit({
    env,
    provider: "minimax-code",
    accountId: "u1",
    mode: "direct",
  });
  expect(missingWrite.ok).toBeFalse();
  expect(missingWrite.reason).toBe("providers_missing");

  // A malformed file is never repaired: both calls must leave its bytes alone.
  const raw = "NOT JSON {{ }}";
  await writeFile(file, raw, "utf8");
  const invalidRead = await readAccountExit({ env, provider: "minimax-code", accountId: "u1" });
  expect(invalidRead.reason).toBe("providers_invalid");
  const invalidWrite = await writeAccountExit({
    env,
    provider: "minimax-code",
    accountId: "u1",
    mode: "direct",
  });
  expect(invalidWrite.reason).toBe("providers_invalid");
  expect(readFileSync(file, "utf8")).toBe(raw);

  // `providers` that is not an array is invalid too.
  await writeFile(file, JSON.stringify({ providers: {} }), "utf8");
  const notArray = await writeAccountExit({
    env,
    provider: "minimax-code",
    accountId: "u1",
    mode: "direct",
  });
  expect(notArray.reason).toBe("providers_invalid");

  await seedProvidersJson(cfg);
  const unknownRead = await readAccountExit({ env, provider: "nope", accountId: "u1" });
  expect(unknownRead.ok).toBeFalse();
  expect(unknownRead.reason).toBe("provider_missing");
  const unknownWrite = await writeAccountExit({
    env,
    provider: "nope",
    accountId: "u1",
    mode: "direct",
  });
  expect(unknownWrite.ok).toBeFalse();
  expect(unknownWrite.reason).toBe("provider_missing");
});

test("writeAccountExit round-trips: a written value reads back through readAccountExit", async () => {
  const cfg = await tempDir();
  await seedProvidersJson(cfg, [{ id: "round", proxy: "http://127.0.0.1:9" }]);
  const env = { MAGPIE_CONFIG_DIR: cfg };

  const written = await writeAccountExit({
    env,
    provider: "round",
    accountId: "RoundUser",
    mode: "custom",
    url: "https://user:pass@exit.test:8443",
  });
  expect(written.ok).toBeTrue();
  expect(written.reason).toBe("written");
  expect(written.changed).toBeTrue();

  const read = await readAccountExit({ env, provider: "round", accountId: "RoundUser" });
  expect(read).toEqual({
    ok: true,
    mode: "custom",
    url: "https://user:pass@exit.test:8443",
    key: "rounduser",
    providerProxy: "http://127.0.0.1:9",
  });
});

test("backfillAccountProxies prefers meta.exit and never collides concatenated provider/account keys", async () => {
  const root = await tempDir();
  const cfg = join(root, "config");
  const data = join(root, "data");
  await mkdir(cfg, { recursive: true });
  await mkdir(data, { recursive: true });
  await seedProvidersJson(cfg, [{ id: "ab" }, { id: "a" }]);
  const store = createProxyStore({ dataDir: data });
  const pOld = await store.create({ name: "Old", type: "http", host: "127.0.0.1", port: 18001 });
  const pExit = await store.create({ name: "Exit", type: "http", host: "127.0.0.1", port: 18002 });
  const pOther = await store.create({ name: "Other", type: "http", host: "127.0.0.1", port: 18003 });
  const env = { MAGPIE_CONFIG_DIR: cfg, MAGPIE_CLEAN_LOGIN_DATA: data };

  const report = await backfillAccountProxies({
    env,
    store,
    listAccounts: async () => [
      {
        provider: "ab",
        key: "ab",
        meta: {
          provider: "ab",
          accountId: "c",
          lastLogin: { proxyId: pOld.id },
          exit: { proxyId: pExit.id },
        },
      },
      {
        provider: "a",
        key: "a",
        meta: {
          provider: "a",
          accountId: "bc",
          lastLogin: { proxyId: pOther.id },
        },
      },
    ],
  });
  expect(report.ok).toBe(true);
  expect(report.changed).toHaveLength(2);
  expect((await readAccountExit({ env, provider: "ab", accountId: "c" })).url).toBe(
    "http://127.0.0.1:18002",
  );
  expect((await readAccountExit({ env, provider: "a", accountId: "bc" })).url).toBe(
    "http://127.0.0.1:18003",
  );
});

test("syncSignInProxy sets direct when an account previously had an exit, while syncProxyUpdate & clearAccountProxy stay in sync", async () => {
  const root = await tempDir();
  const cfg = join(root, "config");
  const data = join(root, "data");
  await mkdir(cfg, { recursive: true });
  await mkdir(data, { recursive: true });
  await seedProvidersJson(cfg, [{ id: "minimax-code" }]);
  const store = createProxyStore({ dataDir: data });
  const px = await store.create({ name: "Node", type: "http", host: "127.0.0.1", port: 18100 });
  const env = { MAGPIE_CONFIG_DIR: cfg, MAGPIE_CLEAN_LOGIN_DATA: data };

  await syncSignInProxy({ env, provider: "minimax-code", accountId: "UserA", proxy: px });
  expect((await readAccountExit({ env, provider: "minimax-code", accountId: "UserA" })).mode).toBe(
    "custom",
  );

  // Updating the proxy pushes new host/port into providers.json via syncProxyUpdate.
  await store.update(px.id, { port: 18101 });
  const updatedSync = await syncProxyUpdate({
    env,
    store,
    proxyId: px.id,
    listAccounts: async () => [
      { provider: "minimax-code", key: "k1", meta: { provider: "minimax-code", accountId: "UserA", exit: { proxyId: px.id } } },
    ],
  });
  expect(updatedSync.ok).toBe(true);
  expect((await readAccountExit({ env, provider: "minimax-code", accountId: "UserA" })).url).toBe(
    "http://127.0.0.1:18101",
  );

  // Re-signing in as direct switches the previously proxied account to literal "direct".
  const clearedToDirect = await syncSignInProxy({
    env,
    provider: "minimax-code",
    accountId: "UserA",
    proxy: null,
  });
  expect(clearedToDirect.reason).toBe("cleared_to_direct");
  expect((await readAccountExit({ env, provider: "minimax-code", accountId: "UserA" })).mode).toBe(
    "direct",
  );

  // Deleting the account clears its entry from magpie's map.
  const removed = await clearAccountProxy({ env, provider: "minimax-code", accountId: "UserA" });
  expect(removed.ok).toBe(true);
  expect(removed.changed).toBe(true);
  expect((await readAccountExit({ env, provider: "minimax-code", accountId: "UserA" })).mode).toBe(
    "inherit",
  );
});

test("parseProxyUrl handles http/https/socks5/socks4, encoded credentials, IPv6, defaults and rejects invalid input", () => {
  const httpsProxy = parseProxyUrl("https://u%20ser:p%40ss%3Aword@exit.proxy.test:8443");
  expect(httpsProxy).toEqual({
    type: "https",
    host: "exit.proxy.test",
    port: 8443,
    username: "u ser",
    password: "p@ss:word",
    server: "https://exit.proxy.test:8443",
  });
  // `server` must never include credentials; Playwright receives username/password separately.
  expect(httpsProxy.server).not.toContain("u ser");
  expect(httpsProxy.server).not.toContain("p@ss");
  expect(toPlaywrightProxy(httpsProxy)).toEqual({
    server: "https://exit.proxy.test:8443",
    username: "u ser",
    password: "p@ss:word",
  });
  expect(signInProxyUrl(httpsProxy)).toBe("https://u%20ser:p%40ss%3Aword@exit.proxy.test:8443");

  const ipv6Socks5 = parseProxyUrl("socks5://[::1]:1080");
  expect(ipv6Socks5).toEqual({
    type: "socks5",
    host: "::1",
    port: 1080,
    username: "",
    password: "",
    server: "socks5://[::1]:1080",
  });
  expect(toPlaywrightProxy(ipv6Socks5)).toEqual({ server: "socks5://[::1]:1080" });

  expect(parseProxyUrl("socks4://127.0.0.1:1081")).toEqual({
    type: "socks4",
    host: "127.0.0.1",
    port: 1081,
    username: "",
    password: "",
    server: "socks4://127.0.0.1:1081",
  });
  // Default ports for http/https are preserved even when URL drops :80 / :443.
  expect(parseProxyUrl("http://proxy.example:80")?.port).toBe(80);
  expect(parseProxyUrl("https://proxy.example")?.port).toBe(443);

  // Invalid inputs return null rather than throwing or guessing.
  for (const bad of [
    null,
    undefined,
    "",
    "   ",
    "direct",
    "not-a-url",
    "ftp://127.0.0.1:21",
    "socks5://127.0.0.1",
    "http://127.0.0.1:0",
    "http://127.0.0.1:99999",
    "http://127.0.0.1:8080/path",
    "http://127.0.0.1:8080?q=1",
  ]) {
    expect(parseProxyUrl(bad)).toBeNull();
  }
  expect(exitDisplayUrl("http://user:s3cr3t@198.51.100.7:8080")).toBe("http://198.51.100.7:8080");
  expect(exitDisplayUrl("direct")).toBeNull();
});

test("backfillAccountProxies does not rebound after user switches account back to inherit in magpie", async () => {
  const root = await tempDir();
  const cfg = join(root, "config");
  const data = join(root, "data");
  await mkdir(cfg, { recursive: true });
  await mkdir(data, { recursive: true });
  await seedProvidersJson(cfg);
  const env = { MAGPIE_CONFIG_DIR: cfg, MAGPIE_CLEAN_LOGIN_DATA: data };

  const store = createProxyStore({ dataDir: data });
  const p1 = await store.create({ name: "Node1", type: "http", host: "127.0.0.1", port: 19101 });

  const dir1 = join(data, "accounts", "minimax-code", "slot1");
  await mkdir(dir1, { recursive: true });
  await writeAccountMeta(dir1, {
    version: 1,
    provider: "minimax-code",
    key: "slot1",
    accountId: "BackfillUser",
    lastLogin: { proxyId: p1.id, proxyName: "Node1", type: "http" },
  });

  // First startup backfill populates providers.json.
  const first = await backfillAccountProxies({ env, store, dataDir: data });
  expect(first.ok).toBe(true);
  expect(first.changed).toHaveLength(1);
  expect((await readAccountExit({ env, provider: "minimax-code", accountId: "BackfillUser" })).mode).toBe(
    "custom",
  );

  // User switches the account back to inherit inside magpie (deletes accountProxies key).
  const doc = readProviders(cfg);
  delete doc.providers.find((p) => p.id === "minimax-code").accountProxies.backfilluser;
  await writeFile(join(cfg, "providers.json"), `${JSON.stringify(doc, null, 2)}\n`, "utf8");

  // Next startup backfill MUST NOT re-write historical lastLogin back into providers.json.
  const restart = await backfillAccountProxies({ env, store, dataDir: data });
  expect(restart.ok).toBe(true);
  expect(restart.changed).toHaveLength(0);
  expect(restart.reason).toBe("up_to_date");
  expect((await readAccountExit({ env, provider: "minimax-code", accountId: "BackfillUser" })).mode).toBe(
    "inherit",
  );

  // Same guarantee for a freshly signed-in account (via syncSignInProxy) later switched to inherit.
  const dir2 = join(data, "accounts", "minimax-code", "slot2");
  await mkdir(dir2, { recursive: true });
  await writeAccountMeta(dir2, {
    version: 1,
    provider: "minimax-code",
    key: "slot2",
    accountId: "SignedInUser",
    lastLogin: { proxyId: p1.id, proxyName: "Node1", type: "http" },
  });
  await syncSignInProxy({ env, provider: "minimax-code", accountId: "SignedInUser", proxy: p1, dataDir: data });
  const doc2 = readProviders(cfg);
  delete doc2.providers.find((p) => p.id === "minimax-code").accountProxies.signedinuser;
  await writeFile(join(cfg, "providers.json"), `${JSON.stringify(doc2, null, 2)}\n`, "utf8");

  const restart2 = await backfillAccountProxies({ env, store, dataDir: data });
  expect(restart2.ok).toBe(true);
  expect(restart2.changed).toHaveLength(0);
  expect((await readAccountExit({ env, provider: "minimax-code", accountId: "SignedInUser" })).mode).toBe(
    "inherit",
  );

  // Same guarantee after explicit writeAccountExit(mode: "inherit") on an account with historical lastLogin.
  const dir3 = join(data, "accounts", "minimax-code", "slot3");
  await mkdir(dir3, { recursive: true });
  await writeAccountMeta(dir3, {
    version: 1,
    provider: "minimax-code",
    key: "slot3",
    accountId: "ExplicitInheritUser",
    lastLogin: { proxyId: p1.id, proxyName: "Node1", type: "http" },
  });
  await writeAccountExit({
    env,
    provider: "minimax-code",
    accountId: "ExplicitInheritUser",
    mode: "inherit",
    dataDir: data,
  });
  const restart3 = await backfillAccountProxies({ env, store, dataDir: data });
  expect(restart3.ok).toBe(true);
  expect(restart3.changed).toHaveLength(0);
  expect(
    (await readAccountExit({ env, provider: "minimax-code", accountId: "ExplicitInheritUser" })).mode,
  ).toBe("inherit");
});

test("syncProxyUpdate with previousUrl updates magpie-bound and canonical entries without clobbering direct/inherit/other", async () => {
  const root = await tempDir();
  const cfg = join(root, "config");
  const data = join(root, "data");
  await mkdir(cfg, { recursive: true });
  await mkdir(data, { recursive: true });
  const env = { MAGPIE_CONFIG_DIR: cfg, MAGPIE_CLEAN_LOGIN_DATA: data };
  const store = createProxyStore({ dataDir: data });
  const px = await store.create({
    name: "Primary",
    type: "http",
    host: "198.51.100.10",
    port: 80,
    username: "olduser",
    password: "oldpassword",
  });
  const previousUrl = proxyUrlFor(px);

  await seedProvidersJson(cfg, [
    {
      id: "alpha",
      proxy: "http://127.0.0.1:9000",
      accountProxies: {
        exactbound: previousUrl,
        // Canonical equivalent (default :80 omitted in magpie)
        canonicalbound: "http://olduser:oldpassword@198.51.100.10",
        directuser: "direct",
        otherproxy: "socks5://203.0.113.99:1080",
      },
    },
  ]);

  await store.update(px.id, { port: 8081, password: "new:pass@word" });
  const newUrl = proxyUrlFor(await store.get(px.id));

  const res = await syncProxyUpdate({
    env,
    store,
    proxyId: px.id,
    previousUrl,
  });
  expect(res.ok).toBe(true);
  expect(res.reason).toBe("written");
  expect(res.changed).toHaveLength(2);

  const alpha = readProviders(cfg).providers.find((p) => p.id === "alpha");
  expect(alpha.accountProxies).toEqual({
    exactbound: newUrl,
    canonicalbound: newUrl,
    directuser: "direct",
    otherproxy: "socks5://203.0.113.99:1080",
  });
  // Provider-level proxy and unrelated providers stay untouched.
  expect(alpha.proxy).toBe("http://127.0.0.1:9000");
  expect(readProviders(cfg).providers.find((p) => p.id === "workbuddy").accountProxies["user-hand"]).toBe(
    "http://127.0.0.1:9999",
  );
});

test("resolveEffectiveAccountExit resolves all providers.json states, fallbacks, errors and redacts public output", async () => {
  const root = await tempDir();
  const cfg = join(root, "config");
  const data = join(root, "data");
  await mkdir(cfg, { recursive: true });
  await mkdir(data, { recursive: true });
  const env = { MAGPIE_CONFIG_DIR: cfg, MAGPIE_CLEAN_LOGIN_DATA: data };
  const store = createProxyStore({ dataDir: data });
  const nodeA = await store.create({
    name: "Node A",
    region: "HK",
    type: "http",
    host: "198.51.100.11",
    port: 8080,
    username: "userA",
    password: "secretA!",
  });
  const nodeB = await store.create({
    name: "Node B",
    region: "SG",
    type: "socks5",
    host: "198.51.100.12",
    port: 1080,
    username: "userB",
    password: "secretB!",
  });

  const extUrl = "socks5://extUser:extSecret@203.0.113.55:1080";
  const provUrl = "http://provUser:provSecret@198.51.100.20:3128";
  await seedProvidersJson(cfg, [
    {
      id: "p-store",
      proxy: proxyUrlFor(nodeB),
      accountProxies: {
        stored: proxyUrlFor(nodeA),
        external: extUrl,
        forcedirect: "direct",
        badurl: "not-a-valid-proxy-url",
      },
    },
    {
      id: "p-ext-prov",
      proxy: provUrl,
      accountProxies: {},
    },
    {
      id: "p-empty-prov",
      proxy: "",
      accountProxies: {},
    },
  ]);

  const proxyByUrl = await buildProxyUrlMap(store);

  // 1. custom matching stored node
  const rStored = await resolveEffectiveAccountExit({
    env,
    provider: "p-store",
    meta: { accountId: "Stored" },
    store,
    proxyByUrl,
  });
  expect(rStored.ok).toBe(true);
  expect(rStored.mode).toBe("custom");
  expect(rStored.effectiveMode).toBe("proxy");
  expect(rStored.source).toBe("providers_account");
  expect(rStored.matchedStore).toBe(true);
  expect(rStored.proxyId).toBe(nodeA.id);
  expect(rStored.proxy.password).toBe("secretA!");
  expect(JSON.stringify(rStored.public)).not.toContain("secretA!");
  expect(JSON.stringify(rStored.public)).not.toContain("userA");
  expect(rStored.public.displayUrl).toBe("http://198.51.100.11:8080");

  // 2. custom external URL not in store -> never degrades to direct, credentials stripped in public/proxyMeta
  const rExt = await resolveEffectiveAccountExit({
    env,
    provider: "p-store",
    meta: { accountId: "External" },
    store,
    proxyByUrl,
  });
  expect(rExt.ok).toBe(true);
  expect(rExt.mode).toBe("custom");
  expect(rExt.effectiveMode).toBe("proxy");
  expect(rExt.matchedStore).toBe(false);
  expect(rExt.proxy).toEqual({
    type: "socks5",
    host: "203.0.113.55",
    port: 1080,
    username: "extUser",
    password: "extSecret",
    server: "socks5://203.0.113.55:1080",
  });
  expect(rExt.proxyMeta).toEqual({ id: null, name: "", region: "", type: "socks5" });
  expect(JSON.stringify(publicAccountExit(rExt))).not.toContain("extUser");
  expect(JSON.stringify(publicAccountExit(rExt))).not.toContain("extSecret");
  expect(accountExitProjection(rExt)).toEqual({
    at: null,
    proxyId: null,
    proxyName: "",
    region: "",
    type: "socks5",
    custom: true,
    displayUrl: "socks5://203.0.113.55:1080",
  });

  // 3. direct
  const rDirect = await resolveEffectiveAccountExit({
    env,
    provider: "p-store",
    meta: { accountId: "ForceDirect" },
    store,
    proxyByUrl,
  });
  expect(rDirect.ok).toBe(true);
  expect(rDirect.mode).toBe("direct");
  expect(rDirect.effectiveMode).toBe("direct");
  expect(rDirect.proxy).toBeNull();

  // 4. inherit -> provider proxy hitting stored node
  const rInheritStore = await resolveEffectiveAccountExit({
    env,
    provider: "p-store",
    meta: { accountId: "InheritUser" },
    store,
    proxyByUrl,
  });
  expect(rInheritStore.ok).toBe(true);
  expect(rInheritStore.mode).toBe("inherit");
  expect(rInheritStore.effectiveMode).toBe("proxy");
  expect(rInheritStore.source).toBe("providers_provider");
  expect(rInheritStore.matchedStore).toBe(true);
  expect(rInheritStore.proxyId).toBe(nodeB.id);
  expect(JSON.stringify(rInheritStore.public)).not.toContain("secretB!");

  // 5. inherit -> provider proxy external URL
  const rInheritExt = await resolveEffectiveAccountExit({
    env,
    provider: "p-ext-prov",
    meta: { accountId: "InheritExtUser" },
    store,
    proxyByUrl,
  });
  expect(rInheritExt.ok).toBe(true);
  expect(rInheritExt.mode).toBe("inherit");
  expect(rInheritExt.effectiveMode).toBe("proxy");
  expect(rInheritExt.matchedStore).toBe(false);
  expect(rInheritExt.proxy.host).toBe("198.51.100.20");
  expect(rInheritExt.proxy.password).toBe("provSecret");
  expect(JSON.stringify(rInheritExt.public)).not.toContain("provUser");
  expect(JSON.stringify(rInheritExt.public)).not.toContain("provSecret");
  expect(accountExitProjection(rInheritExt)).toEqual({
    at: null,
    proxyId: null,
    proxyName: "",
    region: "",
    type: "http",
    mode: "inherit",
    custom: true,
    displayUrl: "http://198.51.100.20:3128",
  });

  // 6. inherit -> empty provider proxy -> direct
  const rInheritEmpty = await resolveEffectiveAccountExit({
    env,
    provider: "p-empty-prov",
    meta: { accountId: "InheritEmptyUser" },
    store,
    proxyByUrl,
  });
  expect(rInheritEmpty.ok).toBe(true);
  expect(rInheritEmpty.mode).toBe("inherit");
  expect(rInheritEmpty.effectiveMode).toBe("direct");
  expect(rInheritEmpty.proxy).toBeNull();

  // 7. invalid URL in providers.json -> fails explicitly, never degrades to direct
  const rBadUrl = await resolveEffectiveAccountExit({
    env,
    provider: "p-store",
    meta: { accountId: "BadUrl" },
    store,
    proxyByUrl,
  });
  expect(rBadUrl.ok).toBe(false);
  expect(rBadUrl.reason).toBe("invalid_exit_url");
  expect(accountExitProjection(rBadUrl)).toMatchObject({ custom: true, displayUrl: null });

  // 8. providers.json missing -> ledger fallback (direct, stored, missing proxyId -> exit_missing, empty -> exit_unknown)
  const missingEnv = { MAGPIE_CONFIG_DIR: join(root, "no-config"), MAGPIE_CLEAN_LOGIN_DATA: data };
  const rFallbackNode = await resolveEffectiveAccountExit({
    env: missingEnv,
    provider: "p-store",
    meta: { accountId: "Stored", lastLogin: { proxyId: nodeA.id } },
    store,
  });
  expect(rFallbackNode.ok).toBe(true);
  expect(rFallbackNode.source).toBe("ledger_last_login");
  expect(rFallbackNode.proxyId).toBe(nodeA.id);

  const rFallbackMissing = await resolveEffectiveAccountExit({
    env: missingEnv,
    provider: "p-store",
    meta: { accountId: "Stored", exit: { proxyId: "deleted-node-id" } },
    store,
  });
  expect(rFallbackMissing.ok).toBe(false);
  expect(rFallbackMissing.reason).toBe("exit_missing");

  const rFallbackUnknown = await resolveEffectiveAccountExit({
    env: missingEnv,
    provider: "p-store",
    meta: { accountId: "Stored" },
    store,
  });
  expect(rFallbackUnknown.ok).toBe(false);
  expect(rFallbackUnknown.reason).toBe("exit_unknown");

  // 9. corrupt providers.json -> fails explicitly with providers_invalid, never degrades to direct
  const corruptDir = join(root, "corrupt-config");
  await mkdir(corruptDir, { recursive: true });
  await writeFile(join(corruptDir, "providers.json"), "{ not valid json", "utf8");
  const rCorrupt = await resolveEffectiveAccountExit({
    env: { MAGPIE_CONFIG_DIR: corruptDir, MAGPIE_CLEAN_LOGIN_DATA: data },
    provider: "p-store",
    meta: { accountId: "Stored", lastLogin: { proxyId: null } },
    store,
  });
  expect(rCorrupt.ok).toBe(false);
  expect(rCorrupt.reason).toBe("providers_invalid");

  // 10. resolveAccountProxyName precedence
  expect(
    resolveAccountProxyName({
      meta: { accountId: "  FromMeta  " },
      key: "k1",
      authEntries: { k1: { accountId: "FromAuth", email: "auth@test" } },
      nativeEntries: [{ key: "k1", email: "native@test" }],
    }),
  ).toBe("FromMeta");
  expect(
    resolveAccountProxyName({
      meta: {},
      key: "k1",
      authEntries: { k1: { email: "auth@test" } },
      nativeEntries: [{ key: "k1", email: "native@test" }],
    }),
  ).toBe("auth@test");
  expect(
    resolveAccountProxyName({
      meta: {},
      key: "k1",
      authEntries: {},
      nativeEntries: [{ key: "k1", email: "native@test" }],
    }),
  ).toBe("native@test");
});
