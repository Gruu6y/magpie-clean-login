// Hosted renewal. Every test runs against a temporary data directory and an
// injected credential reader, so nothing here touches the real ~/.config/magpie
// and no test ever opens a browser: the sign-in controller is a fake that
// records what it was asked to do.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOSTING_LEAD_MAX_MS,
  HOSTING_LEAD_MS,
  HOSTING_LONG_LEAD_MS,
  HOSTING_LONG_LIFETIME_MS,
  HOSTING_MIN_GAP_MS,
  RENEW_HOSTING_FILE,
  RenewHostingError,
  createRenewHosting,
  leadForLifetime,
  offView,
} from "../lib/renew-hosting.mjs";
import { accountDir, writeAccountMeta } from "../lib/account-identity.mjs";

const PROVIDER = "workbuddy";
const KEY = "workbuddy";
const BASE = Date.parse("2026-11-08T12:00:00.000Z");

// A fake sign-in controller that settles immediately with whatever state the
// test asked for, and records the exact arguments hosting passed it.
function fakeSignIn({ state = "done", error = null, onStart = null } = {}) {
  const calls = [];
  let current = { state: "idle" };
  return {
    calls,
    status: () => current,
    async startSignIn(input) {
      calls.push(input);
      current = { state: "waiting-login" };
      onStart?.(input);
      current = error ? { state: "error", error } : { state };
    },
    whenSettled: () => Promise.resolve(),
    async cancel() {
      current = { state: "cancelled" };
    },
  };
}

// Builds an account on disk (ledger + pinned identity) and a hosting controller
// whose credential reads are injected, so expiry/type/sign-in state are exactly
// what each test wants without writing a real plugin-auth.json.
async function setup({
  expiresAt = BASE - 10 * 60 * 1000,
  signedIn = true,
  type = "oauth",
  withIdentity = true,
  withLedger = true,
  signedInAt = "2026-11-08T10:00:00.000Z",
  lastLogin = { at: "2026-11-08T10:00:00.000Z", proxyId: null },
  proxyRecord = null,
  signIn = fakeSignIn(),
  now = () => BASE,
  ...options
} = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "cl-hosting-"));
  const dataDir = join(tmp, "data");
  const env = { MAGPIE_CLEAN_LOGIN_DATA: dataDir, MAGPIE_CONFIG_DIR: join(tmp, "config") };
  const dir = accountDir(env, PROVIDER, KEY);
  if (withLedger) {
    await writeAccountMeta(dir, {
      version: 1,
      provider: PROVIDER,
      key: KEY,
      accountId: "acct-1",
      uid: "u-1",
      signedInAt,
      ...(lastLogin ? { lastLogin } : {}),
    });
  }
  if (withIdentity) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "identity.json"), JSON.stringify({ fingerprint: { os: "linux" } }));
  }
  const store = {
    async get(id) {
      return proxyRecord && proxyRecord.id === id ? proxyRecord : null;
    },
  };
  const hosting = createRenewHosting({
    dataDir,
    env,
    signIn,
    store,
    now,
    readKeys: () => new Set(signedIn ? [KEY] : []),
    readEntries: () => ({ [KEY]: { type } }),
    readExpiries: () => (expiresAt === null ? {} : { [KEY]: expiresAt }),
    ...options,
  });
  return { tmp, dataDir, env, dir, hosting, signIn, store, file: join(dataDir, RENEW_HOSTING_FILE) };
}

function cleanup(ctx) {
  rmSync(ctx.tmp, { recursive: true, force: true });
}

test("offView is off and carries no history", () => {
  const view = offView(PROVIDER, KEY);
  expect(view.enabled).toBe(false);
  expect(view.state).toBe("off");
  expect(view.history).toEqual([]);
  expect(view.pausedReason).toBeNull();
});

test("an account with no policy reads as off, and nothing is enabled by default", async () => {
  const ctx = await setup();
  try {
    const inspect = await ctx.hosting.inspect(PROVIDER, KEY);
    expect(inspect.hosting.enabled).toBe(false);
    expect(inspect.hosting.state).toBe("off");
    expect(inspect.eligible).toBe(true);
    expect(inspect.reason).toBeNull();
    const snapshot = await ctx.hosting.snapshot();
    expect(snapshot.accounts).toEqual([]);
    expect(ctx.signIn.calls).toEqual([]);
  } finally {
    cleanup(ctx);
  }
});

test("enable refuses an account with no ownership ledger", async () => {
  const ctx = await setup({ withLedger: false, withIdentity: false });
  try {
    await expect(ctx.hosting.enable(PROVIDER, KEY)).rejects.toMatchObject({
      code: "account_not_found",
      status: 404,
    });
  } finally {
    cleanup(ctx);
  }
});

test("enable refuses a signed-out account", async () => {
  const ctx = await setup({ signedIn: false });
  try {
    await expect(ctx.hosting.enable(PROVIDER, KEY)).rejects.toMatchObject({
      code: "not_signed_in",
      status: 409,
    });
  } finally {
    cleanup(ctx);
  }
});

test("enable refuses an API-key credential", async () => {
  const ctx = await setup({ type: "api" });
  try {
    await expect(ctx.hosting.enable(PROVIDER, KEY)).rejects.toMatchObject({
      code: "not_renewable",
    });
  } finally {
    cleanup(ctx);
  }
});

test("enable refuses a credential with no expiry", async () => {
  const ctx = await setup({ expiresAt: null });
  try {
    await expect(ctx.hosting.enable(PROVIDER, KEY)).rejects.toMatchObject({ code: "no_expiry" });
  } finally {
    cleanup(ctx);
  }
});

test("enable refuses an account with no pinned fingerprint", async () => {
  const ctx = await setup({ withIdentity: false });
  try {
    await expect(ctx.hosting.enable(PROVIDER, KEY)).rejects.toMatchObject({
      code: "identity_missing",
    });
  } finally {
    cleanup(ctx);
  }
});

test("enable refuses an account whose login exit was never recorded", async () => {
  const ctx = await setup({ lastLogin: null });
  try {
    await expect(ctx.hosting.enable(PROVIDER, KEY)).rejects.toMatchObject({ code: "exit_unknown" });
  } finally {
    cleanup(ctx);
  }
});

test("enable refuses when the recorded login exit is gone from the proxy list", async () => {
  const ctx = await setup({
    lastLogin: { at: "2026-11-08T10:00:00.000Z", proxyId: "px-gone" },
    proxyRecord: null,
  });
  try {
    await expect(ctx.hosting.enable(PROVIDER, KEY)).rejects.toMatchObject({ code: "exit_missing" });
  } finally {
    cleanup(ctx);
  }
});

test("enable persists one account and leaves every other account off", async () => {
  const ctx = await setup();
  try {
    const view = await ctx.hosting.enable(PROVIDER, KEY);
    expect(view.enabled).toBe(true);
    expect(view.state).toBe("watching");
    expect(view.expiresAt).toBe(BASE - 10 * 60 * 1000);
    const stored = JSON.parse(readFileSync(ctx.file, "utf8"));
    expect(stored.accounts).toHaveLength(1);
    expect(stored.accounts[0].provider).toBe(PROVIDER);
    expect(stored.accounts[0].enabled).toBe(true);
    // A second account with no policy still reads as off.
    const other = await ctx.hosting.viewOf("other", "other");
    expect(other.enabled).toBe(false);
    expect(other.state).toBe("off");
  } finally {
    cleanup(ctx);
  }
});

test("enable resolves the recorded exit and keeps credentials out of the ledger meta", async () => {
  const proxyRecord = {
    id: "px-1",
    name: "HK · 01",
    region: "HK",
    type: "http",
    server: "http://127.0.0.1:8080",
    username: "secret-user",
    password: "secret-pass",
  };
  const ctx = await setup({
    lastLogin: { at: "2026-11-08T10:00:00.000Z", proxyId: "px-1" },
    proxyRecord,
  });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    await ctx.hosting.runNow(PROVIDER, KEY);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ctx.signIn.calls).toHaveLength(1);
    const call = ctx.signIn.calls[0];
    expect(call.silent).toBe(true);
    expect(call.account).toEqual({ key: KEY });
    expect(call.proxy).toBe(proxyRecord);
    expect(call.proxyMeta).toEqual({ id: "px-1", name: "HK · 01", region: "HK", type: "http" });
    expect(JSON.stringify(call.proxyMeta)).not.toContain("secret");
  } finally {
    cleanup(ctx);
  }
});

test("a direct login stays a direct renewal", async () => {
  const ctx = await setup({ lastLogin: { at: "2026-11-08T10:00:00.000Z", proxyId: null } });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    await ctx.hosting.runNow(PROVIDER, KEY);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ctx.signIn.calls[0].proxy).toBeNull();
    expect(ctx.signIn.calls[0].proxyMeta).toBeNull();
  } finally {
    cleanup(ctx);
  }
});

test("disable turns the policy off and keeps the history", async () => {
  const ctx = await setup();
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    await ctx.hosting.runNow(PROVIDER, KEY);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const view = await ctx.hosting.disable(PROVIDER, KEY);
    expect(view.enabled).toBe(false);
    expect(view.state).toBe("off");
    expect(view.history).toHaveLength(1);
    const stored = JSON.parse(readFileSync(ctx.file, "utf8"));
    expect(stored.accounts[0].enabled).toBe(false);
  } finally {
    cleanup(ctx);
  }
});

test("runNow refuses an account that was never enabled", async () => {
  const ctx = await setup();
  try {
    await expect(ctx.hosting.runNow(PROVIDER, KEY)).rejects.toMatchObject({
      code: "not_enabled",
      status: 409,
    });
    expect(ctx.signIn.calls).toEqual([]);
  } finally {
    cleanup(ctx);
  }
});

test("a successful renewal clears the failure streak and records ok", async () => {
  const ctx = await setup();
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    await ctx.hosting.runNow(PROVIDER, KEY);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const view = await ctx.hosting.viewOf(PROVIDER, KEY);
    expect(view.lastOutcome).toBe("ok");
    expect(view.failStreak).toBe(0);
    expect(view.nextDueAt).toBeNull();
    expect(view.history[0].outcome).toBe("ok");
    expect(view.state).toBe("watching");
  } finally {
    cleanup(ctx);
  }
});

test("a renewal that needs a person switches hosting off and says why", async () => {
  const ctx = await setup({
    signIn: fakeSignIn({ state: "error", error: { code: "not_hostable", message: "needs a code" } }),
  });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    await ctx.hosting.runNow(PROVIDER, KEY);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const view = await ctx.hosting.viewOf(PROVIDER, KEY);
    expect(view.enabled).toBe(false);
    expect(view.state).toBe("paused");
    expect(view.pausedReason).toBe("not_hostable");
    expect(view.lastOutcome).toBe("error");
  } finally {
    cleanup(ctx);
  }
});

test("an identity mismatch pauses hosting instead of retrying", async () => {
  const ctx = await setup({
    signIn: fakeSignIn({
      state: "error",
      error: { code: "identity_mismatch", message: "different account" },
    }),
  });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    await ctx.hosting.runNow(PROVIDER, KEY);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const view = await ctx.hosting.viewOf(PROVIDER, KEY);
    expect(view.enabled).toBe(false);
    expect(view.pausedReason).toBe("identity_mismatch");
  } finally {
    cleanup(ctx);
  }
});

test("a transient failure backs off, and the second one pauses", async () => {
  const ctx = await setup({
    signIn: fakeSignIn({ state: "error", error: { code: "network", message: "boom" } }),
    backoffBaseMs: 1000,
    maxFailures: 2,
  });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    await ctx.hosting.runNow(PROVIDER, KEY);
    await new Promise((resolve) => setTimeout(resolve, 20));
    let view = await ctx.hosting.viewOf(PROVIDER, KEY);
    expect(view.enabled).toBe(true);
    expect(view.failStreak).toBe(1);
    expect(view.nextDueAt).toBe(BASE + 1000);
    await ctx.hosting.runNow(PROVIDER, KEY);
    await new Promise((resolve) => setTimeout(resolve, 20));
    view = await ctx.hosting.viewOf(PROVIDER, KEY);
    expect(view.enabled).toBe(false);
    expect(view.pausedReason).toBe("network");
    expect(view.failStreak).toBe(2);
  } finally {
    cleanup(ctx);
  }
});

test("a cancelled renewal is not counted as a failure", async () => {
  const ctx = await setup({ signIn: fakeSignIn({ state: "cancelled" }) });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    await ctx.hosting.runNow(PROVIDER, KEY);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const view = await ctx.hosting.viewOf(PROVIDER, KEY);
    expect(view.enabled).toBe(true);
    expect(view.lastOutcome).toBe("cancelled");
    expect(view.failStreak).toBe(0);
    expect(view.nextDueAt).toBeNull();
  } finally {
    cleanup(ctx);
  }
});

test("tick does nothing while the credential is still valid", async () => {
  const ctx = await setup({ expiresAt: BASE + 60 * 60 * 1000 });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    const result = await ctx.hosting.tick();
    expect(result.ran).toBe(false);
    expect(ctx.signIn.calls).toEqual([]);
  } finally {
    cleanup(ctx);
  }
});

test("tick does nothing while the credential is still valid", async () => {
  const ctx = await setup({ expiresAt: BASE + 60 * 60 * 1000 });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    const result = await ctx.hosting.tick();
    expect(result.ran).toBe(false);
    expect(ctx.signIn.calls).toEqual([]);
  } finally {
    cleanup(ctx);
  }
});

test("tick leaves a credential alone until it enters the renewal window", async () => {
  // Still valid, with more than the lead time left: nothing to do yet.
  const ctx = await setup({ expiresAt: BASE + HOSTING_LEAD_MS + 60 * 1000 });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    const result = await ctx.hosting.tick();
    expect(result.ran).toBe(false);
    expect(ctx.signIn.calls).toEqual([]);
  } finally {
    cleanup(ctx);
  }
});

// The whole point of hosting is a takeover, not a rescue: it must renew BEFORE
// expiry, so magpie's own at-expiry refresh has nothing left to do.
test("tick takes over before the credential expires", async () => {
  const ctx = await setup({ expiresAt: BASE + HOSTING_LEAD_MS - 60 * 1000 });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    const result = await ctx.hosting.tick();
    expect(result).toEqual({ ran: true, provider: PROVIDER, key: KEY });
    expect(ctx.signIn.calls).toHaveLength(1);
    expect(ctx.signIn.calls[0].silent).toBe(true);
  } finally {
    cleanup(ctx);
  }
});

test("tick still renews a credential that is already expired", async () => {
  const ctx = await setup({ expiresAt: BASE - 1000 });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    const result = await ctx.hosting.tick();
    expect(result).toEqual({ ran: true, provider: PROVIDER, key: KEY });
    expect(ctx.signIn.calls).toHaveLength(1);
    expect(ctx.signIn.calls[0].silent).toBe(true);
  } finally {
    cleanup(ctx);
  }
});

test("tick never renews an account that was not enabled", async () => {
  const ctx = await setup({ expiresAt: BASE - 1000 });
  try {
    const result = await ctx.hosting.tick();
    expect(result.ran).toBe(false);
    expect(ctx.signIn.calls).toEqual([]);
  } finally {
    cleanup(ctx);
  }
});

test("tick respects the minimum gap between attempts", async () => {
  const ctx = await setup({ expiresAt: BASE - 1000 });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    await ctx.hosting.tick();
    // A second pass right after the first must not hammer the vendor.
    const again = await ctx.hosting.tick();
    expect(again.ran).toBe(false);
    expect(ctx.signIn.calls).toHaveLength(1);
    // Past the gap it may try again.
    const later = createRenewHosting({
      dataDir: ctx.dataDir,
      env: ctx.env,
      signIn: ctx.signIn,
      store: ctx.store,
      now: () => BASE + HOSTING_MIN_GAP_MS + 1000,
      readKeys: () => new Set([KEY]),
      readEntries: () => ({ [KEY]: { type: "oauth" } }),
      readExpiries: () => ({ [KEY]: BASE - 1000 }),
    });
    const third = await later.tick();
    expect(third.ran).toBe(true);
  } finally {
    cleanup(ctx);
  }
});

// Taking over a short-lived credential means many legitimate renewals a day:
// a one-hour token needs about 24. A daily attempt ceiling would silently
// strangle exactly the accounts hosting exists for, so there is none -- the
// loop guards are the minimum gap, the backoff and the failure switch-off.
test("a healthy short-lived credential is not capped per day", async () => {
  const ctx = await setup({ expiresAt: BASE - 1000, minGapMs: 0 });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    const stored = JSON.parse(readFileSync(ctx.file, "utf8"));
    stored.accounts[0].history = Array.from({ length: 24 }, (_, index) => ({
      at: BASE - (index + 1) * 60 * 60 * 1000,
      outcome: "ok",
      code: null,
      message: "",
    }));
    writeFileSync(ctx.file, JSON.stringify(stored));
    const fresh = createRenewHosting({
      dataDir: ctx.dataDir,
      env: ctx.env,
      signIn: ctx.signIn,
      store: ctx.store,
      now: () => BASE,
      minGapMs: 0,
      readKeys: () => new Set([KEY]),
      readEntries: () => ({ [KEY]: { type: "oauth" } }),
      readExpiries: () => ({ [KEY]: BASE - 1000 }),
    });
    const result = await fresh.tick();
    expect(result.ran).toBe(true);
    expect(ctx.signIn.calls).toHaveLength(1);
  } finally {
    cleanup(ctx);
  }
});

test("tick stands down while an interactive sign-in is running", async () => {
  const busy = {
    status: () => ({ state: "waiting-login" }),
    startSignIn: async () => {},
    whenSettled: () => Promise.resolve(),
    cancel: async () => {},
  };
  const ctx = await setup({ expiresAt: BASE - 1000, signIn: busy });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    const result = await ctx.hosting.tick();
    expect(result).toEqual({ ran: false, reason: "signin_busy" });
  } finally {
    cleanup(ctx);
  }
});

test("a malformed policy file leaves everything off", async () => {
  const ctx = await setup();
  try {
    mkdirSync(ctx.dataDir, { recursive: true });
    writeFileSync(ctx.file, "{ this is not json");
    const fresh = createRenewHosting({
      dataDir: ctx.dataDir,
      env: ctx.env,
      signIn: ctx.signIn,
      store: ctx.store,
      now: () => BASE,
      readKeys: () => new Set([KEY]),
      readEntries: () => ({ [KEY]: { type: "oauth" } }),
      readExpiries: () => ({ [KEY]: BASE - 1000 }),
    });
    const snapshot = await fresh.snapshot();
    expect(snapshot.accounts).toEqual([]);
    const result = await fresh.tick();
    expect(result.ran).toBe(false);
    expect(ctx.signIn.calls).toEqual([]);
  } finally {
    cleanup(ctx);
  }
});

test("a policy entry with unknown fields is normalized, not trusted", async () => {
  const ctx = await setup();
  try {
    mkdirSync(ctx.dataDir, { recursive: true });
    writeFileSync(
      ctx.file,
      JSON.stringify({
        version: 1,
        accounts: [
          {
            provider: PROVIDER,
            key: KEY,
            enabled: true,
            failStreak: "not-a-number",
            lastOutcome: "weird",
            history: "nope",
            evil: { nested: true },
          },
        ],
      }),
    );
    const fresh = createRenewHosting({
      dataDir: ctx.dataDir,
      env: ctx.env,
      signIn: ctx.signIn,
      store: ctx.store,
      now: () => BASE,
      readKeys: () => new Set([KEY]),
      readEntries: () => ({ [KEY]: { type: "oauth" } }),
      readExpiries: () => ({ [KEY]: BASE + 60 * 60 * 1000 }),
    });
    const view = await fresh.viewOf(PROVIDER, KEY);
    expect(view.enabled).toBe(true);
    expect(view.failStreak).toBe(0);
    expect(view.lastOutcome).toBeNull();
    expect(view.history).toEqual([]);
    expect(view.evil).toBeUndefined();
  } finally {
    cleanup(ctx);
  }
});

test("RenewHostingError carries a code and an HTTP status", () => {
  const error = new RenewHostingError("busy", "wait", 409);
  expect(error.code).toBe("busy");
  expect(error.status).toBe(409);
  expect(error.name).toBe("RenewHostingError");
});

const DAY = 24 * 60 * 60 * 1000;

test("the lead scales with the credential lifetime", () => {
  // Unknown lifetime: the floor, until a renewal teaches hosting otherwise.
  expect(leadForLifetime(null)).toBe(HOSTING_LEAD_MS);
  expect(leadForLifetime(0)).toBe(HOSTING_LEAD_MS);
  // An hourly token: fifteen minutes, never so early that it renews again at once.
  expect(leadForLifetime(60 * 60 * 1000)).toBe(HOSTING_LEAD_MS);
  // A daily token: five percent of its life, about 72 minutes.
  expect(leadForLifetime(DAY)).toBe(0.05 * DAY);
  // Just under the long-lived threshold: still proportional, never past 12 hours.
  expect(leadForLifetime(9 * DAY)).toBe(0.05 * 9 * DAY);
  expect(leadForLifetime(9.9 * DAY)).toBe(9.9 * DAY * 0.05);
  expect(leadForLifetime(9.9 * DAY)).toBeLessThanOrEqual(HOSTING_LEAD_MAX_MS);
  // A fortnight or a month: five days, so a failure can be retried for days.
  expect(leadForLifetime(HOSTING_LONG_LIFETIME_MS)).toBe(HOSTING_LONG_LEAD_MS);
  expect(leadForLifetime(15 * DAY)).toBe(5 * DAY);
  expect(leadForLifetime(30 * DAY)).toBe(5 * DAY);
});

test("a month-long credential enters its window five days before expiry", async () => {
  // Issued 26 days ago, expires in 4: a thirty-day credential inside its window.
  const ctx = await setup({
    expiresAt: BASE + 4 * DAY,
    signedInAt: new Date(BASE - 26 * DAY).toISOString(),
  });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    const result = await ctx.hosting.tick();
    expect(result).toEqual({ ran: true, provider: PROVIDER, key: KEY });
    expect(ctx.signIn.calls).toHaveLength(1);
  } finally {
    cleanup(ctx);
  }
});

test("a month-long credential with six days left is left alone", async () => {
  const ctx = await setup({
    expiresAt: BASE + 6 * DAY,
    signedInAt: new Date(BASE - 24 * DAY).toISOString(),
  });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    const result = await ctx.hosting.tick();
    expect(result.ran).toBe(false);
    expect(ctx.signIn.calls).toEqual([]);
  } finally {
    cleanup(ctx);
  }
});

test("a successful renewal learns the lifetime for the next schedule", async () => {
  let expiresAt = BASE - 1000;
  const signIn = fakeSignIn({ onStart: () => { expiresAt = BASE + 30 * DAY; } });
  const ctx = await setup({ signIn, readExpiries: () => ({ [KEY]: expiresAt }) });
  try {
    await ctx.hosting.enable(PROVIDER, KEY);
    const result = await ctx.hosting.tick();
    expect(result.ran).toBe(true);
    const saved = JSON.parse(readFileSync(ctx.file, "utf8"));
    expect(saved.accounts[0].lifetimeMs).toBe(30 * DAY);
    // And the next pass stands down: the fresh credential is a month away.
    const again = await ctx.hosting.tick();
    expect(again.ran).toBe(false);
    expect(ctx.signIn.calls).toHaveLength(1);
  } finally {
    cleanup(ctx);
  }
});