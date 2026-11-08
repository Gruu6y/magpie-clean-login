// The sign-in flow, driven entirely through injected pieces: no browser is
// started, no provider plugin is imported and no network request is made. The
// real filesystem is used for the account directories (a temp root).
import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SIGNIN_FLOW_MARKER,
  accountDir,
  accountProfileDir,
  ensureIdentity,
  readAccountMeta,
  readIdentity,
  writeAccountMeta,
} from "../lib/account-identity.mjs";
import { SignInBrowserError } from "../lib/browser-launcher.mjs";
import { currentSignInEgress } from "../lib/signin-egress.mjs";
import {
  SIGNIN_STATES,
  SignInFlowError,
  chooseBrowserMethod,
  createSignInFlow,
} from "../lib/signin-flow.mjs";

const tempDirs = [];

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "clean-login-flow-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const fixedRandom = () => 0.123456789;

function browserMethod({ url = "https://provider/signin", instructions = "go", callback } = {}) {
  return {
    type: "oauth",
    label: "Provider account (browser)",
    authorize: async () => ({ url, instructions, method: "auto", callback }),
  };
}

function success(over = {}) {
  return {
    type: "success",
    provider: "workbuddy",
    refresh: "R",
    access: "A",
    expires: 1,
    accountId: "me",
    ...over,
  };
}

async function harness(overrides = {}) {
  const dir = await tempDir();
  const env = { MAGPIE_CLEAN_LOGIN_DATA: dir };
  const entries = overrides.entries ?? {};
  const clientCalls = [];
  const client =
    overrides.client ?? {
      auth: {
        set: async (input) => {
          clientCalls.push(input);
        },
      },
    };
  const state = { launched: null, browserClosed: 0 };
  const browser = {
    pid: 4321,
    async close() {
      state.browserClosed += 1;
    },
  };
  const methods = overrides.methods ?? [browserMethod({ callback: async () => success() })];
  const controller = createSignInFlow({
    env,
    client,
    readKeys: () => new Set(Object.keys(entries)),
    readEntries: () => entries,
    random: fixedRandom,
    identityGenerator: overrides.identityGenerator ?? (async () => ({ tag: "pin" })),
    loadProvider: overrides.loadProvider ?? (async () => ({ methods })),
    launchBrowser:
      overrides.launchBrowser ??
      (async (args) => {
        state.launched = args;
        return browser;
      }),
    resolveExecutable: overrides.resolveExecutable ?? (async () => "/fake/browser"),
    callbackTimeoutMs: overrides.callbackTimeoutMs,
    writeFlowMarker: overrides.writeFlowMarker,
    clearFlowMarker: overrides.clearFlowMarker,
    syncAccountProxy: overrides.syncAccountProxy,
  });
  return { dir, env, entries, client, clientCalls, browser, state, controller };
}

test("the happy path pins the account and writes the result back", async () => {
  const { dir, env, clientCalls, state, controller } = await harness();
  const started = await controller.startSignIn({ provider: "workbuddy" });
  expect(started).toEqual({
    flowId: expect.any(String),
    key: "workbuddy",
    url: "https://provider/signin",
    instructions: "go",
  });
  expect(state.launched.identity).toEqual({ tag: "pin" });
  expect(state.launched.profileDir).toBe(
    accountProfileDir(accountDir(env, "workbuddy", "workbuddy")),
  );
  expect(existsSync(join(accountDir(env, "workbuddy", "workbuddy"), "identity.json"))).toBe(true);

  await controller.whenSettled();
  const flow = controller.status();
  expect(flow.state).toBe("done");
  expect(flow.accountKey).toBe("workbuddy");
  expect(flow.identityCreated).toBe(true);
  expect(flow.error).toBeNull();
  expect(state.browserClosed).toBe(1);

  expect(clientCalls).toHaveLength(1);
  expect(clientCalls[0].path.id).toBe("workbuddy");
  expect(clientCalls[0].body.access).toBe("A");
  expect(clientCalls[0].body.refresh).toBe("R");
  expect("provider" in clientCalls[0].body).toBe(false);
  // The public status never carries a credential.
  expect(flow.access).toBeUndefined();
  expect(flow.refresh).toBeUndefined();
});

test("a sign-in marks its pre-allocated directory in flight and clears it on done", async () => {
  const { env, controller } = await harness();
  const dir = accountDir(env, "workbuddy", "workbuddy");
  await controller.startSignIn({ provider: "workbuddy" });
  // Written after the directory exists and before the browser opens, so the
  // directory is already marked by the time startSignIn returns.
  const markerFile = join(dir, SIGNIN_FLOW_MARKER);
  expect(existsSync(markerFile)).toBe(true);
  const marker = JSON.parse(readFileSync(markerFile, "utf8"));
  expect(marker.flowId).toBe(controller.status().flowId);
  expect(typeof marker.pid).toBe("number");
  expect(marker.startedAt).toBe(controller.status().createdAt);

  await controller.whenSettled();
  expect(controller.status().state).toBe("done");
  expect(existsSync(markerFile)).toBe(false);
});

test("a failed sign-in clears its in-flight marker too", async () => {
  const { env, controller } = await harness({
    methods: [browserMethod({ callback: async () => ({ type: "failed", error: "denied" }) })],
  });
  const dir = accountDir(env, "workbuddy", "workbuddy");
  await controller.startSignIn({ provider: "workbuddy" });
  expect(existsSync(join(dir, SIGNIN_FLOW_MARKER))).toBe(true);
  await controller.whenSettled();
  expect(controller.status().state).toBe("error");
  expect(existsSync(join(dir, SIGNIN_FLOW_MARKER))).toBe(false);
});

test("a cancelled sign-in clears its in-flight marker", async () => {
  const { env, controller } = await harness({
    methods: [browserMethod({ callback: () => new Promise(() => {}) })],
  });
  const dir = accountDir(env, "workbuddy", "workbuddy");
  await controller.startSignIn({ provider: "workbuddy" });
  await controller.cancel();
  await controller.whenSettled();
  expect(controller.status().state).toBe("cancelled");
  expect(existsSync(join(dir, SIGNIN_FLOW_MARKER))).toBe(false);
});

test("a marker that cannot be written does not fail the sign-in", async () => {
  const { controller } = await harness({
    writeFlowMarker: async () => {
      throw new Error("disk full");
    },
    clearFlowMarker: async () => {
      throw new Error("disk full");
    },
  });
  const started = await controller.startSignIn({ provider: "workbuddy" });
  expect(started.key).toBe("workbuddy");
  await controller.whenSettled();
  expect(controller.status().state).toBe("done");
});

test("a repeated account gets a fresh pre-allocated key but writes to the existing one", async () => {
  const entries = { workbuddy: { accountId: "me" } };
  const { env, clientCalls, controller } = await harness({ entries });
  const started = await controller.startSignIn({ provider: "workbuddy" });
  // magpie's signInKey sees the occupied bare key and allocates `workbuddy#…`.
  expect(started.key.startsWith("workbuddy#")).toBe(true);
  expect(started.key).not.toBe("workbuddy");

  await controller.whenSettled();
  const flow = controller.status();
  expect(flow.state).toBe("done");
  // writeBack de-duplicated the account back onto its existing key.
  expect(flow.accountKey).toBe("workbuddy");
  expect(clientCalls).toHaveLength(1);
  expect(clientCalls[0].path.id).toBe("workbuddy");
  // The identity followed the account onto the existing key and the in-flight
  // marker did not outlive the sign-in.
  expect(existsSync(join(accountDir(env, "workbuddy", "workbuddy"), "identity.json"))).toBe(true);
  expect(existsSync(join(accountDir(env, "workbuddy", "workbuddy"), SIGNIN_FLOW_MARKER))).toBe(false);
  expect(existsSync(accountDir(env, "workbuddy", started.key))).toBe(false);
  // The pin travelled; it was not thrown away. `pinDiscarded` is what tells the
  // page the difference between these two outcomes.
  expect(flow.pinDiscarded).toBe(false);
  expect(flow.rotated).toBe(false);
});

test("a sign-in onto an account that already owns a pin says the draw was discarded", async () => {
  // magpie holds the credential under `workbuddy`, and clean-login already has
  // a directory for it with its own machine. Signing in "as a new account"
  // draws a second pin, the write-back recognises the credential, and the
  // account's own pin wins. That is the invariant -- but the user asked for a
  // new fingerprint, so the flow has to admit it did not get one.
  const entries = { workbuddy: { accountId: "me" } };
  const { env, controller } = await harness({ entries });
  const owned = accountDir(env, "workbuddy", "workbuddy");
  await ensureIdentity(owned, { generate: async () => ({ tag: "already-owned" }) });

  const started = await controller.startSignIn({ provider: "workbuddy" });
  expect(started.key).not.toBe("workbuddy");
  await controller.whenSettled();
  const flow = controller.status();
  expect(flow.state).toBe("done");
  expect(flow.accountKey).toBe("workbuddy");
  expect(flow.identityCreated).toBe(true);
  expect(flow.pinDiscarded).toBe(true);
  expect(flow.rotated).toBe(false);
  // The account kept the machine it already had.
  expect(await readIdentity(owned)).toEqual({ tag: "already-owned" });
  expect(existsSync(accountDir(env, "workbuddy", started.key))).toBe(false);
});

test("a failed callback is an error and never writes", async () => {
  const { clientCalls, state, controller } = await harness({
    methods: [browserMethod({ callback: async () => ({ type: "failed", error: "denied" }) })],
  });
  await controller.startSignIn({ provider: "workbuddy" });
  await controller.whenSettled();
  const flow = controller.status();
  expect(flow.state).toBe("error");
  expect(flow.error).toEqual({ code: "callback_failed", message: "denied" });
  expect(clientCalls).toHaveLength(0);
  expect(state.browserClosed).toBe(1);
});

test("a callback that never finishes times out and never writes", async () => {
  const { clientCalls, controller } = await harness({
    callbackTimeoutMs: 20,
    methods: [browserMethod({ callback: () => new Promise(() => {}) })],
  });
  await controller.startSignIn({ provider: "workbuddy" });
  await controller.whenSettled();
  const flow = controller.status();
  expect(flow.state).toBe("error");
  expect(flow.error.code).toBe("callback_timeout");
  expect(clientCalls).toHaveLength(0);
});

test("a browser that cannot open is an error and never writes", async () => {
  const { clientCalls, controller } = await harness({
    launchBrowser: async () => {
      throw new SignInBrowserError("launch_failed", "boom", 502);
    },
  });
  await expect(controller.startSignIn({ provider: "workbuddy" })).rejects.toMatchObject({
    code: "launch_failed",
  });
  const flow = controller.status();
  expect(flow.state).toBe("error");
  expect(flow.error).toEqual({ code: "launch_failed", message: "boom" });
  expect(clientCalls).toHaveLength(0);
});

test("a missing plugin executable is reported honestly", async () => {
  const { controller } = await harness({ resolveExecutable: async () => null });
  await expect(controller.startSignIn({ provider: "workbuddy" })).rejects.toMatchObject({
    code: "browser_missing",
  });
  expect(controller.status().error.code).toBe("browser_missing");
});

test("a plugin with no browser method is reported honestly", async () => {
  const { controller } = await harness({
    methods: [{ type: "api", label: "API key" }],
  });
  await expect(controller.startSignIn({ provider: "workbuddy" })).rejects.toMatchObject({
    code: "no_browser_method",
  });
  expect(controller.status().state).toBe("error");
});

test("only one sign-in runs at a time", async () => {
  const { controller } = await harness({
    methods: [browserMethod({ callback: () => new Promise(() => {}) })],
  });
  await controller.startSignIn({ provider: "workbuddy" });
  await expect(controller.startSignIn({ provider: "workbuddy" })).rejects.toBeInstanceOf(
    SignInFlowError,
  );
  await controller.cancel();
  await controller.whenSettled();
  expect(controller.status().state).toBe("cancelled");
});

test("cancel moves the flow to cancelled and closes the browser", async () => {
  const { state, clientCalls, controller } = await harness({
    methods: [browserMethod({ callback: () => new Promise(() => {}) })],
  });
  await controller.startSignIn({ provider: "workbuddy" });
  const cancelled = await controller.cancel();
  expect(cancelled.cancelled).toBe(true);
  await controller.whenSettled();
  expect(controller.status().state).toBe("cancelled");
  expect(state.browserClosed).toBeGreaterThanOrEqual(1);
  expect(clientCalls).toHaveLength(0);
  // A second cancel is a no-op.
  expect((await controller.cancel()).cancelled).toBe(false);
});

test("a failed write-back is a distinct error and never throws out of the flow", async () => {
  const { controller, state } = await harness({
    client: {
      auth: {
        set: async () => {
          throw new Error("auth.set refused");
        },
      },
    },
  });
  await controller.startSignIn({ provider: "workbuddy" });
  await controller.whenSettled();
  const flow = controller.status();
  expect(flow.state).toBe("error");
  expect(flow.error.code).toBe("write_failed");
  expect(flow.error.message).toContain("auth.set refused");
  expect(state.browserClosed).toBe(1);
});

// The extended ownership ledger: a successful sign-in must record the exit it
// used (or an honest direct login) without ever storing a proxy credential or
// dropping a note / detection history that was already there.
test("a sign-in records a direct login when no proxyMeta is given", async () => {
  const { env, controller } = await harness();
  await controller.startSignIn({ provider: "workbuddy" });
  await controller.whenSettled();
  const meta = await readAccountMeta(accountDir(env, "workbuddy", "workbuddy"));
  expect(meta.version).toBe(1);
  expect(meta.signedInAt).toEqual(expect.any(String));
  expect(meta.lastLogin).toMatchObject({
    proxyId: null,
    proxyName: "",
    region: "",
    type: null,
  });
  expect(typeof meta.lastLogin.at).toBe("string");
  expect(meta.loginHistory).toHaveLength(1);
  expect(meta.loginHistory[0]).toEqual(meta.lastLogin);
});

test("a sign-in whitelists proxyMeta into the ledger", async () => {
  const { env, controller } = await harness();
  await controller.startSignIn({
    provider: "workbuddy",
    proxyMeta: {
      id: "p-01",
      name: "Hong Kong 01",
      region: "香港",
      type: "socks5",
      password: "secret-pass",
      host: "10.0.0.7",
      port: 1080,
      dir: "/home/user/.config/magpie",
    },
  });
  await controller.whenSettled();
  const path = accountDir(env, "workbuddy", "workbuddy");
  const meta = await readAccountMeta(path);
  expect(meta.lastLogin).toMatchObject({
    proxyId: "p-01",
    proxyName: "Hong Kong 01",
    region: "香港",
    type: "socks5",
  });
  expect(Object.keys(meta.lastLogin).sort()).toEqual(["at", "proxyId", "proxyName", "region", "type"]);
  const text = JSON.stringify(meta);
  for (const secret of ["secret-pass", "10.0.0.7", "1080", "/home/user"]) {
    expect(text).not.toContain(secret);
  }
});

test("a sign-in preserves an existing note, checks and login history", async () => {
  const { env, controller } = await harness();
  const dir = accountDir(env, "workbuddy", "workbuddy");
  const earlierLogin = { at: "2026-11-01T00:00:00.000Z", proxyId: null, proxyName: "", region: "", type: null };
  const earlierCheck = {
    at: "2026-11-01T00:00:00.000Z",
    grade: "A",
    proxyId: null,
    proxyName: "",
    region: "",
    exposure: 0,
    summary: [],
  };
  await writeAccountMeta(dir, {
    version: 1,
    provider: "workbuddy",
    key: "workbuddy",
    accountId: "me",
    uid: null,
    signedInAt: "2026-11-01T00:00:00.000Z",
    note: "keep this note",
    lastLogin: earlierLogin,
    loginHistory: [earlierLogin],
    checks: [earlierCheck],
  });
  // Claim this exact identity so the write-back reuses the directory whose
  // ledger we seeded (a fresh allocation would pick a new key).
  await controller.startSignIn({ provider: "workbuddy", account: { key: "workbuddy" } });
  await controller.whenSettled();
  const meta = await readAccountMeta(dir);
  expect(meta.note).toBe("keep this note");
  expect(meta.checks).toEqual([earlierCheck]);
  expect(meta.loginHistory).toHaveLength(2);
  expect(meta.loginHistory[1]).toEqual(earlierLogin);
  expect(meta.lastLogin.at).not.toBe(earlierLogin.at);
  expect(meta.version).toBe(1);
  expect(meta.provider).toBe("workbuddy");
});

test("chooseBrowserMethod prefers an explicit browser method and skips local", () => {
  const local = { type: "oauth", label: "Provider desktop's sign-in", authorize: async () => {} };
  const api = { type: "api", label: "API key" };
  const browser = { type: "oauth", label: "Provider (browser)", authorize: async () => {} };
  expect(chooseBrowserMethod([local, api, browser])).toBe(browser);
  expect(chooseBrowserMethod([local, api])).toBeNull();
  // An ambiguous oauth method with authorize is the fallback, not a local one.
  const ambiguous = { type: "oauth", label: "Provider GLM Coding Plan", authorize: async () => {} };
  expect(chooseBrowserMethod([local, ambiguous])).toBe(ambiguous);
});

test("a navigation warning reaches publicFlow with only the safe fields", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const { controller } = await harness({
    methods: [browserMethod({ callback: () => pending })],
    launchBrowser: async () => ({
      pid: 4321,
      warning: {
        code: "navigation_failed",
        status: 504,
        message: "The login browser is open, but the page did not finish loading within 60 seconds.",
        url: "https://provider/signin?user_code=SECRET-CODE",
        detail: "goto: Timeout 30000ms exceeded",
        stack: "Error: SECRET-STACK",
        user_code: "SECRET-CODE",
      },
      async close() {},
    }),
  });
  await controller.startSignIn({ provider: "workbuddy" });
  const flow = controller.status();
  expect(flow.state).toBe("waiting-login");
  expect(flow.instructions).toBe("go");
  expect(flow.warning).toEqual({
    code: "navigation_failed",
    status: 504,
    message: "The login browser is open, but the page did not finish loading within 60 seconds.",
  });
  expect(Object.keys(flow.warning).sort()).toEqual(["code", "message", "status"]);
  expect(flow.warning).not.toHaveProperty("url");
  expect(flow.warning).not.toHaveProperty("detail");
  expect(flow.warning).not.toHaveProperty("stack");
  expect(flow.warning).not.toHaveProperty("user_code");
  expect(JSON.stringify(flow)).not.toContain("SECRET");
  release(success());
  await controller.whenSettled();
});

// A method that asks something before it starts: ZCode's team picker, Qoder
// CN's VPC instance, the PAT prompts. Without the answer the plugin either
// throws or silently takes a default (ZCode's team flow would always sign in to
// Z.ai), so the answers the page collected must reach authorize().
function promptingMethod({ seen, prompts, url = "https://provider/team", callback } = {}) {
  return {
    type: "oauth",
    label: "Provider team (browser)",
    prompts: prompts ?? [
      {
        type: "select",
        key: "site",
        message: "Where is the team's plan?",
        options: [
          { label: "Z.ai", value: "zai" },
          { label: "BigModel", value: "bigmodel" },
        ],
      },
    ],
    authorize: async (inputs) => {
      if (seen) seen.push(inputs);
      return { url, instructions: "go", method: "auto", callback: callback ?? (async () => success()) };
    },
  };
}

test("the answers the page collected reach authorize()", async () => {
  const seen = [];
  const method = promptingMethod({ seen });
  const { controller } = await harness({ methods: [method] });
  const started = await controller.startSignIn({
    provider: "workbuddy",
    methodInputs: { site: "bigmodel" },
  });
  expect(started.url).toBe("https://provider/team");
  expect(seen).toEqual([{ site: "bigmodel" }]);
  await controller.whenSettled();
  expect(controller.status().state).toBe("done");
});
// A plugin whose sign-in is a one-time code it sends itself (Loomy's SMS
// code): no URL, no browser, and the callback only completes once the caller
// hands the code back through submitCode().
function codeMethod({ instructions = "A code was sent to 138****0000.", callback } = {}) {
  return {
    type: "oauth",
    label: "Provider phone code",
    authorize: async () => ({ url: "", instructions, method: "code", callback }),
  };
}

test("a code flow waits for the code, opens no browser, and writes back on submit", async () => {
  const seen = [];
  const { env, clientCalls, state, controller } = await harness({
    methods: [
      codeMethod({
        callback: async (code) => {
          seen.push(code);
          return success();
        },
      }),
    ],
  });
  const started = await controller.startSignIn({ provider: "workbuddy" });
  // No browser: the flow is honest that it is waiting for the user's code.
  expect(started.url).toBe("");
  expect(state.launched).toBeNull();
  expect(controller.status().state).toBe("waiting-code");
  expect(controller.status().codeRequired).toBe(true);
  expect(existsSync(join(accountDir(env, "workbuddy", "workbuddy"), SIGNIN_FLOW_MARKER))).toBe(true);

  const submitted = await controller.submitCode("123456");
  expect(submitted.state).toBe("finishing");
  await controller.whenSettled();

  expect(seen).toEqual(["123456"]);
  const flow = controller.status();
  expect(flow.state).toBe("done");
  expect(flow.accountKey).toBe("workbuddy");
  expect(flow.codeRequired).toBe(false);
  expect(clientCalls).toHaveLength(1);
  // The public status never carries the code the user typed.
  expect(JSON.stringify(flow)).not.toContain("123456");
});

test("a code flow refuses an empty code and a flow that is not waiting for one", async () => {
  const { controller } = await harness({
    methods: [codeMethod({ callback: async () => success() })],
  });
  await controller.startSignIn({ provider: "workbuddy" });
  await expect(controller.submitCode("   ")).rejects.toMatchObject({ code: "invalid_code" });
  await expect(controller.submitCode(undefined)).rejects.toMatchObject({ code: "invalid_code" });
  // The flow is still waiting; a real code still completes it.
  await controller.submitCode("123456");
  await controller.whenSettled();
  expect(controller.status().state).toBe("done");
  // Submitting again after it settled is refused, not silently ignored.
  await expect(controller.submitCode("123456")).rejects.toMatchObject({
    code: "no_waiting_code",
  });
});

test("a browser flow refuses submitCode, because it never waits for a code", async () => {
  const { controller } = await harness();
  await controller.startSignIn({ provider: "workbuddy" });
  await expect(controller.submitCode("123456")).rejects.toMatchObject({
    code: "no_waiting_code",
  });
  await controller.cancel();
  await controller.whenSettled();
});

test("a code flow that is cancelled settles and never writes", async () => {
  const { env, clientCalls, controller } = await harness({
    methods: [codeMethod({ callback: async () => success() })],
  });
  await controller.startSignIn({ provider: "workbuddy" });
  expect(controller.status().state).toBe("waiting-code");
  await controller.cancel();
  await controller.whenSettled();
  expect(controller.status().state).toBe("cancelled");
  expect(clientCalls).toHaveLength(0);
  expect(existsSync(join(accountDir(env, "workbuddy", "workbuddy"), SIGNIN_FLOW_MARKER))).toBe(false);
});

test("the typed form values reach authorize, and only the declared keys do", async () => {
  const received = [];
  const { controller } = await harness({
    methods: [
      {
        type: "oauth",
        label: "Provider account (form)",
        prompts: [{ type: "text", key: "phone" }],
        authorize: async (inputs) => {
          received.push(inputs);
          return { url: "https://provider/signin", instructions: "go", method: "auto", callback: async () => success() };
        },
      },
    ],
  });
  await controller.startSignIn({
    provider: "workbuddy",
    methodInputs: { phone: "13800138000", undeclared: "nope" },
  });
  expect(received).toEqual([{ phone: "13800138000" }]);
  await controller.whenSettled();
  expect(controller.status().state).toBe("done");
});

test("an answer the method never asked for is not forwarded", async () => {
  const seen = [];
  const { controller } = await harness({ methods: [promptingMethod({ seen })] });
  await controller.startSignIn({
    provider: "workbuddy",
    methodInputs: { site: "zai", pat: "pt-smuggled", extra: "x" },
  });
  expect(seen).toEqual([{ site: "zai" }]);
  await controller.whenSettled();
});

test("a required answer left blank is refused before authorize() runs", async () => {
  const seen = [];
  const method = promptingMethod({
    seen,
    prompts: [{ type: "password", key: "pat", message: "Your Personal Access Token" }],
  });
  const { controller, state, clientCalls } = await harness({ methods: [method] });
  await expect(
    controller.startSignIn({ provider: "workbuddy" }),
  ).rejects.toMatchObject({ code: "method_input_required", status: 400 });
  const flow = controller.status();
  expect(flow.state).toBe("error");
  expect(flow.error).toMatchObject({
    code: "method_input_required",
    message: "Your Personal Access Token",
  });
  // Nothing ran: no authorize(), no browser, no write-back.
  expect(seen).toHaveLength(0);
  expect(state.launched).toBeNull();
  expect(clientCalls).toHaveLength(0);

  // The same method with the answer supplied runs normally.
  const retry = await harness({
    methods: [promptingMethod({ seen, prompts: method.prompts })],
  });
  await retry.controller.startSignIn({
    provider: "workbuddy",
    methodInputs: { pat: "pt-real" },
  });
  expect(seen).toEqual([{ pat: "pt-real" }]);
  await retry.controller.whenSettled();
});

test("the flow status never carries the answers", async () => {
  const { controller } = await harness({
    methods: [
      promptingMethod({
        prompts: [{ type: "password", key: "pat", message: "Your Personal Access Token" }],
      }),
    ],
  });
  await controller.startSignIn({ provider: "workbuddy", methodInputs: { pat: "pt-SECRET" } });
  const flow = controller.status();
  expect(JSON.stringify(flow)).not.toContain("pt-SECRET");
  expect(flow).not.toHaveProperty("inputs");
  expect(flow).not.toHaveProperty("pat");
  await controller.whenSettled();
});

test("a method with no prompts still calls authorize the way it always did", async () => {
  const received = [];
  const { controller } = await harness({
    methods: [
      {
        type: "oauth",
        label: "Provider account (browser)",
        authorize: async (...args) => {
          received.push(args);
          return { url: "https://provider/signin", instructions: "go", method: "auto", callback: async () => success() };
        },
      },
    ],
  });
  await controller.startSignIn({ provider: "workbuddy", methodInputs: { anything: "x" } });
  expect(received).toEqual([[]]);
  await controller.whenSettled();
});

test("a plugin that returns no url and no code method is still an honest error", async () => {
  const { controller } = await harness({
    methods: [
      {
        type: "oauth",
        label: "Provider account (broken)",
        authorize: async () => ({ url: "", instructions: "nothing", method: "auto", callback: async () => success() }),
      },
    ],
  });
  await expect(controller.startSignIn({ provider: "workbuddy" })).rejects.toMatchObject({
    code: "no_url",
    status: 502,
  });
  expect(controller.status().state).toBe("error");
});

test("the state list covers the whole lifecycle", () => {
  expect(SIGNIN_STATES).toEqual([
    "idle",
    "authorizing",
    "waiting-login",
    "waiting-code",
    "finishing",
    "done",
    "error",
    "cancelled",
  ]);
});

// A sign-in has two legs, and both must leave through the exit the dialog
// picked. The browser leg is covered by browser-launcher; this covers the other
// one: the plugin mints the link and exchanges the code inside magpie's plugin
// host, which would otherwise send them through magpie's own proxy.
test("the plugin's own requests leave through the picked proxy", async () => {
  const seen = [];
  const proxy = { id: "p-01", type: "http", host: "10.1.2.3", port: 18118, username: "" };
  const methods = [
    {
      type: "oauth",
      label: "Provider account (browser)",
      authorize: async () => {
        seen.push(["authorize", currentSignInEgress()]);
        return {
          url: "https://provider/signin",
          instructions: "go",
          method: "auto",
          callback: async () => {
            seen.push(["callback", currentSignInEgress()]);
            return success();
          },
        };
      },
    },
  ];
  const { controller } = await harness({ methods });
  await controller.startSignIn({ provider: "workbuddy", proxy });
  await controller.whenSettled();
  expect(seen).toEqual([
    ["authorize", "http://10.1.2.3:18118"],
    ["callback", "http://10.1.2.3:18118"],
  ]);
  expect(controller.status().state).toBe("done");
});

test("a sign-in with no proxy chosen does not inherit magpie's silently", async () => {
  const seen = [];
  const methods = [
    {
      type: "oauth",
      label: "Provider account (browser)",
      authorize: async () => {
        seen.push(currentSignInEgress());
        return { url: "https://provider/signin", instructions: "go", method: "auto", callback: async () => success() };
      },
    },
  ];
  const { controller } = await harness({ methods });
  await controller.startSignIn({ provider: "workbuddy" });
  await controller.whenSettled();
  // "" is the direct option: no proxy at all, not "whatever magpie would use".
  expect(seen).toEqual([""]);
});

test("a silent sign-in passes headless=true to launchBrowser", async () => {
  const { state, controller } = await harness();
  await controller.startSignIn({ provider: "workbuddy", silent: true });
  expect(state.launched.headless).toBe(true);
  expect(controller.status().silent).toBe(true);
  await controller.whenSettled();
  expect(controller.status().state).toBe("done");
});

test("a silent sign-in refuses a code method with not_hostable", async () => {
  const methods = [
    {
      type: "oauth",
      label: "Device code",
      authorize: async () => ({
        url: "https://provider/device",
        instructions: "enter code",
        method: "code",
        callback: async () => success(),
      }),
    },
  ];
  const { controller } = await harness({ methods });
  await expect(controller.startSignIn({ provider: "workbuddy", silent: true })).rejects.toMatchObject({
    code: "not_hostable",
  });
});

test("a silent sign-in refuses a non-browser category with not_hostable", async () => {
  const methods = [
    {
      type: "oauth",
      label: "Device login",
      authorize: async () => ({
        url: "https://provider/device",
        instructions: "copy the device code to continue",
        callback: async () => success(),
      }),
    },
  ];
  const { controller } = await harness({ methods });
  await expect(controller.startSignIn({ provider: "workbuddy", silent: true })).rejects.toMatchObject({
    code: "not_hostable",
  });
});

test("a finished sign-in forwards the credential-free registration report in proxySync", async () => {
  const { controller } = await harness({
    syncAccountProxy: async () => ({
      ok: true,
      reason: "synced",
      changed: ["me"],
      registration: { ok: true, state: "never_offered", action: "added" },
    }),
  });
  await controller.startSignIn({ provider: "workbuddy" });
  await controller.whenSettled();
  const flow = controller.status();
  expect(flow.state).toBe("done");
  expect(flow.proxySync).toEqual({
    ok: true,
    reason: "synced",
    changed: 1,
    registration: { ok: true, state: "never_offered", action: "added", reason: null },
  });
});
