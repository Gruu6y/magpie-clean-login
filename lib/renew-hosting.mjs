// Hosted renewal: the account's own browser, opened with nobody watching.
//
// Why this exists. magpie refreshes a credential with a plain API call from its
// own runtime. That call carries the runtime's TLS fingerprint, not the one the
// account logged in with. For most vendors that is fine -- a token endpoint is a
// machine endpoint and the official clients are not browsers either. For the
// ones that tie a session to the browser that created it, the refresh fails and
// the account quietly drops.
//
// What hosting does. Once enabled it OWNS this account's renewal: it renews
// before the credential expires, so magpie's own at-expiry refresh normally
// never fires. It re-runs the account's own sign-in inside the account's own
// Camoufox profile -- the pinned identity.json, the same persistent profile,
// the same exit recorded at login, headless. The fresh credential goes back
// through the same write-back a normal login uses, so the ownership ledger and
// the identity-mismatch guard still apply.
//
// Why renewing early is safe. A hosted renewal never touches the refresh token:
// it is a complete sign-in (authorize, then callback), so there is no
// single-use refresh token to race magpie for. The one shared resource is the
// credential slot in plugin-auth.json, and that is written through magpie's own
// locked write-back. If magpie happens to renew first, hosting simply reads the
// new expiry and moves its next attempt -- it does not renew twice.
//
// Why there is no daily attempt ceiling. Taking over means a healthy one-hour
// token legitimately needs about 24 renewals a day, so capping attempts per day
// would silently strangle the feature. The loop guards are the minimum gap
// between attempts, the exponential backoff, and switching off after repeated
// failures.
//
// Off by default, per account, by an explicit click. Installing the plugin
// enables nothing, and there is no "enable all".

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pluginDataDir } from "./paths.mjs";
import { accountDir, readAccountMeta, readIdentity } from "./account-identity.mjs";
import { readAuthKeys } from "./account-keys.mjs";
import { readAuthEntries, readAuthExpiries } from "./signin-writeback.mjs";
import { isSettledSignIn } from "./agent-surface.mjs";

export const RENEW_HOSTING_FILE = "renew-hosting.json";
export const RENEW_HOSTING_VERSION = 1;

// How often the watcher looks at the clock. A minute is far finer than any
// token lifetime and costs one small file read.
export const HOSTING_TICK_MS = 60 * 1000;
// Hosting renews BEFORE the credential expires, and how far before depends on
// how long the credential lives (see leadForLifetime). Renewing early is what
// makes it a takeover rather than a rescue: by the time magpie's own at-expiry
// refresh would fire, the credential is already fresh and magpie stands down.
// 15 minutes is both the default, while a lifetime is still unknown, and the
// floor for short-lived tokens, which must not be renewed again right away.
export const HOSTING_LEAD_MS = 15 * 60 * 1000;
export const HOSTING_LEAD_MAX_MS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// A credential that lives this long gets a real retry window instead of a
// single shot: a fortnight- or month-long sign-in is worth renewing five days
// early, so a transient failure can be retried for days rather than lapsing.
export const HOSTING_LONG_LIFETIME_MS = 10 * DAY_MS;
export const HOSTING_LONG_LEAD_MS = 5 * DAY_MS;

// How far before expiry a credential of this lifetime should be renewed.
// Short-lived: five percent of its life, between 15 minutes and 12 hours, so
// an hourly token renews 15 minutes early and a daily one about 72 minutes
// early. Long-lived (ten days or more): a flat five days. An unknown lifetime
// falls back to the floor until a renewal teaches hosting how long they live.
export function leadForLifetime(lifetimeMs) {
  if (!isFiniteNumber(lifetimeMs) || lifetimeMs <= 0) return HOSTING_LEAD_MS;
  if (lifetimeMs >= HOSTING_LONG_LIFETIME_MS) return HOSTING_LONG_LEAD_MS;
  return Math.min(Math.max(lifetimeMs * 0.05, HOSTING_LEAD_MS), HOSTING_LEAD_MAX_MS);
}
// Two attempts on one account are never closer than this, however the clock
// moves. A vendor that keeps rejecting the renewal must not be hammered. This
// is the rate limit; there is deliberately no daily attempt ceiling, because a
// short-lived credential needs many legitimate renewals a day.
export const HOSTING_MIN_GAP_MS = 30 * 60 * 1000;
// Consecutive transient failures before hosting gives up and asks the user.
export const HOSTING_MAX_FAILURES = 2;
export const HOSTING_BACKOFF_BASE_MS = 10 * 60 * 1000;
export const HOSTING_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
export const HOSTING_HISTORY_LIMIT = 10;

// Failures that mean "a person has to do something": the method needs an answer,
// the vendor asked for a real login, the identity no longer matches, or the
// account/exit hosting depends on is gone. Retrying cannot fix any of them, so
// hosting switches itself off and says why instead of looping.
const NEEDS_USER = new Set([
  "not_hostable",
  "identity_mismatch",
  "callback_timeout",
  "no_browser_method",
  "method_not_found",
  "not_signed_in",
  "account_not_found",
  "identity_missing",
  "exit_unknown",
  "exit_missing",
  "no_expiry",
  "not_renewable",
]);

export class RenewHostingError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "RenewHostingError";
    this.code = code;
    this.status = status;
  }
}

function entryId(provider, key) {
  return `${provider}\u0000${key}`;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function blankEntry(provider, key) {
  return {
    provider,
    key,
    enabled: false,
    enabledAt: null,
    updatedAt: null,
    methodLabel: null,
    nextDueAt: null,
    lifetimeMs: null,
    lastAt: null,
    lastOutcome: null,
    lastCode: null,
    lastMessage: "",
    failStreak: 0,
    pausedReason: null,
    history: [],
  };
}

// Only these fields survive a read. A policy file is user-editable state on
// disk, so an unknown or malformed field is dropped rather than trusted.
function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const provider = typeof raw.provider === "string" ? raw.provider : "";
  const key = typeof raw.key === "string" ? raw.key : "";
  if (!provider || !key) return null;
  const entry = blankEntry(provider, key);
  entry.enabled = raw.enabled === true;
  entry.enabledAt = isFiniteNumber(raw.enabledAt) ? raw.enabledAt : null;
  entry.updatedAt = isFiniteNumber(raw.updatedAt) ? raw.updatedAt : null;
  entry.methodLabel = typeof raw.methodLabel === "string" && raw.methodLabel ? raw.methodLabel : null;
  entry.nextDueAt = isFiniteNumber(raw.nextDueAt) ? raw.nextDueAt : null;
  entry.lifetimeMs = isFiniteNumber(raw.lifetimeMs) && raw.lifetimeMs > 0 ? raw.lifetimeMs : null;
  entry.lastAt = isFiniteNumber(raw.lastAt) ? raw.lastAt : null;
  entry.lastOutcome =
    raw.lastOutcome === "ok" || raw.lastOutcome === "error" || raw.lastOutcome === "cancelled"
      ? raw.lastOutcome
      : null;
  entry.lastCode = typeof raw.lastCode === "string" ? raw.lastCode : null;
  entry.lastMessage = typeof raw.lastMessage === "string" ? raw.lastMessage.slice(0, 300) : "";
  entry.failStreak = isFiniteNumber(raw.failStreak) && raw.failStreak >= 0 ? Math.floor(raw.failStreak) : 0;
  entry.pausedReason = typeof raw.pausedReason === "string" ? raw.pausedReason : null;
  entry.history = Array.isArray(raw.history)
    ? raw.history
        .filter((item) => item && typeof item === "object" && isFiniteNumber(item.at))
        .slice(0, HOSTING_HISTORY_LIMIT)
        .map((item) => ({
          at: item.at,
          outcome:
            item.outcome === "ok" || item.outcome === "error" || item.outcome === "cancelled"
              ? item.outcome
              : "error",
          code: typeof item.code === "string" ? item.code : null,
          message: typeof item.message === "string" ? item.message.slice(0, 300) : "",
        }))
    : [];
  return entry;
}

// The state an account with no policy entry is in. Exported so the accounts
// list can show "off" for every account without inventing a stored entry.
export function offView(provider, key) {
  return {
    provider,
    key,
    enabled: false,
    state: "off",
    enabledAt: null,
    updatedAt: null,
    nextDueAt: null,
    lastAt: null,
    lastOutcome: null,
    lastCode: null,
    lastMessage: "",
    failStreak: 0,
    pausedReason: null,
    history: [],
  };
}

export function createRenewHosting(options = {}) {
  const {
    dataDir = pluginDataDir(),
    env = process.env,
    signIn = null,
    store = null,
    now = () => Date.now(),
    tickMs = HOSTING_TICK_MS,
    leadMs = HOSTING_LEAD_MS,
    minGapMs = HOSTING_MIN_GAP_MS,
    maxFailures = HOSTING_MAX_FAILURES,
    backoffBaseMs = HOSTING_BACKOFF_BASE_MS,
    backoffMaxMs = HOSTING_BACKOFF_MAX_MS,
    historyLimit = HOSTING_HISTORY_LIMIT,
    readExpiries = readAuthExpiries,
    readKeys = readAuthKeys,
    readEntries = readAuthEntries,
  } = options;

  const file = join(dataDir, RENEW_HOSTING_FILE);
  let policies = null;
  let running = null;
  let timer = null;
  let stopped = false;
  let ticking = false;

  async function load() {
    if (policies) return policies;
    policies = new Map();
    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      const list = Array.isArray(parsed?.accounts) ? parsed.accounts : [];
      for (const raw of list) {
        const entry = normalizeEntry(raw);
        if (entry) policies.set(entryId(entry.provider, entry.key), entry);
      }
    } catch {
      // Missing, unreadable or malformed: everything stays off. A policy file
      // that cannot be read must never silently enable a background login.
    }
    return policies;
  }

  async function save() {
    const payload = {
      version: RENEW_HOSTING_VERSION,
      updatedAt: new Date(now()).toISOString(),
      accounts: [...policies.values()],
    };
    await mkdir(dataDir, { recursive: true });
    await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  function assertAccount(provider, key) {
    if (typeof provider !== "string" || !provider) {
      throw new RenewHostingError("invalid_provider", "A provider id is required.", 400);
    }
    if (typeof key !== "string" || !key) {
      throw new RenewHostingError("invalid_account", "An account key is required.", 400);
    }
  }

  // The exit hosting will use is the one this account logged in through, read
  // from the ownership ledger -- never a currently "preferred" proxy and never
  // a fresh pick. A direct login is a legitimate recorded exit and stays direct.
  async function resolveExit(meta) {
    const last = meta?.lastLogin;
    if (!last || typeof last !== "object") {
      return {
        ok: false,
        code: "exit_unknown",
        status: 409,
        message:
          "This account has no recorded login exit. Sign in once more so the exit is recorded, then enable hosting.",
      };
    }
    const proxyId = typeof last.proxyId === "string" && last.proxyId ? last.proxyId : null;
    if (!proxyId) return { ok: true, proxy: null, proxyMeta: null };
    if (!store || typeof store.get !== "function") {
      return {
        ok: false,
        code: "exit_missing",
        status: 409,
        message: "The proxy list is unavailable, so the login exit cannot be resolved.",
      };
    }
    const stored = await store.get(proxyId);
    if (!stored) {
      return {
        ok: false,
        code: "exit_missing",
        status: 409,
        message:
          "The exit this account logged in through is no longer in the proxy list. Add it back, or sign in again through another exit.",
      };
    }
    return {
      ok: true,
      proxy: stored,
      // The same four-field whitelist the sign-in route writes to the ledger.
      // The stored record's credentials never leave this function.
      proxyMeta: {
        id: stored.id,
        name: typeof stored.name === "string" ? stored.name : "",
        region: typeof stored.region === "string" ? stored.region : "",
        type: typeof stored.type === "string" ? stored.type : null,
      },
    };
  }

  // Everything hosting needs before it may act on an account. Each refusal is a
  // distinct code with a sentence the user can act on, never a generic failure.
  async function eligibility(provider, key) {
    const dir = accountDir(env, provider, key);
    const meta = await readAccountMeta(dir);
    if (!meta || meta.provider !== provider) {
      return {
        ok: false,
        code: "account_not_found",
        status: 404,
        message: "This account has no ownership ledger; sign in through clean-login first.",
      };
    }
    if (!readKeys(env).has(key)) {
      return {
        ok: false,
        code: "not_signed_in",
        status: 409,
        message: "This account is signed out; there is no credential to renew.",
      };
    }
    const type = readEntries(env)[key]?.type;
    if (type === "api" || type === "key" || type === "apikey") {
      return {
        ok: false,
        code: "not_renewable",
        status: 409,
        message: "This credential is an API key; it does not expire and there is nothing to renew.",
      };
    }
    const expiresAt = readExpiries(env)[key];
    if (!isFiniteNumber(expiresAt)) {
      return {
        ok: false,
        code: "no_expiry",
        status: 409,
        message: "This credential has no expiry time, so there is nothing to watch.",
      };
    }
    if (!(await readIdentity(dir))) {
      return {
        ok: false,
        code: "identity_missing",
        status: 409,
        message: "This account has no pinned fingerprint; sign in through clean-login first.",
      };
    }
    const exit = await resolveExit(meta);
    if (!exit.ok) return exit;
    return { ok: true, dir, meta, expiresAt, proxy: exit.proxy, proxyMeta: exit.proxyMeta };
  }

  function view(entry, extra = {}) {
    const base = offView(entry.provider, entry.key);
    const state = !entry.enabled
      ? entry.pausedReason
        ? "paused"
        : "off"
      : running && running.provider === entry.provider && running.key === entry.key
        ? "running"
        : "watching";
    return {
      ...base,
      enabled: entry.enabled,
      state,
      enabledAt: entry.enabledAt,
      updatedAt: entry.updatedAt,
      nextDueAt: entry.nextDueAt,
      lastAt: entry.lastAt,
      lastOutcome: entry.lastOutcome,
      lastCode: entry.lastCode,
      lastMessage: entry.lastMessage,
      failStreak: entry.failStreak,
      pausedReason: entry.pausedReason,
      history: entry.history,
      ...extra,
    };
  }

  function publicRunning() {
    return running ? { ...running } : null;
  }

  function signInBusy() {
    if (!signIn || typeof signIn.status !== "function") return false;
    return !isSettledSignIn(signIn.status());
  }

  async function record(entry, attempt) {
    entry.lastAt = attempt.at;
    entry.lastOutcome = attempt.outcome;
    entry.lastCode = attempt.code;
    entry.lastMessage = String(attempt.message ?? "").slice(0, 300);
    entry.updatedAt = now();
    entry.history = [attempt, ...(entry.history ?? [])].slice(0, historyLimit);
    if (attempt.outcome === "ok") {
      entry.failStreak = 0;
      entry.nextDueAt = null;
      entry.pausedReason = null;
      // Learn how long this vendor's credentials live, so the next renewal is
      // scheduled relative to that lifetime instead of a fixed guess.
      const freshExpires = readExpiries(env)[entry.key];
      if (isFiniteNumber(freshExpires) && freshExpires > entry.updatedAt) {
        entry.lifetimeMs = freshExpires - entry.updatedAt;
      }
    } else if (attempt.outcome === "cancelled") {
      // The user stopped it. No penalty and no backoff: the expiry clock decides
      // when the next attempt is due.
      entry.nextDueAt = null;
    } else {
      entry.failStreak += 1;
      if (NEEDS_USER.has(attempt.code) || entry.failStreak >= maxFailures) {
        entry.enabled = false;
        entry.pausedReason = attempt.code ?? "failed";
        entry.nextDueAt = null;
      } else {
        const backoff = Math.min(backoffBaseMs * 2 ** (entry.failStreak - 1), backoffMaxMs);
        entry.nextDueAt = now() + backoff;
      }
    }
    policies.set(entryId(entry.provider, entry.key), entry);
    await save();
  }

  // One hosted renewal, start to finish. It never throws: every outcome is
  // recorded against the account so the watcher and the page can both see it.
  async function perform(entry, check, { manual = false } = {}) {
    const startedAt = now();
    running = { provider: entry.provider, key: entry.key, startedAt, manual };
    let outcome = "error";
    let code = null;
    let message = "";
    try {
      if (!signIn || typeof signIn.startSignIn !== "function") {
        throw new RenewHostingError(
          "unavailable",
          "The sign-in controller is unavailable, so the renewal cannot run.",
          503,
        );
      }
      await signIn.startSignIn({
        provider: entry.provider,
        proxy: check.proxy,
        proxyMeta: check.proxyMeta,
        account: { key: entry.key },
        methodLabel: entry.methodLabel || null,
        silent: true,
      });
      await signIn.whenSettled();
      const status = signIn.status();
      if (status?.state === "done") {
        outcome = "ok";
      } else if (status?.state === "cancelled") {
        outcome = "cancelled";
        code = "cancelled";
        message = "The renewal was cancelled.";
      } else {
        code = status?.error?.code ?? "unknown";
        message = status?.error?.message ?? "The renewal did not finish.";
      }
    } catch (error) {
      code = typeof error?.code === "string" ? error.code : "unknown";
      message = error?.message ?? String(error);
    } finally {
      running = null;
    }
    await record(entry, { at: startedAt, outcome, code, message });
  }

  async function enable(provider, key) {
    assertAccount(provider, key);
    await load();
    const check = await eligibility(provider, key);
    if (!check.ok) throw new RenewHostingError(check.code, check.message, check.status);
    const at = now();
    const existing = policies.get(entryId(provider, key));
    const entry = {
      ...(existing ?? blankEntry(provider, key)),
      enabled: true,
      enabledAt: at,
      updatedAt: at,
      pausedReason: null,
      failStreak: 0,
      nextDueAt: null,
    };
    policies.set(entryId(provider, key), entry);
    await save();
    return view(entry, { expiresAt: check.expiresAt });
  }

  async function disable(provider, key) {
    assertAccount(provider, key);
    await load();
    const entry = policies.get(entryId(provider, key)) ?? blankEntry(provider, key);
    entry.enabled = false;
    entry.updatedAt = now();
    entry.nextDueAt = null;
    policies.set(entryId(provider, key), entry);
    await save();
    if (running && running.provider === provider && running.key === key) await cancel();
    return view(entry);
  }

  // The full state of one account, including whether it could be enabled right
  // now and, if not, the sentence explaining why. The dialog reads this before
  // offering the switch, so the user is never promised something impossible.
  async function inspect(provider, key) {
    assertAccount(provider, key);
    await load();
    const entry = policies.get(entryId(provider, key)) ?? blankEntry(provider, key);
    const check = await eligibility(provider, key);
    return {
      hosting: view(entry, { expiresAt: check.ok ? check.expiresAt : null }),
      eligible: check.ok,
      reason: check.ok ? null : { code: check.code, message: check.message },
      running: publicRunning(),
    };
  }

  // The stored view of one account, without the live eligibility reads. The
  // accounts list and the PATCH response use it so a row never claims "off"
  // for an account the user has actually enabled.
  async function viewOf(provider, key) {
    await load();
    return view(policies.get(entryId(provider, key)) ?? blankEntry(provider, key));
  }

  async function snapshot() {
    await load();
    const expiries = readExpiries(env);
    return {
      accounts: [...policies.values()].map((entry) =>
        view(entry, { expiresAt: isFiniteNumber(expiries[entry.key]) ? expiries[entry.key] : null }),
      ),
      running: publicRunning(),
    };
  }

  // A manual run is the user asking for it now, so the expiry clock is ignored.
  // The one-at-a-time and sign-in exclusion guards still apply.
  async function runNow(provider, key) {
    assertAccount(provider, key);
    await load();
    const entry = policies.get(entryId(provider, key));
    if (!entry?.enabled) {
      throw new RenewHostingError("not_enabled", "Enable hosting for this account first.", 409);
    }
    if (running || signInBusy()) {
      throw new RenewHostingError("busy", "A sign-in is already running; try again when it finishes.", 409);
    }
    const check = await eligibility(provider, key);
    if (!check.ok) throw new RenewHostingError(check.code, check.message, check.status);
    void perform(entry, check, { manual: true });
    return { ok: true, running: publicRunning() };
  }

  async function cancel() {
    if (!running) return { cancelled: false, running: null };
    if (signIn && typeof signIn.cancel === "function") await signIn.cancel();
    return { cancelled: true, running: publicRunning() };
  }

  // One pass of the watcher. At most one renewal starts per pass, and only for
  // an account whose credential is inside its renewal window: close enough to
  // expiry that hosting should take over now, or already past it.
  async function tick() {
    if (stopped || ticking) return { ran: false };
    ticking = true;
    try {
      await load();
      if (running) return { ran: false, reason: "busy" };
      if (signInBusy()) return { ran: false, reason: "signin_busy" };
      const expiries = readExpiries(env);
      const at = now();
      for (const entry of policies.values()) {
        if (!entry.enabled) continue;
        const expiresAt = expiries[entry.key];
        // No usable expiry: the credential is gone or never had one. Leave it
        // alone rather than guessing; the next inspect tells the user why.
        if (!isFiniteNumber(expiresAt)) continue;
        // The lead depends on how long this credential lives. Until a hosted
        // renewal has taught us, the ledger's own sign-in date is a good
        // estimate: expiry minus when this credential was issued.
        let lifetime = entry.lifetimeMs;
        if (!isFiniteNumber(lifetime)) {
          const meta = await readAccountMeta(accountDir(env, entry.provider, entry.key));
          const signedInAt = Date.parse(meta?.signedInAt ?? "");
          if (Number.isFinite(signedInAt) && expiresAt > signedInAt) {
            lifetime = expiresAt - signedInAt;
          }
        }
        // Not due yet: the credential still has more than the lead time left.
        const lead = isFiniteNumber(lifetime) && lifetime > 0 ? leadForLifetime(lifetime) : leadMs;
        if (at < expiresAt - lead) continue;
        if (isFiniteNumber(entry.nextDueAt) && at < entry.nextDueAt) continue;
        if (isFiniteNumber(entry.lastAt) && at - entry.lastAt < minGapMs) continue;
        const check = await eligibility(entry.provider, entry.key);
        if (!check.ok) {
          await record(entry, { at, outcome: "error", code: check.code, message: check.message });
          continue;
        }
        await perform(entry, check, { manual: false });
        return { ran: true, provider: entry.provider, key: entry.key };
      }
      return { ran: false };
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (timer) return;
    stopped = false;
    const loop = async () => {
      timer = null;
      try {
        await tick();
      } catch {
        // A failed pass must not kill the watcher; the next tick tries again.
      }
      if (!stopped) {
        timer = setTimeout(loop, tickMs);
        timer.unref?.();
      }
    };
    // The first pass waits one tick so a host that is still loading is never
    // asked to open a browser mid-handover.
    timer = setTimeout(loop, tickMs);
    timer.unref?.();
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    file,
    enable,
    disable,
    inspect,
    viewOf,
    snapshot,
    runNow,
    cancel,
    tick,
    start,
    stop,
    running: publicRunning,
  };
}