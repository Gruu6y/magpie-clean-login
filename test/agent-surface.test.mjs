// Pure unit tests for the compact program-facing projection. No service, no
// network, no timers: the wait is driven with an injected clock.
import { expect, test } from "bun:test";
import {
  AGENT_COMMANDS,
  AGENT_WAIT_MAX_MS,
  agentDigest,
  clampWait,
  compactAccount,
  compactProvider,
  compactProxy,
  isSettledEnvironmentJob,
  isSettledJob,
  isSettledNativeSignIn,
  isSettledSignIn,
  waitForSettled,
} from "../lib/agent-surface.mjs";

// ---------- the wait bound ----------

test("clampWait rejects junk, zero and negatives, and clamps to the cap", () => {
  for (const value of [undefined, null, "", "abc", "0", "-1", "-5000", "Infinity"]) {
    expect(clampWait(value)).toBe(0);
  }
  expect(clampWait("500")).toBe(500);
  expect(clampWait("500.9")).toBe(500);
  expect(clampWait(1200)).toBe(1200);
  expect(clampWait("999999999")).toBe(AGENT_WAIT_MAX_MS);
  expect(clampWait("999999999", 1000)).toBe(1000);
});

test("the settled predicates stop on terminal states, idle and states needing input", () => {
  for (const state of ["idle", "done", "error", "cancelled", "waiting-code"]) {
    expect(isSettledSignIn({ state })).toBe(true);
  }
  for (const state of ["authorizing", "waiting-login", "finishing"]) {
    expect(isSettledSignIn({ state })).toBe(false);
  }
  expect(isSettledSignIn(null)).toBe(true);

  for (const state of ["idle", "done", "error", "cancelled", "paste-required"]) {
    expect(isSettledNativeSignIn({ state })).toBe(true);
  }
  for (const state of ["starting", "waiting"]) {
    expect(isSettledNativeSignIn({ state })).toBe(false);
  }
  expect(isSettledNativeSignIn(null)).toBe(true);

  for (const state of ["idle", "done", "error", "cancelled"]) {
    expect(isSettledJob({ state })).toBe(true);
  }
  for (const state of ["launching", "measuring", "checking"]) {
    expect(isSettledJob({ state })).toBe(false);
  }
  expect(isSettledJob(null)).toBe(true);

  for (const state of ["ready", "error", "cancelled"]) {
    expect(isSettledEnvironmentJob({ state })).toBe(true);
  }
  for (const state of ["preparing", "installing", "idle"]) {
    expect(isSettledEnvironmentJob({ state })).toBe(false);
  }
  expect(isSettledEnvironmentJob(null)).toBe(true);
});

// A fake clock: sleep advances it, so the whole wait runs synchronously in
// the test while still exercising the deadline arithmetic.
function fakeClock() {
  let now = 0;
  const sleeps = [];
  return {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
  };
}

test("waitForSettled re-reads until the job settles and returns the last value", async () => {
  const clock = fakeClock();
  const values = [{ state: "launching" }, { state: "measuring" }, { state: "done" }];
  let reads = 0;
  const value = await waitForSettled({
    read: () => values[Math.min(reads++, values.length - 1)],
    settled: isSettledJob,
    waitMs: 5000,
    ...clock,
  });
  expect(value).toEqual({ state: "done" });
  expect(reads).toBe(3);
  expect(clock.sleeps).toEqual([250, 250]);
});

test("waitForSettled times out honestly with the still-running value", async () => {
  const clock = fakeClock();
  let reads = 0;
  const value = await waitForSettled({
    read: () => ({ state: "measuring", reads: reads++ }),
    settled: isSettledJob,
    waitMs: 600,
    intervalMs: 250,
    ...clock,
  });
  expect(value.state).toBe("measuring");
  expect(reads).toBe(4);
  expect(clock.sleeps).toEqual([250, 250, 100]);
});

test("waitForSettled does not sleep for a zero bound or an already settled job", async () => {
  const clock = fakeClock();
  let reads = 0;
  const read = () => ({ state: "measuring", reads: reads++ });
  expect(await waitForSettled({ read, settled: isSettledJob, waitMs: 0, ...clock })).toEqual({
    state: "measuring",
    reads: 0,
  });
  expect(reads).toBe(1);
  expect(clock.sleeps).toEqual([]);

  const settledClock = fakeClock();
  let settledReads = 0;
  expect(
    await waitForSettled({
      read: () => ({ state: "done", reads: settledReads++ }),
      settled: isSettledJob,
      waitMs: 5000,
      ...settledClock,
    }),
  ).toEqual({ state: "done", reads: 0 });
  expect(settledReads).toBe(1);
  expect(settledClock.sleeps).toEqual([]);
});

// ---------- the compact projections ----------

test("compactProvider drops all prose and keeps only actionable fields", () => {
  const provider = {
    id: "workbuddy",
    name: "WorkBuddy",
    description: { en: "A long description", zh: "很长", "zh-TW": "很長", ja: "長い" },
    notice: { en: "A long notice", zh: "注意", "zh-TW": "注意", ja: "注意" },
    capability: { state: "ready", reason: { en: "Why", zh: "原因", "zh-TW": "原因", ja: "理由" } },
    presence: "both",
    presenceNote: { en: "Installed", zh: "已装" },
    signInMode: "browser",
    linkOnly: false,
    signableMethod: true,
    nativeSignIn: false,
    signInProvider: "@magpie/workbuddy",
    authMethods: [
      {
        label: "WorkBuddy (browser)",
        category: "browser",
        runnable: true,
        fields: [{ type: "text", key: "email", message: "Email" }],
        password: "must-not-travel",
      },
      { label: "API key", category: "key" },
    ],
    sources: { local: true, magpie: true },
    pluginPackage: "@magpie/workbuddy",
  };
  const compact = compactProvider(provider);
  expect(Object.keys(compact).sort()).toEqual(
    [
      "canSignIn",
      "capability",
      "id",
      "linkOnly",
      "methods",
      "name",
      "nativeSignIn",
      "presence",
      "signInMode",
      "signInProvider",
    ].sort(),
  );
  expect(compact).toEqual({
    id: "workbuddy",
    name: "WorkBuddy",
    presence: "both",
    capability: "ready",
    signInMode: "browser",
    linkOnly: false,
    canSignIn: true,
    nativeSignIn: false,
    signInProvider: "@magpie/workbuddy",
    methods: [
      {
        label: "WorkBuddy (browser)",
        category: "browser",
        fields: [{ type: "text", key: "email", message: "Email" }],
      },
      { label: "API key", category: "key" },
    ],
  });
  expect(JSON.stringify(compact)).not.toContain("must-not-travel");
});

test("compactProvider marks a native-only provider as signable", () => {
  const compact = compactProvider({ id: "codex", nativeSignIn: true, signableMethod: false });
  expect(compact.canSignIn).toBe(true);
  expect(compact.nativeSignIn).toBe(true);
  expect(compact.methods).toEqual([]);
});

test("compactProxy reports a password as a boolean and never returns a credential", () => {
  const compact = compactProxy({
    id: "p1",
    name: "Home",
    type: "http",
    host: "1.2.3.4",
    port: 8080,
    username: "alice",
    password: "s3cr3t",
    region: "HK",
    exitIp: "1.2.3.4",
    status: "ok",
    latency: 42,
    score: 87,
    lastCheckedAt: "2026-01-01T00:00:00.000Z",
    errorCode: "",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  expect(Object.keys(compact).sort()).toEqual(
    [
      "errorCode",
      "exitIp",
      "hasPassword",
      "host",
      "id",
      "lastCheckedAt",
      "latency",
      "name",
      "port",
      "region",
      "score",
      "status",
      "type",
    ].sort(),
  );
  expect(compact.hasPassword).toBe(true);
  expect(compact.score).toBe(87);
  expect(JSON.stringify(compact)).not.toContain("s3cr3t");
  expect(JSON.stringify(compact)).not.toContain("alice");
  expect(compactProxy({ score: 87.5, latency: "x" }).score).toBeNull();
});

test("compactAccount drops paths, fingerprints and history arrays", () => {
  const compact = compactAccount({
    provider: "workbuddy",
    key: "workbuddy-1",
    signedIn: true,
    signedInAt: "2026-01-01T00:00:00.000Z",
    uid: "u1",
    accountId: "a1",
    note: "primary",
    lastCheck: { at: "2026-01-02T00:00:00.000Z", verdict: "ok" },
    checks: [{ at: "2026-01-02T00:00:00.000Z" }],
    loginHistory: [{ at: "2026-01-01T00:00:00.000Z" }],
    path: "/home/secret/.config/magpie",
    fingerprint: { browser: "camoufox" },
  });
  expect(compact).toEqual({
    provider: "workbuddy",
    key: "workbuddy-1",
    signedIn: true,
    signedInAt: "2026-01-01T00:00:00.000Z",
    uid: "u1",
    accountId: "a1",
    note: "primary",
    lastCheckedAt: "2026-01-02T00:00:00.000Z",
  });
  expect(JSON.stringify(compact)).not.toContain("secret");
});

test("compactAccount projects live exit without leaking credentials", () => {
  const external = compactAccount({
    provider: "workbuddy",
    key: "wb-1",
    signedIn: true,
    exit: {
      at: null,
      proxyId: null,
      proxyName: "",
      region: "",
      type: "socks5",
      custom: true,
      // Even if a raw credential URL were ever passed in, compactExit redacts it.
      displayUrl: "socks5://leakedUser:leakedPass@203.0.113.5:1080",
    },
  });
  expect(external.exit).toEqual({
    mode: "custom",
    proxyId: null,
    proxyName: "",
    region: "",
    type: "socks5",
    custom: true,
    displayUrl: "socks5://203.0.113.5:1080",
  });
  expect(JSON.stringify(external)).not.toContain("leakedUser");
  expect(JSON.stringify(external)).not.toContain("leakedPass");

  const inherited = compactAccount({
    provider: "workbuddy",
    key: "wb-2",
    exit: {
      mode: "inherit",
      proxyId: "px-1",
      proxyName: "HK-1",
      region: "HK",
      type: "http",
      displayUrl: "http://127.0.0.1:7890",
    },
  });
  expect(inherited.exit).toEqual({
    mode: "inherit",
    proxyId: "px-1",
    proxyName: "HK-1",
    region: "HK",
    type: "http",
    displayUrl: "http://127.0.0.1:7890",
  });

  const direct = compactAccount({
    provider: "workbuddy",
    key: "wb-3",
    exit: { proxyId: null, proxyName: "", region: "", type: null },
  });
  expect(direct.exit).toEqual({
    mode: "direct",
    proxyId: null,
    proxyName: "",
    region: "",
    type: null,
  });
});

test("agentDigest assembles counts, job states and the command catalog", () => {
  const digest = agentDigest({
    version: "0.1.40",
    port: 3492,
    providers: [
      { id: "workbuddy", signableMethod: true },
      { id: "brand-new", nativeSignIn: false, signableMethod: false },
    ],
    proxies: [{ id: "p1" }],
    accounts: [{ provider: "workbuddy", key: "workbuddy", signedIn: true }, { provider: "codex", key: "codex" }],
    environment: { state: "ready", ready: true, installed: true, modelInstalled: true },
    jobs: { signin: "waiting-login" },
  });
  expect(digest.version).toBe("0.1.40");
  expect(digest.service).toEqual({ status: "ready", port: 3492 });
  expect(digest.cli).toBe("bin/clean-login.mjs");
  expect(digest.commands).toEqual(AGENT_COMMANDS);
  expect(digest.commands.length).toBeGreaterThanOrEqual(15);
  expect(digest.commands.map((command) => command.command)).toContain("signin start");
  expect(digest.state.counts).toEqual({
    providers: 2,
    signableProviders: 1,
    proxies: 1,
    accounts: 2,
    accountsSignedIn: 1,
  });
  expect(digest.state.environment).toEqual({
    state: "ready",
    ready: true,
    installed: true,
    modelInstalled: true,
  });
  expect(digest.state.jobs).toEqual({
    signin: "waiting-login",
    nativeSignIn: "idle",
    score: "idle",
    check: "idle",
    environment: "idle",
  });
  expect(digest.state.providers).toHaveLength(2);
  expect(digest.state.proxies).toHaveLength(1);
  expect(digest.state.accounts).toHaveLength(2);
  expect(Object.isFrozen(AGENT_COMMANDS)).toBe(true);
});

test("AGENT_COMMANDS advertises proxies import and proxy test --provider", () => {
  const bulkCmd = AGENT_COMMANDS.find((entry) => entry.command === "proxies import");
  expect(bulkCmd).toMatchObject({
    command: "proxies import",
    http: "POST /api/proxies/bulk",
  });
  expect(bulkCmd.args).toContain("--file");
  const testCmd = AGENT_COMMANDS.find((entry) => entry.command === "proxy test");
  expect(testCmd.args).toContain("--provider");
});
