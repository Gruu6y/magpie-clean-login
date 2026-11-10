// The asset registry routes. A temporary data directory and temporary magpie
// config/cache directories keep the real ~/.config/magpie untouched; the
// server starts on port 0 and the page token is read from the served HTML
// exactly as the account route tests do.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKEN_HEADER, startServer } from "../lib/server.mjs";
import { ASSET_FILE_NAME, createAssetStore } from "../lib/asset-registry.mjs";

const tmp = mkdtempSync(join(tmpdir(), "clean-login-assets-routes-"));
const dataDir = join(tmp, "data");
const configDir = join(tmp, "magpie-config");
const cacheDir = join(tmp, "magpie-cache");
let service;
let token;

// The four seeds; the list order assertion uses the pauses between creates so
// `createdAt` really increases and the newest-first sort is observable.
const seeds = [
  { type: "google-mail", account: "Owner@Example.com", note: "primary" },
  { type: "microsoft-mail", account: "work@example.com", note: "" },
  { type: "cn-phone", account: "138 0013 8000", note: "sms" },
  { type: "apple-id", account: "apple@example.com", note: "" },
];
const created = [];

beforeAll(async () => {
  await mkdir(configDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  service = await startServer({
    port: 0,
    env: {
      ...process.env,
      MAGPIE_CONFIG_DIR: configDir,
      MAGPIE_CLEAN_LOGIN_DATA: dataDir,
      MAGPIE_CACHE_DIR: cacheDir,
    },
    dataDir,
    pluginScanner: {
      get: () => ({ available: false, providers: [], scanned: false, stale: false, scanning: false, error: null }),
      warm: () => {},
    },
  });
  const html = await (await fetch(`http://127.0.0.1:${service.port}/`)).text();
  token = /name="clean-login-token" content="([0-9a-f]+)"/.exec(html)?.[1];
});

afterAll(async () => {
  await service?.close();
  rmSync(tmp, { recursive: true, force: true });
});

function api(method, path, body, { withToken = true } = {}) {
  const headers = withToken ? { [TOKEN_HEADER]: token } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`http://127.0.0.1:${service.port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("GET /api/assets starts empty", async () => {
  const res = await api("GET", "/api/assets");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ assets: [] });
});

test("POST /api/assets creates one row per type with the public shape", async () => {
  for (const seed of seeds) {
    await sleep(3);
    const res = await api("POST", "/api/assets", seed);
    expect(res.status).toBe(201);
    const { asset } = await res.json();
    expect(Object.keys(asset).sort()).toEqual([
      "account",
      "createdAt",
      "id",
      "note",
      "type",
      "updatedAt",
    ]);
    expect(asset.type).toBe(seed.type);
    expect(asset.note).toBe(seed.note);
    expect(asset.id.length).toBeGreaterThan(0);
    expect(asset.createdAt).toBe(asset.updatedAt);
    // A phone number is stored normalized to its 11 bare digits.
    if (seed.type === "cn-phone") expect(asset.account).toBe("13800138000");
    else expect(asset.account).toBe(seed.account);
    // The response never carries a credential.
    expect(JSON.stringify(asset)).not.toContain(tmp);
    expect(asset).not.toHaveProperty("password");
    created.push(asset);
  }
});

test("GET /api/assets lists newest first and matches the created rows", async () => {
  const res = await api("GET", "/api/assets");
  expect(res.status).toBe(200);
  const { assets } = await res.json();
  expect(assets).toHaveLength(seeds.length);
  const times = assets.map((asset) => Date.parse(asset.createdAt));
  for (let i = 1; i < times.length; i += 1) expect(times[i]).toBeLessThanOrEqual(times[i - 1]);
  expect(new Set(assets.map((asset) => asset.id)).size).toBe(seeds.length);
  expect(assets.map((asset) => asset.id).sort()).toEqual(created.map((asset) => asset.id).sort());
});

test("POST /api/assets rejects invalid types, accounts and notes", async () => {
  const cases = [
    [{ type: "bogus", account: "a@example.com" }, "invalid_type"],
    [{ type: "google-mail", account: "not-an-email" }, "invalid_account"],
    [{ type: "apple-id", account: "missing@tld" }, "invalid_account"],
    [{ type: "cn-phone", account: "12345" }, "invalid_account"],
    [{ type: "cn-phone", account: "23800138000" }, "invalid_account"],
    [{ type: "google-mail" }, "invalid_account"],
    [{ type: "google-mail", account: "   " }, "invalid_account"],
    [{ type: "google-mail", account: "a@example.com", note: "n".repeat(201) }, "invalid_note"],
  ];
  for (const [body, code] of cases) {
    const res = await api("POST", "/api/assets", body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(code);
  }
});

// The account cap is asserted at the wire boundary with a literal, so a change
// to the service limit fails here even if the shared constant moves with it.
test("POST /api/assets accepts a 254 character account and rejects 255", async () => {
  const edge = `${"a".repeat(249)}@b.co`;
  expect(edge).toHaveLength(254);
  const ok = await api("POST", "/api/assets", { type: "google-mail", account: edge });
  expect(ok.status).toBe(201);
  expect((await ok.json()).asset.account).toBe(edge);

  const tooLong = await api("POST", "/api/assets", {
    type: "google-mail",
    account: `${edge}x`,
  });
  expect(tooLong.status).toBe(400);
  expect((await tooLong.json()).error).toBe("invalid_account");
});

test("POST /api/assets rejects a missing or non-object body", async () => {
  const empty = await fetch(`http://127.0.0.1:${service.port}/api/assets`, {
    method: "POST",
    headers: { [TOKEN_HEADER]: token },
  });
  expect(empty.status).toBe(400);
  expect((await empty.json()).error).toBe("invalid_body");
  const array = await api("POST", "/api/assets", []);
  expect(array.status).toBe(400);
  expect((await array.json()).error).toBe("invalid_body");
});

test("GET /api/assets/:id returns the record, unknown ids are 404", async () => {
  const id = created[0].id;
  const res = await api("GET", `/api/assets/${id}`);
  expect(res.status).toBe(200);
  expect((await res.json()).asset).toEqual(created[0]);
  const missing = await api("GET", "/api/assets/no-such-asset");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "not_found", message: "Asset not found." });
});

test("PATCH /api/assets/:id updates the note and re-checks the account format", async () => {
  const id = created[0].id;
  const res = await api("PATCH", `/api/assets/${id}`, { note: "  updated note  " });
  expect(res.status).toBe(200);
  const { asset } = await res.json();
  expect(asset.note).toBe("updated note");
  expect(asset.account).toBe(created[0].account);
  expect(asset.type).toBe("google-mail");
  expect(Date.parse(asset.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created[0].updatedAt));

  const badNote = await api("PATCH", `/api/assets/${id}`, { note: "x".repeat(201) });
  expect(badNote.status).toBe(400);
  expect((await badNote.json()).error).toBe("invalid_note");
});

test("PATCH changing the type re-validates the final account", async () => {
  // A phone row switched to an email type must satisfy the email rule.
  const phone = created.find((asset) => asset.type === "cn-phone");
  const toEmail = await api("PATCH", `/api/assets/${phone.id}`, { type: "google-mail" });
  expect(toEmail.status).toBe(400);
  expect((await toEmail.json()).error).toBe("invalid_account");

  // An email row switched to cn-phone with its old account still fails...
  const email = created.find((asset) => asset.type === "google-mail");
  const toPhone = await api("PATCH", `/api/assets/${email.id}`, { type: "cn-phone" });
  expect(toPhone.status).toBe(400);
  expect((await toPhone.json()).error).toBe("invalid_account");

  // ...but supplying a matching number in the same request succeeds and is
  // stored normalized under the new type.
  const mixed = await api("PATCH", `/api/assets/${email.id}`, {
    type: "cn-phone",
    account: "139-0013-8001",
  });
  expect(mixed.status).toBe(200);
  const { asset } = await mixed.json();
  expect(asset.type).toBe("cn-phone");
  expect(asset.account).toBe("13900138001");

  // A later account-only edit is still checked against the stored type.
  const badAgain = await api("PATCH", `/api/assets/${email.id}`, { account: "not-a-phone" });
  expect(badAgain.status).toBe(400);
  expect((await badAgain.json()).error).toBe("invalid_account");
});

test("PATCH requires at least one known field", async () => {
  const id = created[1].id;
  const res = await api("PATCH", `/api/assets/${id}`, {});
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("invalid_body");
  const unknown = await api("PATCH", `/api/assets/${id}`, { password: "nope" });
  expect(unknown.status).toBe(400);
  expect((await unknown.json()).error).toBe("invalid_body");
});

test("PATCH and DELETE on an unknown id are 404", async () => {
  const patch = await api("PATCH", "/api/assets/no-such-asset", { note: "x" });
  expect(patch.status).toBe(404);
  expect((await patch.json()).error).toBe("not_found");
  const del = await api("DELETE", "/api/assets/no-such-asset");
  expect(del.status).toBe(404);
  expect((await del.json()).error).toBe("not_found");
});

test("DELETE /api/assets/:id removes the row", async () => {
  const extra = await api("POST", "/api/assets", {
    type: "apple-id",
    account: "delete-me@example.com",
  });
  const id = (await extra.json()).asset.id;
  const del = await api("DELETE", `/api/assets/${id}`);
  expect(del.status).toBe(200);
  expect(await del.json()).toEqual({ ok: true });
  const gone = await api("GET", `/api/assets/${id}`);
  expect(gone.status).toBe(404);
});

test("asset routes reject another method", async () => {
  const collection = await api("PUT", "/api/assets");
  expect(collection.status).toBe(405);
  expect(collection.headers.get("allow")).toBe("GET, POST");
  const item = await api("PUT", `/api/assets/${created[0].id}`);
  expect(item.status).toBe(405);
  expect(item.headers.get("allow")).toBe("GET, PATCH, DELETE");
});

test("asset routes require the page token", async () => {
  const get = await api("GET", "/api/assets", undefined, { withToken: false });
  expect(get.status).toBe(403);
  const post = await api("POST", "/api/assets", seeds[0], { withToken: false });
  expect(post.status).toBe(403);
  const del = await api("DELETE", `/api/assets/${created[0].id}`, undefined, { withToken: false });
  expect(del.status).toBe(403);
});

test("the data file lands atomically and never leaks a temp path", async () => {
  const file = join(dataDir, ASSET_FILE_NAME);
  expect(existsSync(file)).toBe(true);
  const raw = readFileSync(file, "utf8");
  const doc = JSON.parse(raw);
  expect(doc.version).toBe(1);
  expect(Array.isArray(doc.assets)).toBe(true);
  expect(doc.assets.length).toBeGreaterThan(0);
  for (const record of doc.assets) {
    expect(typeof record.id).toBe("string");
    expect(record).not.toHaveProperty("password");
  }
  expect(raw).not.toContain(tmp);
  expect(raw).not.toContain(".tmp");
  expect(readdirSync(dataDir).some((name) => name.endsWith(".tmp"))).toBe(false);
});

test("a restarted store reads the same records from disk", async () => {
  const reopened = createAssetStore({ dataDir });
  const listed = await reopened.list();
  const viaApi = (await (await api("GET", "/api/assets")).json()).assets;
  expect(listed).toHaveLength(viaApi.length);
  expect(listed.map((asset) => asset.id).sort()).toEqual(viaApi.map((asset) => asset.id).sort());
  for (const asset of listed) {
    expect(asset).toEqual(viaApi.find((item) => item.id === asset.id));
  }
});

test("loading drops invalid stored entries instead of failing", async () => {
  const isolated = join(tmp, "isolated-data");
  await mkdir(isolated, { recursive: true });
  await writeFile(
    join(isolated, ASSET_FILE_NAME),
    JSON.stringify({
      version: 1,
      assets: [
        {
          id: "keep-me",
          type: "google-mail",
          account: "keep@example.com",
          note: "ok",
          createdAt: "2026-11-03T10:00:00.000Z",
          updatedAt: "2026-11-03T10:00:00.000Z",
        },
        { id: "bad-type", type: "bogus", account: "x@example.com" },
        { id: "bad-account", type: "google-mail", account: "not-an-email" },
        { type: "apple-id", account: "no-id@example.com" },
      ],
    }),
  );
  const store = createAssetStore({ dataDir: isolated });
  expect(await store.list()).toEqual([
    {
      id: "keep-me",
      type: "google-mail",
      account: "keep@example.com",
      note: "ok",
      createdAt: "2026-11-03T10:00:00.000Z",
      updatedAt: "2026-11-03T10:00:00.000Z",
    },
  ]);
});
