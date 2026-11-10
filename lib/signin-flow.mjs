// The single-lifetime sign-in orchestration: key allocation, the account's
// pinned identity, the provider plugin's browser method, the isolated browser
// and the write-back, all in one call chain.
//
// Why one call chain: everything after `authorize()` lives in the closure of a
// promise held only in THIS process's memory. The provider plugin's
// `callback()` polls the vendor and the browser is a child process, but the
// handle that ties them together is in memory. A host reload drops it, so
// `authorize()` -> `callback()` must not be split across several user requests;
// this module keeps the whole lifecycle inside one `startSignIn()` call and
// reports progress through the flow state instead.
//
// The flow is honest about failures. A missing plugin, a method that returns no
// URL, a missing browser executable, a failed or timed-out callback and a
// failed write-back are all reported as distinct codes, never as a generic
// failure.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readAuthKeys } from "./account-keys.mjs";
import { readAuthEntries, signInKey, writeBack } from "./signin-writeback.mjs";
import { withSignInEgress } from "./signin-egress.mjs";
import { LOCAL_HINT, classifyMethod, pluginRootDir, requiresFormInput, requiresSecretInput } from "./magpie-plugins.mjs";
import {
  SIGNIN_FLOW_MARKER,
  accountDir,
  accountProfileDir,
  ensureIdentity,
  listAccountDirsWithMeta,
  readAccountMeta,
  reconcileAccountDir,
  rotateIdentity,
  writeAccountMeta,
} from "./account-identity.mjs";
import { SignInBrowserError, launchSignInBrowser, navigationWarning } from "./browser-launcher.mjs";
import { EXECUTABLE_ENV } from "./browser-environment.mjs";
import { methodInputFields, readMethodInputs } from "./method-inputs.mjs";
import { loginSnapshot, withLogin } from "./account-records.mjs";

export const SIGNIN_STATES = Object.freeze([
  "idle",
  "authorizing",
  // The browser is open and the user finishes there; the plugin's callback is
  // already polling. A device code (Qoder, MiniMax Code) also reads this way.
  "waiting-login",
  // There is no browser to open: the plugin sent a one-time code (Loomy's
  // phone code) and the flow waits for `submitCode()` to hand it back. The
  // callback has not been started, so nothing polls until the code arrives.
  "waiting-code",
  "finishing",
  "done",
  "error",
  "cancelled",
]);

const TERMINAL = new Set(["done", "error", "cancelled"]);

// How long a sign-in's callback may take before it is timed out. The startup
// orphan sweep reads a directory's in-flight marker and treats a marker older
// than this as abandoned, so the two decisions share one number instead of
// each spelling out six minutes.
export const CALLBACK_TIMEOUT_MS = 6 * 60 * 1000;

// Best-effort in-flight marker, written into the pre-allocated account
// directory once the directory exists and before the browser opens. Both
// directions swallow their failure: a directory the sweep cannot mark must not
// fail a sign-in, and one it cannot clear must not fail one either.
async function defaultWriteFlowMarker(dir, marker) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, SIGNIN_FLOW_MARKER), `${JSON.stringify(marker)}\n`, { mode: 0o600 });
}

async function defaultClearFlowMarker(dir) {
  await rm(join(dir, SIGNIN_FLOW_MARKER), { force: true });
}

export class SignInFlowError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = "SignInFlowError";
    this.code = code;
    this.status = status;
  }
}

// The account keys of `provider` whose directory carries an ownership ledger,
// i.e. the retired identities: signed out, but still the owner of their key and
// their pinned fingerprint. A new sign-in must never be allocated one of these
// keys (see `existingKeysFor` in `createSignInFlow`).
//
// Built on `listAccountDirsWithMeta` so the ledger and the on-disk layout are
// read the one way the rest of the package reads them. A directory whose ledger
// is missing or unreadable simply contributes no key. `list` is injectable for
// tests; production callers leave it alone.
export async function retiredAccountKeys(
  env = process.env,
  provider,
  { list = listAccountDirsWithMeta } = {},
) {
  const accounts = await list(env);
  const keys = new Set();
  for (const account of accounts ?? []) {
    if (!account || account.provider !== provider) continue;
    if (!account.meta) continue;
    if (typeof account.key === "string" && account.key) keys.add(account.key);
  }
  return keys;
}


function createDeferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function normalizeError(error) {
  if (error instanceof SignInFlowError || error instanceof SignInBrowserError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "signin_failed",
    message: String(error?.message ?? error ?? "The sign-in failed."),
  };
}

// Instructions that name a one-time code the user has to confirm or type: a
// device-code flow, a phone-code flow, a PAT the user pastes. Checked before
// BROWSER_HINT, because several of these also say "in the browser" and the code
// is what distinguishes them (MiniMax Code, Qoder, Loomy's phone code).
const DEVICE_HINT = /device|\bcode\b|验证码|驗證碼|手机码|手機碼|授权码|授權碼|设备码|設備碼/i;

// Instructions that name a browser or web page. Checked after DEVICE_HINT, so
// "confirm the code ... in the browser" stays a device flow.
const BROWSER_WORD_HINT = /browser|浏览器|瀏覽器|网页|網頁|web page|sign in to/i;

// Classify the return value of a provider method's `authorize()` call. This is
// the only place the real sign-in kind is knowable: the scan cannot call
// authorize(), so the plugins put the browser/device detail in the returned
// `url`/`instructions` rather than in the method label.
//
// Rules, in order:
//   1. no object                                 -> unknown
//   2. url + instructions naming a one-time code  -> device
//   3. url + instructions naming a browser        -> browser
//   4. url, instructions silent                   -> browser (an https auth page
//                                                   is itself the evidence)
//   5. no url + typed prompts (text / password)   -> secret (password) or form
//   6. no url, no typed prompts                   -> local (reuse a local session)
//
// Rule 6 is deliberately conservative. Every real local-session method (the
// desktop app's or the vendor CLI's already-signed-in account) returns exactly
// "no url, but instructions like `Uses the account ...`". Calling that "needs a
// form" was the bug: a local session is common and real, whereas a URL-less
// fill-in form is only a form when the method declares a typed prompt. When in
// doubt, "local" is the honest reading, never "needs a form".
//
// `method` is optional and only supplies the declared `prompts` shape; the
// function keeps working with just the authorize() return value.
export function classifyAuthorizedFlow(authorized, method = null) {
  if (!authorized || typeof authorized !== "object") {
    return { category: "unknown", url: "", instructions: "" };
  }
  const url = typeof authorized.url === "string" ? authorized.url.trim() : "";
  const instructions = typeof authorized.instructions === "string" ? authorized.instructions : "";
  if (url) {
    if (DEVICE_HINT.test(instructions)) return { category: "device", url, instructions };
    if (BROWSER_WORD_HINT.test(instructions)) return { category: "browser", url, instructions };
    return { category: "browser", url, instructions };
  }
  // No URL: only a declared typed prompt makes this a fill-in form. Anything
  // else is a local-session reuse, which is what the real plugins return.
  const prompts = Array.isArray(method?.prompts)
    ? method.prompts
    : Array.isArray(authorized?.prompts)
      ? authorized.prompts
      : [];
  if (requiresSecretInput(prompts)) return { category: "secret", url, instructions };
  if (requiresFormInput(prompts)) return { category: "form", url, instructions };
  return { category: "local", url, instructions };
}

// Picks the browser sign-in method out of a plugin's `auth.methods`. The
// classification from magpie-plugins.mjs is the first choice; if no method
// explicitly says "browser", any non-local oauth method with an authorize
// function is accepted, because a plugin may word its label in a way the
// classifier does not recognize. A local-session method is never picked.
//
// A caller that already knows which method it wants (for example one of the
// several ZCode sites) may pass it as the second argument, either as the method
// object itself or as its label. A supplied label that matches nothing returns
// null so the flow reports the mismatch instead of silently using the first
// method. Omitting the second argument keeps the old first-match behavior.
export function chooseBrowserMethod(methods, preferred = null) {
  const list = Array.isArray(methods) ? methods : [];
  const withAuthorize = list.filter((method) => typeof method?.authorize === "function");
  // A local-session method is never a browser flow, so it is never picked,
  // not even when the caller names it explicitly.
  const runnable = withAuthorize.filter((method) => !LOCAL_HINT.test(String(method?.label ?? "")));
  if (preferred && typeof preferred === "object") {
    const exact = runnable.find((method) => method === preferred);
    if (exact) return exact;
  }
  const wantedLabel =
    typeof preferred === "string"
      ? preferred
      : preferred && typeof preferred === "object" && typeof preferred.label === "string"
        ? preferred.label
        : "";
  if (wantedLabel) {
    return runnable.find((method) => method.label === wantedLabel) ?? null;
  }
  const explicit = runnable.find((method) => classifyMethod(method).category === "browser");
  if (explicit) return explicit;
  return (
    runnable.find(
      (method) =>
        classifyMethod(method).type === "oauth" && !LOCAL_HINT.test(String(method?.label ?? "")),
    ) ?? null
  );
}

async function readPluginEntry(dir) {
  let main = "index.mjs";
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    if (typeof pkg?.main === "string" && pkg.main) main = pkg.main;
    else if (typeof pkg?.exports === "string" && pkg.exports) main = pkg.exports;
  } catch {
    // Fall back to the convention the other provider packages use.
  }
  return join(dir, main);
}

// Imports the installed provider package in this process, calls each exported
// factory with the real `{ client, magpie }` input and returns the hooks whose
// `auth.provider` is the one asked for. Third-party code is only ever imported
// here, at sign-in time, never during startup or a scan.
export async function defaultLoadProvider({ provider, env = process.env, client, magpie, pluginScanner, pluginInput } = {}) {
  let scan = pluginScanner?.get ? pluginScanner.get() : null;
  if (!scan?.available && pluginScanner?.refresh) scan = await pluginScanner.refresh();
  const entry = scan?.providers?.find?.((item) => item?.id === provider);
  if (!entry || typeof entry.package !== "string" || !entry.package) {
    throw new SignInFlowError(
      "plugin_missing",
      `No installed provider plugin provides "${provider}".`,
      404,
    );
  }
  const root = pluginRootDir(env);
  const dir = join(root, ...entry.package.split("/").filter(Boolean));
  let mod;
  try {
    mod = await import(pathToFileURL(await readPluginEntry(dir)).href);
  } catch (error) {
    throw new SignInFlowError(
      "plugin_load_failed",
      `The "${provider}" plugin could not be imported: ${String(error?.message ?? error)}`,
      502,
    );
  }
  const input = pluginInput ?? {
    client,
    magpie,
    directory: process.cwd(),
    worktree: process.cwd(),
    $: undefined,
    project: {},
  };
  const failures = [];
  // The same two export shapes the scanner in lib/magpie-plugins.mjs reads:
  // named factory exports, and the host shape `export default { id, server }`.
  // The card lists a sign-in method because the scanner understood the
  // package, so this loader has to accept the same shapes -- otherwise the
  // dialog offers "Sign in with Google" and then reports that the plugin
  // exposes no sign-in method. Named factories come first, explicitly, so the
  // winner never depends on how a package sorts its export keys.
  const factories = [];
  const hostServers = [];
  for (const key of Object.keys(mod)) {
    const value = mod[key];
    if (typeof value === "function") factories.push(value);
    else if (value && typeof value === "object" && typeof value.server === "function") {
      hostServers.push(value.server);
    }
  }
  for (const factory of [...factories, ...hostServers]) {
    let hooks;
    try {
      hooks = await factory(input);
    } catch (error) {
      failures.push(String(error?.message ?? error));
      continue;
    }
    const auth = hooks?.auth;
    if (auth && auth.provider === provider && Array.isArray(auth.methods)) {
      return { methods: auth.methods, package: entry.package };
    }
  }
  throw new SignInFlowError(
    "plugin_load_failed",
    `The "${provider}" plugin exposes no sign-in method${failures.length ? `: ${failures[0]}` : "."}`,
    502,
  );
}

async function defaultResolveExecutable({ env = process.env, environment } = {}) {
  if (environment?.status) {
    try {
      const status = await environment.status();
      if (typeof status?.executablePath === "string" && status.executablePath) {
        return status.executablePath;
      }
    } catch {
      // Fall through to the environment override.
    }
  }
  return env?.[EXECUTABLE_ENV] || process.env[EXECUTABLE_ENV] || null;
}

function publicFlow(flow) {
  if (!flow) return null;
  return {
    flowId: flow.flowId,
    provider: flow.provider,
    state: flow.state,
    key: flow.key,
    accountKey: flow.accountKey,
    url: flow.url,
    instructions: flow.instructions,
    // The real sign-in kind, known only after authorize() ran. Null until then.
    methodCategory: flow.methodCategory ?? null,
    // True while a `method: "code"` plugin is waiting for the one-time code
    // the user has to submit. The page shows the code box from this flag, not
    // from the state alone, so a browser flow never grows a code box.
    codeRequired: Boolean(flow.codeRequired),
    identityCreated: flow.identityCreated,
    // Whether this sign-in was started for a chosen existing identity rather
    // than a fresh account.
    claimed: Boolean(flow.claimKey),
    // The chosen identity was asked to draw a SECOND fingerprint, in place
    // (`account.rotate`). Only ever true alongside `claimed`.
    rotated: Boolean(flow.pinRotated),
    // The invariant overrode a freshly drawn pin: the credential already owns
    // a directory, so its old pin won and the new one was deleted. The page has
    // to say so -- otherwise "sign in as a new account" reads like a rotation
    // that never happened. Asking for a rotation is `account.rotate`.
    pinDiscarded: Boolean(flow.pinDiscarded),
    // True when this flow is a hosted renewal: the same profile and exit as the
    // original login, opened headless with nobody watching. The page uses it to
    // tell a background renewal apart from the sign-in the user started.
    silent: Boolean(flow.silent),
    pid: flow.pid,
    // A first-navigation timeout is a warning, not a terminal error. Expose
    // only the safe fields so no URL, stack trace or OAuth code leaves the flow.
    warning: navigationWarning(flow.warning),
    createdAt: flow.createdAt,
    finishedAt: flow.finishedAt,
    error: flow.error ? { ...flow.error } : null,
    // Summaries of post-login actions (exit sync and magpie provider registration).
    // Safe fields only: no exit URL, no credential, no stack trace.
    proxySync: flow.proxySync ? { ...flow.proxySync } : null,
  };
}

// A hosted renewal runs with nobody at the keyboard. If the vendor still asks
// for a login, waiting the full interactive six minutes only burns the exit and
// the account's goodwill, so a silent flow gives up much sooner. It stays well
// under CALLBACK_TIMEOUT_MS so the orphan sweep never mistakes a live renewal
// for an abandoned one.
export const SILENT_CALLBACK_TIMEOUT_MS = 2 * 60 * 1000;

export function createSignInFlow(options = {}) {
  const {
    client,
    magpie,
    env = process.env,
    environment,
    pluginScanner,
    pluginInput,
    loadProvider = defaultLoadProvider,
    launchBrowser = launchSignInBrowser,
    resolveExecutable = defaultResolveExecutable,
    ensureAccountIdentity = ensureIdentity,
    rotateAccountIdentity = rotateIdentity,
    identityGenerator,
    random = Math.random,
    callbackTimeoutMs = CALLBACK_TIMEOUT_MS,
    silentCallbackTimeoutMs = SILENT_CALLBACK_TIMEOUT_MS,
    // Optional first-navigation deadline; absent keeps the launcher default.
    navTimeoutMs,
    writeFlowMarker = defaultWriteFlowMarker,
    clearFlowMarker = defaultClearFlowMarker,
    pid = process.pid,
    idFactory = () => randomUUID(),
    now = () => new Date().toISOString(),
    readKeys = () => readAuthKeys(env),
    readEntries = () => readAuthEntries(env),
    retiredKeys = (providerId) => retiredAccountKeys(env, providerId),
    reconcile = reconcileAccountDir,
    // Writes the signed-in account's exit into magpie's own per-account proxy
    // map. The default does nothing on purpose: a flow can be constructed
    // against a partial `env` (only the data dir overridden), and such a flow
    // must never resolve the real magpie config directory and write into it.
    // The HTTP service passes the real sync, built from its full `env`.
    syncAccountProxy = async () => ({ ok: true, reason: "not_configured" }),
  } = options;

  let flow = null;

  async function safeClose(browser) {
    try {
      await browser?.close?.();
    } catch {
      // A browser that refused to close must not change the flow's outcome.
    }
  }

  function throwIfCancelled(current) {
    if (current.cancelled) {
      throw new SignInFlowError("cancelled", "The sign-in was cancelled.", 409);
    }
  }

  async function markInFlight(current) {
    if (!current.dir) return;
    try {
      await writeFlowMarker(current.dir, {
        flowId: current.flowId,
        pid,
        startedAt: current.createdAt,
      });
    } catch {
      // Best effort: an unmarked directory only risks being swept later.
    }
  }

  async function clearInFlight(current) {
    if (!current.dir) return;
    try {
      await clearFlowMarker(current.dir);
    } catch {
      // Best effort: a stale marker is reaped by the age check on startup.
    }
  }

  // Starts the plugin's callback exactly once. A browser flow starts it as
  // soon as the window is open; a code flow starts it only when the user
  // submits the code, because until then there is nothing to poll for.
  function startCallback(current, input) {
    if (current.callbackStarted) return;
    current.callbackStarted = true;
    runCallback(current, input).finally(async () => {
      current.finishedAt ??= now();
      await clearInFlight(current);
      current.resolveSettled();
    });
  }

  async function runCallback(current, input) {
    let result;
    try {
      result = await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          current.armCancel = null;
          fn(value);
        };
        const timer = setTimeout(
          () =>
            finish(
              reject,
              new SignInFlowError("callback_timeout", "The sign-in did not finish in time.", 504),
            ),
          current.silent ? silentCallbackTimeoutMs : callbackTimeoutMs,
        );
        current.armCancel = () =>
          finish(reject, new SignInFlowError("cancelled", "The sign-in was cancelled.", 409));
        Promise.resolve()
          // The code exchange is another request the plugin makes, so it leaves
          // through the same exit as the link that was minted for it.
          .then(() => withSignInEgress(current.proxy, () => current.callback(input)))
          .then(
            (value) => finish(resolve, value),
            (error) => finish(reject, error),
          );
      });
    } catch (error) {
      current.state = current.cancelled ? "cancelled" : "error";
      current.error = current.cancelled ? null : normalizeError(error);
      await safeClose(current.browser);
      return;
    }

    if (!result || result.type !== "success") {
      current.state = "error";
      current.error = {
        code: "callback_failed",
        message:
          typeof result?.error === "string" && result.error
            ? result.error
            : "The sign-in did not complete.",
      };
      await safeClose(current.browser);
      return;
    }

    current.state = "finishing";
    let finalKey = null;
    try {
      // A directory that already carries a ledger belongs to a known identity.
      // The callback result must agree with it before anything is written:
      // reusing a key must never let a different account sign in under
      // someone else's pinned fingerprint. On a mismatch nothing is written
      // and the directory stays retired; the in-flight marker is cleared by
      // the caller's `finally` below.
      const existingMeta = current.dir ? await readAccountMeta(current.dir) : null;
      const ledgerId = existingMeta ? String(existingMeta.uid || existingMeta.accountId || "") : "";
      const incomingId = String(result.uid || result.accountId || "");
      if (existingMeta && ledgerId && incomingId && ledgerId !== incomingId) {
        current.state = "error";
        current.error = {
          code: "identity_mismatch",
          message:
            "This sign-in returned a different account than the identity it was started for.",
        };
      } else {
        const written = await writeBack({
          provider: current.provider,
          result,
          entries: readEntries(),
          client,
          // A claimed identity must land on the key the user picked, so the
          // settle name match is skipped for it. A fresh account allocates
          // against the same key set it was started with, so a retired key is
          // never reused here either (it would put this credential on another
          // account's directory).
          opts: current.claimKey ? { forceKey: current.claimKey } : { takenKeys: current.takenKeys },
        });
        if (!written.ok) {
          current.state = "error";
          current.error = { code: "write_failed", message: written.error };
        } else {
          current.accountKey = written.key;
          finalKey = written.key;
          // Record the ownership ledger before the reconciliation below, so it
          // travels with the directory when the directory is renamed onto the
          // account's real key. Best effort: the credential is already written,
          // and an unledgered directory is reclaimed conservatively.
          //
          // Re-signing in must not erase the account's note, its identity-check
          // history or its earlier logins. Only those three optional fields are
          // carried over (never a blind spread of a possibly stale ledger),
          // and this login is prepended as a whitelisted exit snapshot. A
          // direct sign-in still records one `proxyId: null` login.
          try {
            const signedAt = now();
            const carried = {};
            if (existingMeta && typeof existingMeta.note === "string") {
              carried.note = existingMeta.note;
            }
            if (existingMeta && Array.isArray(existingMeta.checks)) {
              carried.checks = existingMeta.checks;
            }
            if (existingMeta && Array.isArray(existingMeta.loginHistory)) {
              carried.loginHistory = existingMeta.loginHistory;
            }
            await writeAccountMeta(
              current.dir,
              withLogin(
                {
                  version: 1,
                  provider: current.provider,
                  key: written.key,
                  accountId: written.entry?.accountId ?? null,
                  uid: written.entry?.uid ?? null,
                  signedInAt: signedAt,
                  ...carried,
                },
                loginSnapshot(current.proxyMeta, signedAt),
              ),
            );
          } catch {
            // Leave the flow done; a missing ledger only affects re-use later.
          }
          // The account's own proxy in magpie now follows the exit it signed
          // in through, so its traffic does not fall back to the provider-wide
          // proxy. Best effort and deliberately after the credential and the
          // ledger are saved: a magpie without providers.json, or a read-only
          // config directory, must not turn a successful sign-in into an
          // error. Only a credential-free summary is kept, never the URL.
          try {
            const sync = await syncAccountProxy({
              provider: current.provider,
              accountId: written.entry?.accountId ?? null,
              proxy: current.proxy,
            });
            current.proxySync = {
              ok: sync?.ok !== false,
              reason: sync?.reason ?? null,
              changed: Array.isArray(sync?.changed) ? sync.changed.length : 0,
              // A credential-free registration report tells the caller whether
              // magpie now offers the provider whose first sign-in happened here.
              registration: sync?.registration
                ? {
                    ok: sync.registration.ok === true,
                    state: sync.registration.state ?? null,
                    action: sync.registration.action ?? null,
                    reason: sync.registration.reason ?? null,
                  }
                : null,
            };
          } catch (error) {
            current.proxySync = {
              ok: false,
              reason: "sync_failed",
              changed: 0,
              error: String(error?.message ?? error),
            };
          }
          current.state = "done";
          current.error = null;
        }
      }
    } catch (error) {
      current.state = "error";
      current.error = { code: "write_failed", message: String(error?.message ?? error) };
    } finally {
      // Close first: on Windows an open browser profile locks its files and
      // would block the reconciliation move below.
      await safeClose(current.browser);
    }
    // The account turned out to be an existing one: keep the pin beside the key
    // the account really lives under.
    if (finalKey && finalKey !== current.key) {
      try {
        const moved = await reconcile(env, current.provider, current.key, finalKey);
        // This sign-in drew a pin and the account already owned one, so the
        // drawn pin was deleted and the old one kept. The credential is safe;
        // the user's expectation is not, so record it for the page.
        current.pinDiscarded = Boolean(moved?.discarded) && Boolean(current.identityCreated);
      } catch {
        // Best effort; a completed sign-in is not undone by this.
      }
      // The directory was moved onto the account's real key; drop the marker
      // there too, since the marker travelled with it.
      try {
        await clearFlowMarker(accountDir(env, current.provider, finalKey));
      } catch {
        // Best effort.
      }
    }
  }

  // The key set `signInKey` allocates against. Besides the keys magpie still
  // holds a credential for, it includes the keys of retired identities: a
  // signed-out account's key is gone from `plugin-auth.json`, but its directory
  // -- the pin and the browser profile -- is still there and still belongs to
  // that account. Allocating that key again would open the browser on the
  // retired directory, so a brand-new account would sign its login page in on
  // the previous account's fingerprint and cookies. Treating a retired key as
  // taken is what keeps a new identity off a retired directory.
  //
  // `single === true` is deliberately excluded. Such a provider has exactly one
  // slot: `signInKey` returns `accountsOf(keys, provider)[0] ?? provider` no
  // matter what else the set holds, so merging the retired keys could not move
  // the target anywhere -- there is no second slot to move it to, and a key the
  // provider no longer has cannot be dropped from the slot it names. Inventing
  // a "skip this directory" rule here would only contradict the single-slot
  // contract. The fallbacks stay what they already are for every write: the
  // callback's uid guard (a different account fails with `identity_mismatch`
  // before anything is written) and the UI's list of retired identities, which
  // lets the user continue the existing identity explicitly instead of starting
  // a second account on top of it.
  //
  // Never throws for the ledger read: a directory listing or ledger read that
  // fails degrades to exactly the pre-existing allocation (the auth keys only)
  // instead of interrupting the login.
  async function existingKeysFor(provider, single) {
    const keys = readKeys();
    const union =
      keys instanceof Set
        ? new Set(keys)
        : new Set(Array.isArray(keys) ? keys : Object.keys(keys ?? {}));
    if (single === true) return union;
    try {
      for (const key of await retiredKeys(provider)) union.add(key);
    } catch {
      // Keep the union as it is: allocation behaves as it did before.
    }
    return union;
  }

  // `proxyMeta` is the server's whitelisted `{ id, name, region, type }`
  // view of the chosen exit (or null for a direct login). Only these display
  // fields are ever written into the ledger; the full proxy record with its
  // credentials stays with the browser launcher.
  //
  // `methodInputs` are the answers the page collected for the method's declared
  // prompts (a team's site, an enterprise VPC instance or domain, a Personal
  // Access Token). They are filtered against the method's own declarations
  // before plugin code sees them and are never stored, never logged and never
  // returned in the flow status.
  async function startSignIn({
    provider,
    proxy = null,
    proxyMeta = null,
    single = false,
    methodLabel = null,
    account = null,
    methodInputs = null,
    // A hosted renewal: no window, no code box, no human. Only a method that
    // completes on its own in the account's own browser can be hosted.
    silent = false,
  } = {}) {
    // `account` is the page's choice of identity: `{ key }` continues an
    // existing one, `{ key, rotate: true }` continues it on a NEW fingerprint.
    const claimKey =
      account && typeof account === "object" && typeof account.key === "string" && account.key
        ? account.key
        : null;
    const rotatePin = Boolean(
      account && typeof account === "object" && account.rotate === true,
    );
    if (typeof provider !== "string" || !provider) {
      throw new SignInFlowError("invalid_provider", "A provider id is required.", 400);
    }
    if (flow && !TERMINAL.has(flow.state)) {
      throw new SignInFlowError("busy", "A sign-in is already in progress.", 409);
    }

    // A rotation is a statement about ONE account, so it cannot travel without
    // the key that names it. Checked before the generic claim error so the
    // answer names what the user actually asked for; without it a request that
    // lost its key would quietly draw a provisional pin twice and call that a
    // new machine.
    if (rotatePin && !claimKey) {
      throw new SignInFlowError(
        "rotate_needs_account",
        "A new fingerprint needs the account it belongs to.",
        400,
      );
    }
    // An explicit `account.key` reuses a retired identity: the directory and
    // its pinned fingerprint already exist and must be read, not regenerated.
    // The ledger proves the directory belongs to this provider, so a bare
    // shared slot cannot be pointed at another account's profile.
    if (account && !claimKey) {
      throw new SignInFlowError(
        "invalid_account",
        "An account key is required to continue an identity.",
        400,
      );
    }
    if (claimKey) {
      const meta = await readAccountMeta(accountDir(env, provider, claimKey));
      if (!meta || meta.provider !== provider) {
        throw new SignInFlowError(
          "retired_missing",
          "The chosen identity no longer exists for this provider.",
          400,
        );
      }
    }

    const deferred = createDeferred();
    const current = {
      flowId: idFactory(),
      provider,
      proxyMeta,
      // The full exit record, kept only in this closure for the browser
      // launch and for the account-proxy sync after a successful write-back.
      // It is never exposed through `publicFlow` (a whitelist) and never
      // written into the ledger, because it can carry credentials.
      proxy,
      state: "authorizing",
      key: null,
      accountKey: null,
      claimKey,
      silent: Boolean(silent),
      // The key set the fresh allocation ran against, ledgers included. Kept so
      // the write-back allocates against the same set instead of re-deriving it.
      takenKeys: null,
      url: null,
      instructions: "",
      identityCreated: false,
      pinRotated: false,
      pinDiscarded: false,
      pid: null,
      error: null,
      warning: null,
      createdAt: now(),
      finishedAt: null,
      browser: null,
      callback: null,
      armCancel: null,
      cancelled: false,
      settled: deferred.promise,
      resolveSettled: deferred.resolve,
    };
    flow = current;

    try {
      throwIfCancelled(current);
      // (a) Pre-allocate the key with magpie's own rule, calling it "new" so a
      // fresh account is allocated while a `single` provider keeps its slot.
      // `existingKeysFor` also counts retired identities as taken, so the key a
      // signed-out account still owns is never handed to a new one.
      // A claimed identity keeps its own key: `signInKey` would return it
      // unchanged too, except on a `single` provider, where it would hand back
      // the provider's first slot instead of the identity the user picked.
      const allocationKeys = claimKey ? null : await existingKeysFor(provider, single);
      const key = claimKey ?? signInKey(provider, "new", allocationKeys, { single, random });
      current.key = key;
      // The set the allocation used is the one the write-back must use too, so
      // the two cannot disagree about which keys are taken.
      current.takenKeys = allocationKeys;
      // (b) One account directory, one persistent pin.
      const dir = accountDir(env, provider, key);
      // A rotation redraws the pin in the directory the account already owns,
      // and takes its profile with it. Doing it here -- on the claimed key,
      // before any provisional directory exists -- is what keeps it out of
      // `reconcile`'s way: the write-back lands on the same key it started on,
      // so there is no move to make and no fresh pin to throw away.
      let identity;
      if (rotatePin) {
        try {
          ({ identity } = await rotateAccountIdentity(
            dir,
            identityGenerator ? { generate: identityGenerator } : {},
          ));
        } catch (error) {
          throw new SignInFlowError(
            "rotate_failed",
            `The account's fingerprint could not be renewed: ${String(error?.message ?? error)}`,
            500,
          );
        }
        current.pinRotated = true;
        current.identityCreated = true;
      } else {
        const ensured = await ensureAccountIdentity(
          dir,
          identityGenerator ? { generate: identityGenerator } : {},
        );
        identity = ensured.identity;
        current.identityCreated = ensured.created;
      }
      current.dir = dir;
      // The directory now exists but carries no credential. Mark it as in
      // flight before the browser opens so a concurrent/next-startup orphan
      // sweep does not mistake it for an abandoned one.
      await markInFlight(current);
      throwIfCancelled(current);

      // (c) Import the provider plugin and ask its browser method for the URL
      // and the polling callback.
      const loaded = await loadProvider({
        provider,
        env,
        client,
        magpie,
        pluginScanner,
        pluginInput,
      });
      const method = chooseBrowserMethod(loaded?.methods, methodLabel);
      if (!method) {
        throw new SignInFlowError(
          "no_browser_method",
          methodLabel
            ? `The "${provider}" plugin has no sign-in method labelled "${methodLabel}".`
            : `The "${provider}" plugin has no browser sign-in method.`,
          502,
        );
      }
      // A method can need an answer before it starts: which site a team's plan
      // is on, an enterprise VPC instance or dedicated domain, a Personal
      // Access Token to exchange. The page collects those from the fields the
      // method declares and sends them back; only declared keys survive, so a
      // method never receives an input it did not ask for, and a blank required
      // field is refused here instead of surfacing as the plugin's own throw.
      const answers = readMethodInputs(method, methodInputs);
      if (!answers.ok) {
        throw new SignInFlowError(answers.code, answers.message, 400);
      }
      // A method that declares no prompts is called the way it always was, with
      // no arguments: an empty object would look like the page sent answers.
      // The plugin mints the link, sends the SMS and exchanges the code from
      // inside magpie's plugin host, which would send all of it through
      // magpie's own exit. Running authorize() under the picked proxy makes
      // those requests leave through the exit the dialog shows instead.
      const auth = await withSignInEgress(proxy, () =>
        methodInputFields(method).length > 0
          ? method.authorize(answers.inputs)
          : method.authorize(),
      );
      // The method's real kind is only knowable now, from what authorize()
      // returned. It is recorded for the status view and keeps the error codes
      // below honest about what was (not) returned.
      const authorized = classifyAuthorizedFlow(auth, method);
      current.methodCategory = authorized.category;

      // Hosting can only carry a flow that finishes by itself in the browser.
      // A device code, an SMS code, a secret or a form all need an answer from
      // a person, and a local callback needs the user's own machine. Refuse
      // here, before anything is opened, instead of parking a headless window
      // on a login page until it times out.
      if (current.silent && authorized.category !== "browser") {
        throw new SignInFlowError(
          "not_hostable",
          `The "${provider}" sign-in needs an answer from a person, so it cannot be renewed in the background.`,
          409,
        );
      }

      if (typeof auth?.callback !== "function") {
        throw new SignInFlowError(
          "no_callback",
          `The "${provider}" sign-in has no completion callback.`,
          502,
        );
      }
      current.callback = auth.callback;
      current.instructions = typeof auth.instructions === "string" ? auth.instructions : "";

      // A plugin with `method: "code"` (for example Loomy's SMS code flow)
      // returns no URL because there is no page to open: it sent a code to the
      // destination the user typed and asks for that code back. It waits in
      // `waiting-code` until `submitCode()` hands the code to `callback(input)`.
      const isCodeMethod = auth?.method === "code";
      if (isCodeMethod && current.silent) {
        throw new SignInFlowError(
          "not_hostable",
          `The "${provider}" sign-in asks for a one-time code, so it cannot be renewed in the background.`,
          409,
        );
      }
      if (isCodeMethod) {
        current.codeRequired = true;
        current.url = typeof auth.url === "string" ? auth.url : "";
        current.state = "waiting-code";
        throwIfCancelled(current);
        return {
          flowId: current.flowId,
          key: current.key,
          url: current.url,
          instructions: current.instructions,
        };
      }

      if (!auth || typeof auth.url !== "string" || !auth.url) {
        throw new SignInFlowError("no_url", `The "${provider}" sign-in returned no URL.`, 502);
      }
      current.url = auth.url;
      throwIfCancelled(current);

      // (d) Open the account's own browser profile at the URL. The request
      // waits only for the window to open, never for the login.
      const executablePath = await resolveExecutable({ env, environment });
      if (!executablePath) {
        throw new SignInFlowError(
          "browser_missing",
          "The login browser is not installed; prepare it on the Providers page first.",
          503,
        );
      }
      current.browser = await launchBrowser({
        executablePath,
        url: auth.url,
        profileDir: accountProfileDir(dir),
        identity,
        proxy,
        ...(current.silent ? { headless: true } : {}),
        ...(navTimeoutMs ? { navTimeoutMs } : {}),
      });
      current.pid = current.browser?.pid ?? null;
      current.warning = navigationWarning(current.browser?.warning);
      if (current.cancelled) {
        await safeClose(current.browser);
        throw new SignInFlowError("cancelled", "The sign-in was cancelled.", 409);
      }
      current.state = "waiting-login";
    } catch (error) {
      current.state = current.cancelled ? "cancelled" : "error";
      current.error = current.cancelled ? null : normalizeError(error);
      current.finishedAt = now();
      await safeClose(current.browser);
      await clearInFlight(current);
      current.resolveSettled();
      throw error instanceof SignInFlowError
        ? error
        : new SignInFlowError(current.error.code, current.error.message, 502);
    }

    // (e) The polling callback runs here, in the background, and writes the
    // result back itself. (f) The caller is answered now.
    startCallback(current);

    return {
      flowId: current.flowId,
      key: current.key,
      url: current.url,
      instructions: current.instructions,
    };
  }

  // Hands a one-time code to a flow that is in `waiting-code`. Starts the
  // callback in the background and returns the status immediately, matching
  // the browser flow's lifecycle.
  async function submitCode(code) {
    const current = flow;
    if (!current || current.state !== "waiting-code") {
      throw new SignInFlowError(
        "no_waiting_code",
        "No sign-in is currently waiting for a code.",
        409,
      );
    }
    const trimmed = typeof code === "string" ? code.trim() : "";
    if (!trimmed) {
      throw new SignInFlowError("invalid_code", "A verification code is required.", 400);
    }
    current.codeRequired = false;
    current.state = "finishing";
    startCallback(current, trimmed);
    return publicFlow(current);
  }

  function status() {
    return publicFlow(flow);
  }

  async function cancel() {
    const current = flow;
    if (!current || TERMINAL.has(current.state)) {
      return { cancelled: false, flow: publicFlow(current) };
    }
    current.cancelled = true;
    try {
      current.armCancel?.();
    } catch {
      // The callback was not armed yet; the flag is enough.
    }
    if (!TERMINAL.has(current.state)) {
      current.state = "cancelled";
      current.error = null;
    }
    await safeClose(current.browser);
    await clearInFlight(current);
    // A flow that never started its callback (a code flow that was cancelled
    // while still waiting for the code) would otherwise never settle.
    if (!current.callbackStarted) current.resolveSettled();
    return { cancelled: true, flow: publicFlow(current) };
  }

  return {
    states: SIGNIN_STATES,
    startSignIn,
    submitCode,
    status,
    cancel,
    // Waits for the background callback to reach a terminal state. Used by
    // tests; in production a GET reads `status()` instead.
    whenSettled: () => flow?.settled ?? Promise.resolve(),
  };
}
