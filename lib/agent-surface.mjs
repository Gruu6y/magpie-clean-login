// A compact, program-facing view of the service.
//
// The page talks to this service with the payloads the page itself needs: a
// provider carries four languages of description, notice and capability
// reason, and every proxy and account carries its whole record. A program
// driving the service — an agent, a script, the bundled CLI — pays for all of
// that in context and then discards it. This module projects the same state
// down to the fields a caller actually acts on.
//
// Everything here is a pure function of the values it is handed: no network,
// no storage, and no timers of its own (the sleep is injected, so the wait is
// unit-testable). It never reads or returns a credential. A password is
// reported only as a boolean, and no provider description, notice or
// capability reason text travels.
//
// The wait exists to remove the poll loop from the caller's side. Starting a
// sign-in, a proxy test or an environment download is asynchronous, and the
// page polls for it cheaply with a browser timer. A program that polls with a
// fresh HTTP request pays a full model turn per poll, so `wait` lets one
// request block inside the service until the job settles (or a bound elapses)
// and answer once.

// The longest a single request may block. A caller can ask for more; the
// service clamps to this so one request cannot hold a connection open
// indefinitely.
export const AGENT_WAIT_MAX_MS = 120_000;

// How often the in-process wait re-reads the job while it blocks.
export const AGENT_WAIT_INTERVAL_MS = 250;

// Job states that mean "nothing more will happen without the caller acting".
// Every controller's own TERMINAL set is {done, error, cancelled}; `idle`
// means no job ever ran. The extras are the states that stop the clock because
// the caller must supply something: a one-time code or a pasted value.
const TERMINAL = new Set(["done", "error", "cancelled"]);

// A sign-in that is waiting for a code the caller must hand back. Nothing
// polls until it arrives, so waiting longer is pointless.
const SIGNIN_NEEDS_INPUT = "waiting-code";

// A native sign-in that asked the caller to paste a value.
const NATIVE_NEEDS_INPUT = "paste-required";

// The environment job's own success state is `ready`, which is outside the
// shared terminal set.
const ENVIRONMENT_TERMINAL = new Set(["ready", "error", "cancelled"]);

// A tiny catalog of the CLI's commands, carried in the digest so a caller that
// has only found the service can act without reading this repository. Each
// entry names the command, the HTTP route it maps to, and its arguments.
export const AGENT_COMMANDS = Object.freeze([
  Object.freeze({ command: "agent", http: "GET /api/agent", args: "", summary: "This digest." }),
  Object.freeze({ command: "status", http: "GET /api/health", args: "", summary: "Liveness and the account-prune summary." }),
  Object.freeze({ command: "providers", http: "GET /api/agent", args: "", summary: "The merged provider cards, compact." }),
  Object.freeze({ command: "proxies", http: "GET /api/agent", args: "", summary: "Stored proxies, compact, without credentials." }),
  Object.freeze({ command: "accounts", http: "GET /api/agent", args: "", summary: "Known accounts and whether each is signed in." }),
  Object.freeze({ command: "signin start", http: "POST /api/signin", args: "--provider <id> [--proxy <id>] [--method <label>] [--input k=v]... [--single] [--wait ms]", summary: "Start a sign-in, optionally waiting until it settles." }),
  Object.freeze({ command: "signin status", http: "GET /api/signin?wait=ms", args: "[--wait ms]", summary: "The current sign-in flow." }),
  Object.freeze({ command: "signin code", http: "POST /api/signin/code", args: "<code>", summary: "Hand a one-time code back to a waiting flow." }),
  Object.freeze({ command: "signin cancel", http: "POST /api/signin/cancel", args: "", summary: "Cancel the running sign-in." }),
  Object.freeze({ command: "native start", http: "POST /api/native-signin", args: "--provider <id> [--wait ms]", summary: "Start a sign-in magpie runs itself." }),
  Object.freeze({ command: "native status", http: "GET /api/native-signin?wait=ms", args: "[--wait ms]", summary: "The current native sign-in flow." }),
  Object.freeze({ command: "native paste", http: "POST /api/native-signin/paste", args: "<text>", summary: "Paste a callback URL or code into the native flow." }),
  Object.freeze({ command: "native cancel", http: "POST /api/native-signin/cancel", args: "", summary: "Cancel the native sign-in." }),
  Object.freeze({ command: "proxy test", http: "POST /api/proxies/:id/test", args: "<proxyId>", summary: "Probe a stored proxy and persist the result." }),
  Object.freeze({ command: "proxy score", http: "POST /api/proxies/:id/score", args: "<proxyId> [--wait ms]", summary: "Start the Claude trust-score check." }),
  Object.freeze({ command: "score status", http: "GET /api/proxy-score?wait=ms", args: "[--wait ms]", summary: "The trust-score job." }),
  Object.freeze({ command: "env", http: "GET /api/environment/job?wait=ms", args: "[--wait ms]", summary: "The login browser and its download job." }),
  Object.freeze({ command: "env prepare", http: "POST /api/environment/prepare", args: "[--wait ms]", summary: "Start the one-time browser download." }),
  Object.freeze({ command: "check", http: "GET /api/accounts/:provider/:key/check?wait=ms", args: "<provider> <key> [--wait ms]", summary: "The identity-check job for one account." }),
]);

// Read a caller-supplied wait bound. A non-number, a negative number and zero
// all mean "do not wait"; anything above the cap is clamped so a single
// request cannot block indefinitely.
export function clampWait(value, max = AGENT_WAIT_MAX_MS) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(Math.floor(ms), max);
}

// The per-endpoint "is there still something to wait for" questions. Kept
// exported and pure so the routes share one definition and the tests can pin
// the exact states that stop a wait.
export function isSettledSignIn(flow) {
  const state = flow?.state ?? "idle";
  return state === "idle" || TERMINAL.has(state) || state === SIGNIN_NEEDS_INPUT;
}

export function isSettledNativeSignIn(flow) {
  const state = flow?.state ?? "idle";
  return state === "idle" || TERMINAL.has(state) || state === NATIVE_NEEDS_INPUT;
}

// Used by both the trust-score job and the identity-check job: they share the
// {idle, launching, measuring|checking, done, error, cancelled} shape, and a
// missing job means nothing is running.
export function isSettledJob(job) {
  return !job || job.state === "idle" || TERMINAL.has(job.state);
}

export function isSettledEnvironmentJob(job) {
  return !job || ENVIRONMENT_TERMINAL.has(job.state);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Block until `settled(value)` is true or `waitMs` elapses, re-reading through
// the same in-process function the route already calls. Returns the last value
// read, so a caller that times out still gets an honest "still running"
// payload rather than an error.
export async function waitForSettled({
  read,
  settled,
  waitMs,
  intervalMs = AGENT_WAIT_INTERVAL_MS,
  sleep = defaultSleep,
  now = Date.now,
}) {
  let value = await read();
  if (!waitMs || settled(value)) return value;
  const deadline = now() + waitMs;
  while (!settled(value)) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
    value = await read();
  }
  return value;
}

// One provider card, compact: what it is, where it came from, whether a
// sign-in can run, and the methods (labels, categories and the questions each
// asks) — but not four languages of prose.
export function compactProvider(provider) {
  const methods = Array.isArray(provider?.authMethods)
    ? provider.authMethods
        .filter((method) => method && typeof method === "object")
        .map((method) => {
          const entry = {
            label: typeof method.label === "string" ? method.label : "",
            category: typeof method.category === "string" ? method.category : "unknown",
          };
          if (Array.isArray(method.fields) && method.fields.length > 0) entry.fields = method.fields;
          return entry;
        })
    : [];
  return {
    id: provider?.id ?? "",
    name: provider?.name ?? "",
    presence: provider?.presence ?? null,
    capability: provider?.capability?.state ?? "pending",
    signInMode: provider?.signInMode ?? "unknown",
    linkOnly: Boolean(provider?.linkOnly),
    canSignIn: Boolean(provider?.signableMethod) || Boolean(provider?.nativeSignIn),
    nativeSignIn: Boolean(provider?.nativeSignIn),
    signInProvider: provider?.signInProvider ?? null,
    methods,
  };
}

// One stored proxy, compact. The password is a boolean and the username never
// travels: a caller that needs the credential has no business reading it here.
export function compactProxy(proxy) {
  return {
    id: proxy?.id ?? "",
    name: proxy?.name ?? "",
    type: proxy?.type ?? "",
    host: proxy?.host ?? "",
    port: proxy?.port ?? null,
    region: proxy?.region ?? "",
    exitIp: proxy?.exitIp ?? "",
    status: proxy?.status ?? "untested",
    latency: Number.isFinite(proxy?.latency) ? proxy.latency : null,
    hasPassword: Boolean(proxy?.hasPassword ?? proxy?.password),
    score: Number.isInteger(proxy?.score) ? proxy.score : null,
    lastCheckedAt: proxy?.lastCheckedAt ?? null,
    errorCode: proxy?.errorCode ?? "",
  };
}

// One account, compact: identity, whether it is signed in, and its note. No
// path, no fingerprint detail, no history arrays.
export function compactAccount(account) {
  return {
    provider: account?.provider ?? "",
    key: account?.key ?? "",
    signedIn: Boolean(account?.signedIn),
    signedInAt: account?.signedInAt ?? null,
    uid: account?.uid ?? null,
    accountId: account?.accountId ?? null,
    note: account?.note ?? "",
    lastCheckedAt: account?.lastCheck?.at ?? null,
  };
}

// The digest itself. `state` is assembled by the route from the live
// controllers and the store; this function only shapes it, slices and all, so
// a test can feed it a fixed object and read the exact output.
export function agentDigest({
  version,
  port,
  providers = [],
  proxies = [],
  accounts = [],
  environment = null,
  jobs = {},
  service = "ready",
  counts = null,
  recovered = null,
}) {
  const compactProviders = providers.map(compactProvider);
  const compactProxies = proxies.map(compactProxy);
  const compactAccounts = accounts.map(compactAccount);
  return {
    version,
    service: { status: service, port: port ?? null },
    cli: "bin/clean-login.mjs",
    commands: AGENT_COMMANDS,
    state: {
      counts:
        counts ?? {
          providers: compactProviders.length,
          signableProviders: compactProviders.filter((provider) => provider.canSignIn).length,
          proxies: compactProxies.length,
          accounts: compactAccounts.length,
          accountsSignedIn: compactAccounts.filter((account) => account.signedIn).length,
        },
      environment: environment
        ? {
            state: environment.state ?? "unknown",
            ready: Boolean(environment.ready),
            installed: Boolean(environment.installed),
            modelInstalled: Boolean(environment.modelInstalled),
          }
        : null,
      jobs: {
        signin: jobs.signin ?? "idle",
        nativeSignIn: jobs.nativeSignIn ?? "idle",
        score: jobs.score ?? "idle",
        check: jobs.check ?? "idle",
        environment: jobs.environment ?? "idle",
      },
      providers: compactProviders,
      proxies: compactProxies,
      accounts: compactAccounts,
      // Non-null when a corrupt proxies.json was quarantined at startup: the
      // empty list above is then a recovery, not an empty store.
      recovered,
    },
  };
}
