// Keeping magpie's per-account proxy in step with the exit the account signed
// in through.
//
// Why this module writes a file instead of calling an API: the plugin host
// hands a plugin `client.auth`, `client.app.log`, `client.config.get` and
// `input.magpie`, and none of them can set a provider's account proxy. The
// page itself is sandboxed to its declared reads, so it cannot POST
// `/api/provider/save` either. What magpie *does* do is watch its own config:
// `providers.json` is read through its file memo (keyed on the file's stat)
// and re-read when the file changes, so an atomic replace here is picked up
// without a restart. Verified on magpie 0.1.3001 by replacing the file and
// watching `/v1/models` reflect the new labels within a second.
//
// The shape written here is the one magpie's own editor saves:
//   providers[].accountProxies = { "<account user name, lower case>": "<url>" }
// (`accountProxyPicker` keys each row by `login.user.toLowerCase()`, and
// `accountProxiesOfDraft()` stores `"direct"` or the URL text). An account
// without an entry follows the provider-level proxy, which is exactly the
// behaviour this module replaces for the accounts it knows about.
//
// Two callers, two policies:
//   - a finished sign-in overwrites that account's own entry, because the
//     user has just picked the exit again;
//   - the startup backfill only fills entries that are absent, so a proxy the
//     user set by hand in magpie's editor is never clobbered.
//
// Nothing here may break a sign-in: a missing or unreadable providers.json is
// reported, never thrown, and every caller treats the result as best effort.

import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { magpieConfigDir, pluginDataDir } from "./paths.mjs";
import { listAccountDirsWithMeta } from "./account-identity.mjs";

export const PROVIDERS_FILE_NAME = "providers.json";
export const ACCOUNT_PROXY_BACKFILL_FILE = "account-proxy-backfill.json";
const URL_TYPES = new Set(["http", "https", "socks5", "socks4"]);
const DEFAULT_PROXY_PORTS = { http: 80, https: 443 };
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
// A user name that is also an object key with special meaning must never be
// written into magpie's map; such an account is left on the provider proxy.
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function providersFile(env = process.env) {
  return join(magpieConfigDir(env), PROVIDERS_FILE_NAME);
}

// magpie keys the map by the account's user name in lower case. The name is
// always computed from the account the sign-in returned, never hard-coded.
export function accountProxyKey(user) {
  return String(user ?? "").trim().toLowerCase();
}

function safeDecodeComponent(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// A display-only view of an exit URL: scheme, host and port, never the
// credentials. `providers.json` stores a custom exit as a full URL and
// `provider.proxy` may carry one too, but HTTP/UI/CLI responses may only ever
// carry `scheme://host:port`. Unparseable text yields null rather than an echo,
// so this can never leak credentials.
export function exitDisplayUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "direct") return null;
  try {
    const url = new URL(trimmed);
    return url.host ? `${url.protocol}//${url.host}` : null;
  } catch {
    return null;
  }
}

// Parses a proxy URL (`http://`, `https://`, `socks5://`, `socks4://`) into the
// normalized shape `browser-launcher.mjs` and `signin-egress.mjs` consume.
// Handles IPv6 literals (`[::1]`) and percent-encoded credentials. `server`
// intentionally omits `username`/`password` because Playwright requires them as
// separate fields. Invalid or non-proxy inputs return null.
export function parseProxyUrl(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.toLowerCase() === "direct") return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const type = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (!URL_TYPES.has(type)) return null;
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    return null;
  }
  const rawHostname = parsed.hostname;
  if (!rawHostname) return null;
  const host =
    rawHostname.startsWith("[") && rawHostname.endsWith("]")
      ? rawHostname.slice(1, -1)
      : rawHostname;
  if (!host || /\s/.test(host)) return null;

  let port;
  if (parsed.port) {
    if (!/^\d+$/.test(parsed.port)) return null;
    port = Number(parsed.port);
  } else if (Object.hasOwn(DEFAULT_PROXY_PORTS, type)) {
    port = DEFAULT_PROXY_PORTS[type];
  } else {
    return null;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  const username = safeDecodeComponent(parsed.username);
  const password = safeDecodeComponent(parsed.password);
  const address = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const server = `${type}://${address}:${port}`;
  return { type, host, port, username, password, server };
}

// Canonical proxy URL text used for matching equivalent URLs (e.g. trailing
// slash, uppercase scheme, or encoding differences) between `proxies.json` and
// `providers.json`.
export function canonicalProxyUrl(rawUrl) {
  const parsed = parseProxyUrl(rawUrl);
  if (!parsed) return null;
  const auth =
    parsed.username || parsed.password
      ? `${encodeURIComponent(parsed.username)}:${encodeURIComponent(parsed.password)}@`
      : "";
  const address =
    parsed.host.includes(":") && !parsed.host.startsWith("[")
      ? `[${parsed.host}]`
      : parsed.host;
  return `${parsed.type}://${auth}${address}:${parsed.port}`;
}

// The stored proxy record carries credentials; magpie's own editor expects
// them inline in the URL (`http://user:pass@host:port`), so they are encoded
// rather than dropped. A record without a usable address yields null and the
// account is simply left alone.
export function proxyUrlFor(record) {
  if (!record || typeof record !== "object") return null;
  const direct = typeof record.url === "string" ? record.url.trim() : "";
  if (direct && SCHEME.test(direct)) return direct;
  const host = String(record.host ?? "").trim();
  const port = Number(record.port);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const type = String(record.type ?? "http").trim().toLowerCase() || "http";
  if (!URL_TYPES.has(type)) return null;
  const username = String(record.username ?? "");
  const password = String(record.password ?? "");
  const auth = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : "";
  const address = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${type}://${auth}${address}:${port}`;
}

// Writes within this process are serialized per file, so a sign-in finishing
// while the startup backfill runs cannot interleave two read-modify-write
// cycles and lose one of them.
const chains = new Map();

function serialized(file, work) {
  const previous = chains.get(file) ?? Promise.resolve();
  const next = previous.then(work, work);
  chains.set(
    file,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

async function writeAtomic(file, text) {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temp, "wx", 0o600);
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await rename(temp, file);
    } catch (error) {
      // Windows cannot rename over an existing file that another process has
      // open; fall back to removing the target first, as the proxy store does.
      if (!["EEXIST", "EPERM", "EACCES", "ENOTEMPTY"].includes(error?.code)) throw error;
      await rm(file, { force: true });
      await rename(temp, file);
    }
    try {
      await chmod(file, 0o600);
    } catch {
      // POSIX modes are not implemented everywhere; the file still holds only
      // proxy URLs inside the user's own config directory.
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

// `entries` is a list of `{ provider, accountId, url }`. Returns a report
// instead of throwing for the expected "nothing to do" cases, so a sign-in is
// never failed by a magpie installation that has no providers.json yet.
export async function writeAccountProxies({
  env = process.env,
  entries = [],
  onlyMissing = false,
  file = providersFile(env),
} = {}) {
  const wanted = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      provider: String(entry?.provider ?? "").trim(),
      key: accountProxyKey(entry?.accountId),
      url: String(entry?.url ?? "").trim(),
    }))
    .filter((entry) => entry.provider && entry.key && entry.url && !RESERVED_KEYS.has(entry.key));
  const report = { ok: false, file, changed: [], skipped: [], reason: null };
  if (!wanted.length) {
    report.ok = true;
    report.reason = "nothing_to_sync";
    return report;
  }

  return serialized(file, async () => {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      report.reason = error?.code === "ENOENT" ? "providers_missing" : "providers_unreadable";
      report.error = String(error?.message ?? error);
      return report;
    }
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      // Never "repair" magpie's file: a malformed one is left exactly as it
      // is, which is also what magpie itself does.
      report.reason = "providers_invalid";
      return report;
    }
    if (!Array.isArray(doc?.providers)) {
      report.reason = "providers_invalid";
      return report;
    }

    for (const entry of wanted) {
      const provider = doc.providers.find((item) => item?.id === entry.provider);
      if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
        report.skipped.push({ ...entry, reason: "provider_missing" });
        continue;
      }
      const existing =
        provider.accountProxies &&
        typeof provider.accountProxies === "object" &&
        !Array.isArray(provider.accountProxies)
          ? provider.accountProxies
          : {};
      // `accountProxies` is an own-property map keyed by user name; only the
      // exact account key is ever read or written, never a prototype key.
      if (!Object.hasOwn(provider, "accountProxies") || provider.accountProxies !== existing) {
        provider.accountProxies = { ...existing };
      }
      if (onlyMissing && Object.hasOwn(provider.accountProxies, entry.key)) {
        report.skipped.push({ ...entry, reason: "already_set" });
        continue;
      }
      if (provider.accountProxies[entry.key] === entry.url) {
        report.skipped.push({ ...entry, reason: "unchanged" });
        continue;
      }
      provider.accountProxies[entry.key] = entry.url;
      report.changed.push(entry);
    }

    if (!report.changed.length) {
      report.ok = true;
      report.reason = "up_to_date";
      return report;
    }
    await writeAtomic(file, `${JSON.stringify(doc, null, 2)}\n`);
    report.ok = true;
    report.reason = "written";
    return report;
  });
}

// Shared loader for the read side: a missing or unreadable providers.json is
// reported, never thrown, and a malformed one is left exactly as it is rather
// than "repaired". Both readAccountExit and writeAccountExit reuse it.
async function readProvidersDoc(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: error?.code === "ENOENT" ? "providers_missing" : "providers_unreadable",
      error: String(error?.message ?? error),
    };
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: "providers_invalid" };
  }
  if (!Array.isArray(doc?.providers)) return { ok: false, reason: "providers_invalid" };
  return { ok: true, doc };
}

// A provider entry must be an object before any account map is touched; an
// array or scalar would otherwise be assigned properties.
function findProvider(doc, provider) {
  const entry = doc.providers.find((item) => item?.id === provider);
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  return entry;
}

// `accountProxies` is an own-property map keyed by user name; a missing or
// wrong-typed one is treated as empty, and only own keys are ever consulted so
// a prototype like `__proto__` cannot surface a value.
function accountProxyMap(entry) {
  return entry.accountProxies &&
    typeof entry.accountProxies === "object" &&
    !Array.isArray(entry.accountProxies)
    ? entry.accountProxies
    : {};
}

// Tracks accounts that have already been synchronized with magpie at least once
// so that a user explicitly switching an account back to `inherit` in magpie
// (which deletes `accountProxies[key]`) does not rebound to historical
// `lastLogin` on the next clean-login restart. Stores only provider/account
// keys and timestamps — never proxy URLs or credentials.
function backfillStateKey(provider, accountId) {
  const p = String(provider ?? "").trim();
  const k = accountProxyKey(accountId);
  if (!p || !k || RESERVED_KEYS.has(k)) return null;
  return `${p}\u0000${k}`;
}

export function resolveBackfillStateFile({
  env = process.env,
  file = providersFile(env),
  dataDir = null,
  stateFile = null,
} = {}) {
  if (typeof stateFile === "string" && stateFile) return stateFile;
  if (typeof dataDir === "string" && dataDir) {
    return join(dataDir, ACCOUNT_PROXY_BACKFILL_FILE);
  }
  const defaultProviders = providersFile(env);
  if (file && file !== defaultProviders) {
    return join(dirname(file), "magpie-clean-login", ACCOUNT_PROXY_BACKFILL_FILE);
  }
  return join(pluginDataDir(env), ACCOUNT_PROXY_BACKFILL_FILE);
}

async function readBackfillState(stateFile) {
  try {
    const text = await readFile(stateFile, "utf8");
    const doc = JSON.parse(text);
    const raw = doc?.synced;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Object.create(null);
    const out = Object.create(null);
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string" && v) out[k] = v;
    }
    return out;
  } catch {
    return Object.create(null);
  }
}

async function markBackfilledKeys(stateFile, keys) {
  const valid = [...new Set(keys.filter((k) => typeof k === "string" && k))];
  if (!valid.length) return;
  await serialized(stateFile, async () => {
    const synced = await readBackfillState(stateFile);
    let changed = false;
    const now = new Date().toISOString();
    for (const key of valid) {
      if (!Object.hasOwn(synced, key)) {
        synced[key] = now;
        changed = true;
      }
    }
    if (!changed) return;
    await writeAtomic(stateFile, `${JSON.stringify({ version: 1, synced }, null, 2)}\n`);
  });
}

async function unmarkBackfilledKey(stateFile, key) {
  if (typeof key !== "string" || !key) return;
  await serialized(stateFile, async () => {
    const synced = await readBackfillState(stateFile);
    if (!Object.hasOwn(synced, key)) return;
    delete synced[key];
    await writeAtomic(stateFile, `${JSON.stringify({ version: 1, synced }, null, 2)}\n`);
  });
}

// Reads providers.json once under the file lock so batch callers (such as
// account list projection) avoid N+1 reads while staying serialized against
// concurrent writers in this process.
export async function readProvidersSnapshot({
  env = process.env,
  file = providersFile(env),
} = {}) {
  return serialized(file, () => readProvidersDoc(file));
}

// Pure lookup against a snapshot returned by `readProvidersSnapshot()`.
export function extractAccountExitFromDoc(loaded, provider, accountId) {
  const key = accountProxyKey(accountId);
  if (!key || RESERVED_KEYS.has(key)) {
    return { ok: false, reason: "account_name_unknown", key };
  }
  if (!loaded || typeof loaded !== "object") {
    return { ok: false, reason: "providers_missing", key };
  }
  if (!loaded.ok) return { ...loaded, key };
  const entry = findProvider(loaded.doc, provider);
  if (!entry) return { ok: false, reason: "provider_missing", key };
  const providerProxy = entry.proxy ?? null;
  const map = accountProxyMap(entry);
  const value = Object.hasOwn(map, key) ? map[key] : undefined;
  if (value === "direct") {
    return { ok: true, mode: "direct", url: "direct", key, providerProxy };
  }
  if (typeof value === "string") {
    return { ok: true, mode: "custom", url: value, key, providerProxy };
  }
  return { ok: true, mode: "inherit", url: null, key, providerProxy };
}

// Reads the exit an account currently follows, for the page's "change exit"
// dialog. `inherit` means no entry, so the account follows `providerProxy`.
// Read failures return a structured reason instead of throwing, because the
// caller is a UI that must still render the provider's default.
export async function readAccountExit({
  env = process.env,
  provider,
  accountId,
  file = providersFile(env),
} = {}) {
  const key = accountProxyKey(accountId);
  if (!key || RESERVED_KEYS.has(key)) {
    return { ok: false, reason: "account_name_unknown", key };
  }

  return serialized(file, async () => {
    const loaded = await readProvidersDoc(file);
    return extractAccountExitFromDoc(loaded, provider, accountId);
  });
}

// Writes one account's exit in magpie's own three-state representation:
// `inherit` deletes the entry (fall back to the provider proxy), `direct`
// stores the literal `"direct"`, and `custom` stores the URL text. The file is
// re-read inside the serialized section before every write so a concurrent
// editor change is not lost, and the result is read back to prove the write
// landed. All expected failures are returned, never thrown.
export async function writeAccountExit({
  env = process.env,
  provider,
  accountId,
  mode,
  url = null,
  file = providersFile(env),
  dataDir = null,
  stateFile = null,
} = {}) {
  const key = accountProxyKey(accountId);
  if (!key || RESERVED_KEYS.has(key)) {
    return { ok: false, reason: "account_name_unknown", key };
  }

  let after;
  if (mode === "inherit") {
    after = null;
  } else if (mode === "direct") {
    after = "direct";
  } else if (mode === "custom") {
    const trimmed = typeof url === "string" ? url.trim() : "";
    if (!trimmed || !SCHEME.test(trimmed)) {
      return { ok: false, reason: "invalid_url", key };
    }
    after = trimmed;
  } else {
    return { ok: false, reason: "invalid_mode", key };
  }

  const resolvedStateFile = resolveBackfillStateFile({ env, file, dataDir, stateFile });
  const result = await serialized(file, async () => {
    const loaded = await readProvidersDoc(file);
    if (!loaded.ok) return { ...loaded, key };
    const entry = findProvider(loaded.doc, provider);
    if (!entry) return { ok: false, reason: "provider_missing", key };

    const map = accountProxyMap(entry);
    const before =
      Object.hasOwn(map, key) && typeof map[key] === "string" ? map[key] : null;
    if (before === after) {
      return { ok: true, mode, url: after, key, before, after, changed: false, reason: "unchanged" };
    }

    // Copy-on-write so a missing `accountProxies` becomes a fresh own object
    // and the original is never mutated in place before the atomic replace.
    if (!Object.hasOwn(entry, "accountProxies") || entry.accountProxies !== map) {
      entry.accountProxies = { ...map };
    }
    if (after === null) {
      // Deleting the last key keeps the empty map: magpie's editor expects the
      // property to exist, and removing it would change the record's shape.
      delete entry.accountProxies[key];
    } else {
      entry.accountProxies[key] = after;
    }

    await writeAtomic(file, `${JSON.stringify(loaded.doc, null, 2)}\n`);

    // Read the file back rather than trusting the in-memory document: only a
    // successful re-read proves magpie will observe the new value.
    const verified = await readProvidersDoc(file);
    if (!verified.ok) return { ...verified, key };
    const verifiedEntry = findProvider(verified.doc, provider);
    if (!verifiedEntry) return { ok: false, reason: "verify_failed", key };
    const verifiedMap = accountProxyMap(verifiedEntry);
    const actual = Object.hasOwn(verifiedMap, key) ? verifiedMap[key] : undefined;
    const landed = after === null ? actual === undefined : actual === after;
    if (!landed) return { ok: false, reason: "verify_failed", key };

    return { ok: true, mode, url: after, key, before, after, changed: true, reason: "written" };
  });

  if (result.ok) {
    const bKey = backfillStateKey(provider, accountId);
    if (bKey) await markBackfilledKeys(resolvedStateFile, [bKey]);
  }
  return result;
}

// A finished sign-in: the account's own entry follows the exit it just used.
// `proxy` is the full stored record (credentials included) when the page named
// a stored exit. A direct sign-in (`proxy == null`) leaves a clean account
// untouched so magpie keeps inheriting; if magpie already holds an entry for
// this account from an earlier exit, re-signing in as direct switches it to
// `"direct"` so traffic does not remain pinned to the stale proxy.
export async function syncSignInProxy({
  env = process.env,
  provider,
  accountId,
  proxy,
  file = providersFile(env),
  dataDir = null,
  stateFile = null,
} = {}) {
  const url = proxyUrlFor(proxy);
  const key = accountProxyKey(accountId);
  if (!key || RESERVED_KEYS.has(key) || !provider) {
    return { ok: true, changed: [], skipped: [], reason: "no_proxy" };
  }
  const resolvedStateFile = resolveBackfillStateFile({ env, file, dataDir, stateFile });
  const bKey = backfillStateKey(provider, accountId);
  if (!url) {
    if (proxy === null || proxy === undefined) {
      const loaded = await readProvidersDoc(file);
      const entry = loaded.ok ? findProvider(loaded.doc, provider) : null;
      const map = entry ? accountProxyMap(entry) : {};
      if (entry && Object.hasOwn(map, key) && map[key] !== "direct") {
        const res = await writeAccountExit({
          env,
          provider,
          accountId,
          mode: "direct",
          file,
          dataDir,
          stateFile: resolvedStateFile,
        });
        return {
          ok: res.ok,
          changed: res.changed ? [{ provider, accountId, key: res.key, url: "direct" }] : [],
          skipped: [],
          reason: res.changed ? "cleared_to_direct" : (res.reason ?? "no_proxy"),
        };
      }
      if (entry && bKey) {
        await markBackfilledKeys(resolvedStateFile, [bKey]);
      }
    }
    return { ok: true, changed: [], skipped: [], reason: "no_proxy" };
  }
  const res = await writeAccountProxies({ env, entries: [{ provider, accountId, url }], file });
  if (
    res.ok &&
    bKey &&
    (res.changed.length > 0 ||
      res.skipped.some((s) => s.reason === "unchanged" || s.reason === "already_set"))
  ) {
    await markBackfilledKeys(resolvedStateFile, [bKey]);
  }
  return res;
}

function accountActiveProxyId(meta) {
  const picked = meta?.exit && typeof meta.exit === "object" ? meta.exit : meta?.lastLogin;
  return typeof picked?.proxyId === "string" && picked.proxyId ? picked.proxyId : null;
}

// Startup backfill: every ledger that remembers which exit it is bound to
// (`exit`, falling back to `lastLogin`) gets that exit into magpie at most
// once, and only where magpie has no entry yet. Already-synced accounts are
// recorded in `account-proxy-backfill.json` so switching an account back to
// `inherit` in magpie (which deletes `accountProxies[key]`) does not rebound
// to historical `lastLogin` on the next restart.
export async function backfillAccountProxies({
  env = process.env,
  store,
  listAccounts = listAccountDirsWithMeta,
  file = providersFile(env),
  dataDir = null,
  stateFile = null,
} = {}) {
  const report = { ok: false, file, changed: [], skipped: [], reason: null, ledgers: 0 };
  let accounts;
  try {
    accounts = await listAccounts(env);
  } catch (error) {
    report.reason = "accounts_unreadable";
    report.error = String(error?.message ?? error);
    return report;
  }

  const resolvedStateFile = resolveBackfillStateFile({ env, file, dataDir, stateFile });
  const synced = await readBackfillState(resolvedStateFile);

  const wanted = [];
  const seen = new Set();
  let alreadyBackfilled = 0;
  for (const account of Array.isArray(accounts) ? accounts : []) {
    const meta = account?.meta;
    const proxyId = accountActiveProxyId(meta);
    const accountId = meta?.accountId;
    const provider = meta?.provider ?? account?.provider;
    const bKey = backfillStateKey(provider, accountId);
    if (!proxyId || !bKey) continue;
    report.ledgers += 1;
    if (seen.has(bKey)) continue;
    seen.add(bKey);
    if (Object.hasOwn(synced, bKey)) {
      alreadyBackfilled += 1;
      report.skipped.push({ provider, accountId, reason: "already_backfilled" });
      continue;
    }
    let url = null;
    try {
      url = proxyUrlFor(await store?.get?.(proxyId));
    } catch {
      url = null;
    }
    if (!url) {
      // The exit was deleted from the proxy list; there is nothing honest to
      // write, so the account keeps following the provider-level proxy.
      report.skipped.push({ provider, accountId, reason: "proxy_missing" });
      continue;
    }
    wanted.push({ provider, accountId, url });
  }

  if (!wanted.length) {
    report.ok = true;
    report.reason =
      alreadyBackfilled > 0
        ? "up_to_date"
        : report.ledgers
          ? "no_usable_exit"
          : "nothing_to_sync";
    return report;
  }
  const written = await writeAccountProxies({ env, entries: wanted, onlyMissing: true, file });
  if (written.ok) {
    const keysToMark = [];
    for (const item of written.changed) {
      const k = backfillStateKey(item.provider, item.key);
      if (k) keysToMark.push(k);
    }
    for (const item of written.skipped) {
      if (item.reason === "already_set" || item.reason === "unchanged") {
        const k = backfillStateKey(item.provider, item.key);
        if (k) keysToMark.push(k);
      }
    }
    if (keysToMark.length) await markBackfilledKeys(resolvedStateFile, keysToMark);
  }
  return { ...written, ledgers: report.ledgers, skipped: [...report.skipped, ...written.skipped] };
}

// Re-sync every account pointing at a proxy after its connection or credentials
// change. When `previousUrl` is supplied (the normal HTTP path), magpie's
// `providers.json` is scanned directly and every `accountProxies` entry matching
// the old URL (exact or canonical) is updated — catching accounts bound directly
// in magpie while never overwriting accounts switched to `direct`, `inherit`, or
// another proxy. When `previousUrl` is omitted (legacy callers), falls back to
// scanning account ledgers bound to `proxyId`.
export async function syncProxyUpdate({
  env = process.env,
  store,
  proxyId,
  previousUrl = null,
  listAccounts = listAccountDirsWithMeta,
  file = providersFile(env),
} = {}) {
  if (typeof proxyId !== "string" || !proxyId) {
    return { ok: false, file, changed: [], skipped: [], reason: "invalid_proxy" };
  }
  let record = null;
  try {
    record = await store?.get?.(proxyId);
  } catch {
    record = null;
  }
  const url = proxyUrlFor(record);
  const prevRaw = typeof previousUrl === "string" ? previousUrl.trim() : "";

  if (prevRaw) {
    if (!url) {
      return { ok: false, file, changed: [], skipped: [], reason: "proxy_missing" };
    }
    if (prevRaw === url) {
      return { ok: true, file, changed: [], skipped: [], reason: "up_to_date" };
    }
    const prevCanonical = canonicalProxyUrl(prevRaw);
    return serialized(file, async () => {
      const loaded = await readProvidersDoc(file);
      if (!loaded.ok) {
        return {
          ok: false,
          file,
          changed: [],
          skipped: [],
          reason: loaded.reason,
          ...(loaded.error ? { error: loaded.error } : {}),
        };
      }
      const changed = [];
      const skipped = [];
      for (const providerEntry of loaded.doc.providers) {
        if (!providerEntry || typeof providerEntry !== "object" || Array.isArray(providerEntry)) {
          continue;
        }
        const providerId = typeof providerEntry.id === "string" ? providerEntry.id : "";
        if (!providerId) continue;
        const map = accountProxyMap(providerEntry);
        for (const [key, current] of Object.entries(map)) {
          if (RESERVED_KEYS.has(key) || typeof current !== "string" || current === "direct") {
            continue;
          }
          const matched =
            current === prevRaw ||
            (prevCanonical !== null && canonicalProxyUrl(current) === prevCanonical);
          if (!matched) continue;
          if (current === url) {
            skipped.push({ provider: providerId, key, url, reason: "unchanged" });
            continue;
          }
          if (!Object.hasOwn(providerEntry, "accountProxies") || providerEntry.accountProxies !== map) {
            providerEntry.accountProxies = { ...map };
          }
          providerEntry.accountProxies[key] = url;
          changed.push({ provider: providerId, key, url });
        }
      }
      if (!changed.length) {
        return {
          ok: true,
          file,
          changed,
          skipped,
          reason: skipped.length ? "up_to_date" : "nothing_to_sync",
        };
      }
      await writeAtomic(file, `${JSON.stringify(loaded.doc, null, 2)}\n`);
      return { ok: true, file, changed, skipped, reason: "written" };
    });
  }

  let accounts;
  try {
    accounts = await listAccounts(env);
  } catch (error) {
    return {
      ok: false,
      file,
      changed: [],
      skipped: [],
      reason: "accounts_unreadable",
      error: String(error?.message ?? error),
    };
  }
  const entries = [];
  const seen = new Set();
  for (const account of Array.isArray(accounts) ? accounts : []) {
    const meta = account?.meta;
    if (accountActiveProxyId(meta) !== proxyId) continue;
    const accountId = meta?.accountId;
    const provider = meta?.provider ?? account?.provider;
    const accountKey = accountProxyKey(accountId);
    if (!provider || !accountKey || RESERVED_KEYS.has(accountKey)) continue;
    const dedupeKey = `${provider}\u0000${accountKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    entries.push({ provider, accountId, url });
  }
  if (!entries.length) {
    return { ok: true, file, changed: [], skipped: [], reason: "nothing_to_sync" };
  }
  if (!url) {
    return {
      ok: false,
      file,
      changed: [],
      skipped: entries.map(({ provider, accountId }) => ({
        provider,
        accountId,
        reason: "proxy_missing",
      })),
      reason: "proxy_missing",
    };
  }
  return writeAccountProxies({ env, entries, onlyMissing: false, file });
}

// Removes an account's per-account proxy override from magpie's providers.json
// when the account is deleted.
export async function clearAccountProxy({
  env = process.env,
  provider,
  accountId,
  file = providersFile(env),
  dataDir = null,
  stateFile = null,
} = {}) {
  const key = accountProxyKey(accountId);
  if (!provider || !key || RESERVED_KEYS.has(key)) {
    return { ok: true, changed: false, reason: "account_name_unknown" };
  }
  const resolvedStateFile = resolveBackfillStateFile({ env, file, dataDir, stateFile });
  const bKey = backfillStateKey(provider, accountId);
  const loaded = await readProvidersDoc(file);
  if (!loaded.ok) {
    if (bKey) await unmarkBackfilledKey(resolvedStateFile, bKey);
    return loaded.reason === "providers_missing"
      ? { ok: true, changed: false, reason: "providers_missing" }
      : { ok: false, changed: false, reason: loaded.reason };
  }
  const entry = findProvider(loaded.doc, provider);
  if (!entry) {
    if (bKey) await unmarkBackfilledKey(resolvedStateFile, bKey);
    return { ok: true, changed: false, reason: "provider_missing" };
  }
  const map = accountProxyMap(entry);
  if (!Object.hasOwn(map, key)) {
    if (bKey) await unmarkBackfilledKey(resolvedStateFile, bKey);
    return { ok: true, changed: false, reason: "unchanged" };
  }
  const res = await writeAccountExit({
    env,
    provider,
    accountId,
    mode: "inherit",
    file,
    dataDir,
    stateFile: resolvedStateFile,
  });
  if (res.ok && bKey) await unmarkBackfilledKey(resolvedStateFile, bKey);
  return { ok: res.ok, changed: Boolean(res.changed), reason: res.reason };
}

// The flow's default: build the sync from the environment alone, so a sign-in
// driven without the HTTP service still lands in magpie. The proxy store is
// only read here, never written.
export function createAccountProxySync({ env = process.env, store, dataDir = pluginDataDir(env) } = {}) {
  let lazyStore = store ?? null;
  async function ensureStore() {
    if (!lazyStore) {
      const { createProxyStore } = await import("./proxies.mjs");
      lazyStore = createProxyStore({ dataDir });
    }
    return lazyStore;
  }
  return {
    syncSignIn: async ({ provider, accountId, proxy }) => {
      let record = proxy;
      if (record && !proxyUrlFor(record) && typeof record.id === "string" && record.id) {
        record = await (await ensureStore()).get(record.id);
      }
      return syncSignInProxy({ env, provider, accountId, proxy: record, dataDir });
    },
    syncProxyUpdate: async ({ proxyId, previousUrl } = {}) =>
      syncProxyUpdate({ env, store: await ensureStore(), proxyId, previousUrl }),
    clearAccountProxy: async ({ provider, accountId }) =>
      clearAccountProxy({ env, provider, accountId, dataDir }),
    backfill: async () =>
      backfillAccountProxies({ env, store: await ensureStore(), dataDir }),
  };
}
