// Unified effective-exit resolution for clean-login, using magpie's
// `providers.json` as the single source of truth (SSOT).
//
// Shared by the accounts list, the account detail exit dialog, hosted renewal,
// agent/CLI output, and downstream features (such as opening a provider
// account's fingerprint browser) so every consumer resolves the exact same
// network exit and obeys the same credential boundary.
//
// Boundary note: clean-login only reads `<MAGPIE_CONFIG_DIR>/providers.json`
// (not magpie's other global proxy configuration files). When an account is in
// `inherit` mode and the provider's own `proxy` field is empty or `"direct"`,
// the effective exit resolves as `"direct"`.

import {
  accountProxyKey,
  canonicalProxyUrl,
  exitDisplayUrl,
  extractAccountExitFromDoc,
  parseProxyUrl,
  providersFile,
  proxyUrlFor,
  readAccountExit,
  readProvidersSnapshot,
} from "./account-proxies.mjs";
import { readAuthEntries } from "./signin-writeback.mjs";
import { readNativeLoginsResult } from "./magpie-logins.mjs";

export {
  accountProxyKey,
  canonicalProxyUrl,
  exitDisplayUrl,
  parseProxyUrl,
  proxyUrlFor,
  readProvidersSnapshot,
};

// Derives the account name that magpie keys `providers[].accountProxies` by.
// Preference order matches clean-login's ledger and magpie's auth stores:
//   1. `meta.accountId`
//   2. `authEntries[key].accountId`
//   3. `authEntries[key].email`
//   4. `nativeEntries.find(e => e.key === key).email`
// Returns `""` when no name is known so callers receive `account_name_unknown`.
export function resolveAccountProxyName({
  meta = null,
  key = "",
  authEntries,
  nativeEntries,
  env = process.env,
} = {}) {
  const fromMeta = typeof meta?.accountId === "string" ? meta.accountId.trim() : "";
  if (fromMeta) return fromMeta;
  const k = typeof key === "string" ? key : "";
  if (!k) return "";
  const auth = authEntries !== undefined ? authEntries : readAuthEntries(env);
  const authEntry = auth && typeof auth === "object" ? auth[k] : null;
  const fromAuthId = typeof authEntry?.accountId === "string" ? authEntry.accountId.trim() : "";
  if (fromAuthId) return fromAuthId;
  const fromAuthEmail = typeof authEntry?.email === "string" ? authEntry.email.trim() : "";
  if (fromAuthEmail) return fromAuthEmail;
  const native =
    nativeEntries !== undefined
      ? nativeEntries
      : (readNativeLoginsResult(env)?.entries ?? []);
  if (Array.isArray(native)) {
    const match = native.find((entry) => entry?.key === k);
    const fromNative = typeof match?.email === "string" ? match.email.trim() : "";
    if (fromNative) return fromNative;
  }
  return "";
}

// Builds a URL -> stored proxy record lookup map once for batch resolution,
// indexing both the exact URL emitted by `proxyUrlFor()` and its canonical form
// (e.g. default port / percent-encoding normalization). Safe when `store` only
// implements `get()` (e.g. minimal unit-test fakes without `list()`).
export async function buildProxyUrlMap(store) {
  const map = new Map();
  if (!store || typeof store.list !== "function" || typeof store.get !== "function") {
    return map;
  }
  let items;
  try {
    items = await store.list();
  } catch {
    return map;
  }
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.id) continue;
    let record = null;
    try {
      record = await store.get(item.id);
    } catch {
      record = null;
    }
    const raw = proxyUrlFor(record);
    if (!raw) continue;
    if (!map.has(raw)) map.set(raw, record);
    const canonical = canonicalProxyUrl(raw);
    if (canonical && !map.has(canonical)) map.set(canonical, record);
  }
  return map;
}

export function lookupProxyByUrl(proxyByUrl, rawUrl) {
  if (!proxyByUrl || typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (proxyByUrl.has(trimmed)) return proxyByUrl.get(trimmed);
  const canonical = canonicalProxyUrl(trimmed);
  if (canonical && proxyByUrl.has(canonical)) return proxyByUrl.get(canonical);
  return null;
}

// Pure credential-free public projection of a `resolveEffectiveAccountExit()`
// result. Safe to serialize in HTTP responses, CLI output, UI state, and logs:
// never contains `proxy`, `username`, `password`, raw URLs, or OS error paths.
export function publicAccountExit(resolved) {
  if (!resolved || typeof resolved !== "object") {
    return {
      ok: false,
      reason: "exit_unknown",
      mode: null,
      accountKey: null,
      providerProxy: null,
    };
  }
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason ?? "exit_unknown",
      mode: resolved.mode ?? null,
      accountKey: resolved.accountKey ?? null,
      providerProxy: exitDisplayUrl(resolved.providerProxy),
    };
  }
  return {
    ok: true,
    mode: resolved.mode ?? null,
    effectiveMode: resolved.effectiveMode ?? null,
    source: resolved.source ?? null,
    accountKey: resolved.accountKey ?? null,
    matchedStore: Boolean(resolved.matchedStore),
    proxyId: resolved.proxyId ?? null,
    proxyName: resolved.proxyName ?? "",
    region: resolved.region ?? "",
    type: resolved.type ?? null,
    displayUrl: exitDisplayUrl(resolved.displayUrl),
    providerProxy: exitDisplayUrl(resolved.providerProxy),
  };
}

function attachPublic(result) {
  return { ...result, public: publicAccountExit(result) };
}

function ledgerExitSnapshot(meta) {
  if (meta?.exit && typeof meta.exit === "object") {
    return { ledger: meta.exit, source: "ledger_exit" };
  }
  if (meta?.lastLogin && typeof meta.lastLogin === "object") {
    return { ledger: meta.lastLogin, source: "ledger_last_login" };
  }
  return { ledger: null, source: null };
}

// Resolves the effective network exit for one account.
//
// Returns an internal runtime result containing:
// - `ok`: boolean
// - `mode`: `"custom" | "direct" | "inherit" | null`
// - `effectiveMode`: `"proxy" | "direct" | null`
// - `source`: `"providers_account" | "providers_provider" | "providers_direct" | "ledger_exit" | "ledger_last_login" | "providers_error" | null`
// - `accountKey`: lower-cased magpie accountProxies key (or `""`)
// - `matchedStore`: whether the effective proxy matched a stored node in `proxies.json`
// - `proxy`: full runtime proxy object (stored node record or `parseProxyUrl()` output) when `effectiveMode === "proxy"`, else `null`
// - `proxyMeta`: credential-free `{ id, name, region, type }` for `signin-flow` / ledger writes, else `null`
// - `proxyId`, `proxyName`, `region`, `type`, `displayUrl`, `providerProxy`
// - `reason`: error code when `ok === false` (`"providers_invalid"`, `"providers_unreadable"`, `"invalid_exit_url"`, `"exit_missing"`, `"exit_unknown"`, or providers read reason when `fallbackToLedger === false`)
// - `public`: strictly credential-free projection from `publicAccountExit()`
export async function resolveEffectiveAccountExit({
  env = process.env,
  provider,
  key = "",
  meta = null,
  store = null,
  authEntries,
  nativeEntries,
  proxyByUrl = null,
  providersDoc = null,
  file = providersFile(env),
  fallbackToLedger = true,
} = {}) {
  const accountId = resolveAccountProxyName({ meta, key, authEntries, nativeEntries, env });
  const accountKey = accountProxyKey(accountId);
  const read =
    providersDoc !== null && providersDoc !== undefined
      ? extractAccountExitFromDoc(providersDoc, provider, accountId)
      : await readAccountExit({ env, provider, accountId, file });

  let urlMap = proxyByUrl;
  async function ensureUrlMap() {
    if (!urlMap) {
      urlMap = await buildProxyUrlMap(store);
    }
    return urlMap;
  }

  async function resolveProxyUrl(rawUrl, { mode, source, providerProxy }) {
    const safeProviderProxy = exitDisplayUrl(providerProxy);
    const matched = lookupProxyByUrl(await ensureUrlMap(), rawUrl);
    if (matched) {
      const type = String(matched.type ?? "http").toLowerCase();
      const displayUrl = exitDisplayUrl(rawUrl) ?? exitDisplayUrl(proxyUrlFor(matched));
      return attachPublic({
        ok: true,
        mode,
        effectiveMode: "proxy",
        source,
        accountKey: read.key ?? accountKey,
        matchedStore: true,
        proxy: matched,
        proxyId: matched.id,
        proxyName: matched.name ?? "",
        region: matched.region ?? "",
        type,
        displayUrl,
        providerProxy: safeProviderProxy,
        proxyMeta: {
          id: matched.id,
          name: matched.name ?? "",
          region: matched.region ?? "",
          type,
        },
        reason: null,
      });
    }

    const parsed = parseProxyUrl(rawUrl);
    if (!parsed) {
      return attachPublic({
        ok: false,
        mode,
        effectiveMode: null,
        source,
        accountKey: read.key ?? accountKey,
        matchedStore: false,
        proxy: null,
        proxyId: null,
        proxyName: "",
        region: "",
        type: null,
        displayUrl: null,
        providerProxy: safeProviderProxy,
        proxyMeta: null,
        reason: "invalid_exit_url",
      });
    }

    const displayUrl = exitDisplayUrl(rawUrl) ?? parsed.server;
    return attachPublic({
      ok: true,
      mode,
      effectiveMode: "proxy",
      source,
      accountKey: read.key ?? accountKey,
      matchedStore: false,
      proxy: parsed,
      proxyId: null,
      proxyName: "",
      region: "",
      type: parsed.type,
      displayUrl,
      providerProxy: safeProviderProxy,
      proxyMeta: {
        id: null,
        name: "",
        region: "",
        type: parsed.type,
      },
      reason: null,
    });
  }

  if (read.ok) {
    const safeProviderProxy = exitDisplayUrl(read.providerProxy);
    if (read.mode === "custom") {
      return resolveProxyUrl(read.url, {
        mode: "custom",
        source: "providers_account",
        providerProxy: read.providerProxy,
      });
    }
    if (read.mode === "direct") {
      return attachPublic({
        ok: true,
        mode: "direct",
        effectiveMode: "direct",
        source: "providers_direct",
        accountKey: read.key,
        matchedStore: false,
        proxy: null,
        proxyId: null,
        proxyName: "",
        region: "",
        type: null,
        displayUrl: null,
        providerProxy: safeProviderProxy,
        proxyMeta: null,
        reason: null,
      });
    }
    // `mode === "inherit"`: follow provider-level proxy if configured.
    const providerRaw = typeof read.providerProxy === "string" ? read.providerProxy.trim() : "";
    if (providerRaw && providerRaw !== "direct") {
      return resolveProxyUrl(providerRaw, {
        mode: "inherit",
        source: "providers_provider",
        providerProxy: read.providerProxy,
      });
    }
    return attachPublic({
      ok: true,
      mode: "inherit",
      effectiveMode: "direct",
      source: "providers_provider",
      accountKey: read.key,
      matchedStore: false,
      proxy: null,
      proxyId: null,
      proxyName: "",
      region: "",
      type: null,
      displayUrl: null,
      providerProxy: safeProviderProxy,
      proxyMeta: null,
      reason: null,
    });
  }

  // Corrupt or unreadable providers.json must fail explicitly and never degrade
  // to direct or silently trust stale ledger state.
  if (read.reason === "providers_invalid" || read.reason === "providers_unreadable") {
    return attachPublic({
      ok: false,
      mode: null,
      effectiveMode: null,
      source: "providers_error",
      accountKey: read.key ?? accountKey,
      matchedStore: false,
      proxy: null,
      proxyId: null,
      proxyName: "",
      region: "",
      type: null,
      displayUrl: null,
      providerProxy: null,
      proxyMeta: null,
      reason: read.reason,
    });
  }

  if (!fallbackToLedger) {
    return attachPublic({
      ok: false,
      mode: null,
      effectiveMode: null,
      source: null,
      accountKey: read.key ?? accountKey,
      matchedStore: false,
      proxy: null,
      proxyId: null,
      proxyName: "",
      region: "",
      type: null,
      displayUrl: null,
      providerProxy: null,
      proxyMeta: null,
      reason: read.reason ?? "exit_unknown",
    });
  }

  // Fallback to account ledger only when providers.json is missing, lacks this
  // provider, or the account name is unknown.
  const { ledger, source } = ledgerExitSnapshot(meta);
  if (!ledger) {
    return attachPublic({
      ok: false,
      mode: null,
      effectiveMode: null,
      source: null,
      accountKey: read.key ?? accountKey,
      matchedStore: false,
      proxy: null,
      proxyId: null,
      proxyName: "",
      region: "",
      type: null,
      displayUrl: null,
      providerProxy: null,
      proxyMeta: null,
      reason: "exit_unknown",
    });
  }
  if (ledger.proxyId === null) {
    return attachPublic({
      ok: true,
      mode: "direct",
      effectiveMode: "direct",
      source,
      accountKey: read.key ?? accountKey,
      matchedStore: false,
      proxy: null,
      proxyId: null,
      proxyName: "",
      region: "",
      type: null,
      displayUrl: null,
      providerProxy: null,
      proxyMeta: null,
      reason: null,
    });
  }
  if (typeof ledger.proxyId === "string" && ledger.proxyId) {
    let stored = null;
    try {
      stored = await store?.get?.(ledger.proxyId);
    } catch {
      stored = null;
    }
    if (!stored) {
      return attachPublic({
        ok: false,
        mode: "custom",
        effectiveMode: null,
        source,
        accountKey: read.key ?? accountKey,
        matchedStore: false,
        proxy: null,
        proxyId: ledger.proxyId,
        proxyName: "",
        region: "",
        type: null,
        displayUrl: null,
        providerProxy: null,
        proxyMeta: null,
        reason: "exit_missing",
      });
    }
    const type = String(stored.type ?? "http").toLowerCase();
    const displayUrl = exitDisplayUrl(proxyUrlFor(stored));
    return attachPublic({
      ok: true,
      mode: "custom",
      effectiveMode: "proxy",
      source,
      accountKey: read.key ?? accountKey,
      matchedStore: true,
      proxy: stored,
      proxyId: stored.id,
      proxyName: stored.name ?? "",
      region: stored.region ?? "",
      type,
      displayUrl,
      providerProxy: null,
      proxyMeta: {
        id: stored.id,
        name: stored.name ?? "",
        region: stored.region ?? "",
        type,
      },
      reason: null,
    });
  }

  return attachPublic({
    ok: false,
    mode: null,
    effectiveMode: null,
    source: null,
    accountKey: read.key ?? accountKey,
    matchedStore: false,
    proxy: null,
    proxyId: null,
    proxyName: "",
    region: "",
    type: null,
    displayUrl: null,
    providerProxy: null,
    proxyMeta: null,
    reason: "exit_unknown",
  });
}

// Projects a `resolveEffectiveAccountExit()` result into the credential-free
// `account.exit` view shape used by `GET /api/accounts`, `PATCH /exit`,
// `PATCH /accounts/:provider/:key`, and `GET /api/agent`.
//
// Returns `undefined` when providers.json could not authoritatively resolve the
// account (missing file / provider / account name / corrupt file), so callers
// keep any existing ledger `extras.exit` unchanged.
export function accountExitProjection(resolved, ledgerExit = null) {
  if (!resolved || typeof resolved !== "object") return undefined;

  if (!resolved.ok) {
    if (resolved.reason === "invalid_exit_url") {
      return {
        at: null,
        proxyId: null,
        proxyName: "",
        region: "",
        type: null,
        ...(resolved.mode === "inherit" ? { mode: "inherit" } : {}),
        custom: true,
        displayUrl: null,
      };
    }
    return undefined;
  }

  const fromProviders =
    resolved.source === "providers_account" ||
    resolved.source === "providers_provider" ||
    resolved.source === "providers_direct";
  if (!fromProviders) return undefined;

  if (resolved.mode === "custom") {
    if (resolved.matchedStore) {
      const sameNode =
        ledgerExit &&
        typeof ledgerExit === "object" &&
        ledgerExit.proxyId === resolved.proxyId;
      return {
        at: sameNode ? (ledgerExit.at ?? null) : null,
        proxyId: resolved.proxyId,
        proxyName: resolved.proxyName ?? "",
        region: resolved.region ?? "",
        type: resolved.type ?? null,
      };
    }
    return {
      at: null,
      proxyId: null,
      proxyName: "",
      region: "",
      type: resolved.type ?? null,
      custom: true,
      displayUrl: exitDisplayUrl(resolved.displayUrl),
    };
  }

  if (resolved.mode === "direct") {
    const ledgerWasDirect =
      ledgerExit &&
      typeof ledgerExit === "object" &&
      ledgerExit.proxyId === null &&
      !ledgerExit.custom &&
      ledgerExit.mode !== "inherit";
    return {
      at: ledgerWasDirect ? (ledgerExit.at ?? null) : null,
      proxyId: null,
      proxyName: "",
      region: "",
      type: null,
    };
  }

  if (resolved.mode === "inherit") {
    if (resolved.effectiveMode === "proxy") {
      const displayUrl = exitDisplayUrl(resolved.displayUrl ?? resolved.providerProxy);
      if (resolved.matchedStore) {
        return {
          at: null,
          proxyId: resolved.proxyId,
          proxyName: resolved.proxyName ?? "",
          region: resolved.region ?? "",
          type: resolved.type ?? null,
          mode: "inherit",
          displayUrl,
        };
      }
      return {
        at: null,
        proxyId: null,
        proxyName: "",
        region: "",
        type: resolved.type ?? null,
        mode: "inherit",
        custom: true,
        displayUrl,
      };
    }
    return {
      at: null,
      proxyId: null,
      proxyName: "",
      region: "",
      type: null,
      mode: "inherit",
    };
  }

  return undefined;
}
