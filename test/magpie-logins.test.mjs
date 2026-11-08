// magpie keeps accounts in two files. `plugin-auth.json` holds the plugins;
// `logins.json` holds every agent, and the built-in ones (antigravity, codex,
// grok, ...) exist ONLY there. These tests pin the second reader:
//
//   A) a built-in record becomes `agent#id`, keyed by magpie's own record id so
//      a second import lands on the same directory;
//   B) a `plugin:<id>` record is skipped -- plugin-auth.json already owns it,
//      and importing it twice under two keys would duplicate the account;
//   C) the three failure states stay distinct, and only ENOENT is "missing";
//   D) `auth` never leaves the reader: not its values, not even its key.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isPluginAgent,
  nativeLoginKey,
  readNativeLoginKeys,
  readNativeLoginsResult,
} from "../lib/magpie-logins.mjs";

// The strings buried in the credential fields. Nothing the reader returns may
// contain any of them.
const SECRETS = ["NATIVE-ACCESS-SECRET", "NATIVE-REFRESH-SECRET", "NATIVE-PROJECT-SECRET"];

// Shaped like the real ledger: a built-in agent carries the bare agent id, a
// plugin carries `plugin:<id>`, and both carry an `auth` object.
const LOGINS_FIXTURE = [
  {
    id: "d13e957af937ea32",
    agent: "antigravity",
    user: "first@example.com",
    plan: "Google AI Pro",
    on: true,
    home: "/home/first",
    auth: {
      access_token: SECRETS[0],
      refresh_token: SECRETS[1],
      expiry_date: 1794000000000,
      project: SECRETS[2],
    },
  },
  {
    id: "4f7b6ee36df76116",
    agent: "antigravity",
    user: "second@example.com",
    auth: { access_token: SECRETS[0], refresh_token: SECRETS[1] },
  },
  {
    id: "0123456789abcdef",
    agent: "grok",
    user: "third@example.com",
    auth: { access_token: SECRETS[0] },
  },
  // Already owned by plugin-auth.json under its own key.
  {
    id: "ffffffffffffffff",
    agent: "plugin:workbuddy",
    user: "plugin@example.com",
    auth: { access_token: SECRETS[0] },
  },
];

const tempDirs = [];

async function configWith(contents) {
  const root = await mkdtemp(join(tmpdir(), "clean-login-magpie-logins-"));
  tempDirs.push(root);
  const configDir = join(root, "magpie-config");
  await mkdir(configDir, { recursive: true });
  if (contents !== undefined) {
    await writeFile(join(configDir, "logins.json"), contents);
  }
  return { root, configDir, env: { MAGPIE_CONFIG_DIR: configDir } };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// --- A/B. which records become accounts -----------------------------------

test("a built-in record is keyed by magpie's own record id, so the key is stable", () => {
  expect(nativeLoginKey("antigravity", "d13e957af937ea32")).toBe("antigravity#d13e957af937ea32");
  // The same record read twice must produce the same key: a random slot would
  // create a second directory for an account that already has one.
  expect(nativeLoginKey("antigravity", "d13e957af937ea32")).toBe(
    nativeLoginKey("antigravity", "d13e957af937ea32"),
  );
});

test("a plugin agent is not a built-in and never gets a derived key", () => {
  expect(isPluginAgent("plugin:workbuddy")).toBe(true);
  expect(isPluginAgent("antigravity")).toBe(false);
  expect(isPluginAgent(null)).toBe(false);
  expect(nativeLoginKey("plugin:workbuddy", "ffffffffffffffff")).toBeNull();
});

test("a malformed agent or record id is refused rather than turned into a path", () => {
  for (const agent of ["", "../etc", "a/b", "a\\b", "Anti gravity", "x".repeat(65)]) {
    expect(nativeLoginKey(agent, "d13e957af937ea32")).toBeNull();
  }
  for (const id of ["", "../etc", "a/b", "a\\b", "a b", "x".repeat(129)]) {
    expect(nativeLoginKey("antigravity", id)).toBeNull();
  }
  expect(nativeLoginKey(undefined, "abc")).toBeNull();
  expect(nativeLoginKey("antigravity", 42)).toBeNull();
});

test("the reader keeps built-ins, drops plugin records and de-duplicates a repeated id", async () => {
  const repeated = [...LOGINS_FIXTURE, { ...LOGINS_FIXTURE[0] }];
  const { env } = await configWith(JSON.stringify(repeated));
  const result = readNativeLoginsResult(env);
  expect(result.ok).toBe(true);
  expect(result.entries.map((entry) => entry.key)).toEqual([
    "antigravity#d13e957af937ea32",
    "antigravity#4f7b6ee36df76116",
    "grok#0123456789abcdef",
  ]);
  expect([...result.keys]).toEqual(result.entries.map((entry) => entry.key));
  expect(result.entries[0].email).toBe("first@example.com");
  expect(result.entries[0].source).toBe("logins");
});

test("a record with no display name still yields a key, with a null identity", async () => {
  const { env } = await configWith(JSON.stringify([{ id: "abcdef0123456789", agent: "codex" }]));
  const result = readNativeLoginsResult(env);
  expect(result.ok).toBe(true);
  expect(result.entries).toEqual([
    {
      key: "codex#abcdef0123456789",
      email: null,
      accountId: null,
      uid: null,
      credentialType: null,
      source: "logins",
    },
  ]);
});

// --- C. the three failure states ------------------------------------------

test("an absent ledger is logins_missing, and only an absent ledger is", async () => {
  const { env } = await configWith(undefined);
  expect(readNativeLoginsResult(env)).toEqual({ ok: false, reason: "logins_missing" });
});

test("a ledger that cannot be read is logins_unreadable, never logins_missing", async () => {
  // A directory where the file should be: a real read failure that is not
  // ENOENT. Collapsing it into "missing" is exactly how a live account gets
  // mistaken for no account at all.
  const { configDir, env } = await configWith(undefined);
  await mkdir(join(configDir, "logins.json"));
  expect(readNativeLoginsResult(env)).toEqual({ ok: false, reason: "logins_unreadable" });
});

test("malformed JSON and a non-array ledger are both logins_invalid", async () => {
  const broken = await configWith("{ not json");
  expect(readNativeLoginsResult(broken.env)).toEqual({ ok: false, reason: "logins_invalid" });
  const object = await configWith(JSON.stringify({ antigravity: { id: "abc" } }));
  expect(readNativeLoginsResult(object.env)).toEqual({ ok: false, reason: "logins_invalid" });
});

test("the tolerant projection adds no keys when the ledger cannot be read", async () => {
  const missing = await configWith(undefined);
  expect([...readNativeLoginKeys(missing.env)]).toEqual([]);
  const broken = await configWith("{ not json");
  expect([...readNativeLoginKeys(broken.env)]).toEqual([]);
  const good = await configWith(JSON.stringify(LOGINS_FIXTURE));
  expect(readNativeLoginKeys(good.env).has("antigravity#d13e957af937ea32")).toBe(true);
});

// --- D. credential containment --------------------------------------------

test("no credential value and no auth key ever leaves the reader", async () => {
  const { env } = await configWith(JSON.stringify(LOGINS_FIXTURE));
  const result = readNativeLoginsResult(env);
  const serialized = JSON.stringify(result.entries);
  for (const secret of SECRETS) expect(serialized).not.toContain(secret);
  for (const entry of result.entries) {
    // The whitelist is exact: a new field on magpie's record cannot ride along.
    expect(Object.keys(entry).sort()).toEqual(
      ["accountId", "credentialType", "email", "key", "source", "uid"].sort(),
    );
  }
  expect(serialized).not.toContain("access_token");
  expect(serialized).not.toContain("refresh_token");
  expect(serialized).not.toContain("expiry_date");
  // `home` and `plan` are not credentials, but they are not identity either.
  expect(serialized).not.toContain("/home/first");
  expect(serialized).not.toContain("Google AI Pro");
});