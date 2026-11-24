// Launching the isolated login browser for one account.
//
// The browser is a stock Camoufox driven by playwright-core. It runs as its
// own operating-system process, and the service only holds a handle to it, so
// a slow sign-in never blocks the loopback service. Two entry points exist:
//
//   * `launchSignInBrowser(...)` is what the sign-in flow calls. It forks a
//     small host process (`signin-browser-host.mjs`) that owns the browser,
//     waits for the host to report either "ready" or an error, and returns
//     `{ pid, close() }` immediately after. The service never waits on the
//     login itself.
//   * `openSignInBrowser(...)` is the in-process launch the host runs. It is
//     exported so the host stays a thin wrapper and so the option builder can
//     be unit tested.
//
// Nothing here is a security boundary on its own: the profile is persistent
// per account and the fingerprint is pinned by the caller (see
// account-identity.mjs), because re-presenting one credential from several
// fingerprints trips the provider's risk control. `canvas_noise` is off so the
// browser does not add per-launch canvas noise on top of the pinned identity.

import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BROWSER_DIR_ENV, browserEnvironmentRoot, fingerprintModelDir } from "./browser-environment.mjs";
import { camoufoxCacheEnv, loadCamoufoxSandboxed } from "./camoufox-loader.mjs";

const HOST_PATH = fileURLToPath(new URL("./signin-browser-host.mjs", import.meta.url));
const SCORE_HOST_PATH = fileURLToPath(new URL("./score-browser-host.mjs", import.meta.url));
const IDENTITY_HOST_PATH = fileURLToPath(
  new URL("./identity-check-browser-host.mjs", import.meta.url),
);

// Playwright defaults to `waitUntil: "load"` with a 30s deadline. OAuth and
// trust-score pages can stay open and usable without ever firing `load`, so the
// first navigation gets its own explicit deadline and readiness condition.
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 60_000;
export const NAVIGATION_ERROR_CODE = "navigation_failed";
const NAVIGATION_STATUS = 504;
const NAVIGATION_WAIT_UNTIL = "domcontentloaded";

function normalizeNavTimeoutMs(value) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : DEFAULT_NAVIGATION_TIMEOUT_MS;
}

// Only the safe, displayable part of a navigation error crosses IPC. The raw
// browser message is kept on the in-process handle for debugging, never sent.
export function navigationWarning(error) {
  if (!error) return null;
  return {
    code: typeof error.code === "string" ? error.code : NAVIGATION_ERROR_CODE,
    status: Number.isFinite(error.status) ? error.status : NAVIGATION_STATUS,
    message: String(error.message ?? "The page did not finish loading."),
  };
}

export const DISPLAY_ENV = "MAGPIE_CLEAN_LOGIN_DISPLAY";
export const FONTCONFIG_ENV = "MAGPIE_CLEAN_LOGIN_FONTCONFIG";
export const SYSTEM_FONTCONFIG_PATH = "/etc/fonts/fonts.conf";

// The env the forked browser hosts run under. FPGEN_DATA_DIR is the name
// fpgen-js actually reads (only a fallback — the host also calls setModelDir
// from its launch input). camoufoxCacheEnv repeats the import-time cache
// redirect inside the child: without it the spawned process resolves the real
// user cache (LOCALAPPDATA / XDG_CACHE_HOME) and runtime writes like
// fontconfig's escape the sandbox. Because those overrides would also move
// browserEnvironmentRoot() inside the host, BROWSER_DIR_ENV is pinned so the
// host still finds the same sandbox root the parent computed.
//
// On Linux, DISPLAY and FONTCONFIG_FILE are explicit opt-ins via DISPLAY_ENV
// and FONTCONFIG_ENV: we never silently probe /tmp/.X11-unix/X99 or replace
// Camoufox's stock anti-fingerprinting fontconfig by default, and we never
// override an existing DISPLAY, WAYLAND_DISPLAY, or FONTCONFIG_FILE.
export function hostEnv(
  env,
  sandboxRoot,
  modelDir,
  platform = process.platform,
  { existsSync: exists = existsSync } = {},
) {
  const baseEnv = env ?? {};
  let display = {};
  let fontEnv = {};
  if (platform === "linux") {
    if (!baseEnv.DISPLAY && !baseEnv.WAYLAND_DISPLAY) {
      const requestedDisplay =
        typeof baseEnv[DISPLAY_ENV] === "string" ? baseEnv[DISPLAY_ENV].trim() : "";
      if (requestedDisplay) display = { DISPLAY: requestedDisplay };
    }
    if (!baseEnv.FONTCONFIG_FILE) {
      const fc =
        typeof baseEnv[FONTCONFIG_ENV] === "string" ? baseEnv[FONTCONFIG_ENV].trim() : "";
      if (fc && fc.toLowerCase() !== "off") {
        const candidate = fc.toLowerCase() === "system" ? SYSTEM_FONTCONFIG_PATH : fc;
        if (exists(candidate)) fontEnv = { FONTCONFIG_FILE: candidate };
      }
    }
  }
  return {
    ...baseEnv,
    ...display,
    ...fontEnv,
    ...camoufoxCacheEnv(sandboxRoot, platform),
    [BROWSER_DIR_ENV]: sandboxRoot,
    FPGEN_DATA_DIR: modelDir,
  };
}

export class SignInBrowserError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = "SignInBrowserError";
    this.code = code;
    this.status = status;
  }
}

// The score launch mirrors the sign-in launch, but its host reports a measured
// trust score instead of a ready login window. A distinct error type keeps the
// two channels from being confused in a catch block.
export class ScoreBrowserError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = "ScoreBrowserError";
    this.code = code;
    this.status = status;
  }
}

// Converts the proxy record the page stores into the shape playwright-core
// expects. A record already in `{ server }` form passes through.
export function toPlaywrightProxy(proxy) {
  if (!proxy || typeof proxy !== "object") return null;
  if (typeof proxy.server === "string" && proxy.server) {
    const out = { server: proxy.server };
    if (proxy.username) out.username = String(proxy.username);
    if (proxy.password) out.password = String(proxy.password);
    if (proxy.bypass) out.bypass = String(proxy.bypass);
    return out;
  }
  const host = typeof proxy.host === "string" ? proxy.host : "";
  const port = Number(proxy.port);
  if (!host || !Number.isInteger(port) || port <= 0) return null;
  const scheme =
    proxy.type === "socks5" || proxy.type === "socks4"
      ? proxy.type
      : proxy.type === "https"
        ? "https"
        : "http";
  // An IPv6 literal is ambiguous in a URL authority without brackets; the
  // same wrapping rule account-proxies.mjs uses for stored exits applies to
  // the one-off launch URL.
  const address = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const out = { server: `${scheme}://${address}:${port}` };
  if (proxy.username) out.username = String(proxy.username);
  if (proxy.password) out.password = String(proxy.password);
  return out;
}

// The options handed to camoufox. Kept as a pure function so the pin, the
// persistent profile and the proxy/geoip coupling can be asserted without a
// browser. `headless` defaults to false so an ordinary sign-in still shows
// its window; the identity check passes true.
export function buildLaunchInput({ url, profileDir, identity, proxy, modelDir, headless = false } = {}) {
  const playwrightProxy = toPlaywrightProxy(proxy);
  return {
    url,
    // The fingerprint model directory the host must point fpgen at before
    // camoufox draws anything. It travels as launch input, never as an
    // environment variable (see openSignInBrowser).
    modelDir: modelDir ?? null,
    launch: {
      // Persistent context: cookies and the provider's own session survive so
      // the user does not have to sign in again on the next account action.
      persistent_context: true,
      user_data_dir: profileDir,
      headless: Boolean(headless),
      // The pin is the account's own stored fingerprint, never a freshly
      // drawn one.
      fingerprint: identity ?? undefined,
      canvas_noise: false,
      enable_cache: true,
      humanize: true,
      ...(playwrightProxy ? { proxy: playwrightProxy, geoip: true } : {}),
    },
  };
}

async function defaultCheckExecutable(executablePath) {
  try {
    return (await stat(executablePath)).isFile();
  } catch {
    return false;
  }
}

const ACCOUNT_PURPOSE = "account";
const BLANK_URL = "about:blank";

function normalizePurpose(purpose) {
  return purpose === ACCOUNT_PURPOSE ? ACCOUNT_PURPOSE : "signin";
}

function normalizeLaunchUrl(url, purpose) {
  if (purpose !== ACCOUNT_PURPOSE) {
    if (typeof url !== "string" || !url) {
      throw new SignInBrowserError("url_missing", "The sign-in method returned no URL.", 502);
    }
    return url;
  }
  if (url === undefined || url === null) return BLANK_URL;
  if (typeof url !== "string") {
    throw new SignInBrowserError("invalid_url", "The account browser URL must be a string.", 400);
  }
  const trimmed = url.trim();
  if (!trimmed || trimmed.toLowerCase() === BLANK_URL) return BLANK_URL;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new SignInBrowserError("invalid_url", "The account browser URL is invalid.", 400);
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SignInBrowserError("invalid_url", "The account browser URL is invalid.", 400);
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    throw new SignInBrowserError(
      "invalid_url",
      "The account browser only opens http:, https:, or about:blank URLs.",
      400,
    );
  }
  if (parsed.username || parsed.password) {
    throw new SignInBrowserError(
      "invalid_url",
      "The account browser URL must not contain embedded credentials.",
      400,
    );
  }
  return parsed.href;
}

async function assertExecutable(executablePath, check, { isAccount = false } = {}) {
  const browserLabel = isAccount ? "account browser" : "login browser";
  if (typeof executablePath !== "string" || !executablePath) {
    throw new SignInBrowserError(
      "executable_missing",
      `The ${browserLabel} is not installed; prepare it on the Providers page first.`,
      503,
    );
  }
  if (!(await check(executablePath))) {
    throw new SignInBrowserError(
      "executable_missing",
      isAccount
        ? "The account browser executable was not found; prepare it on the Providers page first."
        : `The ${browserLabel} executable was not found at ${executablePath}.`,
      503,
    );
  }
}

// The in-process launch, run inside the forked host. `deps` is injectable so
// the host can be replaced in tests without importing camoufox.
export async function openSignInBrowser({
  executablePath,
  url,
  profileDir,
  identity,
  proxy,
  modelDir,
  headless = false,
  navTimeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS,
  purpose = "signin",
  deps = {},
} = {}) {
  const normalizedPurpose = normalizePurpose(purpose);
  const isAccount = normalizedPurpose === ACCOUNT_PURPOSE;
  const browserLabel = isAccount ? "account browser" : "login browser";
  const targetUrl = normalizeLaunchUrl(url, normalizedPurpose);
  if (!profileDir) {
    throw new SignInBrowserError("profile_missing", "The account has no browser profile directory.", 500);
  }
  const navigationTimeoutMs = normalizeNavTimeoutMs(navTimeoutMs);
  await assertExecutable(executablePath, deps.checkExecutable ?? defaultCheckExecutable, { isAccount });
  await mkdir(profileDir, { recursive: true, mode: 0o700 });

  const input = buildLaunchInput({ url: targetUrl, profileDir, identity, proxy, modelDir, headless });
  // fpgen resolves its model directory as `configuredDir || FPGEN_DATA_DIR ||
  // userCacheDir("fpgen")`, with one module-level `configuredDir`. Setting the
  // correctly named FPGEN_DATA_DIR here is only a fallback: importing camoufox
  // overwrites configuredDir with the user-shared cache, and configuredDir
  // outranks the environment. The explicit setModelDir below is what actually
  // decides the directory.
  if (input.modelDir) process.env.FPGEN_DATA_DIR = input.modelDir;
  let camoufox;
  try {
    camoufox = await (deps.loadCamoufox ?? (() => loadCamoufoxSandboxed(browserEnvironmentRoot())))();
  } catch (error) {
    throw new SignInBrowserError(
      "runtime_missing",
      isAccount
        ? "The account browser runtime could not be loaded."
        : `The ${browserLabel} runtime could not be loaded: ${String(error?.message ?? error)}`,
      503,
    );
  }
  // Point fpgen at the plugin's own model AFTER camoufox has been imported:
  // camoufox's paths.js calls setModelDir(<INSTALL_DIR>/fpgen) as it evaluates,
  // so doing this before the import would be undone. The directory arrives as
  // launch input, not as an environment variable, precisely because camoufox
  // overrides the variable at import time.
  if (input.modelDir) {
    try {
      const fpgen = await (deps.loadFpgen ?? (() => import("fpgen-js")))();
      fpgen.setModelDir(input.modelDir);
    } catch (error) {
      throw new SignInBrowserError(
        "runtime_missing",
        isAccount
          ? "The fingerprint runtime could not be loaded."
          : `The fingerprint runtime could not be loaded: ${String(error?.message ?? error)}`,
        503,
      );
    }
  }
  let firefox;
  try {
    ({ firefox } = await (deps.loadPlaywright ?? (() => import("playwright-core")))());
  } catch (error) {
    throw new SignInBrowserError(
      "runtime_missing",
      isAccount
        ? "The browser automation runtime could not be loaded."
        : `playwright-core could not be loaded: ${String(error?.message ?? error)}`,
      503,
    );
  }

  const shouldNavigate = !isAccount || targetUrl !== BLANK_URL;
  let context;
  let page;
  try {
    const fromOptions = await camoufox.launchOptions({
      executable_path: executablePath,
      headless: Boolean(headless),
      fingerprint: input.launch.fingerprint,
      canvas_noise: input.launch.canvas_noise,
      enable_cache: input.launch.enable_cache,
      humanize: input.launch.humanize,
      ...(input.launch.proxy ? { proxy: input.launch.proxy, geoip: true } : {}),
    });
    fromOptions.user_data_dir = profileDir;
    context = await camoufox.NewBrowser(firefox, {
      from_options: fromOptions,
      persistent_context: true,
      headless: Boolean(headless),
    });
    page = context.pages?.()[0] ?? (await context.newPage());
    if (!page || (shouldNavigate && typeof page.goto !== "function")) {
      throw new Error(`The ${browserLabel} opened no page.`);
    }
  } catch (error) {
    try {
      await context?.close();
    } catch {
      // The context may not exist yet; nothing to clean up.
    }
    throw new SignInBrowserError(
      "launch_failed",
      isAccount
        ? "The account browser could not be opened."
        : `The ${browserLabel} could not be opened: ${String(error?.message ?? error)}`,
      502,
    );
  }

  // Navigation is a separate phase: once the browser and page exist, a slow
  // page must not be reported as a failed launch or close the user's window.
  // For account browsers opening on `about:blank`, skip navigation altogether
  // to avoid unnecessary network traffic or timeouts.
  let navigationError = null;
  if (shouldNavigate) {
    try {
      await page.goto(targetUrl, { waitUntil: NAVIGATION_WAIT_UNTIL, timeout: navigationTimeoutMs });
    } catch (error) {
      const seconds = Math.ceil(navigationTimeoutMs / 1000);
      navigationError = new SignInBrowserError(
        NAVIGATION_ERROR_CODE,
        isAccount
          ? `The account browser is open, but the page did not finish loading within ${seconds} seconds. You can continue using the open window.`
          : `The login browser is open, but the page did not finish loading within ${seconds} seconds. You can still complete the sign-in in the open window.`,
        NAVIGATION_STATUS,
      );
      navigationError.timeoutMs = navigationTimeoutMs;
      navigationError.waitUntil = NAVIGATION_WAIT_UNTIL;
      navigationError.detail = String(error?.message ?? error);
    }
  }

  let closed = false;
  return {
    context,
    page,
    navigationError,
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await context.close();
      } catch {
        // Closing an already-closed window is not an error worth reporting.
      }
    },
  };
}

// Fork the host process, wait for it to report that the browser is open, and
// resolve with a handle. A launch failure inside the host comes back as a
// message, so the caller gets a real reason instead of a silent orphan.
export async function launchSignInBrowser({
  executablePath,
  url,
  profileDir,
  identity,
  proxy,
  modelDir,
  navTimeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS,
  timeoutMs = 60_000,
  // A hosted renewal has no user watching it: the same profile, the same
  // pinned fingerprint and the same exit, but no window on the desktop.
  headless = false,
  purpose = "signin",
  env = process.env,
  platform = process.platform,
  deps = {},
} = {}) {
  const normalizedPurpose = normalizePurpose(purpose);
  const isAccount = normalizedPurpose === ACCOUNT_PURPOSE;
  const browserLabel = isAccount ? "account browser" : "login browser";
  const targetUrl = normalizeLaunchUrl(url, normalizedPurpose);
  if (!profileDir) {
    throw new SignInBrowserError("profile_missing", "The account has no browser profile directory.", 500);
  }
  await assertExecutable(executablePath, deps.checkExecutable ?? defaultCheckExecutable, { isAccount });
  await mkdir(profileDir, { recursive: true, mode: 0o700 });

  const resolvedModelDir = modelDir ?? fingerprintModelDir(env);
  const navigationTimeoutMs = normalizeNavTimeoutMs(navTimeoutMs);
  // The launch input can carry a proxy credential, so it goes to the host over
  // stdin rather than through a payload file on disk: a file outlives a crash
  // inside the profile directory and has to be cleaned up on every path.
  const payload = JSON.stringify({
    executablePath,
    url: targetUrl,
    profileDir,
    identity,
    proxy,
    modelDir: resolvedModelDir,
    navTimeoutMs: navigationTimeoutMs,
    headless: Boolean(headless),
    purpose: normalizedPurpose,
  });

  const spawnHost = deps.fork ?? fork;
  let child;
  try {
    child = spawnHost(deps.hostPath ?? HOST_PATH, [], {
      stdio: ["pipe", "ignore", "pipe", "ipc"],
      windowsHide: false,
      env: hostEnv(
        env,
        browserEnvironmentRoot(env),
        resolvedModelDir,
        platform,
        deps.existsSync ? { existsSync: deps.existsSync } : undefined,
      ),
    });
  } catch (error) {
    throw new SignInBrowserError(
      "launch_failed",
      isAccount
        ? "The account browser host could not be started."
        : `The ${browserLabel} host could not be started: ${String(error?.message ?? error)}`,
      502,
    );
  }
  // An EPIPE here means the host exited before reading its input; the exit
  // listener below reports that failure, so the write error itself is ignored.
  child.stdin?.on?.("error", () => {});
  child.stdin?.end?.(`${payload}\n`);

  let warning = null;
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(
        () => done(reject, new SignInBrowserError("launch_timeout", `The ${browserLabel} did not open in time.`, 504)),
        timeoutMs,
      );
      child.on("message", (message) => {
        if (message?.type === "ready") {
          warning = message.warning ?? null;
          done(resolve);
        } else if (message?.type === "error") {
          const code = typeof message.code === "string" && message.code ? message.code : "launch_failed";
          let safeMessage = String(message.message ?? `The ${browserLabel} failed to open.`);
          if (isAccount) {
            if (code === "executable_missing") {
              safeMessage =
                "The account browser executable was not found; prepare it on the Providers page first.";
            } else if (code === "runtime_missing") {
              safeMessage = "The account browser runtime could not be loaded.";
            } else if (code === "invalid_url") {
              safeMessage = "The account browser only opens http:, https:, or about:blank URLs.";
            } else if (code === "launch_timeout") {
              safeMessage = "The account browser did not open in time.";
            } else {
              safeMessage = "The account browser could not be opened.";
            }
          }
          done(
            reject,
            new SignInBrowserError(code, safeMessage, message.status ?? 502),
          );
        }
      });
      child.once("error", (error) =>
        done(
          reject,
          new SignInBrowserError(
            "launch_failed",
            isAccount
              ? "The account browser host failed."
              : `The ${browserLabel} host failed: ${String(error?.message ?? error)}`,
            502,
          ),
        ),
      );
      child.once("exit", (code) => {
        if (!settled) {
          done(
            reject,
            new SignInBrowserError(
              "launch_failed",
              `The ${browserLabel} host exited before it opened the browser (code ${code}).`,
              502,
            ),
          );
        }
      });
    });
  } catch (error) {
    try {
      child.kill();
    } catch {
      // Already gone.
    }
    throw error;
  }

  // The browser must outlive the request that asked for it. Unref both the
  // child and its IPC channel so the service can exit with the window still
  // open; `close()` is the explicit way to end it.
  child.unref?.();
  child.channel?.unref?.();

  // `closed` settles when the host process exits, whatever the reason: the
  // user shut the window, the browser crashed, or close() asked it to. A
  // caller holding the handle uses it to notice a dead window instead of
  // reporting it as still open.
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  closed.catch(() => {});
  child.once("exit", () => resolveClosed());

  let closedOnce = false;
  return {
    pid: child.pid,
    warning,
    closed,
    async close() {
      if (closedOnce) return;
      closedOnce = true;
      try {
        child.send({ type: "close" });
      } catch {
        try {
          child.kill();
        } catch {
          // Already gone.
        }
        return;
      }
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try {
            child.kill();
          } catch {
            // Already gone.
          }
          resolve();
        }, 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

function withLaunchTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ScoreBrowserError("launch_timeout", "The scoring browser did not open in time.", 504));
    }, timeoutMs);
    timer.unref?.();
    promise.then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Forks the score host, waits until the page window is open, and returns a
// handle. `result` settles with `{ score, label, ip }` when the host has read
// the trust score, or rejects with a `ScoreBrowserError`. The handle keeps the
// window open (the caller decides when to close it), and the forked host closes
// the browser on `disconnect`, so a service exit cannot leave an orphan.
export async function launchScoreBrowser({
  executablePath,
  url,
  profileDir,
  identity,
  proxy,
  modelDir,
  // First navigation has its own deadline; the page poll below is separate.
  navTimeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS,
  // How long the host may poll the page for the score.
  timeoutMs = 60_000,
  // How long the window may take to open. A separate number: a slow browser
  // start must not eat the page's own deadline.
  launchTimeoutMs = 60_000,
  env = process.env,
  platform = process.platform,
  // A display-less Linux box cannot show a window; the headed launch fails
  // there outright. Headless is the default in that case only — wherever a
  // display exists (and on win32/darwin always) the window still opens.
  headless = platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY,
  deps = {},
} = {}) {
  if (typeof url !== "string" || !url) {
    throw new ScoreBrowserError("url_missing", "The score page URL is missing.", 502);
  }
  if (!profileDir) {
    throw new ScoreBrowserError("profile_missing", "The scoring browser has no profile directory.", 500);
  }
  await assertExecutable(executablePath, deps.checkExecutable ?? defaultCheckExecutable);
  await mkdir(profileDir, { recursive: true, mode: 0o700 });

  const resolvedModelDir = modelDir ?? fingerprintModelDir(env);
  const navigationTimeoutMs = normalizeNavTimeoutMs(navTimeoutMs);
  const payload = JSON.stringify({
    executablePath,
    url,
    profileDir,
    identity,
    proxy,
    modelDir: resolvedModelDir,
    // The host owns the page poll, so it needs the same deadline.
    timeoutMs,
    // Never reuse timeoutMs: this is the first-navigation deadline.
    navTimeoutMs: navigationTimeoutMs,
    headless: Boolean(headless),
  });

  const spawnHost = deps.fork ?? fork;
  let child;
  try {
    child = spawnHost(deps.hostPath ?? SCORE_HOST_PATH, [], {
      stdio: ["pipe", "ignore", "pipe", "ipc"],
      windowsHide: false,
      env: hostEnv(
        env,
        browserEnvironmentRoot(env),
        resolvedModelDir,
        platform,
        deps.existsSync ? { existsSync: deps.existsSync } : undefined,
      ),
    });
  } catch (error) {
    throw new ScoreBrowserError(
      "launch_failed",
      `The scoring browser host could not be started: ${String(error?.message ?? error)}`,
      502,
    );
  }
  child.stdin?.on?.("error", () => {});
  child.stdin?.end?.(`${payload}\n`);

  let warning = null;
  let ready = false;
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Never let a rejection nobody is awaiting crash the process; the caller
  // still gets the rejection when it awaits `handle.result`.
  readyPromise.catch(() => {});

  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  result.catch(() => {});

  child.on("message", (message) => {
    if (message?.type === "ready") {
      warning = message.warning ?? null;
      if (!ready) {
        ready = true;
        resolveReady();
      }
      return;
    }
    if (message?.type === "score") {
      resolveResult({ score: message.score, label: message.label, ip: message.ip });
      return;
    }
    if (message?.type === "error") {
      const error = new ScoreBrowserError(
        typeof message.code === "string" && message.code ? message.code : "launch_failed",
        String(message.message ?? "The scoring browser failed."),
        message.status ?? 502,
      );
      if (ready) rejectResult(error);
      else rejectReady(error);
    }
  });
  child.once("error", (error) => {
    const wrapped = new ScoreBrowserError(
      "launch_failed",
      `The scoring browser host failed: ${String(error?.message ?? error)}`,
      502,
    );
    if (ready) rejectResult(wrapped);
    else rejectReady(wrapped);
  });
  child.once("exit", (code) => {
    if (!ready) {
      rejectReady(
        new ScoreBrowserError(
          "launch_failed",
          `The scoring browser host exited before it opened the browser (code ${code}).`,
          502,
        ),
      );
    } else {
      rejectResult(
        new ScoreBrowserError(
          "launch_failed",
          `The scoring browser host exited before returning a score (code ${code}).`,
          502,
        ),
      );
    }
  });

  try {
    await withLaunchTimeout(readyPromise, launchTimeoutMs);
  } catch (error) {
    try {
      child.kill();
    } catch {
      // Already gone.
    }
    throw error;
  }

  // The window must outlive the request that opened it. Unref the child and
  // its IPC channel so the service can exit with the window still open; the
  // host shuts the browser down on `disconnect`, and `close()` is the explicit
  // way to end it.
  child.unref?.();
  child.channel?.unref?.();

  // See the sign-in handle: `closed` settles on ANY host exit, including the
  // user closing the window by hand or the host crashing mid-measure.
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  closed.catch(() => {});
  child.once("exit", () => resolveClosed());

  let closedOnce = false;
  return {
    pid: child.pid,
    warning,
    result,
    closed,
    async close() {
      if (closedOnce) return;
      closedOnce = true;
      try {
        child.send({ type: "close" });
      } catch {
        try {
          child.kill();
        } catch {
          // Already gone.
        }
        return;
      }
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try {
            child.kill();
          } catch {
            // Already gone.
          }
          resolve();
        }, 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

// Forks the identity-check host. It is the score launcher's shape with two
// differences: the payload carries `headless` (the check runs without a
// window) and the deadline the host polls the page with, and the host reports
// the raw page text as `{ type: "identity", text }` instead of a score. The
// parent parses that text; nothing about the verdict is decided here.
export async function launchIdentityCheckBrowser({
  executablePath,
  url,
  profileDir,
  identity,
  proxy,
  modelDir,
  headless = true,
  timeoutMs,
  launchTimeoutMs = 60_000,
  env = process.env,
  platform = process.platform,
  deps = {},
} = {}) {
  if (typeof url !== "string" || !url) {
    throw new SignInBrowserError("url_missing", "The identity page URL is missing.", 502);
  }
  if (!profileDir) {
    throw new SignInBrowserError(
      "profile_missing",
      "The identity-check browser has no profile directory.",
      500,
    );
  }
  await assertExecutable(executablePath, deps.checkExecutable ?? defaultCheckExecutable);
  await mkdir(profileDir, { recursive: true, mode: 0o700 });

  const resolvedModelDir = modelDir ?? fingerprintModelDir(env);
  const payload = JSON.stringify({
    executablePath,
    url,
    profileDir,
    identity,
    proxy,
    modelDir: resolvedModelDir,
    headless,
    timeoutMs,
  });

  const spawnHost = deps.fork ?? fork;
  let child;
  try {
    child = spawnHost(deps.hostPath ?? IDENTITY_HOST_PATH, [], {
      stdio: ["pipe", "ignore", "pipe", "ipc"],
      windowsHide: false,
      env: hostEnv(
        env,
        browserEnvironmentRoot(env),
        resolvedModelDir,
        platform,
        deps.existsSync ? { existsSync: deps.existsSync } : undefined,
      ),
    });
  } catch (error) {
    throw new SignInBrowserError(
      "launch_failed",
      `The identity-check browser host could not be started: ${String(error?.message ?? error)}`,
      502,
    );
  }
  child.stdin?.on?.("error", () => {});
  child.stdin?.end?.(`${payload}\n`);

  let ready = false;
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  readyPromise.catch(() => {});

  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  result.catch(() => {});

  child.on("message", (message) => {
    if (message?.type === "ready") {
      if (!ready) {
        ready = true;
        resolveReady();
      }
      return;
    }
    if (message?.type === "identity") {
      resolveResult({ text: typeof message.text === "string" ? message.text : "" });
      return;
    }
    if (message?.type === "error") {
      const error = new SignInBrowserError(
        typeof message.code === "string" && message.code ? message.code : "launch_failed",
        String(message.message ?? "The identity-check browser failed."),
        502,
      );
      if (ready) rejectResult(error);
      else rejectReady(error);
    }
  });
  child.once("error", (error) => {
    const wrapped = new SignInBrowserError(
      "launch_failed",
      `The identity-check browser host failed: ${String(error?.message ?? error)}`,
      502,
    );
    if (ready) rejectResult(wrapped);
    else rejectReady(wrapped);
  });
  child.once("exit", (code) => {
    if (!ready) {
      rejectReady(
        new SignInBrowserError(
          "launch_failed",
          `The identity-check browser host exited before it opened the browser (code ${code}).`,
          502,
        ),
      );
    } else {
      rejectResult(
        new SignInBrowserError(
          "launch_failed",
          `The identity-check browser host exited before returning a verdict (code ${code}).`,
          502,
        ),
      );
    }
  });

  try {
    await withLaunchTimeout(readyPromise, launchTimeoutMs);
  } catch (error) {
    // withLaunchTimeout reports a ScoreBrowserError for a shared helper; keep
    // the identity channel's error type consistent with its own launch errors.
    const wrapped =
      error?.code === "launch_timeout"
        ? new SignInBrowserError(
            "launch_timeout",
            "The identity-check browser did not open in time.",
            504,
          )
        : error;
    try {
      child.kill();
    } catch {
      // Already gone.
    }
    throw wrapped;
  }

  child.unref?.();
  child.channel?.unref?.();

  // Same exit seam as the sign-in and score handles.
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  closed.catch(() => {});
  child.once("exit", () => resolveClosed());

  let closedOnce = false;
  return {
    pid: child.pid,
    result,
    closed,
    async close() {
      if (closedOnce) return;
      closedOnce = true;
      try {
        child.send({ type: "close" });
      } catch {
        try {
          child.kill();
        } catch {
          // Already gone.
        }
        return;
      }
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try {
            child.kill();
          } catch {
            // Already gone.
          }
          resolve();
        }, 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}
