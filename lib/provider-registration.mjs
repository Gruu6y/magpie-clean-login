// A credential written by this plugin is not enough to make magpie offer its
// provider: magpie also needs the provider's first-use registration. When the
// first sign-in happened here instead of in magpie, providers.json can contain
// a hidden shell (or no row at all) while plugin-auth.json is perfectly valid.
// This module completes that registration through magpie's own CLI. It never
// writes providers.json directly, and it never enables an `off` provider.

import { execFile as nodeExecFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { listAccountDirsWithMeta } from "./account-identity.mjs";
import { magpieConfigDir } from "./paths.mjs";
import { magpieCli } from "./native-signin.mjs";
import { join } from "node:path";

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

export function providersFile(env = process.env) {
  return join(magpieConfigDir(env), "providers.json");
}

export async function readProvidersDocument(file) {
  const raw = JSON.parse(await readFile(file, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid providers.json");
  return raw;
}

export function providerRegistrationState(doc, provider) {
  if (typeof provider !== "string" || !ID.test(provider)) return "invalid";
  const rows = Array.isArray(doc?.providers) ? doc.providers : [];
  const row = rows.find((entry) => entry?.id === provider);
  if (!row) return "missing";
  if (row.off === true) return "switched_off";
  if (row.hidden !== true) return "offered";
  // `models`/`pickedFrom` mean magpie offered it before the user removed it.
  // Both are deliberately repaired now: signing in here is an explicit request
  // to use the provider, not a reason to keep a stale removal forever.
  return Array.isArray(row.models) && row.models.length > 0 || row.pickedFrom ? "removed" : "never_offered";
}

export function registerProvider({
  env = process.env,
  provider,
  cli = magpieCli(env),
  execFile = nodeExecFile,
  timeoutMs = 30_000,
} = {}) {
  if (typeof provider !== "string" || !ID.test(provider)) {
    return Promise.resolve({ ok: false, action: "none", reason: "invalid_provider" });
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const child = execFile(
        cli,
        ["provider", "add", provider],
        { env, timeout: timeoutMs, windowsHide: true, maxBuffer: 256 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            done({ ok: false, action: "add_failed", reason: "cli_failed", error: String(error.message ?? error).slice(0, 500) });
            return;
          }
          done({ ok: true, action: "added", output: String(stdout || stderr || "").trim().slice(0, 500) });
        },
      );
      child?.once?.("error", (error) => done({ ok: false, action: "add_failed", reason: "spawn_failed", error: String(error.message ?? error).slice(0, 500) }));
    } catch (error) {
      done({ ok: false, action: "add_failed", reason: "spawn_failed", error: String(error?.message ?? error).slice(0, 500) });
    }
  });
}

export function createProviderRegistration({
  env = process.env,
  file = providersFile(env),
  pluginScanner,
  execFile = nodeExecFile,
  cli = magpieCli(env),
  listAccounts = listAccountDirsWithMeta,
  timeoutMs = 30_000,
} = {}) {
  async function ensure(provider) {
    if (typeof provider !== "string" || !ID.test(provider)) {
      return { provider: provider ?? null, ok: false, state: "invalid", action: "none" };
    }
    let doc;
    try {
      doc = await readProvidersDocument(file);
    } catch (error) {
      // A missing file is a legitimate fresh magpie profile. Anything else is
      // left alone: repairing malformed JSON through a CLI would be dishonest.
      if (error?.code !== "ENOENT") {
        return { provider, ok: false, state: "unreadable", action: "none", error: String(error?.message ?? error).slice(0, 300) };
      }
      doc = { providers: [] };
    }
    const state = providerRegistrationState(doc, provider);
    if (state === "offered") return { provider, ok: true, state, action: "none" };
    if (state === "switched_off") return { provider, ok: true, state, action: "none", reason: "switched_off" };
    if (state === "invalid") return { provider, ok: false, state, action: "none" };
    if (state === "missing") {
      // No row is the same first-use gap only when an installed plugin proves
      // that this is a real provider id. Without that proof, `provider add`
      // could create an unrelated custom vendor.
      let known = pluginScanner?.get?.().providers?.some((entry) => entry?.id === provider) === true;
      if (!known && typeof pluginScanner?.refresh === "function") {
        // Startup backfill can run before the first plugin scan has landed.
        // Wait for that bounded scan here (already in the background), rather
        // than reporting an installed provider as missing because of a race.
        try { await pluginScanner.refresh(); } catch { /* the next check reports unknown */ }
        known = pluginScanner?.get?.().providers?.some((entry) => entry?.id === provider) === true;
      }
      if (!known) return { provider, ok: false, state, action: "none", reason: "provider_not_installed" };
    }
    const result = await registerProvider({ env, provider, cli, execFile, timeoutMs });
    return { provider, state, ...result };
  }

  return {
    ensure,
    backfill: async () => {
      let accounts;
      try {
        accounts = await listAccounts(env);
      } catch (error) {
        return { ok: false, reason: "accounts_unreadable", error: String(error?.message ?? error).slice(0, 300), results: [] };
      }
      const providers = [...new Set(accounts.map((account) => account?.meta?.provider ?? account?.provider).filter((id) => typeof id === "string" && ID.test(id)))].sort();
      const results = [];
      for (const provider of providers) results.push(await ensure(provider));
      return { ok: results.every((result) => result.ok), providers: providers.length, results };
    },
  };
}
