// magpie keeps its accounts in two files, and `plugin-auth.json` is only one of
// them.
//
//   * `plugin-auth.json` -- an object keyed by `provider` / `provider#slot`,
//     written by magpie's plugins.
//   * `logins.json` -- an array of login records covering *every* agent. A
//     plugin record carries `agent: "plugin:<id>"` and mirrors a plugin-auth
//     key; a built-in agent (antigravity, codex, grok, ...) carries the bare
//     agent id and is recorded ONLY here.
//
// Reading `plugin-auth.json` alone therefore hides every built-in account: it
// is never offered for import, never counted as signed in, and its directory
// looks like an orphan to the sweep. This module is that second source.
//
// A record's `auth` object holds `access_token`, `refresh_token`, `expiry_date`
// and `project`. It is never read -- not its values, not even its key names.
// `entryOf` copies exactly three fields (`id`, `agent`, `user`) and drops the
// record, so a credential cannot escape by accident.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { magpieConfigDir } from "./paths.mjs";

const PLUGIN_AGENT_PREFIX = "plugin:";

// Same shape `normalizeAgent` accepts in `native-signin.mjs`: a built-in agent
// id is what `magpie accounts add <agent>` takes.
const AGENT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
// magpie's own record id. It is not a credential: it is the handle magpie uses
// to address the login, and it is what makes an import idempotent.
const RECORD_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function isPluginAgent(agent) {
  return typeof agent === "string" && agent.startsWith(PLUGIN_AGENT_PREFIX);
}

// A built-in agent has no `provider#slot` key of its own, so the key has to be
// derived. Deriving it from magpie's record id -- rather than drawing a fresh
// random slot -- is what makes a second import land on the same directory
// instead of creating a duplicate account.
export function nativeLoginKey(agent, id) {
  if (typeof agent !== "string" || typeof id !== "string") return null;
  if (isPluginAgent(agent)) return null;
  if (!AGENT_ID.test(agent) || !RECORD_ID.test(id)) return null;
  return `${agent}#${id}`;
}

// The whitelist. Everything a login record holds besides these three fields
// is dropped here, including `auth`, `home`, `project` and `plan`.
function entryOf(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const key = nativeLoginKey(record.agent, record.id);
  if (!key) return null;
  // `user` is magpie's display name for the login -- an email address for the
  // Google-backed agents. It is the only identity a built-in record carries.
  const email = typeof record.user === "string" && record.user.length > 0 ? record.user : null;
  return {
    key,
    email,
    accountId: null,
    uid: null,
    credentialType: null,
    // Provenance, not identity: `classifyImport` uses it to say "native" for
    // any agent magpie itself holds a login for, including agents this plugin's
    // own registry does not list. It never reaches the report.
    source: "logins",
  };
}

// The strict form. A caller that must not guess uses this and turns a failure
// into a refusal; only `logins_missing` is a real "no built-in accounts" state.
export function readNativeLoginsResult(env = process.env) {
  let text;
  try {
    text = readFileSync(join(magpieConfigDir(env), "logins.json"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: false, reason: "logins_missing" };
    return { ok: false, reason: "logins_unreadable" };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "logins_invalid" };
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: "logins_invalid" };

  const entries = [];
  const keys = new Set();
  for (const record of parsed) {
    const entry = entryOf(record);
    if (!entry) continue;
    // One directory per magpie record, even if the ledger repeats it.
    if (keys.has(entry.key)) continue;
    keys.add(entry.key);
    entries.push(entry);
  }
  return { ok: true, entries, keys };
}

// The tolerant projection, for liveness checks that only ever add keys to a
// set: a missing or unreadable ledger contributes no native keys. Callers that
// must distinguish "none" from "cannot tell" use the result form instead.
export function readNativeLoginKeys(env = process.env) {
  const result = readNativeLoginsResult(env);
  return result.ok ? result.keys : new Set();
}