import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createProviderRegistration,
  providerRegistrationState,
  providersFile,
  readProvidersDocument,
} from "../lib/provider-registration.mjs";

const NOW_ENV = { MAGPIE_CONFIG_DIR: "" };

function cliFake(calls, failure = null) {
  return (file, args, options, callback) => {
    calls.push({ file, args, options });
    queueMicrotask(() => callback(failure, failure ? "" : `added ${args.at(-1)}`, ""));
    return { once() {} };
  };
}

async function withConfig(rows, run, { omitFile = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "clean-login-provider-registration-"));
  const file = join(root, "providers.json");
  if (!omitFile) await writeFile(file, JSON.stringify({ providers: rows }));
  try {
    await run({ root, file, env: { ...NOW_ENV, MAGPIE_CONFIG_DIR: root } });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("provider state distinguishes offered, first-use gaps, removals and off", () => {
  const doc = {
    providers: [
      { id: "ready" },
      { id: "fresh", hidden: true },
      { id: "removed", hidden: true, models: ["m"] },
      { id: "picked", hidden: true, pickedFrom: ["m"] },
      { id: "off", off: true, hidden: true },
    ],
  };
  expect(providerRegistrationState(doc, "ready")).toBe("offered");
  expect(providerRegistrationState(doc, "fresh")).toBe("never_offered");
  expect(providerRegistrationState(doc, "removed")).toBe("removed");
  expect(providerRegistrationState(doc, "picked")).toBe("removed");
  expect(providerRegistrationState(doc, "off")).toBe("switched_off");
  expect(providerRegistrationState(doc, "absent")).toBe("missing");
  expect(providerRegistrationState(doc, "../bad")).toBe("invalid");
});

test("providersFile follows the isolated magpie config root and parses its document", async () => {
  await withConfig([{ id: "qoder" }], async ({ root, file, env }) => {
    expect(providersFile(env)).toBe(file);
    expect((await readProvidersDocument(file)).providers[0].id).toBe("qoder");
    expect(root).toBe(env.MAGPIE_CONFIG_DIR);
  });
});

for (const [name, row] of [
  ["a hidden shell from a first sign-in here", { id: "qoder", hidden: true }],
  ["a provider the user previously removed", { id: "cursor", hidden: true, models: ["m"], pickedFrom: ["m"] }],
]) {
  test(`ensure registers ${name} through magpie's own CLI`, async () => {
    await withConfig([row], async ({ file, env }) => {
      const calls = [];
      const registration = createProviderRegistration({ env, file, execFile: cliFake(calls), cli: "magpie-test" });
      const result = await registration.ensure(row.id);
      expect(result).toMatchObject({ provider: row.id, ok: true, action: "added" });
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual(["provider", "add", row.id]);
      expect(calls[0].options.windowsHide).toBe(true);
      // Registration is delegated to magpie; this plugin never rewrites the file.
      expect(JSON.parse(await readFile(file, "utf8")).providers[0].hidden).toBe(true);
    });
  });
}

test("an offered or switched-off provider never invokes the CLI", async () => {
  await withConfig([{ id: "ready" }, { id: "off", off: true }], async ({ file, env }) => {
    const calls = [];
    const registration = createProviderRegistration({ env, file, execFile: cliFake(calls) });
    expect(await registration.ensure("ready")).toMatchObject({ ok: true, state: "offered", action: "none" });
    expect(await registration.ensure("off")).toMatchObject({ ok: true, state: "switched_off", action: "none" });
    expect(calls).toEqual([]);
  });
});

test("a missing row is repaired only when an installed plugin proves the provider id", async () => {
  await withConfig([], async ({ file, env }) => {
    const calls = [];
    const registration = createProviderRegistration({
      env,
      file,
      execFile: cliFake(calls),
      pluginScanner: { get: () => ({ providers: [{ id: "qoder" }] }) },
    });
    expect(await registration.ensure("qoder")).toMatchObject({ ok: true, state: "missing", action: "added" });
    expect(await registration.ensure("not-installed")).toMatchObject({
      ok: false,
      state: "missing",
      action: "none",
      reason: "provider_not_installed",
    });
    expect(calls.map((call) => call.args.at(-1))).toEqual(["qoder"]);
  });
});

test("a missing providers.json is treated as a fresh profile, not as corruption", async () => {
  await withConfig([], async ({ file, env }) => {
    const calls = [];
    const registration = createProviderRegistration({
      env,
      file,
      execFile: cliFake(calls),
      pluginScanner: { get: () => ({ providers: [{ id: "qoder" }] }) },
    });
    expect(await registration.ensure("qoder")).toMatchObject({ ok: true, state: "missing", action: "added" });
  }, { omitFile: true });
});

test("malformed config and CLI failures are reported without throwing", async () => {
  await withConfig([], async ({ file, env }) => {
    await writeFile(file, "{broken");
    const calls = [];
    const registration = createProviderRegistration({ env, file, execFile: cliFake(calls) });
    expect(await registration.ensure("qoder")).toMatchObject({ ok: false, state: "unreadable", action: "none" });
    expect(calls).toEqual([]);
  });
  await withConfig([{ id: "qoder", hidden: true }], async ({ file, env }) => {
    const registration = createProviderRegistration({
      env,
      file,
      execFile: cliFake([], Object.assign(new Error("magpie unavailable"), { code: 1 })),
    });
    expect(await registration.ensure("qoder")).toMatchObject({ ok: false, action: "add_failed", reason: "cli_failed" });
  });
});

test("startup backfill visits each account provider once and isolates account-read failures", async () => {
  await withConfig([{ id: "a", hidden: true }, { id: "b", hidden: true }], async ({ file, env }) => {
    const calls = [];
    const registration = createProviderRegistration({
      env,
      file,
      execFile: cliFake(calls),
      listAccounts: async () => [
        { provider: "b" },
        { meta: { provider: "a" } },
        { meta: { provider: "a" } },
      ],
    });
    const report = await registration.backfill();
    expect(report.ok).toBe(true);
    expect(report.providers).toBe(2);
    expect(calls.map((call) => call.args.at(-1))).toEqual(["a", "b"]);
  });
  const registration = createProviderRegistration({
    env: NOW_ENV,
    listAccounts: async () => { throw new Error("denied"); },
  });
  expect(await registration.backfill()).toMatchObject({ ok: false, reason: "accounts_unreadable", results: [] });
});
