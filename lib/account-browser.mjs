// Per-account fingerprint browser controller.
//
// Lets a user open an account's own persistent Camoufox profile with its pinned
// fingerprint and live effective exit (from magpie's `providers.json`, with
// ledger fallback when `providers.json` is unavailable) outside of a sign-in or
// hosted renewal flow.
//
// Invariants enforced here:
//   * Read-only on account state: NEVER calls `ensureIdentity`, NEVER mutates
//     `providers.json`, `account.json`, `identity.json`, or magpie auth files.
//   * Strict exit boundary: a corrupt `providers.json` or invalid/missing exit
//     fails explicitly (409) and never silently degrades to direct. Direct exits
//     configured explicitly or inherited with no provider proxy are allowed.
//   * Credential boundary: proxy credentials reach `launchBrowser` in memory
//     only. All returned views (`open`, `status`, `listOpen`) carry only the
//     whitelisted `publicAccountExit` projection; the exit change detector keeps
//     only a SHA-256 digest in memory and never returns it.
//   * Per-account isolation & mutex: different accounts may open browsers at
//     the same time; the same account allows at most one browser (including
//     in-flight starts) and cannot overlap with its own sign-in or hosted
//     renewal.

import { createHash } from "node:crypto";
import { EXECUTABLE_ENV } from "./browser-environment.mjs";
import {
  accountDir,
  accountProfileDir,
  readAccountMeta,
  readIdentity as defaultReadIdentity,
} from "./account-identity.mjs";
import {
  parseProxyUrl,
  publicAccountExit,
  resolveEffectiveAccountExit,
} from "./account-exit.mjs";
import {
  launchSignInBrowser,
  navigationWarning,
  toPlaywrightProxy,
} from "./browser-launcher.mjs";

const BLANK_URL = "about:blank";
const NON_AUTHORITATIVE_PROVIDERS_REASONS = new Set([
  "providers_missing",
  "provider_missing",
  "account_name_unknown",
]);

export class AccountBrowserError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = "AccountBrowserError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeOpenUrl(rawUrl) {
  if (rawUrl === undefined || rawUrl === null) return BLANK_URL;
  if (typeof rawUrl !== "string") {
    throw new AccountBrowserError("invalid_url", "The browser URL must be a string.", 400);
  }
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.toLowerCase() === BLANK_URL) return BLANK_URL;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new AccountBrowserError("invalid_url", "The browser URL is invalid.", 400);
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AccountBrowserError("invalid_url", "The browser URL is invalid.", 400);
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    throw new AccountBrowserError(
      "invalid_url",
      "Only http:, https:, or about:blank URLs are allowed.",
      400,
    );
  }
  if (parsed.username || parsed.password) {
    throw new AccountBrowserError(
      "invalid_url",
      "Browser URLs must not contain embedded credentials.",
      400,
    );
  }
  return parsed.href;
}

function entryId(provider, key) {
  return `${provider}\u0000${key}`;
}

function closedStatus() {
  return { open: false, openedAt: null, exit: null, exitChanged: false };
}

function normalizeProxyForDigest(proxy) {
  if (!proxy || typeof proxy !== "object") return null;
  if (typeof proxy.server === "string" && proxy.server) {
    return toPlaywrightProxy(proxy);
  }
  let normalized = null;
  if (typeof proxy.type === "string") {
    normalized = toPlaywrightProxy({ ...proxy, type: proxy.type.trim().toLowerCase() });
  } else {
    normalized = toPlaywrightProxy(proxy);
  }
  if (!normalized && typeof proxy.url === "string") {
    normalized = toPlaywrightProxy(parseProxyUrl(proxy.url));
  }
  return normalized;
}

// Internal SHA-256 fingerprint of the effective exit used to launch a browser.
// Kept strictly in process memory and never serialized to callers.
function computeExitDigest(resolved) {
  if (!resolved || typeof resolved !== "object" || !resolved.ok) return null;
  const pw = normalizeProxyForDigest(resolved.proxy);
  const effectiveMode = resolved.effectiveMode ?? (pw ? "proxy" : "direct");
  if (effectiveMode === "proxy" && !pw) return null;
  const payload = {
    effectiveMode,
    mode: resolved.mode ?? null,
    proxyId: resolved.proxyId ?? null,
    server: effectiveMode === "proxy" ? (pw?.server ?? null) : null,
    username: effectiveMode === "proxy" ? (pw?.username ?? "") : "",
    password: effectiveMode === "proxy" ? (pw?.password ?? "") : "",
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function translateLaunchError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "executable_missing") {
    return new AccountBrowserError(
      "executable_missing",
      "The fingerprint browser is not installed; prepare it on the Providers page first.",
      503,
    );
  }
  if (code === "runtime_missing") {
    return new AccountBrowserError(
      "runtime_missing",
      "The fingerprint browser runtime is unavailable; prepare it on the Providers page first.",
      503,
    );
  }
  if (code === "launch_timeout") {
    return new AccountBrowserError(
      "launch_timeout",
      "The account browser did not open in time.",
      504,
    );
  }
  if (code === "invalid_url") {
    return new AccountBrowserError(
      "invalid_url",
      "Only http:, https:, or about:blank URLs are allowed.",
      400,
    );
  }
  return new AccountBrowserError(
    "launch_failed",
    "The account browser could not be opened.",
    502,
  );
}

function exitFailureMessage(reason, store) {
  if (reason === "providers_invalid") {
    return "magpie's providers.json is malformed, so the account exit cannot be resolved.";
  }
  if (reason === "providers_unreadable") {
    return "magpie's providers.json could not be read, so the account exit cannot be resolved.";
  }
  if (reason === "invalid_exit_url") {
    return "The proxy address configured in magpie's providers.json is invalid; fix it before opening the account browser.";
  }
  if (reason === "exit_missing") {
    return !store || typeof store.get !== "function"
      ? "The proxy list is unavailable, so the account exit cannot be resolved."
      : "The exit assigned to this account is no longer in the proxy list. Restore it or assign another exit first.";
  }
  return "This account has no resolvable exit; configure an exit or sign in through clean-login first.";
}

export function createAccountBrowserController({
  env = process.env,
  store = null,
  signIn = null,
  renewHosting = null,
  resolveExecutable,
  launchBrowser = launchSignInBrowser,
  readMeta = readAccountMeta,
  readIdentity = defaultReadIdentity,
  resolveExit = resolveEffectiveAccountExit,
  now = () => new Date().toISOString(),
} = {}) {
  const active = new Map();
  const starting = new Set();
  let shutdownGeneration = 0;

  const getExecutable =
    typeof resolveExecutable === "function"
      ? resolveExecutable
      : async () => env?.[EXECUTABLE_ENV] || null;

  function assertNoConflict(provider, key) {
    const renewal = typeof renewHosting?.running === "function" ? renewHosting.running() : null;
    if (renewal && renewal.provider === provider && renewal.key === key) {
      throw new AccountBrowserError(
        "renewal_running",
        "Hosted renewal is currently running for this account; wait for it to finish before opening the browser.",
        409,
      );
    }
    const activeSignIn =
      typeof signIn?.activeAccount === "function" ? signIn.activeAccount() : null;
    if (activeSignIn && activeSignIn.provider === provider && activeSignIn.key === key) {
      throw new AccountBrowserError(
        "signin_running",
        "A sign-in or fingerprint rotation is currently running for this account; wait for it to finish before opening the browser.",
        409,
      );
    }
  }

  function isOpen(provider, key) {
    if (typeof provider !== "string" || !provider || typeof key !== "string" || !key) {
      return false;
    }
    const id = entryId(provider, key);
    return starting.has(id) || active.has(id);
  }

  function listOpen() {
    return [...active.values()].map((entry) => ({
      provider: entry.provider,
      key: entry.key,
      openedAt: entry.openedAt,
      exit: { ...entry.exitPublic },
    }));
  }

  async function status(provider, key, { liveResolved = null } = {}) {
    if (typeof provider !== "string" || !provider || typeof key !== "string" || !key) {
      return closedStatus();
    }
    const entry = active.get(entryId(provider, key));
    if (!entry) return closedStatus();

    let live = liveResolved;
    const needsFallbackResolve =
      live === null ||
      live === undefined ||
      (!live.ok && NON_AUTHORITATIVE_PROVIDERS_REASONS.has(live.reason));
    if (needsFallbackResolve) {
      try {
        const dir = accountDir(env, provider, key);
        const meta = await readMeta(dir);
        live = await resolveExit({
          env,
          provider,
          key,
          meta,
          store,
          fallbackToLedger: true,
        });
      } catch {
        live = null;
      }
    }

    const liveDigest = computeExitDigest(live);
    const exitChanged = liveDigest === null || liveDigest !== entry.exitDigest;
    return {
      open: true,
      openedAt: entry.openedAt,
      exit: { ...entry.exitPublic },
      exitChanged,
      ...(entry.warning ? { warning: { ...entry.warning } } : {}),
    };
  }

  async function open({ provider, key, url } = {}) {
    if (typeof provider !== "string" || !provider.trim() || typeof key !== "string" || !key.trim()) {
      throw new AccountBrowserError("invalid_account", "Provider and account key are required.", 400);
    }
    const targetUrl = normalizeOpenUrl(url);
    const id = entryId(provider, key);
    if (active.has(id) || starting.has(id)) {
      throw new AccountBrowserError(
        "browser_already_open",
        "A fingerprint browser is already open for this account.",
        409,
      );
    }

    starting.add(id);
    const gen = shutdownGeneration;
    try {
      const dir = accountDir(env, provider, key);
      const meta = await readMeta(dir);
      if (!meta || meta.provider !== provider) {
        throw new AccountBrowserError("not_found", "This account was not found.", 404);
      }

      assertNoConflict(provider, key);

      // Strictly read-only: NEVER call ensureIdentity or synthesize a new pin.
      const identity = await readIdentity(dir);
      if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
        throw new AccountBrowserError(
          "identity_missing",
          "This account has no pinned fingerprint; sign in through clean-login first.",
          409,
        );
      }

      const resolved = await resolveExit({
        env,
        provider,
        key,
        meta,
        store,
        fallbackToLedger: true,
      });
      if (!resolved?.ok) {
        const reason = resolved?.reason || "exit_unknown";
        throw new AccountBrowserError(reason, exitFailureMessage(reason, store), 409);
      }

      const exitDigest = computeExitDigest(resolved);
      if (!exitDigest) {
        throw new AccountBrowserError(
          "invalid_exit_url",
          exitFailureMessage("invalid_exit_url", store),
          409,
        );
      }

      let executablePath;
      try {
        executablePath = await getExecutable();
      } catch {
        executablePath = null;
      }
      if (typeof executablePath !== "string" || !executablePath.trim()) {
        throw new AccountBrowserError(
          "executable_missing",
          "The fingerprint browser is not installed; prepare it on the Providers page first.",
          503,
        );
      }

      assertNoConflict(provider, key);

      let handle;
      try {
        handle = await launchBrowser({
          executablePath,
          url: targetUrl,
          profileDir: accountProfileDir(dir),
          identity,
          proxy: resolved.effectiveMode === "proxy" ? resolved.proxy : null,
          headless: false,
          purpose: "account",
          env,
        });
      } catch (error) {
        throw translateLaunchError(error);
      }

      if (gen !== shutdownGeneration) {
        try {
          await handle?.close?.();
        } catch {
          // Best-effort cleanup if closeAll() raced with an in-flight launch.
        }
        throw new AccountBrowserError(
          "browser_closed",
          "The account browser was closed during shutdown.",
          409,
        );
      }

      const openedAt = now();
      const exitPublic = publicAccountExit(resolved);
      const warning = navigationWarning(handle?.warning);
      const entry = {
        provider,
        key,
        openedAt,
        exitPublic,
        exitDigest,
        warning,
        handle,
      };
      active.set(id, entry);

      if (handle?.closed && typeof handle.closed.then === "function") {
        const onClosed = () => {
          if (active.get(id)?.handle === handle) {
            active.delete(id);
          }
        };
        handle.closed.then(onClosed, onClosed);
      }

      return {
        open: true,
        openedAt,
        exit: { ...exitPublic },
        exitChanged: false,
        ...(warning ? { warning: { ...warning } } : {}),
      };
    } finally {
      starting.delete(id);
    }
  }

  async function close(provider, key) {
    if (typeof provider !== "string" || !provider || typeof key !== "string" || !key) {
      return { closed: false, browser: closedStatus() };
    }
    const id = entryId(provider, key);
    const entry = active.get(id);
    if (!entry) {
      return { closed: false, browser: closedStatus() };
    }
    active.delete(id);
    try {
      await entry.handle?.close?.();
    } catch {
      // Closing an already-closed window is not an error worth surfacing.
    }
    return { closed: true, browser: closedStatus() };
  }

  async function closeAll() {
    shutdownGeneration += 1;
    const entries = [...active.values()];
    active.clear();
    await Promise.allSettled(
      entries.map((entry) => Promise.resolve().then(() => entry.handle?.close?.())),
    );
  }

  return {
    isOpen,
    listOpen,
    status,
    open,
    close,
    closeAll,
  };
}
