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
    browser: { open: false, openedAt: null, exit: null, exitChanged: false },
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

test("dot-segment account keys stay inside the accounts root", async () => {
  // `..` survives into accountDir from sources other than the URL path (a
  // crafted plugin-auth entry reaches it through the import writer), so the
  // directory encoder itself must defuse it. A URL-carried `%2e%2e` is
  // normalized away before routing, which is fine too: it just 404s.
  const res = await api("DELETE", "/api/accounts/workbuddy/%2e%2e");
  expect([404, 405]).toContain(res.status);
  const providerDir = join(dataDir, "accounts", "workbuddy");
  expect(existsSync(join(providerDir, "workbuddy"))).toBe(true);
  expect(existsSync(providerDir)).toBe(true);
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

test("GET /api/accounts/:provider/:key/hosting is a 404 for an account with no ledger", async () => {
  // The neighbouring exit and delete routes already answer 404 for an
  // account the plugin never signed in; hosting must say the same, not a 200
  // that reads like a real-but-ineligible account.
  const res = await api("GET", "/api/accounts/workbuddy/workbuddy%23nope/hosting");
  expect(res.status).toBe(404);
  expect((await res.json()).error).toBe("not_found");
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
    // providers.json is SSOT: inherit projects the provider-level proxy
    // (redacted) so the list does not fall back to stale historicLogin and
    // never leaks credentials from workbuddy.proxy.
    expect(afterInherit.exit).toEqual({
      at: null,
      proxyId: null,
      proxyName: "",
      region: "",
      type: "http",
      mode: "inherit",
      custom: true,
      displayUrl: providerProxyDisplay,
    });
    expect(JSON.stringify(afterInherit)).not.toContain("puser");
    expect(JSON.stringify(afterInherit)).not.toContain("ppass");
  });

  test("magpie-side edits to providers.json override stale ledger meta.exit across accounts, exit, and agent routes without leaking credentials", async () => {
    // Create a second stored proxy so we can switch between two stored nodes.
    const secondRes = await fetch(`http://127.0.0.1:${service.port}/api/proxies`, {
      method: "POST",
      headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Exit B",
        region: "SG",
        type: "http",
        host: "198.51.100.8",
        port: 8081,
        username: "userB",
        password: "secretBPassword",
      }),
    });
    expect(secondRes.status).toBe(201);
    const proxyBId = (await secondRes.json()).proxy.id;
    const proxyBUrl = "http://userB:secretBPassword@198.51.100.8:8081";

    // First populate ledger meta.exit via clean-login PATCH /exit (pointing at Exit A).
    const initial = await patchExit(alphaPath, { mode: "custom", proxyId });
    expect(initial.status).toBe(200);
    expect((await readAccountMeta(alphaDir)).exit?.proxyId).toBe(proxyId);

    const mutateProviders = async (mutator) => {
      const doc = await readProviders();
      mutator(workbuddyEntry(doc));
      await writeFile(providersPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    };

    try {
      // 1. User switches account in magpie to Exit B -> stale meta.exit (Exit A) must NOT mask it.
      await mutateProviders((wb) => {
        wb.accountProxies = { ...(wb.accountProxies ?? {}), "alpha@example.com": proxyBUrl };
      });
      const accountsB = await (await api("GET", "/api/accounts")).json();
      const rowB = accountsB.accounts.find((a) => a.key === "workbuddy#alpha");
      expect(rowB.exit).toEqual({
        at: null,
        proxyId: proxyBId,
        proxyName: "Exit B",
        region: "",
        type: "http",
      });
      const exitB = await (await api("GET", alphaPath)).json();
      expect(exitB.exit.mode).toBe("custom");
      expect(exitB.exit.proxyId).toBe(proxyBId);
      const agentB = await (await api("GET", "/api/agent")).json();
      const agentRowB = agentB.state.accounts.find((a) => a.key === "workbuddy#alpha");
      expect(agentRowB.exit).toEqual({
        mode: "custom",
        proxyId: proxyBId,
        proxyName: "Exit B",
        region: "",
        type: "http",
      });
      for (const payload of [accountsB, exitB, agentB]) {
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain("userB");
        expect(serialized).not.toContain("secretBPassword");
        expect(serialized).not.toContain(proxyBUrl);
      }

      // 2. User switches account in magpie to an external URL not in proxies.json ->
      //    MUST project as custom exit + redacted displayUrl, NEVER as Direct, and NEVER leak credentials.
      const extUrl = "socks5://extUserName:extSuperSecret@203.0.113.44:1080";
      await mutateProviders((wb) => {
        wb.accountProxies["alpha@example.com"] = extUrl;
      });
      const accountsExt = await (await api("GET", "/api/accounts")).json();
      const rowExt = accountsExt.accounts.find((a) => a.key === "workbuddy#alpha");
      expect(rowExt.exit).toEqual({
        at: null,
        proxyId: null,
        proxyName: "",
        region: "",
        type: "socks5",
        custom: true,
        displayUrl: "socks5://203.0.113.44:1080",
      });
      const exitExt = await (await api("GET", alphaPath)).json();
      expect(exitExt.exit).toMatchObject({
        ok: true,
        mode: "custom",
        proxyId: null,
        displayUrl: "socks5://203.0.113.44:1080",
      });
      const agentExt = await (await api("GET", "/api/agent")).json();
      const agentRowExt = agentExt.state.accounts.find((a) => a.key === "workbuddy#alpha");
      expect(agentRowExt.exit).toEqual({
        mode: "custom",
        proxyId: null,
        proxyName: "",
        region: "",
        type: "socks5",
        custom: true,
        displayUrl: "socks5://203.0.113.44:1080",
      });
      for (const payload of [accountsExt, exitExt, agentExt]) {
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain("extUserName");
        expect(serialized).not.toContain("extSuperSecret");
        expect(serialized).not.toContain(extUrl);
      }

      // 3. User switches account in magpie to "direct" -> immediately releases stored proxy.
      await mutateProviders((wb) => {
        wb.accountProxies["alpha@example.com"] = "direct";
      });
      const rowDirect = (await (await api("GET", "/api/accounts")).json()).accounts.find(
        (a) => a.key === "workbuddy#alpha",
      );
      expect(rowDirect.exit).toEqual({
        at: null,
        proxyId: null,
        proxyName: "",
        region: "",
        type: null,
      });

      // 4. User switches account in magpie to inherit (deletes key) with provider.proxy ->
      //    projects inherit with redacted providerProxyDisplay, zero credentials.
      await mutateProviders((wb) => {
        delete wb.accountProxies["alpha@example.com"];
      });
      const accountsInherit = await (await api("GET", "/api/accounts")).json();
      const rowInherit = accountsInherit.accounts.find((a) => a.key === "workbuddy#alpha");
      expect(rowInherit.exit).toEqual({
        at: null,
        proxyId: null,
        proxyName: "",
        region: "",
        type: "http",
        mode: "inherit",
        custom: true,
        displayUrl: providerProxyDisplay,
      });
      expect(JSON.stringify(accountsInherit)).not.toContain("puser");
      expect(JSON.stringify(accountsInherit)).not.toContain("ppass");

      // 5. Provider proxy cleared -> inherit resolves to direct (proxyId: null) and still overrides stale meta.exit.
      await mutateProviders((wb) => {
        wb.proxy = "";
      });
      const rowInheritDirect = (await (await api("GET", "/api/accounts")).json()).accounts.find(
        (a) => a.key === "workbuddy#alpha",
      );
      expect(rowInheritDirect.exit).toEqual({
        at: null,
        proxyId: null,
        proxyName: "",
        region: "",
        type: null,
        mode: "inherit",
      });
    } finally {
      await mutateProviders((wb) => {
        wb.proxy = providerProxy;
        delete wb.accountProxies?.["alpha@example.com"];
      });
      await fetch(`http://127.0.0.1:${service.port}/api/proxies/${proxyBId}`, {
        method: "DELETE",
        headers: { [TOKEN_HEADER]: token },
      });
    }
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

  test("GET /api/accounts projects email, methodLabel and expiresAt without secrets and DELETE clears hosting and proxy sync", async () => {
    const isoRoot = mkdtempSync(join(tmpdir(), "clean-login-accounts-iso-"));
    const isoConfig = join(isoRoot, "magpie-config");
    const isoData = join(isoRoot, "data");
    const removed = [];
    const cleared = [];
    let isoService;
    try {
      await mkdir(isoConfig, { recursive: true });
      const expiresAt = Date.UTC(2026, 11, 1);
      await writeFile(
        join(isoConfig, "plugin-auth.json"),
        JSON.stringify({
          "workbuddy#rich": {
            type: "oauth",
            access: "TOK_SECRET_VALUE",
            refresh: "REF_SECRET_VALUE",
            accountId: "rich-acct",
            expires: expiresAt,
          },
        }),
      );
      await writeAccountMeta(accountDir({ MAGPIE_CLEAN_LOGIN_DATA: isoData }, "workbuddy", "workbuddy#rich"), {
        version: 1,
        provider: "workbuddy",
        key: "workbuddy#rich",
        accountId: "rich-acct",
        uid: "u-rich",
        email: "rich@example.com",
        methodLabel: "OAuth",
        signedInAt: "2026-11-04T10:00:00.000Z",
      });
      await writeAccountMeta(accountDir({ MAGPIE_CLEAN_LOGIN_DATA: isoData }, "workbuddy", "workbuddy#retired"), {
        version: 1,
        provider: "workbuddy",
        key: "workbuddy#retired",
        accountId: "retired-acct",
        uid: "u-retired",
        signedInAt: "2026-11-01T10:00:00.000Z",
      });
      isoService = await startServer({
        port: 0,
        env: {
          ...process.env,
          NODE_ENV: "test",
          MAGPIE_CONFIG_DIR: isoConfig,
          MAGPIE_CLEAN_LOGIN_DATA: isoData,
        },
        dataDir: isoData,
        pluginScanner: {
          get: () => ({ available: false, providers: [], scanned: false, stale: false, scanning: false, error: null }),
          warm: () => {},
        },
        renewHosting: {
          start: () => {},
          stop: () => {},
          cancel: async () => ({}),
          viewOf: (p, k) => offView(p, k),
          snapshot: async () => ({ accounts: [] }),
          running: () => null,
          removeAccount: async (provider, key) => {
            removed.push({ provider, key });
          },
        },
        accountProxySync: {
          backfill: async () => ({ changed: [] }),
          syncSignIn: async () => ({}),
          syncProxyUpdate: async () => ({}),
          clearAccountProxy: async (entry) => {
            cleared.push(entry);
          },
        },
      });
      const html = await (await fetch(`http://127.0.0.1:${isoService.port}/`)).text();
      const isoToken = /name="clean-login-token" content="([0-9a-f]+)"/.exec(html)?.[1];
      const res = await fetch(`http://127.0.0.1:${isoService.port}/api/accounts`, {
        headers: { [TOKEN_HEADER]: isoToken },
      });
      expect(res.status).toBe(200);
      const bodyText = await res.text();
      expect(bodyText).not.toContain("TOK_SECRET_VALUE");
      expect(bodyText).not.toContain("REF_SECRET_VALUE");
      const { accounts } = JSON.parse(bodyText);
      const rich = accounts.find((a) => a.key === "workbuddy#rich");
      expect(rich).toMatchObject({
        email: "rich@example.com",
        methodLabel: "OAuth",
        expiresAt,
      });
      const retired = accounts.find((a) => a.key === "workbuddy#retired");
      expect("email" in retired).toBe(false);
      expect("methodLabel" in retired).toBe(false);
      expect("expiresAt" in retired).toBe(false);

      const del = await fetch(`http://127.0.0.1:${isoService.port}/api/accounts/workbuddy/workbuddy%23retired`, {
        method: "DELETE",
        headers: { [TOKEN_HEADER]: isoToken },
      });
      expect(del.status).toBe(200);
      expect(await del.json()).toEqual({ ok: true });
      expect(removed).toEqual([{ provider: "workbuddy", key: "workbuddy#retired" }]);
      expect(cleared).toEqual([{ provider: "workbuddy", accountId: "retired-acct" }]);
    } finally {
      await isoService?.close();
      rmSync(isoRoot, { recursive: true, force: true });
    }
  });
});

describe("account browser routes and mutexes", () => {
  test("GET/POST/DELETE /api/accounts/:provider/:key/browser lifecycle, exitChanged, mutexes, credential boundary and closeAll", async () => {
    const isoRoot = mkdtempSync(join(tmpdir(), "clean-login-account-browser-routes-"));
    const isoConfig = join(isoRoot, "magpie-config");
    const isoData = join(isoRoot, "data");
    const isoEnv = {
      ...process.env,
      NODE_ENV: "test",
      MAGPIE_CONFIG_DIR: isoConfig,
      MAGPIE_CLEAN_LOGIN_DATA: isoData,
    };

    const launchCalls = [];
    const checkCalls = [];
    let isoService;

    try {
      await mkdir(isoConfig, { recursive: true });
      const expiresAt = Date.now() + 3600_000;
      await writeFile(
        join(isoConfig, "plugin-auth.json"),
        JSON.stringify({
          workbuddy: {
            type: "oauth",
            access: "ACCESS_SECRET_TOKEN",
            accountId: "alpha@example.com",
            expires: expiresAt,
          },
        }),
      );

      const alphaDir = accountDir(isoEnv, "workbuddy", "workbuddy");
      const retiredBrowserDir = accountDir(isoEnv, "workbuddy", "workbuddy#retired");
      const noPinDir = accountDir(isoEnv, "workbuddy", "workbuddy#nopin");

      await writeAccountMeta(alphaDir, {
        version: 1,
        provider: "workbuddy",
        key: "workbuddy",
        accountId: "alpha@example.com",
        uid: "u-alpha",
        signedInAt: "2026-11-03T10:00:00.000Z",
        lastLogin: { at: "2026-11-03T10:00:00.000Z", proxyId: null },
      });
      await writeFile(join(alphaDir, "identity.json"), JSON.stringify({ fingerprint: { os: "linux", seed: 1 } }));

      await writeAccountMeta(retiredBrowserDir, {
        version: 1,
        provider: "workbuddy",
        key: "workbuddy#retired",
        accountId: "retired@example.com",
        uid: "u-retired",
        signedInAt: "2026-11-02T10:00:00.000Z",
        lastLogin: { at: "2026-11-02T10:00:00.000Z", proxyId: null },
      });
      await writeFile(
        join(retiredBrowserDir, "identity.json"),
        JSON.stringify({ fingerprint: { os: "linux", seed: 2 } }),
      );

      await writeAccountMeta(noPinDir, {
        version: 1,
        provider: "workbuddy",
        key: "workbuddy#nopin",
        accountId: "nopin@example.com",
        uid: "u-nopin",
        signedInAt: "2026-11-01T10:00:00.000Z",
        lastLogin: { at: "2026-11-01T10:00:00.000Z", proxyId: null },
      });

      const fakeLauncher = async (opts) => {
        let resolveClosed;
        const closed = new Promise((resolve) => {
          resolveClosed = resolve;
        });
        let closedFlag = false;
        const call = { opts, closeCount: 0, resolveClosed };
        launchCalls.push(call);
        return {
          pid: 5000 + launchCalls.length,
          warning: null,
          closed,
          async close() {
            if (closedFlag) return;
            closedFlag = true;
            call.closeCount += 1;
            resolveClosed();
          },
        };
      };

      isoService = await startServer({
        port: 0,
        env: isoEnv,
        dataDir: isoData,
        pluginScanner: {
          get: () => ({ available: false, providers: [], scanned: false, stale: false, scanning: false, error: null }),
          warm: () => {},
        },
        environment: {
          status: async () => ({
            state: "ready",
            ready: true,
            installed: true,
            modelInstalled: true,
            executablePath: "/fake/camoufox-bin",
          }),
          job: () => null,
        },
        identityCheck: {
          status: () => ({ job: { provider: "", key: "", state: "idle" }, browserOpen: false }),
          async start(args) {
            checkCalls.push(args);
            return { provider: args.provider, key: args.key, state: "launching" };
          },
          async cancel() {
            return { cancelled: false, job: { state: "idle" } };
          },
          async close() {},
        },
        accountBrowserLauncher: fakeLauncher,
      });
      await isoService.prune();

      const html = await (await fetch(`http://127.0.0.1:${isoService.port}/`)).text();
      const isoToken = /name="clean-login-token" content="([0-9a-f]+)"/.exec(html)?.[1];
      const req = (method, path, body, { withToken = true } = {}) => {
        const headers = {};
        if (withToken) headers[TOKEN_HEADER] = isoToken;
        if (body !== undefined) headers["content-type"] = "application/json";
        return fetch(`http://127.0.0.1:${isoService.port}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      };

      // Create two credentialed stored proxies and bind alpha to Proxy A in providers.json.
      const createdA = await (
        await req("POST", "/api/proxies", {
          name: "BrowserExitA",
          type: "http",
          host: "198.51.100.51",
          port: 8080,
          username: "browserSecretUserA",
          password: "browserSecretPassA",
        })
      ).json();
      const createdB = await (
        await req("POST", "/api/proxies", {
          name: "BrowserExitB",
          type: "http",
          host: "198.51.100.52",
          port: 8081,
          username: "browserSecretUserB",
          password: "browserSecretPassB",
        })
      ).json();
      const proxyAId = createdA.proxy.id;
      const proxyBId = createdB.proxy.id;
      const rawUrlA = "http://browserSecretUserA:browserSecretPassA@198.51.100.51:8080";
      await writeFile(
        join(isoConfig, "providers.json"),
        `${JSON.stringify(
          {
            providers: [
              {
                id: "workbuddy",
                proxy: "",
                accountProxies: {
                  "alpha@example.com": rawUrlA,
                  "retired@example.com": "direct",
                },
              },
            ],
          },
          null,
          2,
        )}\n`,
      );

      // Token gate, 404, 405 checks.
      expect((await req("GET", "/api/accounts/workbuddy/workbuddy/browser", undefined, { withToken: false })).status).toBe(403);
      expect((await req("GET", "/api/accounts/workbuddy/missing/browser")).status).toBe(404);
      expect((await req("DELETE", "/api/accounts/workbuddy/missing/browser")).status).toBe(404);
      expect((await req("POST", "/api/accounts/workbuddy/missing/browser", {})).status).toBe(404);
      const wrongMethod = await req("PUT", "/api/accounts/workbuddy/workbuddy/browser", {});
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get("allow")).toBe("GET, POST, DELETE");

      // Missing pinned identity -> 409 identity_missing.
      const noPinOpen = await req("POST", "/api/accounts/workbuddy/workbuddy%23nopin/browser", {});
      expect(noPinOpen.status).toBe(409);
      expect((await noPinOpen.json()).error).toBe("identity_missing");

      // Invalid URL scheme -> 400 invalid_url.
      const badUrl = await req("POST", "/api/accounts/workbuddy/workbuddy/browser", {
        url: "javascript:alert(1)",
      });
      expect(badUrl.status).toBe(400);
      expect((await badUrl.json()).error).toBe("invalid_url");

      // Initial GET status -> closed.
      const beforeOpen = await req("GET", "/api/accounts/workbuddy/workbuddy/browser");
      expect(beforeOpen.status).toBe(200);
      expect(await beforeOpen.json()).toEqual({
        ok: true,
        browser: { open: false, openedAt: null, exit: null, exitChanged: false },
      });

      // POST open with empty body opens about:blank with pinned identity & Proxy A.
      const openedRes = await req("POST", "/api/accounts/workbuddy/workbuddy/browser");
      expect(openedRes.status).toBe(200);
      const openedBody = await openedRes.json();
      expect(openedBody.ok).toBe(true);
      expect(openedBody.browser.open).toBe(true);
      expect(openedBody.browser.exitChanged).toBe(false);
      expect(openedBody.browser.exit).toMatchObject({
        ok: true,
        mode: "custom",
        effectiveMode: "proxy",
        proxyId: proxyAId,
        proxyName: "BrowserExitA",
      });
      expect(launchCalls).toHaveLength(1);
      expect(launchCalls[0].opts.url).toBe("about:blank");
      expect(launchCalls[0].opts.purpose).toBe("account");
      expect(launchCalls[0].opts.headless).toBe(false);

      // Double-open -> 409 browser_already_open.
      const dupOpen = await req("POST", "/api/accounts/workbuddy/workbuddy/browser", {});
      expect(dupOpen.status).toBe(409);
      expect((await dupOpen.json()).error).toBe("browser_already_open");

      // GET /api/accounts includes browser state; /api/agent includes compact open browser only for open account.
      const accountsOpenBody = await (await req("GET", "/api/accounts")).json();
      const alphaRow = accountsOpenBody.accounts.find((a) => a.key === "workbuddy");
      const retiredRow = accountsOpenBody.accounts.find((a) => a.key === "workbuddy#retired");
      expect(alphaRow.browser.open).toBe(true);
      expect(alphaRow.browser.exitChanged).toBe(false);
      expect(retiredRow.browser).toEqual({ open: false, openedAt: null, exit: null, exitChanged: false });

      const agentOpenBody = await (await req("GET", "/api/agent")).json();
      const agentAlpha = agentOpenBody.state.accounts.find((a) => a.key === "workbuddy");
      const agentRetired = agentOpenBody.state.accounts.find((a) => a.key === "workbuddy#retired");
      expect(agentAlpha.browser).toEqual({
        open: true,
        openedAt: openedBody.browser.openedAt,
        exitChanged: false,
      });
      expect("browser" in agentRetired).toBe(false);

      // Concurrency mutexes while alpha's browser is open:
      // 1) POST /api/signin for alpha (continue & rotate & single) -> 409 browser_open.
      const signinContinue = await req("POST", "/api/signin", {
        provider: "workbuddy",
        account: { key: "workbuddy" },
      });
      expect(signinContinue.status).toBe(409);
      expect((await signinContinue.json()).error).toBe("browser_open");

      const signinRotate = await req("POST", "/api/signin", {
        provider: "workbuddy",
        account: { key: "workbuddy", rotate: true },
      });
      expect(signinRotate.status).toBe(409);
      expect((await signinRotate.json()).error).toBe("browser_open");

      const signinSingle = await req("POST", "/api/signin", {
        provider: "workbuddy",
        single: true,
      });
      expect(signinSingle.status).toBe(409);
      expect((await signinSingle.json()).error).toBe("browser_open");

      // 2) POST /api/accounts/workbuddy/workbuddy/hosting/run -> 409 browser_open.
      await isoService.renewHosting.enable("workbuddy", "workbuddy");
      const hostingRun = await req("POST", "/api/accounts/workbuddy/workbuddy/hosting/run", {});
      expect(hostingRun.status).toBe(409);
      expect((await hostingRun.json()).error).toBe("browser_open");

      // 3) POST /api/accounts/workbuddy/workbuddy/check is NOT blocked (uses check-profile/).
      const checkRes = await req("POST", "/api/accounts/workbuddy/workbuddy/check", {});
      expect(checkRes.status).toBe(202);
      expect(checkCalls).toHaveLength(1);

      // 4) PATCH /exit to Proxy B while browser is open -> immediately shows exitChanged: true!
      const patchedExitRes = await req("PATCH", "/api/accounts/workbuddy/workbuddy/exit", {
        mode: "custom",
        proxyId: proxyBId,
      });
      expect(patchedExitRes.status).toBe(200);
      const patchedExitBody = await patchedExitRes.json();
      expect(patchedExitBody.account.browser.open).toBe(true);
      expect(patchedExitBody.account.browser.exitChanged).toBe(true);
      expect(patchedExitBody.account.browser.exit.proxyId).toBe(proxyAId);

      // PATCH /accounts/:provider/:key (note) also returns updated browser status with exitChanged: true.
      const patchedNoteBody = await (
        await req("PATCH", "/api/accounts/workbuddy/workbuddy", { note: "still open" })
      ).json();
      expect(patchedNoteBody.account.browser.open).toBe(true);
      expect(patchedNoteBody.account.browser.exitChanged).toBe(true);

      const statusAfterExitChange = await (
        await req("GET", "/api/accounts/workbuddy/workbuddy/browser")
      ).json();
      expect(statusAfterExitChange.browser.exitChanged).toBe(true);

      // Open retired account's browser simultaneously (with explicit https URL) and verify DELETE mutex.
      const retiredOpenRes = await req("POST", "/api/accounts/workbuddy/workbuddy%23retired/browser", {
        url: "https://example.com/account",
      });
      expect(retiredOpenRes.status).toBe(200);
      expect(launchCalls[1].opts.url).toBe("https://example.com/account");

      const deleteBlocked = await req("DELETE", "/api/accounts/workbuddy/workbuddy%23retired");
      expect(deleteBlocked.status).toBe(409);
      expect((await deleteBlocked.json()).error).toBe("browser_open");
      expect(existsSync(retiredBrowserDir)).toBe(true);

      // DELETE /browser closes alpha; second DELETE reports closed: false cleanly.
      const closedAlpha = await (await req("DELETE", "/api/accounts/workbuddy/workbuddy/browser")).json();
      expect(closedAlpha).toEqual({
        ok: true,
        closed: true,
        browser: { open: false, openedAt: null, exit: null, exitChanged: false },
      });
      expect(launchCalls[0].closeCount).toBe(1);
      const closedAlphaAgain = await (await req("DELETE", "/api/accounts/workbuddy/workbuddy/browser")).json();
      expect(closedAlphaAgain).toEqual({
        ok: true,
        closed: false,
        browser: { open: false, openedAt: null, exit: null, exitChanged: false },
      });

      // Credential boundary: zero usernames, passwords, raw credential URLs, or filesystem paths in any payload.
      for (const payload of [
        openedBody,
        accountsOpenBody,
        agentOpenBody,
        patchedExitBody,
        patchedNoteBody,
        statusAfterExitChange,
        closedAlpha,
      ]) {
        const text = JSON.stringify(payload);
        expect(text).not.toContain("browserSecretUserA");
        expect(text).not.toContain("browserSecretPassA");
        expect(text).not.toContain("browserSecretUserB");
        expect(text).not.toContain("browserSecretPassB");
        expect(text).not.toContain("ACCESS_SECRET_TOKEN");
        expect(text).not.toContain(rawUrlA);
        expect(text).not.toContain(isoRoot);
      }

      // Retired account's browser is still open; closing the server must call closeAll() and close its handle.
      expect(launchCalls[1].closeCount).toBe(0);
      await isoService.close();
      isoService = null;
      expect(launchCalls[1].closeCount).toBe(1);
    } finally {
      await isoService?.close();
      rmSync(isoRoot, { recursive: true, force: true });
    }
  });

  test("server.close invokes injected accountBrowser.closeAll()", async () => {
    const isoRoot = mkdtempSync(join(tmpdir(), "clean-login-browser-closeall-"));
    const isoData = join(isoRoot, "data");
    let closeAllCalls = 0;
    let isoService;
    try {
      isoService = await startServer({
        port: 0,
        dataDir: isoData,
        env: {
          ...process.env,
          NODE_ENV: "test",
          MAGPIE_CONFIG_DIR: join(isoRoot, "config"),
          MAGPIE_CLEAN_LOGIN_DATA: isoData,
        },
        pluginScanner: {
          get: () => ({ available: false, providers: [], scanned: false, stale: false, scanning: false, error: null }),
          warm: () => {},
        },
        accountBrowser: {
          isOpen: () => false,
          listOpen: () => [],
          status: async () => ({ open: false, openedAt: null, exit: null, exitChanged: false }),
          open: async () => ({ open: true, openedAt: "2026-11-24T00:00:00.000Z", exit: null, exitChanged: false }),
          close: async () => ({ closed: false, browser: { open: false, openedAt: null, exit: null, exitChanged: false } }),
          closeAll: async () => {
            closeAllCalls += 1;
          },
        },
      });
      expect(isoService.accountBrowser).toBeDefined();
      await isoService.close();
      isoService = null;
      expect(closeAllCalls).toBe(1);
    } finally {
      await isoService?.close();
      rmSync(isoRoot, { recursive: true, force: true });
    }
  });
});
