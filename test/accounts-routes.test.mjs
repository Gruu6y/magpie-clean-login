// The account identity routes. A temporary data directory holds the account
// layout and a temporary magpie config directory holds `plugin-auth.json`, so
// the real `readAccountMeta`/`removeAccountDir` run without touching the real
// ~/.config/magpie.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKEN_HEADER, startServer } from "../lib/server.mjs";
import { accountDir, readAccountMeta, writeAccountMeta } from "../lib/account-identity.mjs";
import { offView } from "../lib/renew-hosting.mjs";
import { writeAccountProxies } from "../lib/account-proxies.mjs";

const tmp = mkdtempSync(join(tmpdir(), "clean-login-accounts-routes-"));
const dataDir = join(tmp, "data");
const configDir = join(tmp, "magpie-config");
let service;
let token;

const signedInDir = accountDir({ MAGPIE_CLEAN_LOGIN_DATA: dataDir }, "workbuddy", "workbuddy");
const retiredDir = accountDir({ MAGPIE_CLEAN_LOGIN_DATA: dataDir }, "workbuddy", "workbuddy#ab12");

beforeAll(async () => {
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "plugin-auth.json"),
    JSON.stringify({ workbuddy: { type: "oauth", access: "SECRET", accountId: "signed-in" } }),
  );
  await writeAccountMeta(signedInDir, {
    version: 1,
    provider: "workbuddy",
    key: "workbuddy",
    accountId: "signed-in",
    uid: "u-1",
    signedInAt: "2026-11-03T10:00:00.000Z",
  });
  await writeAccountMeta(retiredDir, {
    version: 1,
    provider: "workbuddy",
    key: "workbuddy#ab12",
    accountId: "retired",
    uid: "u-2",
    signedInAt: "2026-11-02T09:00:00.000Z",
  });
  // A directory with no ledger must never show up in the account list.
  await mkdir(accountDir({ MAGPIE_CLEAN_LOGIN_DATA: dataDir }, "workbuddy", "workbuddy#no-ledger"), {
    recursive: true,
  });

  service = await startServer({
    port: 0,
    env: {
      ...process.env,
      MAGPIE_CONFIG_DIR: configDir,
      MAGPIE_CLEAN_LOGIN_DATA: dataDir,
    },
    dataDir,
    pluginScanner: {
      get: () => ({ available: false, providers: [], scanned: false, stale: false, scanning: false, error: null }),
      warm: () => {},
    },
  });
  await service.prune();
  const html = await (await fetch(`http://127.0.0.1:${service.port}/`)).text();
  token = /name="clean-login-token" content="([0-9a-f]+)"/.exec(html)?.[1];
});

afterAll(async () => {
  await service?.close();
  rmSync(tmp, { recursive: true, force: true });
});

function api(method, path, { withToken = true } = {}) {
  const headers = withToken ? { [TOKEN_HEADER]: token } : {};
  return fetch(`http://127.0.0.1:${service.port}${path}`, { method, headers });
}

test("GET /api/accounts lists the ledger fields and the signed-in flag", async () => {
  const res = await api("GET", "/api/accounts");
  expect(res.status).toBe(200);
  const body = await res.json();
  // No identity.json was written for these accounts, so the fingerprint
  // summary is honestly empty rather than invented.
  const extras = {
    note: "",
    lastLogin: null,
    exit: null,
    loginHistory: [],
    lastCheck: null,
    checks: [],
    fingerprint: { id: null, pinnedAt: null },
  };
  expect(body.accounts).toEqual([
    {
      provider: "workbuddy",
      key: "workbuddy",
      accountId: "signed-in",
      uid: "u-1",
      signedInAt: "2026-11-03T10:00:00.000Z",
      signedIn: true,
      ...extras,
      hosting: offView("workbuddy", "workbuddy"),
    },
    {
      provider: "workbuddy",
      key: "workbuddy#ab12",
      accountId: "retired",
      uid: "u-2",
      signedInAt: "2026-11-02T09:00:00.000Z",
      signedIn: false,
      ...extras,
      hosting: offView("workbuddy", "workbuddy#ab12"),
    },
  ]);
  // No path and no credential in the response.
  const text = JSON.stringify(body);
  expect(text).not.toContain(tmp);
  expect(text).not.toContain("SECRET");
});

test("GET /api/accounts whitelists optional ledger fields", async () => {
  await writeAccountMeta(signedInDir, {
    version: 1,
    provider: "workbuddy",
    key: "workbuddy",
    accountId: "signed-in",
    uid: "u-1",
    signedInAt: "2026-11-03T10:00:00.000Z",
    note: "a note",
    lastLogin: { at: "2026-11-03T10:00:00.000Z", proxyId: "p-1", proxyName: "HK", region: "香港", type: "socks5", password: "secret-pass", host: "10.0.0.1", port: 1080 },
    loginHistory: [{ at: "2026-11-03T09:00:00.000Z", proxyId: null, proxyName: "", region: "", type: null }],
    checks: [{ at: "2026-11-03T08:00:00.000Z", grade: "B", proxyId: "p-1", proxyName: "HK", region: "香港", exposure: 2, summary: ["one"], password: "secret-pass", dir: "/secret/path" }],
  });
  const res = await api("GET", "/api/accounts");
  const account = (await res.json()).accounts.find((a) => a.key === "workbuddy");
  expect(account.note).toBe("a note");
  expect(account.lastLogin).toEqual({
    at: "2026-11-03T10:00:00.000Z",
    proxyId: "p-1",
    proxyName: "HK",
    region: "香港",
    type: "socks5",
  });
  expect(account.loginHistory).toHaveLength(1);
  expect(account.lastCheck).toEqual({
    at: "2026-11-03T08:00:00.000Z",
    grade: "B",
    proxyId: "p-1",
    proxyName: "HK",
    region: "香港",
    exposure: 2,
    summary: ["one"],
  });
  expect(account.checks).toHaveLength(1);
  expect(JSON.stringify(account)).not.toContain("secret-pass");
  expect(JSON.stringify(account)).not.toContain("/secret/path");
});

test("PATCH /api/accounts saves a note and keeps the rest of the ledger", async () => {
  await writeAccountMeta(signedInDir, {
    version: 1,
    provider: "workbuddy",
    key: "workbuddy",
    accountId: "signed-in",
    uid: "u-1",
    signedInAt: "2026-11-03T10:00:00.000Z",
    checks: [{ at: "2026-11-03T08:00:00.000Z", grade: "A", proxyId: null, proxyName: "", region: "", exposure: 0, summary: [] }],
    loginHistory: [],
  });
  const res = await fetch(`http://127.0.0.1:${service.port}/api/accounts/workbuddy/workbuddy`, {
    method: "PATCH",
    headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
    body: JSON.stringify({ note: "  saved note  " }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.account.note).toBe("saved note");
  expect(body.account.provider).toBe("workbuddy");
  expect(body.account.key).toBe("workbuddy");
  expect(body.account.lastCheck.grade).toBe("A");
  expect(body.account.fingerprint.id).toBeNull();
  const meta = await readAccountMeta(signedInDir);
  expect(meta.note).toBe("saved note");
  expect(meta.checks).toHaveLength(1);
  expect(JSON.stringify(body)).not.toContain(tmp);
  expect(JSON.stringify(body)).not.toContain("SECRET");
});

test("PATCH /api/accounts rejects an invalid note and an unknown account", async () => {
  const patch = (path, body) =>
    fetch(`http://127.0.0.1:${service.port}${path}`, {
      method: "PATCH",
      headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const overlong = await patch("/api/accounts/workbuddy/workbuddy", { note: "n".repeat(201) });
  expect(overlong.status).toBe(400);
  expect((await overlong.json()).error).toBe("invalid_note");
  const nonString = await patch("/api/accounts/workbuddy/workbuddy", { note: 7 });
  expect(nonString.status).toBe(400);
  expect((await nonString.json()).error).toBe("invalid_note");
  const unknown = await patch("/api/accounts/workbuddy/workbuddy%23unknown", { note: "x" });
  expect(unknown.status).toBe(404);
  expect((await unknown.json()).error).toBe("not_found");
});

test("GET /api/accounts requires the page token", async () => {
  const res = await api("GET", "/api/accounts", { withToken: false });
  expect(res.status).toBe(403);
});

test("GET /api/accounts rejects another method", async () => {
  const res = await api("POST", "/api/accounts");
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("GET");
});

test("DELETE refuses a signed-in account with 409 and keeps its directory", async () => {
  const res = await api("DELETE", "/api/accounts/workbuddy/workbuddy");
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    error: "signed_in",
    message: "This account is still signed in; sign out first.",
  });
  expect(existsSync(signedInDir)).toBe(true);
  expect(await readAccountMeta(signedInDir)).toBeTruthy();
});

test("DELETE removes a signed-out identity and its ledger", async () => {
  const res = await api("DELETE", "/api/accounts/workbuddy/workbuddy%23ab12");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(existsSync(retiredDir)).toBe(false);
});

test("DELETE on a directory without a ledger is a 404", async () => {
  const res = await api("DELETE", "/api/accounts/workbuddy/workbuddy%23no-ledger");
  expect(res.status).toBe(404);
  expect((await res.json()).error).toBe("not_found");
});

test("DELETE on an unknown account is a 404", async () => {
  const res = await api("DELETE", "/api/accounts/workbuddy/workbuddy%23unknown");
  expect(res.status).toBe(404);
});

test("DELETE rejects another method", async () => {
  const res = await api("GET", "/api/accounts/workbuddy/workbuddy");
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("DELETE");
});

// With no readable key set the service cannot tell a signed-in account from a
// signed-out one, so it reports the flag it can prove (false) and refuses the
// delete rather than risk a live credential's pin.
test("an unreadable auth file reports signedIn=false and refuses the delete", async () => {
  await writeFile(join(configDir, "plugin-auth.json"), "{ not json");
  const list = await api("GET", "/api/accounts");
  expect(list.status).toBe(200);
  const body = await list.json();
  expect(body.accounts.length).toBeGreaterThan(0);
  expect(body.accounts.every((account) => account.signedIn === false)).toBe(true);

  const res = await api("DELETE", "/api/accounts/workbuddy/workbuddy");
  expect(res.status).toBe(503);
  expect((await res.json()).error).toBe("auth_unreadable");
  expect(existsSync(signedInDir)).toBe(true);
});

test("GET /api/accounts/hosting returns the overall snapshot", async () => {
  const res = await api("GET", "/api/accounts/hosting");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.accounts)).toBe(true);
  expect(body.running).toBeNull();
});

test("GET /api/accounts/:provider/:key/hosting inspects eligibility and reports reasons", async () => {
  const res = await api("GET", "/api/accounts/workbuddy/workbuddy/hosting");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.hosting.provider).toBe("workbuddy");
  expect(body.hosting.enabled).toBe(false);
  expect(body.eligible).toBe(false);
  // An account with no expiry or unreadable auth reports why honestly.
  expect(typeof body.reason?.code).toBe("string");
});

test("POST /api/accounts/:provider/:key/hosting rejects missing enabled field", async () => {
  const res = await fetch(`http://127.0.0.1:${service.port}/api/accounts/workbuddy/workbuddy/hosting`, {
    method: "POST",
    headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
    body: JSON.stringify({ notEnabled: true }),
  });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("invalid_body");
});

// --- Account exit routes ---------------------------------------------------
// The exit dialog reads and writes the account's fixed exit in magpie's
// providers.json. Everything is seeded into the same temporary directories;
// the real ~/.config/magpie is never touched. The imports below are hoisted by
// ESM, so the existing cases above stay byte-for-byte unchanged.
import { describe } from "bun:test";
import { readFile } from "node:fs/promises";

describe("account exit routes", () => {
  const env = { MAGPIE_CLEAN_LOGIN_DATA: dataDir };
  const alphaDir = accountDir(env, "workbuddy", "workbuddy#alpha");
  const betaDir = accountDir(env, "workbuddy", "workbuddy#beta");
  const gammaDir = accountDir(env, "workbuddy", "workbuddy#gamma");
  const nativeDir = accountDir(env, "antigravity", "antigravity#rec1");
  const providersPath = join(configDir, "providers.json");
  const alphaPath = "/api/accounts/workbuddy/workbuddy%23alpha/exit";
  const betaPath = "/api/accounts/workbuddy/workbuddy%23beta/exit";
  const gammaPath = "/api/accounts/workbuddy/workbuddy%23gamma/exit";
  const nativePath = "/api/accounts/antigravity/antigravity%23rec1/exit";
  // `provider.proxy` may carry credentials just like a custom exit (magpie's
  // own editor accepts a URL with user:password), so the seeded value does.
  const providerProxy = `http://${encodeURIComponent("prov user")}:${encodeURIComponent("prov pass")}@provider-exit.example:8080`;
  const otherEntry = "http://other-exit.example:9000";
  // The route hands the page only the credential-free origin of any exit URL.
  const originOf = (value) => {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  };
  const providerProxyDisplay = originOf(providerProxy);
  // The URL magpie must hold for the chosen exit, credentials included.
  const customUrl = `http://${encodeURIComponent("u ser")}:${encodeURIComponent("p@ss:word")}@198.51.100.7:8080`;
  let proxyId;
  const customUrlDisplay = originOf(customUrl);
  // An exit magpie holds that no stored node produces any more (node deleted,
  // or the entry edited by hand): credentials included, still never echoed.
  const orphanUrl = `http://${encodeURIComponent("legacy user")}:${encodeURIComponent("legacy pass")}@203.0.113.44:3128`;
  const orphanUrlDisplay = originOf(orphanUrl);

  const patchExit = (path, body) =>
    fetch(`http://127.0.0.1:${service.port}${path}`, {
      method: "PATCH",
      headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const readProviders = async () => JSON.parse(await readFile(providersPath, "utf8"));
  const workbuddyEntry = (doc) => doc.providers.find((item) => item.id === "workbuddy");

  beforeAll(async () => {
    // The unreadable-auth case above left plugin-auth.json malformed; restore
    // a valid ledger and add the email-only entry the fallback case needs.
    await writeFile(
      join(configDir, "plugin-auth.json"),
      JSON.stringify({
        workbuddy: { type: "oauth", access: "SECRET", accountId: "signed-in" },
        "workbuddy#beta": { type: "oauth", access: "SECRET-BETA", email: "Beta@Example.com" },
      }),
    );
    // A native login supplies the third fallback's user name.
    await writeFile(
      join(configDir, "logins.json"),
      JSON.stringify([
        { agent: "antigravity", id: "rec1", user: "Delta@Example.com", auth: { access_token: "NATIVE-SECRET" } },
      ]),
    );
    await writeFile(
      providersPath,
      JSON.stringify({
        providers: [
          {
            id: "workbuddy",
            name: "WorkBuddy",
            proxy: providerProxy,
            accountProxies: { "other-user": otherEntry },
          },
          { id: "antigravity", name: "Antigravity" },
        ],
      }),
    );
    await writeAccountMeta(alphaDir, {
      version: 1,
      provider: "workbuddy",
      key: "workbuddy#alpha",
      accountId: "Alpha@Example.com",
      uid: "u-alpha",
      signedInAt: "2026-11-03T10:00:00.000Z",
    });
    await writeAccountMeta(betaDir, {
      version: 1,
      provider: "workbuddy",
      key: "workbuddy#beta",
      uid: "u-beta",
      signedInAt: "2026-11-03T10:00:00.000Z",
    });
    await writeAccountMeta(gammaDir, {
      version: 1,
      provider: "workbuddy",
      key: "workbuddy#gamma",
      uid: "u-gamma",
      signedInAt: "2026-11-03T10:00:00.000Z",
    });
    await writeAccountMeta(nativeDir, {
      version: 1,
      provider: "antigravity",
      key: "antigravity#rec1",
      uid: "u-native",
      signedInAt: "2026-11-03T10:00:00.000Z",
    });
    const res = await fetch(`http://127.0.0.1:${service.port}/api/proxies`, {
      method: "POST",
      headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Exit A",
        type: "http",
        host: "198.51.100.7",
        port: 8080,
        username: "u ser",
        password: "p@ss:word",
      }),
    });
    expect(res.status).toBe(201);
    proxyId = (await res.json()).proxy.id;
  });

  test("GET exit reports inherit and the provider proxy when no mapping exists", async () => {
    const res = await api("GET", alphaPath);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.exit).toEqual({
      ok: true,
      mode: "inherit",
      displayUrl: null,
      key: "alpha@example.com",
      providerProxy: providerProxyDisplay,
      proxyId: null,
    });
    expect(JSON.stringify(body)).not.toContain(tmp);
  });

  test("PATCH exit custom stores the credential URL for this account only", async () => {
    const metaBefore = await readAccountMeta(alphaDir);
    // A client-supplied URL must be ignored: the service computes the address
    // from the stored record alone.
    const res = await patchExit(alphaPath, {
      mode: "custom",
      proxyId,
      url: "http://client-supplied.example:1",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.account?.exit).toEqual({
      at: expect.any(String),
      proxyId,
      proxyName: "Exit A",
      region: "",
      type: "http",
    });
    expect(body.exit.mode).toBe("custom");
    // The stored URL carries the exit's credentials; the response never does.
    expect(body.exit.url).toBeUndefined();
    expect(body.exit.displayUrl).toBe(customUrlDisplay);
    expect(body.exit.proxyId).toBe(proxyId);
    expect(JSON.stringify(body)).not.toContain(customUrl);
    expect(JSON.stringify(body)).not.toContain(
      customUrl.slice(customUrl.indexOf("//") + 2, customUrl.lastIndexOf("@")),
    );
    const entry = workbuddyEntry(await readProviders());
    expect(entry.accountProxies["alpha@example.com"]).toBe(customUrl);
    expect(entry.accountProxies["other-user"]).toBe(otherEntry);
    expect(entry.proxy).toBe(providerProxy);
    // The route mirrors the change into the plugin's own ledger as this
    // account's current exit; every other ledger field is left untouched.
    const afterExit = await readAccountMeta(alphaDir);
    expect(afterExit.exit).toEqual({
      at: expect.any(String),
      proxyId,
      proxyName: "Exit A",
      region: "",
      type: "http",
    });
    const { exit: mirroredExit, ...ledgerRest } = afterExit;
    expect(mirroredExit).toBeTruthy();
    expect(ledgerRest).toEqual(metaBefore);
  });

  test("GET exit reverse-maps the stored URL back to the proxy id", async () => {
    const res = await api("GET", alphaPath);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exit).toEqual({
      ok: true,
      mode: "custom",
      displayUrl: customUrlDisplay,
      key: "alpha@example.com",
      providerProxy: providerProxyDisplay,
      proxyId,
    });
    expect(JSON.stringify(body)).not.toContain(customUrl);
  });

  test("GET exit redacts a custom URL the node list no longer knows", async () => {
    // magpie can hold an exit this page cannot name: a node since deleted, or
    // an entry edited by hand. It is shown, but without its credentials.
    const doc = await readProviders();
    workbuddyEntry(doc).accountProxies["alpha@example.com"] = orphanUrl;
    await writeFile(providersPath, `${JSON.stringify(doc, null, 2)}\n`);
    const res = await api("GET", alphaPath);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exit.mode).toBe("custom");
    expect(body.exit.url).toBeUndefined();
    expect(body.exit.displayUrl).toBe(orphanUrlDisplay);
    expect(body.exit.proxyId).toBeNull();
    expect(JSON.stringify(body)).not.toContain(orphanUrl);
  });

  test("PATCH exit direct stores the literal direct marker", async () => {
    const res = await patchExit(alphaPath, { mode: "direct" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exit.mode).toBe("direct");
    expect(body.exit.proxyId).toBeNull();
    const entry = workbuddyEntry(await readProviders());
    expect(entry.accountProxies["alpha@example.com"]).toBe("direct");
    expect(entry.accountProxies["other-user"]).toBe(otherEntry);
  });

  test("PATCH exit inherit removes only this account's entry", async () => {
    const res = await patchExit(alphaPath, { mode: "inherit" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exit.mode).toBe("inherit");
    expect(body.exit.displayUrl).toBeNull();
    expect(body.exit.proxyId).toBeNull();
    const entry = workbuddyEntry(await readProviders());
    expect(Object.hasOwn(entry.accountProxies, "alpha@example.com")).toBe(false);
    expect(entry.accountProxies["other-user"]).toBe(otherEntry);
    expect(entry.proxy).toBe(providerProxy);
  });

  test("PATCH exit validates the mode and the selected proxy", async () => {
    const badMode = await patchExit(alphaPath, { mode: "bogus" });
    expect(badMode.status).toBe(400);
    expect((await badMode.json()).error).toBe("invalid_mode");
    const noMode = await patchExit(alphaPath, {});
    expect(noMode.status).toBe(400);
    expect((await noMode.json()).error).toBe("invalid_mode");
    const noProxy = await patchExit(alphaPath, { mode: "custom" });
    expect(noProxy.status).toBe(400);
    expect((await noProxy.json()).error).toBe("invalid_proxy");
    const badProxyType = await patchExit(alphaPath, { mode: "custom", proxyId: 42 });
    expect(badProxyType.status).toBe(400);
    expect((await badProxyType.json()).error).toBe("invalid_proxy");
    const unknownProxy = await patchExit(alphaPath, { mode: "custom", proxyId: "no-such-proxy" });
    expect(unknownProxy.status).toBe(404);
    expect((await unknownProxy.json()).error).toBe("not_found");
    const badPath = await api("GET", "/api/accounts/workbuddy/%E0%A4%A/exit");
    expect(badPath.status).toBe(400);
    expect((await badPath.json()).error).toBe("invalid_account");
  });

  test("exit routes answer 404 for an unknown account", async () => {
    const get = await api("GET", "/api/accounts/workbuddy/workbuddy%23missing/exit");
    expect(get.status).toBe(404);
    expect((await get.json()).error).toBe("not_found");
    const patch = await patchExit("/api/accounts/workbuddy/workbuddy%23missing/exit", { mode: "direct" });
    expect(patch.status).toBe(404);
    expect((await patch.json()).error).toBe("not_found");
  });

  test("exit routes require the page token", async () => {
    const get = await api("GET", alphaPath, { withToken: false });
    expect(get.status).toBe(403);
    const patch = await fetch(`http://127.0.0.1:${service.port}${alphaPath}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "direct" }),
    });
    expect(patch.status).toBe(403);
  });

  test("PATCH exit falls back to the auth file email when the ledger has no accountId", async () => {
    const res = await patchExit(betaPath, { mode: "direct" });
    expect(res.status).toBe(200);
    expect((await res.json()).exit.key).toBe("beta@example.com");
    expect(workbuddyEntry(await readProviders()).accountProxies["beta@example.com"]).toBe("direct");
    // Leave the map as it was for the assertions that follow.
    const back = await patchExit(betaPath, { mode: "inherit" });
    expect(back.status).toBe(200);
  });

  test("PATCH exit falls back to the native login email", async () => {
    const res = await patchExit(nativePath, { mode: "direct" });
    expect(res.status).toBe(200);
    expect((await res.json()).exit.key).toBe("delta@example.com");
    const doc = await readProviders();
    const entry = doc.providers.find((item) => item.id === "antigravity");
    expect(entry.accountProxies["delta@example.com"]).toBe("direct");
    const back = await patchExit(nativePath, { mode: "inherit" });
    expect(back.status).toBe(200);
  });

  test("PATCH exit without any user name is a 409 and leaves providers.json untouched", async () => {
    // With logins.json gone the fallback chain must still end at an empty
    // name, not a crash: the lib reports account_name_unknown.
    rmSync(join(configDir, "logins.json"), { force: true });
    const before = await readFile(providersPath, "utf8");
    const res = await patchExit(gammaPath, { mode: "direct" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("account_name_unknown");
    expect(await readFile(providersPath, "utf8")).toBe(before);
  });

  test("GET exit reports an unknown account name instead of failing", async () => {
    const res = await api("GET", gammaPath);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.exit).toEqual({ ok: false, reason: "account_name_unknown", key: "", proxyId: null });
  });

  test("GET exit reports a missing providers.json without leaking paths", async () => {
    const text = await readFile(providersPath, "utf8");
    rmSync(providersPath);
    try {
      const res = await api("GET", alphaPath);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.exit.ok).toBe(false);
      expect(body.exit.reason).toBe("providers_missing");
      expect(body.exit.key).toBe("alpha@example.com");
      expect(body.exit.proxyId).toBeNull();
      expect(JSON.stringify(body)).not.toContain(tmp);
    } finally {
      await writeFile(providersPath, text);
    }
  });

  test("exit routes reject another method", async () => {
    const res = await api("DELETE", alphaPath);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, PATCH");
  });

  test("PATCH exit mirrors the current exit into the ledger and the accounts view", async () => {
    // The plugin's own ledger keeps "the exit this account is set to use",
    // separate from the lastLogin history. Seed one so the mirror is proven
    // not to rewrite the historical record.
    const seeded = await readAccountMeta(alphaDir);
    const historicLogin = {
      at: "2026-11-03T10:00:00.000Z",
      proxyId: "px-historic",
      proxyName: "Old exit",
      region: "US",
      type: "http",
    };
    await writeAccountMeta(alphaDir, {
      ...seeded,
      lastLogin: historicLogin,
      loginHistory: [historicLogin],
    });

    const custom = await patchExit(alphaPath, { mode: "custom", proxyId });
    expect(custom.status).toBe(200);
    const customMeta = await readAccountMeta(alphaDir);
    expect(customMeta.exit).toEqual({
      at: expect.any(String),
      proxyId,
      proxyName: "Exit A",
      region: "",
      type: "http",
    });
    // The exit change never rewrites the sign-in that actually happened.
    expect(customMeta.lastLogin).toEqual(historicLogin);
    expect(customMeta.loginHistory).toEqual([historicLogin]);

    const afterCustom = (await (await api("GET", "/api/accounts")).json()).accounts.find(
      (a) => a.key === "workbuddy#alpha",
    );
    expect(afterCustom.exit).toEqual(customMeta.exit);

    const direct = await patchExit(alphaPath, { mode: "direct" });
    expect(direct.status).toBe(200);
    const directMeta = await readAccountMeta(alphaDir);
    expect(directMeta.exit).toEqual({
      at: expect.any(String),
      proxyId: null,
      proxyName: "",
      region: "",
      type: null,
    });
    const afterDirect = (await (await api("GET", "/api/accounts")).json()).accounts.find(
      (a) => a.key === "workbuddy#alpha",
    );
    expect(afterDirect.exit).toEqual(directMeta.exit);

    const inherit = await patchExit(alphaPath, { mode: "inherit" });
    expect(inherit.status).toBe(200);
    expect((await readAccountMeta(alphaDir)).exit).toBeNull();
    const afterInherit = (await (await api("GET", "/api/accounts")).json()).accounts.find(
      (a) => a.key === "workbuddy#alpha",
    );
    expect(afterInherit.exit).toBeNull();
  });

  test("GET /api/accounts projects a providers.json custom exit when the ledger has no exit", async () => {
    // A legacy account (e.g. antigravity) may be bound to a custom exit in
    // magpie's providers.json while its own ledger never recorded an exit or a
    // login, so the front end cannot see which node it occupies. The list
    // must project the stored node, but only through the credential-free
    // whitelist; the URL text itself may never appear.
    const legacyDir = accountDir(env, "workbuddy", "workbuddy#legacy");
    await writeAccountMeta(legacyDir, {
      version: 1,
      provider: "workbuddy",
      key: "workbuddy#legacy",
      accountId: "Legacy@Example.com",
      uid: "u-legacy",
      signedInAt: "2026-11-03T10:00:00.000Z",
    });
    const written = await writeAccountProxies({
      env: { ...env, MAGPIE_CONFIG_DIR: configDir },
      entries: [{ provider: "workbuddy", accountId: "Legacy@Example.com", url: customUrl }],
    });
    expect(written.ok).toBe(true);
    expect(written.changed).toHaveLength(1);

    const res = await api("GET", "/api/accounts");
    expect(res.status).toBe(200);
    const body = await res.json();
    const account = body.accounts.find((a) => a.key === "workbuddy#legacy");
    // The ledger has no exit, so this is the fallback projection of the node
    // bound in providers.json: same id and name as the stored record, no time.
    expect(account.exit).toEqual({
      at: null,
      proxyId,
      proxyName: "Exit A",
      region: "",
      type: "http",
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain(customUrl);
    // The authority (user:password@host) never leaves the service either.
    expect(text).not.toContain(
      customUrl.slice(customUrl.indexOf("//") + 2, customUrl.lastIndexOf("@")),
    );
  });
});
