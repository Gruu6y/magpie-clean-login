import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IDENTITY_FILE,
  accountDir,
  accountProfileDir,
  writeAccountMeta,
} from "../lib/account-identity.mjs";
import {
  AccountBrowserError,
  createAccountBrowserController,
  normalizeOpenUrl,
} from "../lib/account-browser.mjs";

const tempDirs = [];

async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "clean-login-acct-browser-"));
  tempDirs.push(root);
  const configDir = join(root, "magpie-config");
  const dataDir = join(root, "clean-login-data");
  await mkdir(configDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  const env = {
    MAGPIE_CONFIG_DIR: configDir,
    MAGPIE_CLEAN_LOGIN_DATA: dataDir,
  };
  return { root, configDir, dataDir, env };
}

async function seedAccount(
  env,
  {
    provider = "claude",
    key = "claude#a1",
    accountId = "alice@example.com",
    identity = { navigator: { userAgent: "PinnedUA/1.0" }, tag: "pin-1" },
    metaExtra = {},
  } = {},
) {
  const dir = accountDir(env, provider, key);
  await mkdir(dir, { recursive: true });
  await writeAccountMeta(dir, {
    provider,
    key,
    accountId,
    signedInAt: "2026-11-20T00:00:00.000Z",
    ...metaExtra,
  });
  if (identity !== null) {
    await writeFile(join(dir, IDENTITY_FILE), `${JSON.stringify(identity, null, 2)}\n`, "utf8");
  }
  return dir;
}

async function writeProviders(configDir, doc) {
  const file = join(configDir, "providers.json");
  const text = typeof doc === "string" ? doc : `${JSON.stringify(doc, null, 2)}\n`;
  await writeFile(file, text, "utf8");
  return file;
}

function makeStore(initial = []) {
  const records = new Map(initial.map((item) => [item.id, { ...item }]));
  return {
    records,
    async list() {
      return [...records.values()].map(({ id, name, region, type }) => ({ id, name, region, type }));
    },
    async get(id) {
      const rec = records.get(id);
      return rec ? { ...rec } : null;
    },
    set(record) {
      records.set(record.id, { ...record });
    },
    remove(id) {
      records.delete(id);
    },
  };
}

function makeFakeLauncher({ onLaunch } = {}) {
  const launches = [];
  const launcher = async (args) => {
    let resolveClosed;
    const closed = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    let closeCount = 0;
    const handle = {
      pid: 1000 + launches.length,
      warning: null,
      closed,
      closeCalls: () => closeCount,
      triggerExit: () => resolveClosed(),
      async close() {
        closeCount += 1;
        resolveClosed();
      },
    };
    const record = { args, handle };
    launches.push(record);
    if (onLaunch) {
      const custom = await onLaunch(args, handle);
      if (custom) return custom;
    }
    return handle;
  };
  return { launcher, launches };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// ---------- normalizeOpenUrl ----------

test("normalizeOpenUrl handles blank, about:blank, and valid http/https URLs", () => {
  expect(normalizeOpenUrl(undefined)).toBe("about:blank");
  expect(normalizeOpenUrl(null)).toBe("about:blank");
  expect(normalizeOpenUrl("")).toBe("about:blank");
  expect(normalizeOpenUrl("   \t  ")).toBe("about:blank");
  expect(normalizeOpenUrl("about:blank")).toBe("about:blank");
  expect(normalizeOpenUrl("  ABOUT:BLANK  ")).toBe("about:blank");
  expect(normalizeOpenUrl("https://claude.ai/chats?tab=1#top")).toBe("https://claude.ai/chats?tab=1#top");
  expect(normalizeOpenUrl("  http://example.com:8080/path  ")).toBe("http://example.com:8080/path");
});

test("normalizeOpenUrl rejects non-strings, unsafe schemes, malformed URLs, and embedded credentials", () => {
  for (const invalid of [
    123,
    {},
    [],
    true,
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<h1>hi</h1>",
    "ftp://example.com/file",
    "about:config",
    "chrome://settings",
    "not a url",
    "https://user:secret@example.com/app",
    "https://user@example.com/app",
    "http://:secret@example.com/app",
    "https://example.com/\u0000bad",
  ]) {
    let caught;
    try {
      normalizeOpenUrl(invalid);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AccountBrowserError);
    expect(caught.code).toBe("invalid_url");
    expect(caught.status).toBe(400);
  }
});

// ---------- validation, account lookup, read-only identity, missing executable ----------

test("open validates account arguments, existence, pinned identity (read-only), and browser executable", async () => {
  const { env, configDir } = await makeWorkspace();
  await writeProviders(configDir, {
    providers: [{ id: "claude", proxy: "direct", accountProxies: { "alice@example.com": "direct" } }],
  });
  const { launcher, launches } = makeFakeLauncher();
  const ctrl = createAccountBrowserController({
    env,
    resolveExecutable: async () => "/fake/camoufox",
    launchBrowser: launcher,
  });

  // Invalid provider/key -> 400 invalid_account.
  await expect(ctrl.open({ provider: "", key: "claude#a1" })).rejects.toMatchObject({
    code: "invalid_account",
    status: 400,
  });
  await expect(ctrl.open({ provider: "claude", key: "   " })).rejects.toMatchObject({
    code: "invalid_account",
    status: 400,
  });

  // Missing account -> 404 not_found.
  await expect(ctrl.open({ provider: "claude", key: "claude#missing" })).rejects.toMatchObject({
    code: "not_found",
    status: 404,
  });

  // Provider mismatch in meta -> 404 not_found.
  const mismatchDir = accountDir(env, "claude", "claude#wrong-provider");
  await mkdir(mismatchDir, { recursive: true });
  await writeAccountMeta(mismatchDir, { provider: "openai", key: "claude#wrong-provider" });
  await expect(ctrl.open({ provider: "claude", key: "claude#wrong-provider" })).rejects.toMatchObject({
    code: "not_found",
    status: 404,
  });

  // Missing pinned identity -> 409 identity_missing, and identity.json is NEVER synthesized.
  const noPinDir = await seedAccount(env, {
    provider: "claude",
    key: "claude#nopin",
    accountId: "alice@example.com",
    identity: null,
  });
  await expect(ctrl.open({ provider: "claude", key: "claude#nopin" })).rejects.toMatchObject({
    code: "identity_missing",
    status: 409,
  });
  expect(existsSync(join(noPinDir, IDENTITY_FILE))).toBe(false);

  // Corrupt identity.json -> 409 identity_missing, file left untouched.
  const badPinDir = await seedAccount(env, {
    provider: "claude",
    key: "claude#badpin",
    accountId: "alice@example.com",
    identity: null,
  });
  await writeFile(join(badPinDir, IDENTITY_FILE), "{not json", "utf8");
  await expect(ctrl.open({ provider: "claude", key: "claude#badpin" })).rejects.toMatchObject({
    code: "identity_missing",
    status: 409,
  });
  expect(await readFile(join(badPinDir, IDENTITY_FILE), "utf8")).toBe("{not json");

  // Missing executable -> 503 executable_missing.
  await seedAccount(env, { provider: "claude", key: "claude#ok", accountId: "alice@example.com" });
  const noExeCtrl = createAccountBrowserController({
    env,
    resolveExecutable: async () => null,
    launchBrowser: launcher,
  });
  await expect(noExeCtrl.open({ provider: "claude", key: "claude#ok" })).rejects.toMatchObject({
    code: "executable_missing",
    status: 503,
  });
  expect(launches.length).toBe(0);
});

// ---------- exit modes: custom stored, direct, inherit-proxy, inherit-direct, external auth URL ----------

test("open resolves custom stored proxy, direct, inherit-proxy, inherit-direct, and external auth URLs", async () => {
  const { env, configDir } = await makeWorkspace();
  const store = makeStore([
    {
      id: "node-jp",
      name: "Tokyo 1",
      region: "JP",
      type: "socks5",
      host: "198.51.100.10",
      port: 1080,
      username: "jpuser",
      password: "jp-super-secret-password",
    },
    {
      id: "node-us",
      name: "Oregon 1",
      region: "US",
      type: "http",
      host: "203.0.113.20",
      port: 8080,
      username: "ususer",
      password: "us-super-secret-password",
    },
  ]);

  await writeProviders(configDir, {
    providers: [
      {
        id: "claude",
        proxy: "http://ususer:us-super-secret-password@203.0.113.20:8080",
        accountProxies: {
          "custom@example.com": "socks5://jpuser:jp-super-secret-password@198.51.100.10:1080",
          "direct@example.com": "direct",
          "external@example.com": "http://extuser:ext-secret-999@192.0.2.55:3128",
        },
      },
      {
        id: "openai",
        proxy: "",
        accountProxies: {},
      },
    ],
  });

  const pin = { webgl: { vendor: "PinnedVendor" }, seed: 42 };
  const dCustom = await seedAccount(env, { provider: "claude", key: "claude#1", accountId: "custom@example.com", identity: pin });
  await seedAccount(env, { provider: "claude", key: "claude#2", accountId: "direct@example.com", identity: pin });
  await seedAccount(env, { provider: "claude", key: "claude#3", accountId: "inherit-proxy@example.com", identity: pin });
  await seedAccount(env, { provider: "claude", key: "claude#4", accountId: "external@example.com", identity: pin });
  await seedAccount(env, { provider: "openai", key: "openai#1", accountId: "inherit-direct@example.com", identity: pin });

  const { launcher, launches } = makeFakeLauncher();
  const ctrl = createAccountBrowserController({
    env,
    store,
    resolveExecutable: async () => "/fake/camoufox",
    launchBrowser: launcher,
    now: () => "2026-11-24T12:00:00.000Z",
  });

  // 1. Custom stored node.
  const rCustom = await ctrl.open({ provider: "claude", key: "claude#1" });
  expect(rCustom).toEqual({
    open: true,
    openedAt: "2026-11-24T12:00:00.000Z",
    exit: {
      ok: true,
      mode: "custom",
      effectiveMode: "proxy",
      source: "providers_account",
      accountKey: "custom@example.com",
      matchedStore: true,
      proxyId: "node-jp",
      proxyName: "Tokyo 1",
      region: "JP",
      type: "socks5",
      displayUrl: "socks5://198.51.100.10:1080",
      providerProxy: "http://203.0.113.20:8080",
    },
    exitChanged: false,
  });
  expect(launches[0].args).toMatchObject({
    executablePath: "/fake/camoufox",
    url: "about:blank",
    profileDir: accountProfileDir(dCustom),
    identity: pin,
    headless: false,
    purpose: "account",
    env,
  });
  expect(launches[0].args.proxy).toMatchObject({
    id: "node-jp",
    username: "jpuser",
    password: "jp-super-secret-password",
  });

  // 2. Explicit direct exit.
  const rDirect = await ctrl.open({ provider: "claude", key: "claude#2", url: "https://claude.ai/login" });
  expect(rDirect.exit.mode).toBe("direct");
  expect(rDirect.exit.effectiveMode).toBe("direct");
  expect(launches[1].args.proxy).toBeNull();
  expect(launches[1].args.url).toBe("https://claude.ai/login");

  // 3. Inherit -> provider proxy.
  const rInheritProxy = await ctrl.open({ provider: "claude", key: "claude#3" });
  expect(rInheritProxy.exit.mode).toBe("inherit");
  expect(rInheritProxy.exit.effectiveMode).toBe("proxy");
  expect(rInheritProxy.exit.proxyId).toBe("node-us");
  expect(launches[2].args.proxy).toMatchObject({
    id: "node-us",
    username: "ususer",
    password: "us-super-secret-password",
  });

  // 4. External auth proxy URL (unmatched store).
  const rExternal = await ctrl.open({ provider: "claude", key: "claude#4" });
  expect(rExternal.exit.mode).toBe("custom");
  expect(rExternal.exit.effectiveMode).toBe("proxy");
  expect(rExternal.exit.matchedStore).toBe(false);
  expect(rExternal.exit.proxyId).toBeNull();
  expect(rExternal.exit.displayUrl).toBe("http://192.0.2.55:3128");
  expect(launches[3].args.proxy).toMatchObject({
    server: "http://192.0.2.55:3128",
    username: "extuser",
    password: "ext-secret-999",
  });

  // 5. Inherit with no provider proxy -> direct allowed.
  const rInheritDirect = await ctrl.open({ provider: "openai", key: "openai#1" });
  expect(rInheritDirect.exit.mode).toBe("inherit");
  expect(rInheritDirect.exit.effectiveMode).toBe("direct");
  expect(launches[4].args.proxy).toBeNull();

  // Zero credential / raw path leak across all outputs!
  const allPublic = JSON.stringify({
    opened: [rCustom, rDirect, rInheritProxy, rExternal, rInheritDirect],
    list: ctrl.listOpen(),
    statuses: await Promise.all([
      ctrl.status("claude", "claude#1"),
      ctrl.status("claude", "claude#4"),
    ]),
  });
  for (const secret of [
    "jpuser",
    "jp-super-secret-password",
    "ususer",
    "us-super-secret-password",
    "extuser",
    "ext-secret-999",
    dCustom,
    accountProfileDir(dCustom),
  ]) {
    expect(allPublic).not.toContain(secret);
  }
  expect(allPublic).not.toContain("exitDigest");

  await ctrl.closeAll();
});

// ---------- fail-closed exit boundary (NEVER degrades to direct) ----------

test("corrupt providers.json, invalid exit URL, missing stored exit, or unknown exit fail with 409 and NEVER degrade to direct", async () => {
  const { env, configDir } = await makeWorkspace();
  const store = makeStore([]);
  const { launcher, launches } = makeFakeLauncher();
  const ctrl = createAccountBrowserController({
    env,
    store,
    resolveExecutable: async () => "/fake/camoufox",
    launchBrowser: launcher,
  });

  // Account with a direct ledger snapshot — corrupt providers.json MUST still fail, never degrade!
  await seedAccount(env, {
    provider: "claude",
    key: "claude#corrupt",
    accountId: "corrupt@example.com",
    metaExtra: { exit: { at: "2026-11-20T00:00:00.000Z", proxyId: null } },
  });
  await writeProviders(configDir, "{ broken json");
  await expect(ctrl.open({ provider: "claude", key: "claude#corrupt" })).rejects.toMatchObject({
    code: "providers_invalid",
    status: 409,
  });

  // Invalid exit URL in providers.json -> 409 invalid_exit_url.
  await writeProviders(configDir, {
    providers: [
      { id: "claude", accountProxies: { "corrupt@example.com": "not-a-valid-proxy-url" } },
    ],
  });
  await expect(ctrl.open({ provider: "claude", key: "claude#corrupt" })).rejects.toMatchObject({
    code: "invalid_exit_url",
    status: 409,
  });

  // Ledger references deleted stored node when providers.json is absent -> 409 exit_missing.
  await rm(join(configDir, "providers.json"), { force: true });
  await seedAccount(env, {
    provider: "claude",
    key: "claude#gone",
    accountId: "gone@example.com",
    metaExtra: { exit: { at: "2026-11-20T00:00:00.000Z", proxyId: "deleted-node" } },
  });
  await expect(ctrl.open({ provider: "claude", key: "claude#gone" })).rejects.toMatchObject({
    code: "exit_missing",
    status: 409,
  });

  // No providers.json and no ledger exit/lastLogin -> 409 exit_unknown.
  await seedAccount(env, {
    provider: "claude",
    key: "claude#unknown",
    accountId: "unknown@example.com",
  });
  await expect(ctrl.open({ provider: "claude", key: "claude#unknown" })).rejects.toMatchObject({
    code: "exit_unknown",
    status: 409,
  });

  // Unreadable providers.json -> 409 providers_unreadable.
  const unreadableCtrl = createAccountBrowserController({
    env,
    store,
    resolveExecutable: async () => "/fake/camoufox",
    launchBrowser: launcher,
    resolveExit: async () => ({ ok: false, reason: "providers_unreadable" }),
  });
  await expect(unreadableCtrl.open({ provider: "claude", key: "claude#corrupt" })).rejects.toMatchObject({
    code: "providers_unreadable",
    status: 409,
  });

  expect(launches.length).toBe(0);
});

// ---------- multi-account concurrency, double-open race, signin & renewal mutex ----------

test("supports multiple concurrent accounts, blocks same-account double-open and concurrent start race", async () => {
  const { env, configDir } = await makeWorkspace();
  await writeProviders(configDir, {
    providers: [{ id: "claude", proxy: "direct", accountProxies: {} }],
  });
  await seedAccount(env, { provider: "claude", key: "claude#a", accountId: "a@example.com" });
  await seedAccount(env, { provider: "claude", key: "claude#b", accountId: "b@example.com" });

  let releaseFirstLaunch;
  const firstLaunchGate = new Promise((resolve) => {
    releaseFirstLaunch = resolve;
  });
  let launchIndex = 0;
  const { launcher } = makeFakeLauncher({
    async onLaunch(_args, handle) {
      launchIndex += 1;
      if (launchIndex === 1) await firstLaunchGate;
      return handle;
    },
  });

  const ctrl = createAccountBrowserController({
    env,
    resolveExecutable: async () => "/fake/camoufox",
    launchBrowser: launcher,
  });

  // Kick off first open for claude#a (paused inside launchBrowser).
  const p1 = ctrl.open({ provider: "claude", key: "claude#a" });
  // isOpen must already be true while starting!
  expect(ctrl.isOpen("claude", "claude#a")).toBe(true);
  // Concurrent open on the SAME account must fail immediately with 409 browser_already_open.
  await expect(ctrl.open({ provider: "claude", key: "claude#a" })).rejects.toMatchObject({
    code: "browser_already_open",
    status: 409,
  });
  // Meanwhile, opening a DIFFERENT account succeeds concurrently!
  const bRes = await ctrl.open({ provider: "claude", key: "claude#b" });
  expect(bRes.open).toBe(true);

  releaseFirstLaunch();
  const aRes = await p1;
  expect(aRes.open).toBe(true);

  // Double-open while active also fails with 409 browser_already_open.
  await expect(ctrl.open({ provider: "claude", key: "claude#a" })).rejects.toMatchObject({
    code: "browser_already_open",
    status: 409,
  });

  expect(ctrl.listOpen().map((item) => item.key).sort()).toEqual(["claude#a", "claude#b"]);
  expect(ctrl.isOpen("claude", "claude#a")).toBe(true);
  expect(ctrl.isOpen("claude", "claude#b")).toBe(true);

  // Closing one account leaves the other open.
  const closedA = await ctrl.close("claude", "claude#a");
  expect(closedA).toEqual({
    closed: true,
    browser: { open: false, openedAt: null, exit: null, exitChanged: false },
  });
  expect(ctrl.isOpen("claude", "claude#a")).toBe(false);
  expect(ctrl.isOpen("claude", "claude#b")).toBe(true);

  // Closing an already-closed account returns closed: false.
  const closedAgain = await ctrl.close("claude", "claude#a");
  expect(closedAgain).toEqual({
    closed: false,
    browser: { open: false, openedAt: null, exit: null, exitChanged: false },
  });

  await ctrl.closeAll();
});

test("enforces same-account signin and renewal mutexes while allowing other accounts and tolerating missing activeAccount", async () => {
  const { env, configDir } = await makeWorkspace();
  await writeProviders(configDir, {
    providers: [{ id: "claude", proxy: "direct", accountProxies: {} }],
  });
  await seedAccount(env, { provider: "claude", key: "claude#busy", accountId: "busy@example.com" });
  await seedAccount(env, { provider: "claude", key: "claude#free", accountId: "free@example.com" });

  let runningRenewal = { provider: "claude", key: "claude#busy" };
  let activeSignIn = null;
  const { launcher } = makeFakeLauncher();
  const ctrl = createAccountBrowserController({
    env,
    renewHosting: { running: () => runningRenewal },
    signIn: { activeAccount: () => activeSignIn },
    resolveExecutable: async () => "/fake/camoufox",
    launchBrowser: launcher,
  });

  await expect(ctrl.open({ provider: "claude", key: "claude#busy" })).rejects.toMatchObject({
    code: "renewal_running",
    status: 409,
  });
  // Different account is not blocked by claude#busy's renewal.
  expect((await ctrl.open({ provider: "claude", key: "claude#free" })).open).toBe(true);
  await ctrl.close("claude", "claude#free");

  // Sign-in / rotation mutex.
  runningRenewal = null;
  activeSignIn = { provider: "claude", key: "claude#busy" };
  await expect(ctrl.open({ provider: "claude", key: "claude#busy" })).rejects.toMatchObject({
    code: "signin_running",
    status: 409,
  });
  // Different account is not blocked by claude#busy's sign-in.
  expect((await ctrl.open({ provider: "claude", key: "claude#free" })).open).toBe(true);
  await ctrl.closeAll();

  // Tolerates signIn without activeAccount().
  const legacySignInCtrl = createAccountBrowserController({
    env,
    signIn: { status: () => ({ state: "waiting" }) },
    resolveExecutable: async () => "/fake/camoufox",
    launchBrowser: launcher,
  });
  expect((await legacySignInCtrl.open({ provider: "claude", key: "claude#busy" })).open).toBe(true);
  await legacySignInCtrl.closeAll();
});

// ---------- exitChanged detection ----------

test("status detects exitChanged when mode, proxy node, proxy password, or providers.json validity changes", async () => {
  const { env, configDir } = await makeWorkspace();
  const store = makeStore([
    {
      id: "node-1",
      name: "Node 1",
      region: "JP",
      type: "http",
      host: "198.51.100.1",
      port: 8080,
      username: "user1",
      password: "pw-original",
    },
    {
      id: "node-2",
      name: "Node 2",
      region: "SG",
      type: "http",
      host: "198.51.100.2",
      port: 8080,
      username: "user2",
      password: "pw-two",
    },
  ]);
  await writeProviders(configDir, {
    providers: [
      {
        id: "claude",
        proxy: "direct",
        accountProxies: {
          "alice@example.com": "http://user1:pw-original@198.51.100.1:8080",
        },
      },
    ],
  });
  await seedAccount(env, { provider: "claude", key: "claude#a1", accountId: "alice@example.com" });

  const { launcher } = makeFakeLauncher();
  const ctrl = createAccountBrowserController({
    env,
    store,
    resolveExecutable: async () => "/fake/camoufox",
    launchBrowser: launcher,
  });

  // Closed account returns closed status immediately.
  expect(await ctrl.status("claude", "claude#a1")).toEqual({
    open: false,
    openedAt: null,
    exit: null,
    exitChanged: false,
  });

  await ctrl.open({ provider: "claude", key: "claude#a1" });
  expect((await ctrl.status("claude", "claude#a1")).exitChanged).toBe(false);

  // 1. Password changed on same host/port/node -> exitChanged: true!
  store.set({
    id: "node-1",
    name: "Node 1",
    region: "JP",
    type: "http",
    host: "198.51.100.1",
    port: 8080,
    username: "user1",
    password: "pw-rotated",
  });
  await writeProviders(configDir, {
    providers: [
      {
        id: "claude",
        proxy: "direct",
        accountProxies: {
          "alice@example.com": "http://user1:pw-rotated@198.51.100.1:8080",
        },
      },
    ],
  });
  expect((await ctrl.status("claude", "claude#a1")).exitChanged).toBe(true);

  // Restore original password -> exitChanged returns to false.
  store.set({
    id: "node-1",
    name: "Node 1",
    region: "JP",
    type: "http",
    host: "198.51.100.1",
    port: 8080,
    username: "user1",
    password: "pw-original",
  });
  await writeProviders(configDir, {
    providers: [
      {
        id: "claude",
        proxy: "direct",
        accountProxies: {
          "alice@example.com": "http://user1:pw-original@198.51.100.1:8080",
        },
      },
    ],
  });
  expect((await ctrl.status("claude", "claude#a1")).exitChanged).toBe(false);

  // 2. Switched to another proxy node -> exitChanged: true.
  await writeProviders(configDir, {
    providers: [
      {
        id: "claude",
        proxy: "direct",
        accountProxies: {
          "alice@example.com": "http://user2:pw-two@198.51.100.2:8080",
        },
      },
    ],
  });
  expect((await ctrl.status("claude", "claude#a1")).exitChanged).toBe(true);

  // 3. Switched mode to direct -> exitChanged: true.
  await writeProviders(configDir, {
    providers: [{ id: "claude", proxy: "direct", accountProxies: { "alice@example.com": "direct" } }],
  });
  expect((await ctrl.status("claude", "claude#a1")).exitChanged).toBe(true);

  // 4. Corrupt providers.json -> exitChanged: true.
  await writeProviders(configDir, "{corrupt");
  expect((await ctrl.status("claude", "claude#a1")).exitChanged).toBe(true);

  // 5. Supplied liveResolved short-circuits re-reading providers.json.
  const sWithLive = await ctrl.status("claude", "claude#a1", {
    liveResolved: {
      ok: true,
      mode: "custom",
      effectiveMode: "proxy",
      proxyId: "node-1",
      proxy: {
        id: "node-1",
        type: "http",
        host: "198.51.100.1",
        port: 8080,
        username: "user1",
        password: "pw-original",
      },
    },
  });
  expect(sWithLive.exitChanged).toBe(false);

  const sWithFailedLive = await ctrl.status("claude", "claude#a1", {
    liveResolved: { ok: false, reason: "providers_invalid" },
  });
  expect(sWithFailedLive.exitChanged).toBe(true);

  await ctrl.closeAll();
});

test("status with non-authoritative liveResolved falls back to ledger for accounts opened without providers.json", async () => {
  const { env } = await makeWorkspace();
  const store = makeStore([
    {
      id: "node-1",
      name: "Node 1",
      region: "JP",
      type: "http",
      host: "198.51.100.1",
      port: 8080,
      username: "u",
      password: "p1",
    },
  ]);
  await seedAccount(env, {
    provider: "claude",
    key: "claude#ledger",
    accountId: "ledger@example.com",
    metaExtra: { exit: { at: "2026-11-20T00:00:00.000Z", proxyId: "node-1" } },
  });
  const { launcher } = makeFakeLauncher();
  const ctrl = createAccountBrowserController({
    env,
    store,
    resolveExecutable: async () => "/fake/camoufox",
    launchBrowser: launcher,
  });

  await ctrl.open({ provider: "claude", key: "claude#ledger" });
  const unchanged = await ctrl.status("claude", "claude#ledger", {
    liveResolved: { ok: false, reason: "providers_missing" },
  });
  expect(unchanged.exitChanged).toBe(false);

  // Mutating the stored node's password flips exitChanged to true.
  store.set({
    id: "node-1",
    name: "Node 1",
    region: "JP",
    type: "http",
    host: "198.51.100.1",
    port: 8080,
    username: "u",
    password: "p2",
  });
  const changed = await ctrl.status("claude", "claude#ledger", {
    liveResolved: { ok: false, reason: "providers_missing" },
  });
  expect(changed.exitChanged).toBe(true);

  await ctrl.closeAll();
});

// ---------- handle.closed auto-cleanup, stale handle guard, closeAll, warnings ----------

test("auto-cleans up on handle.closed without evicting a newer reopened handle, and surfaces navigation warning", async () => {
  const { env, configDir } = await makeWorkspace();
  await writeProviders(configDir, {
    providers: [{ id: "claude", proxy: "direct", accountProxies: {} }],
  });
  await seedAccount(env, { provider: "claude", key: "claude#a1", accountId: "a@example.com" });
  await seedAccount(env, { provider: "claude", key: "claude#a2", accountId: "b@example.com" });

  let resolveOldClosed;
  const oldClosed = new Promise((resolve) => {
    resolveOldClosed = resolve;
  });
  let launchNum = 0;
  const { launcher, launches } = makeFakeLauncher({
    async onLaunch(_args, handle) {
      launchNum += 1;
      if (launchNum === 1) {
        return {
          ...handle,
          warning: {
            code: "navigation_failed",
            status: 504,
            message: "Page timed out.",
            detail: "secret internal detail should be stripped",
          },
        };
      }
      if (launchNum === 2) {
        // Handle whose `close()` returns immediately while `closed` settles later.
        return {
          pid: 2002,
          warning: null,
          closed: oldClosed,
          async close() {},
        };
      }
      if (launchNum === 4) {
        return {
          ...handle,
          async close() {
            throw new Error("already dead");
          },
        };
      }
      return handle;
    },
  });

  const ctrl = createAccountBrowserController({
    env,
    resolveExecutable: async () => "/fake/camoufox",
    launchBrowser: launcher,
  });

  // 1. Warning surfaced cleanly without internal detail.
  const opened = await ctrl.open({ provider: "claude", key: "claude#a1", url: "https://example.com" });
  expect(opened.warning).toEqual({
    code: "navigation_failed",
    status: 504,
    message: "Page timed out.",
  });
  expect(JSON.stringify(await ctrl.status("claude", "claude#a1"))).not.toContain("secret internal detail");

  // User closes the window -> handle.closed resolves -> auto-removed.
  launches[0].handle.triggerExit();
  await Promise.resolve();
  await Promise.resolve();
  expect(ctrl.isOpen("claude", "claude#a1")).toBe(false);
  expect((await ctrl.status("claude", "claude#a1")).open).toBe(false);
  expect(ctrl.listOpen()).toEqual([]);

  // 2. Stale handle.closed must NOT remove a newer handle for the same account.
  await ctrl.open({ provider: "claude", key: "claude#a1" });
  await ctrl.close("claude", "claude#a1");
  await ctrl.open({ provider: "claude", key: "claude#a1" });
  expect(ctrl.isOpen("claude", "claude#a1")).toBe(true);
  resolveOldClosed();
  await Promise.resolve();
  await Promise.resolve();
  expect(ctrl.isOpen("claude", "claude#a1")).toBe(true);

  // 3. closeAll closes all active handles gracefully even if one close() throws.
  await ctrl.open({ provider: "claude", key: "claude#a2" });
  expect(ctrl.listOpen().length).toBe(2);
  await ctrl.closeAll();
  expect(ctrl.listOpen()).toEqual([]);
  expect(ctrl.isOpen("claude", "claude#a1")).toBe(false);
  expect(ctrl.isOpen("claude", "claude#a2")).toBe(false);
});

// ---------- zero side effects on providers.json, account.json, identity.json, auth files ----------

test("opening, inspecting, and closing has zero write side effects on providers.json, account.json, identity.json, or auth files", async () => {
  const { env, configDir } = await makeWorkspace();
  const providersPath = await writeProviders(configDir, {
    providers: [{ id: "claude", proxy: "direct", accountProxies: { "alice@example.com": "direct" } }],
  });
  const authPath = join(configDir, "plugin-auth.json");
  await writeFile(authPath, JSON.stringify({ "claude#a1": { token: "keep-me" } }, null, 2), "utf8");
  const dir = await seedAccount(env, { provider: "claude", key: "claude#a1", accountId: "alice@example.com" });
  const accountPath = join(dir, "account.json");
  const identityPath = join(dir, IDENTITY_FILE);

  const watched = [providersPath, authPath, accountPath, identityPath];
  const snapshot = async () =>
    Promise.all(
      watched.map(async (file) => ({
        file,
        content: await readFile(file, "utf8"),
        mtimeMs: (await stat(file)).mtimeMs,
      })),
    );

  const before = await snapshot();
  const { launcher } = makeFakeLauncher();
  const ctrl = createAccountBrowserController({
    env,
    resolveExecutable: async () => "/fake/camoufox",
    launchBrowser: launcher,
  });

  await ctrl.open({ provider: "claude", key: "claude#a1" });
  await ctrl.status("claude", "claude#a1");
  ctrl.listOpen();
  await ctrl.close("claude", "claude#a1");

  const after = await snapshot();
  expect(after).toEqual(before);
});

test("cleans up starting lock on launch failure, handles closeAll race, external URL password rotation, and resolveExit error in status", async () => {
  const { env, configDir } = await makeWorkspace();
  await writeProviders(configDir, {
    providers: [
      {
        id: "claude",
        proxy: "direct",
        accountProxies: {
          "ext@example.com": "http://u1:pass-v1@192.0.2.80:3128",
        },
      },
    ],
  });
  await seedAccount(env, { provider: "claude", key: "claude#ext", accountId: "ext@example.com" });

  // 1. Launch failure clears starting state so retry succeeds.
  let attempts = 0;
  let releaseSecond;
  const secondGate = new Promise((resolve) => {
    releaseSecond = resolve;
  });
  let closedOrphanCount = 0;
  const { launcher } = makeFakeLauncher({
    async onLaunch(_args, handle) {
      attempts += 1;
      if (attempts === 1) throw new Error("boom on launch");
      if (attempts === 2) {
        await secondGate;
        return {
          ...handle,
          async close() {
            closedOrphanCount += 1;
          },
        };
      }
      return handle;
    },
  });

  const ctrl = createAccountBrowserController({
    env,
    resolveExecutable: async () => "/fake/camoufox",
    launchBrowser: launcher,
  });

  let launchErr;
  try {
    await ctrl.open({ provider: "claude", key: "claude#ext" });
  } catch (caught) {
    launchErr = caught;
  }
  expect(launchErr).toBeInstanceOf(AccountBrowserError);
  expect(launchErr.code).toBe("launch_failed");
  expect(launchErr.status).toBe(502);
  expect(launchErr.message).not.toContain("boom on launch");
  expect(ctrl.isOpen("claude", "claude#ext")).toBe(false);

  // 2. closeAll() racing with an in-flight launch closes the late handle and rejects cleanly.
  const inflight = ctrl.open({ provider: "claude", key: "claude#ext" });
  expect(ctrl.isOpen("claude", "claude#ext")).toBe(true);
  await ctrl.closeAll();
  releaseSecond();
  await expect(inflight).rejects.toMatchObject({ code: "browser_closed", status: 409 });
  expect(closedOrphanCount).toBe(1);
  expect(ctrl.isOpen("claude", "claude#ext")).toBe(false);
  expect(ctrl.listOpen()).toEqual([]);

  // 3. Retry succeeds; external auth URL password change flips exitChanged to true.
  await ctrl.open({ provider: "claude", key: "claude#ext" });
  expect((await ctrl.status("claude", "claude#ext")).exitChanged).toBe(false);
  await writeProviders(configDir, {
    providers: [
      {
        id: "claude",
        proxy: "direct",
        accountProxies: {
          "ext@example.com": "http://u1:pass-v2@192.0.2.80:3128",
        },
      },
    ],
  });
  expect((await ctrl.status("claude", "claude#ext")).exitChanged).toBe(true);
  await ctrl.closeAll();

  // 4. resolveExit throwing during status() yields exitChanged: true rather than throwing.
  let calls = 0;
  const flakyCtrl = createAccountBrowserController({
    env,
    resolveExecutable: async () => "/fake/camoufox",
    launchBrowser: makeFakeLauncher().launcher,
    resolveExit: async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: true, mode: "direct", effectiveMode: "direct", proxy: null, proxyId: null };
      }
      throw new Error("disk error");
    },
  });
  await flakyCtrl.open({ provider: "claude", key: "claude#ext" });
  const degraded = await flakyCtrl.status("claude", "claude#ext");
  expect(degraded.open).toBe(true);
  expect(degraded.exitChanged).toBe(true);
  await flakyCtrl.closeAll();
});

test("open translates launchBrowser errors into safe path-free and credential-free AccountBrowserError messages", async () => {
  const { root, env, configDir } = await makeWorkspace();
  await writeProviders(configDir, {
    providers: [
      {
        id: "claude",
        proxy: "direct",
        accountProxies: {
          "alice@example.com": "http://proxyuser:super-secret-pw@192.0.2.90:8080",
        },
      },
    ],
  });
  const dir = await seedAccount(env, {
    provider: "claude",
    key: "claude#a1",
    accountId: "alice@example.com",
  });
  const missingExe = join(root, "private-dir", "missing-camoufox.exe");
  const profileDir = accountProfileDir(dir);

  // 1. Real default launchSignInBrowser with a non-existent executablePath must never leak missingExe.
  const realMissingExeCtrl = createAccountBrowserController({
    env,
    resolveExecutable: async () => missingExe,
  });
  let missingExeErr;
  try {
    await realMissingExeCtrl.open({ provider: "claude", key: "claude#a1" });
  } catch (caught) {
    missingExeErr = caught;
  }
  expect(missingExeErr).toBeInstanceOf(AccountBrowserError);
  expect(missingExeErr.code).toBe("executable_missing");
  expect(missingExeErr.status).toBe(503);
  expect(missingExeErr.message).not.toContain(missingExe);
  expect(missingExeErr.message).not.toContain(root);
  expect(missingExeErr.message).not.toContain("private-dir");

  // 2. Every launcher failure code is translated to a fixed safe message without raw paths or credentials.
  const cases = [
    { rawCode: "executable_missing", expectedCode: "executable_missing", expectedStatus: 503 },
    { rawCode: "runtime_missing", expectedCode: "runtime_missing", expectedStatus: 503 },
    { rawCode: "launch_timeout", expectedCode: "launch_timeout", expectedStatus: 504 },
    { rawCode: "invalid_url", expectedCode: "invalid_url", expectedStatus: 400 },
    { rawCode: "launch_failed", expectedCode: "launch_failed", expectedStatus: 502 },
    { rawCode: "unexpected_internal_code", expectedCode: "launch_failed", expectedStatus: 502 },
  ];

  for (const item of cases) {
    const ctrl = createAccountBrowserController({
      env,
      resolveExecutable: async () => missingExe,
      launchBrowser: async () => {
        const err = new Error(
          `raw failure exe=${missingExe} profile=${profileDir} proxy=http://proxyuser:super-secret-pw@192.0.2.90:8080`,
        );
        err.code = item.rawCode;
        err.status = 500;
        throw err;
      },
    });
    let caught;
    try {
      await ctrl.open({ provider: "claude", key: "claude#a1" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AccountBrowserError);
    expect(caught.code).toBe(item.expectedCode);
    expect(caught.status).toBe(item.expectedStatus);
    for (const sensitive of [
      missingExe,
      profileDir,
      root,
      "proxyuser",
      "super-secret-pw",
      "raw failure",
    ]) {
      expect(caught.message).not.toContain(sensitive);
    }
    expect(ctrl.isOpen("claude", "claude#a1")).toBe(false);
  }

  // 3. A throwing resolveExecutable also maps cleanly to 503 executable_missing without leaking paths.
  const throwingExeCtrl = createAccountBrowserController({
    env,
    resolveExecutable: async () => {
      throw new Error(`stat failed for ${missingExe}`);
    },
    launchBrowser: makeFakeLauncher().launcher,
  });
  let throwingExeErr;
  try {
    await throwingExeCtrl.open({ provider: "claude", key: "claude#a1" });
  } catch (caught) {
    throwingExeErr = caught;
  }
  expect(throwingExeErr).toBeInstanceOf(AccountBrowserError);
  expect(throwingExeErr.code).toBe("executable_missing");
  expect(throwingExeErr.status).toBe(503);
  expect(throwingExeErr.message).not.toContain(missingExe);
  expect(throwingExeErr.message).not.toContain(root);
});


