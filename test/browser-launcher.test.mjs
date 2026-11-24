// The login browser launcher. No browser is started: the option builder and
// the preflight checks are exercised directly, and the in-process launch path
// is driven through injected camoufox/playwright stubs.
import { afterEach, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BROWSER_DIR_ENV, browserEnvironmentRoot } from "../lib/browser-environment.mjs";
import { camoufoxCacheEnv } from "../lib/camoufox-loader.mjs";
import {
  DISPLAY_ENV,
  FONTCONFIG_ENV,
  SYSTEM_FONTCONFIG_PATH,
  ScoreBrowserError,
  SignInBrowserError,
  buildLaunchInput,
  hostEnv,
  launchIdentityCheckBrowser,
  launchScoreBrowser,
  launchSignInBrowser,
  openSignInBrowser,
  toPlaywrightProxy,
} from "../lib/browser-launcher.mjs";

const tempDirs = [];

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "clean-login-launcher-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// The forked host receives its launch input on stdin, not as a file path, so
// the fake child collects what `end()` writes. `payload()` is what the host
// would parse from the stream.
function fakeStdin() {
  const sink = {
    text: "",
    write(chunk) {
      sink.text += String(chunk);
      return true;
    },
    end(chunk) {
      if (chunk) sink.write(chunk);
    },
    on() {},
  };
  return sink;
}

function stdinPayload(child) {
  return JSON.parse(child.stdin.text.trim() || "{}");
}

// A fork stub that captures the spawn options and the stdin payload, then
// reports the host ready. `send` exits the child so close() resolves.
function captureFork(captured) {
  const child = new EventEmitter();
  child.pid = 1;
  child.kill = () => {};
  child.send = () => queueMicrotask(() => child.emit("exit", 0));
  child.unref = () => {};
  child.channel = { unref: () => {} };
  captured.child = child;
  return (_hostPath, _args, options) => {
    captured.env = options?.env;
    child.stdin = fakeStdin();
    queueMicrotask(() => {
      captured.payload = stdinPayload(child);
      child.emit("message", { type: "ready", pid: child.pid });
    });
    return child;
  };
}

test("the launch input pins the persistent profile and the fingerprint", () => {
  const identity = { webgl: { vendor: "X" } };
  const input = buildLaunchInput({ url: "https://x/signin", profileDir: "/profiles/a", identity });
  expect(input.url).toBe("https://x/signin");
  expect(input.launch.persistent_context).toBe(true);
  expect(input.launch.user_data_dir).toBe("/profiles/a");
  expect(input.launch.fingerprint).toBe(identity);
  expect(input.launch.canvas_noise).toBe(false);
  expect(input.launch.enable_cache).toBe(true);
  expect(input.launch.humanize).toBe(true);
  // No proxy means no proxy and no geoip lookup.
  expect("proxy" in input.launch).toBe(false);
  expect("geoip" in input.launch).toBe(false);
  // No model directory is invented when the caller did not name one.
  expect(input.modelDir).toBeNull();
});

test("the launch input carries the plugin's own fpgen model directory", () => {
  const modelDir = "/plugin/camoufox/fpgen";
  const input = buildLaunchInput({
    url: "https://x/signin",
    profileDir: "/profiles/a",
    identity: {},
    modelDir,
  });
  expect(input.modelDir).toBe(modelDir);
  // The directory is input data, not a camoufox launch option.
  expect("modelDir" in input.launch).toBe(false);
});

test("a proxy is normalized and turns geoip on", () => {
  const input = buildLaunchInput({
    url: "https://x/signin",
    profileDir: "/profiles/a",
    identity: {},
    proxy: { type: "socks5", host: "127.0.0.1", port: 1080, username: "u", password: "p" },
  });
  expect(input.launch.proxy).toEqual({
    server: "socks5://127.0.0.1:1080",
    username: "u",
    password: "p",
  });
  expect(input.launch.geoip).toBe(true);
});

test("toPlaywrightProxy accepts both a stored record and a server string", () => {
  expect(toPlaywrightProxy({ server: "http://h:1", username: "u" })).toEqual({
    server: "http://h:1",
    username: "u",
  });
  expect(toPlaywrightProxy({ type: "http", host: "h", port: 8080 })).toEqual({
    server: "http://h:8080",
  });
  expect(toPlaywrightProxy({ type: "https", host: "h", port: 443 })).toEqual({
    server: "https://h:443",
  });
  // An IPv6 literal is wrapped in brackets, like proxyUrlFor does for stored
  // exits; without them the host:port split is ambiguous.
  expect(toPlaywrightProxy({ type: "socks5", host: "2001:db8::1", port: 1080 })).toEqual({
    server: "socks5://[2001:db8::1]:1080",
  });
  expect(toPlaywrightProxy({ type: "http", host: "[::1]", port: 8080 })).toEqual({
    server: "http://[::1]:8080",
  });
  expect(toPlaywrightProxy(null)).toBeNull();
  expect(toPlaywrightProxy({ type: "http", host: "", port: 1 })).toBeNull();
});

test("the launch handle's closed promise settles when the host exits", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 9;
  child.kill = () => {};
  child.send = () => {};
  child.unref = () => {};
  child.channel = { unref: () => {} };
  const handle = await launchSignInBrowser({
    executablePath: exe,
    url: "https://x/signin",
    profileDir: join(dir, "profile"),
    deps: {
      fork: () => {
        queueMicrotask(() => child.emit("message", { type: "ready", pid: 9 }));
        return child;
      },
    },
  });
  let settled = false;
  handle.closed.then(() => {
    settled = true;
  });
  // The user closing the window is a host exit nobody asked for.
  child.emit("exit", 0);
  await handle.closed;
  expect(settled).toBe(true);
});

test("openSignInBrowser passes the pin and the profile to camoufox", async () => {
  const dir = await tempDir();
  const profileDir = join(dir, "profile");
  const identity = { tag: "pin" };
  const calls = { goto: null };
  const context = {
    pages: () => [{ goto: async (url) => { calls.goto = url; } }],
    on: () => {},
    close: async () => {},
  };
  const camoufox = {
    async launchOptions(options) {
      calls.launchOptions = options;
      return { executablePath: options.executable_path, user_data_dir: "overridden" };
    },
    async NewBrowser(_playwright, options) {
      calls.newBrowser = options;
      return context;
    },
  };
  await openSignInBrowser({
    executablePath: join(dir, "camoufox.exe"),
    url: "https://x/signin",
    profileDir,
    identity,
    deps: {
      checkExecutable: async () => true,
      loadCamoufox: async () => camoufox,
      loadPlaywright: async () => ({ firefox: {} }),
    },
  });
  expect(calls.launchOptions.fingerprint).toBe(identity);
  expect(calls.launchOptions.canvas_noise).toBe(false);
  expect(calls.launchOptions.enable_cache).toBe(true);
  expect(calls.launchOptions.humanize).toBe(true);
  expect(calls.launchOptions.executable_path).toBe(join(dir, "camoufox.exe"));
  expect(calls.newBrowser.persistent_context).toBe(true);
  expect(calls.newBrowser.from_options.user_data_dir).toBe(profileDir);
  expect(calls.goto).toBe("https://x/signin");
});

test("openSignInBrowser points fpgen at the plugin model after importing camoufox", async () => {
  const dir = await tempDir();
  const modelDir = join(dir, "camoufox", "fpgen");
  const order = [];
  const setModelDir = [];
  const camoufox = {
    async launchOptions() {
      return {};
    },
    async NewBrowser() {
      return { pages: () => [{ goto: async () => {} }], close: async () => {} };
    },
  };
  await openSignInBrowser({
    executablePath: join(dir, "camoufox.exe"),
    url: "https://x/signin",
    profileDir: join(dir, "profile"),
    identity: {},
    modelDir,
    deps: {
      checkExecutable: async () => true,
      loadCamoufox: async () => {
        order.push("camoufox");
        return camoufox;
      },
      loadFpgen: async () => {
        order.push("fpgen");
        return { setModelDir: (value) => setModelDir.push(value) };
      },
      loadPlaywright: async () => ({ firefox: {} }),
    },
  });
  // camoufox is imported first, because its own import is what overwrites the
  // configured model directory; fpgen is re-pointed only afterwards.
  expect(order).toEqual(["camoufox", "fpgen"]);
  expect(setModelDir).toEqual([modelDir]);
});

test("openSignInBrowser leaves fpgen alone when no model directory is given", async () => {
  const dir = await tempDir();
  let fpgenLoaded = false;
  const camoufox = {
    async launchOptions() {
      return {};
    },
    async NewBrowser() {
      return { pages: () => [{ goto: async () => {} }], close: async () => {} };
    },
  };
  await openSignInBrowser({
    executablePath: join(dir, "camoufox.exe"),
    url: "https://x/signin",
    profileDir: join(dir, "profile"),
    identity: {},
    deps: {
      checkExecutable: async () => true,
      loadCamoufox: async () => camoufox,
      loadFpgen: async () => {
        fpgenLoaded = true;
        return { setModelDir() {} };
      },
      loadPlaywright: async () => ({ firefox: {} }),
    },
  });
  expect(fpgenLoaded).toBe(false);
});

test("openSignInBrowser carries the proxy and geoip through", async () => {
  const dir = await tempDir();
  const calls = {};
  const camoufox = {
    async launchOptions(options) {
      calls.launchOptions = options;
      return {};
    },
    async NewBrowser() {
      return { pages: () => [{ goto: async () => {} }], close: async () => {} };
    },
  };
  await openSignInBrowser({
    executablePath: join(dir, "camoufox.exe"),
    url: "https://x/signin",
    profileDir: join(dir, "profile"),
    identity: {},
    proxy: { server: "http://p:1" },
    deps: {
      checkExecutable: async () => true,
      loadCamoufox: async () => camoufox,
      loadPlaywright: async () => ({ firefox: {} }),
    },
  });
  expect(calls.launchOptions.proxy).toEqual({ server: "http://p:1" });
  expect(calls.launchOptions.geoip).toBe(true);
});

test("launchSignInBrowser refuses a missing URL before anything else", async () => {
  await expect(launchSignInBrowser({ executablePath: "/x", url: "", profileDir: "/p" })).rejects.toMatchObject({
    code: "url_missing",
  });
});

test("launchSignInBrowser reports a missing executable honestly", async () => {
  const dir = await tempDir();
  let error;
  try {
    await launchSignInBrowser({
      executablePath: join(dir, "does-not-exist.exe"),
      url: "https://x/signin",
      profileDir: join(dir, "profile"),
      deps: { checkExecutable: async () => false, fork: () => {
        throw new Error("must not fork");
      } },
    });
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(SignInBrowserError);
  expect(error.code).toBe("executable_missing");
  expect(error.status).toBe(503);
});

test("launchSignInBrowser reports an unset executable path", async () => {
  await expect(
    launchSignInBrowser({ executablePath: null, url: "https://x/signin", profileDir: "/p" }),
  ).rejects.toMatchObject({ code: "executable_missing" });
});

test("launchSignInBrowser starts a host and returns its pid", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 4242;
  child.kill = () => {};
  child.send = () => queueMicrotask(() => child.emit("exit", 0));
  child.unref = () => {};
  child.channel = { unref: () => {} };
  const handle = await launchSignInBrowser({
    executablePath: exe,
    url: "https://x/signin",
    profileDir: join(dir, "profile"),
    deps: {
      fork: () => {
        queueMicrotask(() => child.emit("message", { type: "ready", pid: 4242 }));
        return child;
      },
    },
  });
  expect(handle.pid).toBe(4242);
  await handle.close();
});

test("launchSignInBrowser hands the payload over stdin and writes no payload file", async () => {
  // The launch input can carry a proxy password; it must never sit in a file
  // inside the profile directory where a crash would leave it behind.
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 9;
  child.kill = () => {};
  child.send = () => queueMicrotask(() => child.emit("exit", 0));
  child.unref = () => {};
  child.channel = { unref: () => {} };
  const profile = join(dir, "profile");
  const handle = await launchSignInBrowser({
    executablePath: exe,
    url: "https://x/signin",
    profileDir: profile,
    proxy: { server: "http://u:PLACEHOLDERPW@h:1" },
    env: {},
    deps: {
      fork: (_hostPath, _args, options) => {
        child.stdin = fakeStdin();
        expect(options.stdio[0]).toBe("pipe");
        queueMicrotask(() => child.emit("message", { type: "ready", pid: 9 }));
        return child;
      },
    },
  });
  expect(stdinPayload(child).proxy).toEqual({ server: "http://u:PLACEHOLDERPW@h:1" });
  const names = readdirSync(profile);
  expect(names.some((name) => name.includes("signin-launch"))).toBe(false);
  await handle.close();
});

test("launchSignInBrowser passes the plugin model directory to the host", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const modelDir = join(dir, "camoufox", "fpgen");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 7;
  child.kill = () => {};
  child.send = () => queueMicrotask(() => child.emit("exit", 0));
  child.unref = () => {};
  child.channel = { unref: () => {} };
  const captured = {};
  const handle = await launchSignInBrowser({
    executablePath: exe,
    url: "https://x/signin",
    profileDir: join(dir, "profile"),
    modelDir,
    env: {},
    deps: {
      fork: (hostPath, args, options) => {
        captured.hostPath = hostPath;
        captured.args = args;
        captured.env = options.env;
        child.stdin = fakeStdin();
        queueMicrotask(() => {
          captured.payload = stdinPayload(child);
          child.emit("message", { type: "ready", pid: 7 });
        });
        return child;
      },
    },
  });
  expect(captured.payload.modelDir).toBe(modelDir);
  // FPGEN_DATA_DIR is the real name fpgen-js reads; the shared camoufox cache
  // path is never what the host is pointed at.
  expect(captured.env.FPGEN_DATA_DIR).toBe(modelDir);
  await handle.close();
});

test("launchSignInBrowser defaults to the plugin's model directory", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const root = join(dir, "browser-root");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 8;
  child.kill = () => {};
  child.send = () => queueMicrotask(() => child.emit("exit", 0));
  child.unref = () => {};
  child.channel = { unref: () => {} };
  const captured = {};
  const handle = await launchSignInBrowser({
    executablePath: exe,
    url: "https://x/signin",
    profileDir: join(dir, "profile"),
    env: { MAGPIE_CLEAN_LOGIN_BROWSER_DIR: root },
    deps: {
      fork: (_hostPath, args, options) => {
        captured.env = options.env;
        child.stdin = fakeStdin();
        queueMicrotask(() => {
          captured.payload = stdinPayload(child);
          child.emit("message", { type: "ready", pid: 8 });
        });
        return child;
      },
    },
  });
  expect(captured.payload.modelDir).toBe(join(root, "fpgen"));
  expect(captured.env.FPGEN_DATA_DIR).toBe(join(root, "fpgen"));
  await handle.close();
});

test("launchSignInBrowser sandboxes the forked host's cache dir (F-6)", async () => {
  // The import-time redirect only covers this process: without the override
  // the spawned host resolves the real user cache and runtime writes
  // (camoufox's cache, fontconfig) land outside the plugin directory.
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const root = join(dir, "browser-root");
  const captured = {};
  const handle = await launchSignInBrowser({
    executablePath: exe,
    url: "https://x/signin",
    profileDir: join(dir, "profile"),
    env: {
      MAGPIE_CLEAN_LOGIN_BROWSER_DIR: root,
      XDG_CACHE_HOME: join(dir, "real-xdg"),
      LOCALAPPDATA: join(dir, "real-local"),
    },
    deps: { fork: captureFork(captured) },
  });
  const cacheKey = process.platform === "win32" ? "LOCALAPPDATA" : "XDG_CACHE_HOME";
  // darwin exports no cache env at all (the install symlink covers it).
  if (process.platform !== "darwin") expect(captured.env[cacheKey]).toBe(root);
  // The redirect would move browserEnvironmentRoot() inside the host, so the
  // root is pinned explicitly.
  expect(captured.env[BROWSER_DIR_ENV]).toBe(root);
  expect(captured.env.FPGEN_DATA_DIR).toBe(join(root, "fpgen"));
  await handle.close();
});

// ---------- the scoring launcher ----------

test("openSignInBrowser also hands back the page it opened", async () => {
  const dir = await tempDir();
  const page = { goto: async () => {} };
  const context = { pages: () => [page], on: () => {}, close: async () => {} };
  const camoufox = {
    async launchOptions() {
      return {};
    },
    async NewBrowser() {
      return context;
    },
  };
  const handle = await openSignInBrowser({
    executablePath: join(dir, "camoufox.exe"),
    url: "https://ip.net.coffee/claude/",
    profileDir: join(dir, "profile"),
    identity: {},
    deps: {
      checkExecutable: async () => true,
      loadCamoufox: async () => camoufox,
      loadPlaywright: async () => ({ firefox: {} }),
    },
  });
  expect(handle.page).toBe(page);
});

test("launchScoreBrowser reports the score the host sends", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 11;
  child.kill = () => {};
  child.send = () => queueMicrotask(() => child.emit("exit", 0));
  child.unref = () => {};
  child.channel = { unref: () => {} };
  const handle = await launchScoreBrowser({
    executablePath: exe,
    url: "https://ip.net.coffee/claude/",
    profileDir: join(dir, "profile"),
    identity: { tag: "pin" },
    proxy: { type: "http", host: "h", port: 8080 },
    deps: {
      fork: () => {
        queueMicrotask(() => {
          child.emit("message", { type: "ready", pid: 11 });
          child.emit("message", { type: "score", score: 92, label: "优异", ip: "203.0.113.7" });
        });
        return child;
      },
    },
  });
  expect(handle.pid).toBe(11);
  expect(await handle.result).toEqual({ score: 92, label: "优异", ip: "203.0.113.7" });
  await handle.close();
});

test("launchScoreBrowser turns a host error into its own code", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 12;
  child.kill = () => {};
  child.send = () => {};
  child.unref = () => {};
  child.channel = { unref: () => {} };
  const handle = await launchScoreBrowser({
    executablePath: exe,
    url: "https://ip.net.coffee/claude/",
    profileDir: join(dir, "profile"),
    identity: {},
    deps: {
      fork: () => {
        queueMicrotask(() => {
          child.emit("message", { type: "ready", pid: 12 });
          child.emit("message", { type: "error", code: "page_timeout", message: "no score" });
        });
        return child;
      },
    },
  });
  await expect(handle.result).rejects.toBeInstanceOf(ScoreBrowserError);
  await expect(handle.result).rejects.toMatchObject({ code: "page_timeout" });
});

test("launchScoreBrowser turns an error before the window opens into a launch failure", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 14;
  child.kill = () => {};
  child.send = () => {};
  child.unref = () => {};
  child.channel = { unref: () => {} };
  await expect(
    launchScoreBrowser({
      executablePath: exe,
      url: "https://ip.net.coffee/claude/",
      profileDir: join(dir, "profile"),
      identity: {},
      deps: {
        fork: () => {
          queueMicrotask(() =>
            child.emit("message", { type: "error", code: "launch_failed", message: "no browser" }),
          );
          return child;
        },
      },
    }),
  ).rejects.toMatchObject({ code: "launch_failed" });
});

test("launchScoreBrowser refuses a missing executable before forking", async () => {
  const dir = await tempDir();
  await expect(
    launchScoreBrowser({
      executablePath: join(dir, "does-not-exist.exe"),
      url: "https://ip.net.coffee/claude/",
      profileDir: join(dir, "profile"),
      deps: {
        checkExecutable: async () => false,
        fork: () => {
          throw new Error("must not fork");
        },
      },
    }),
  ).rejects.toMatchObject({ code: "executable_missing" });
});

test("launchScoreBrowser sandboxes the forked host's cache dir (F-6)", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const root = join(dir, "browser-root");
  const captured = {};
  const handle = await launchScoreBrowser({
    executablePath: exe,
    url: "https://ip.net.coffee/claude/",
    profileDir: join(dir, "profile"),
    env: {
      MAGPIE_CLEAN_LOGIN_BROWSER_DIR: root,
      XDG_CACHE_HOME: join(dir, "real-xdg"),
      LOCALAPPDATA: join(dir, "real-local"),
    },
    deps: { fork: captureFork(captured) },
  });
  const cacheKey = process.platform === "win32" ? "LOCALAPPDATA" : "XDG_CACHE_HOME";
  if (process.platform !== "darwin") expect(captured.env[cacheKey]).toBe(root);
  expect(captured.env[BROWSER_DIR_ENV]).toBe(root);
  await handle.close();
});

test("launchScoreBrowser defaults to headless on linux without a display (F-8)", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");

  const noDisplay = {};
  await launchScoreBrowser({
    executablePath: exe,
    url: "https://ip.net.coffee/claude/",
    profileDir: join(dir, "p1"),
    env: {},
    platform: "linux",
    deps: { fork: captureFork(noDisplay) },
  });
  expect(noDisplay.payload.headless).toBe(true);

  // A usable display (X11 or Wayland) keeps the windowed default.
  const withDisplay = {};
  await launchScoreBrowser({
    executablePath: exe,
    url: "https://ip.net.coffee/claude/",
    profileDir: join(dir, "p2"),
    env: { DISPLAY: ":0" },
    platform: "linux",
    deps: { fork: captureFork(withDisplay) },
  });
  expect(withDisplay.payload.headless).toBe(false);

  const wayland = {};
  await launchScoreBrowser({
    executablePath: exe,
    url: "https://ip.net.coffee/claude/",
    profileDir: join(dir, "p3"),
    env: { WAYLAND_DISPLAY: "wayland-0" },
    platform: "linux",
    deps: { fork: captureFork(wayland) },
  });
  expect(wayland.payload.headless).toBe(false);

  // Other platforms keep the windowed default whatever DISPLAY says.
  const windows = {};
  await launchScoreBrowser({
    executablePath: exe,
    url: "https://ip.net.coffee/claude/",
    profileDir: join(dir, "p4"),
    env: {},
    platform: "win32",
    deps: { fork: captureFork(windows) },
  });
  expect(windows.payload.headless).toBe(false);

  // An explicit request always wins over the display heuristic.
  const forced = {};
  await launchScoreBrowser({
    executablePath: exe,
    url: "https://ip.net.coffee/claude/",
    profileDir: join(dir, "p5"),
    env: { DISPLAY: ":0" },
    platform: "linux",
    headless: true,
    deps: { fork: captureFork(forced) },
  });
  expect(forced.payload.headless).toBe(true);
});

test("launchScoreBrowser times out when the host never opens the browser", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 13;
  child.kill = () => {};
  child.send = () => {};
  child.unref = () => {};
  child.channel = { unref: () => {} };
  await expect(
    launchScoreBrowser({
      executablePath: exe,
      url: "https://ip.net.coffee/claude/",
      profileDir: join(dir, "profile"),
      identity: {},
      launchTimeoutMs: 30,
      deps: { fork: () => child },
    }),
  ).rejects.toMatchObject({ code: "launch_timeout" });
});


// ---------- first-navigation failures ----------

test("openSignInBrowser navigates with an explicit readiness condition and deadline", async () => {
  const dir = await tempDir();
  const calls = { goto: null };
  const page = { goto: async (url, options) => { calls.goto = { url, options }; } };
  const context = { pages: () => [page], on: () => {}, close: async () => {} };
  const camoufox = {
    async launchOptions() {
      return {};
    },
    async NewBrowser() {
      return context;
    },
  };
  const handle = await openSignInBrowser({
    executablePath: join(dir, "camoufox.exe"),
    url: "https://account.minimax.cn/oauth-authorize?user_code=F7Y3-9384",
    profileDir: join(dir, "profile"),
    identity: {},
    deps: {
      checkExecutable: async () => true,
      loadCamoufox: async () => camoufox,
      loadPlaywright: async () => ({ firefox: {} }),
    },
  });
  expect(calls.goto.url).toBe("https://account.minimax.cn/oauth-authorize?user_code=F7Y3-9384");
  expect(calls.goto.options).toEqual({ waitUntil: "domcontentloaded", timeout: 60_000 });
  expect(handle.navigationError).toBe(null);
});

test("openSignInBrowser honors a custom navigation deadline", async () => {
  const dir = await tempDir();
  const calls = { goto: null };
  const page = { goto: async (url, options) => { calls.goto = { url, options }; } };
  const context = { pages: () => [page], close: async () => {} };
  const camoufox = {
    async launchOptions() {
      return {};
    },
    async NewBrowser() {
      return context;
    },
  };
  await openSignInBrowser({
    executablePath: join(dir, "camoufox.exe"),
    url: "https://x/signin",
    profileDir: join(dir, "profile"),
    identity: {},
    navTimeoutMs: 12_000,
    deps: {
      checkExecutable: async () => true,
      loadCamoufox: async () => camoufox,
      loadPlaywright: async () => ({ firefox: {} }),
    },
  });
  expect(calls.goto.options).toEqual({ waitUntil: "domcontentloaded", timeout: 12_000 });
});

test("openSignInBrowser keeps the window open when the first navigation times out", async () => {
  const dir = await tempDir();
  const page = {
    goto: async () => {
      throw new Error("Timeout 30000ms exceeded");
    },
  };
  let closed = 0;
  const context = { pages: () => [page], on: () => {}, close: async () => { closed += 1; } };
  const camoufox = {
    async launchOptions() {
      return {};
    },
    async NewBrowser() {
      return context;
    },
  };
  const handle = await openSignInBrowser({
    executablePath: join(dir, "camoufox.exe"),
    url: "https://account.minimax.cn/oauth-authorize?user_code=F7Y3-9384",
    profileDir: join(dir, "profile"),
    identity: {},
    deps: {
      checkExecutable: async () => true,
      loadCamoufox: async () => camoufox,
      loadPlaywright: async () => ({ firefox: {} }),
    },
  });
  // The window is still there for the user to complete the OAuth by hand.
  expect(closed).toBe(0);
  expect(handle.page).toBe(page);
  expect(handle.context).toBe(context);
  expect(handle.navigationError).toBeInstanceOf(SignInBrowserError);
  expect(handle.navigationError.code).toBe("navigation_failed");
  expect(handle.navigationError.status).toBe(504);
  expect(handle.navigationError.message).toContain("did not finish loading within 60 seconds");
  expect(handle.navigationError.message).not.toContain("could not be opened");
  expect(handle.navigationError.detail).toBe("Timeout 30000ms exceeded");
  expect(handle.navigationError.waitUntil).toBe("domcontentloaded");
  await handle.close();
  expect(closed).toBe(1);
});

test("openSignInBrowser still reports a real launch failure", async () => {
  const dir = await tempDir();
  let error;
  const camoufox = {
    async launchOptions() {
      return {};
    },
    async NewBrowser() {
      throw new Error("the browser could not start");
    },
  };
  try {
    await openSignInBrowser({
      executablePath: join(dir, "camoufox.exe"),
      url: "https://x/signin",
      profileDir: join(dir, "profile"),
      identity: {},
      deps: {
        checkExecutable: async () => true,
        loadCamoufox: async () => camoufox,
        loadPlaywright: async () => ({ firefox: {} }),
      },
    });
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(SignInBrowserError);
  expect(error.code).toBe("launch_failed");
  expect(error.status).toBe(502);
});

test("openSignInBrowser closes the context when the page cannot be created", async () => {
  const dir = await tempDir();
  let closed = 0;
  const context = {
    pages: () => {
      throw new Error("no page");
    },
    on: () => {},
    close: async () => { closed += 1; },
  };
  const camoufox = {
    async launchOptions() {
      return {};
    },
    async NewBrowser() {
      return context;
    },
  };
  let error;
  try {
    await openSignInBrowser({
      executablePath: join(dir, "camoufox.exe"),
      url: "https://x/signin",
      profileDir: join(dir, "profile"),
      identity: {},
      deps: {
        checkExecutable: async () => true,
        loadCamoufox: async () => camoufox,
        loadPlaywright: async () => ({ firefox: {} }),
      },
    });
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(SignInBrowserError);
  expect(error.code).toBe("launch_failed");
  expect(closed).toBe(1);
});

test("launchSignInBrowser passes a custom navigation deadline to the host", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 31;
  child.kill = () => {};
  child.send = () => queueMicrotask(() => child.emit("exit", 0));
  child.unref = () => {};
  child.channel = { unref: () => {} };
  const captured = {};
  const handle = await launchSignInBrowser({
    executablePath: exe,
    url: "https://x/signin",
    profileDir: join(dir, "profile"),
    identity: {},
    navTimeoutMs: 12_000,
    deps: {
      fork: (_hostPath, args) => {
        child.stdin = fakeStdin();
        queueMicrotask(() => {
          captured.payload = stdinPayload(child);
          child.emit("message", { type: "ready", pid: 31 });
        });
        return child;
      },
    },
  });
  expect(captured.payload.navTimeoutMs).toBe(12_000);
  await handle.close();
});

test("launchSignInBrowser surfaces a navigation warning from the host", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 32;
  child.kill = () => {};
  child.send = () => queueMicrotask(() => child.emit("exit", 0));
  child.unref = () => {};
  child.channel = { unref: () => {} };
  const handle = await launchSignInBrowser({
    executablePath: exe,
    url: "https://x/signin",
    profileDir: join(dir, "profile"),
    identity: {},
    deps: {
      fork: () => {
        queueMicrotask(() =>
          child.emit("message", {
            type: "ready",
            pid: 32,
            warning: { code: "navigation_failed", status: 504, message: "page did not load" },
          }),
        );
        return child;
      },
    },
  });
  expect(handle.warning).toEqual({ code: "navigation_failed", status: 504, message: "page did not load" });
  await handle.close();
});

test("launchSignInBrowser keeps the host status on an error", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 33;
  child.kill = () => {};
  child.send = () => {};
  child.unref = () => {};
  child.channel = { unref: () => {} };
  let error;
  try {
    await launchSignInBrowser({
      executablePath: exe,
      url: "https://x/signin",
      profileDir: join(dir, "profile"),
      identity: {},
      deps: {
        fork: () => {
          queueMicrotask(() =>
            child.emit("message", { type: "error", code: "runtime_missing", status: 503, message: "no runtime" }),
          );
          return child;
        },
      },
    });
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(SignInBrowserError);
  expect(error.code).toBe("runtime_missing");
  expect(error.status).toBe(503);
});

test("launchScoreBrowser passes a custom navigation deadline to the host", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 34;
  child.kill = () => {};
  child.send = () => queueMicrotask(() => child.emit("exit", 0));
  child.unref = () => {};
  child.channel = { unref: () => {} };
  const captured = {};
  const handle = await launchScoreBrowser({
    executablePath: exe,
    url: "https://ip.net.coffee/claude/",
    profileDir: join(dir, "profile"),
    identity: {},
    timeoutMs: 90_000,
    navTimeoutMs: 7_500,
    deps: {
      fork: (_hostPath, args) => {
        child.stdin = fakeStdin();
        queueMicrotask(() => {
          captured.payload = stdinPayload(child);
          child.emit("message", { type: "ready", pid: 34 });
        });
        return child;
      },
    },
  });
  expect(captured.payload.navTimeoutMs).toBe(7_500);
  // The page poll keeps its own, separate deadline.
  expect(captured.payload.timeoutMs).toBe(90_000);
  await handle.close();
});

// The identity check runs headless in its own `check-profile/` directory. The
// headless flag must reach all three launch sites, and the new host must be
// forked with that flag and the page deadline in its payload.
test("buildLaunchInput defaults to headless false and threads a true value", () => {
  const args = { url: "https://who.1ms.dog/zh-cn/", profileDir: "/profiles/a", identity: {} };
  expect(buildLaunchInput(args).launch.headless).toBe(false);
  expect(buildLaunchInput({ ...args, headless: true }).launch.headless).toBe(true);
  expect(buildLaunchInput({ ...args, headless: false }).launch.headless).toBe(false);
});

test("openSignInBrowser passes headless to both camoufox calls", async () => {
  const dir = await tempDir();
  const calls = {};
  const camoufox = {
    async launchOptions(options) {
      calls.launchOptions = options;
      return { executablePath: options.executable_path };
    },
    async NewBrowser(_playwright, options) {
      calls.newBrowser = options;
      return { pages: () => [{ goto: async () => {} }], on: () => {}, close: async () => {} };
    },
  };
  await openSignInBrowser({
    executablePath: join(dir, "camoufox.exe"),
    url: "https://who.1ms.dog/zh-cn/",
    profileDir: join(dir, "check-profile"),
    identity: { tag: "pin" },
    headless: true,
    deps: {
      checkExecutable: async () => true,
      loadCamoufox: async () => camoufox,
      loadPlaywright: async () => ({ firefox: {} }),
    },
  });
  expect(calls.launchOptions.headless).toBe(true);
  expect(calls.newBrowser.headless).toBe(true);
});

test("openSignInBrowser is headless false by default", async () => {
  const dir = await tempDir();
  const calls = {};
  const camoufox = {
    async launchOptions(options) {
      calls.launchOptions = options;
      return {};
    },
    async NewBrowser(_playwright, options) {
      calls.newBrowser = options;
      return { pages: () => [{ goto: async () => {} }], on: () => {}, close: async () => {} };
    },
  };
  await openSignInBrowser({
    executablePath: join(dir, "camoufox.exe"),
    url: "https://x/signin",
    profileDir: join(dir, "profile"),
    identity: {},
    deps: {
      checkExecutable: async () => true,
      loadCamoufox: async () => camoufox,
      loadPlaywright: async () => ({ firefox: {} }),
    },
  });
  expect(calls.launchOptions.headless).toBe(false);
  expect(calls.newBrowser.headless).toBe(false);
});

test("launchIdentityCheckBrowser reports the verdict text the host sends", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 21;
  child.kill = () => {};
  child.send = () => queueMicrotask(() => child.emit("exit", 0));
  child.unref = () => {};
  child.channel = { unref: () => {} };
  const captured = {};
  const handle = await launchIdentityCheckBrowser({
    executablePath: exe,
    url: "https://who.1ms.dog/zh-cn/",
    profileDir: join(dir, "check-profile"),
    identity: { tag: "pin" },
    headless: true,
    timeoutMs: 42_000,
    deps: {
      hostPath: "/fake/identity-check-browser-host.mjs",
      fork: (hostPath, args) => {
        captured.hostPath = hostPath;
        child.stdin = fakeStdin();
        queueMicrotask(() => {
          captured.payload = stdinPayload(child);
          child.emit("message", { type: "ready", pid: 21 });
          child.emit("message", { type: "identity", text: "评分 B" });
        });
        return child;
      },
    },
  });
  expect(handle.pid).toBe(21);
  expect(captured.hostPath).toBe("/fake/identity-check-browser-host.mjs");
  expect(captured.payload.headless).toBe(true);
  expect(captured.payload.timeoutMs).toBe(42_000);
  expect(captured.payload.profileDir).toBe(join(dir, "check-profile"));
  expect(await handle.result).toEqual({ text: "评分 B" });
  await handle.close();
});

test("launchIdentityCheckBrowser defaults to headless true", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 22;
  child.kill = () => {};
  child.send = () => queueMicrotask(() => child.emit("exit", 0));
  child.unref = () => {};
  child.channel = { unref: () => {} };
  const captured = {};
  const handle = await launchIdentityCheckBrowser({
    executablePath: exe,
    url: "https://who.1ms.dog/zh-cn/",
    profileDir: join(dir, "check-profile"),
    identity: {},
    deps: {
      fork: (_hostPath, args) => {
        child.stdin = fakeStdin();
        queueMicrotask(() => {
          captured.payload = stdinPayload(child);
          child.emit("message", { type: "ready", pid: 22 });
          child.emit("message", { type: "identity", text: "评分 A" });
        });
        return child;
      },
    },
  });
  expect(captured.payload.headless).toBe(true);
  expect(await handle.result).toEqual({ text: "评分 A" });
  await handle.close();
});

test("launchIdentityCheckBrowser maps a host error to a launcher error", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 23;
  child.kill = () => {};
  child.send = () => queueMicrotask(() => child.emit("exit", 0));
  child.unref = () => {};
  child.channel = { unref: () => {} };
  const handle = await launchIdentityCheckBrowser({
    executablePath: exe,
    url: "https://who.1ms.dog/zh-cn/",
    profileDir: join(dir, "check-profile"),
    identity: {},
    deps: {
      fork: () => {
        queueMicrotask(() => {
          child.emit("message", { type: "ready", pid: 23 });
          child.emit("message", { type: "error", code: "page_timeout", message: "no verdict" });
        });
        return child;
      },
    },
  });
  await expect(handle.result).rejects.toBeInstanceOf(SignInBrowserError);
  await expect(handle.result).rejects.toMatchObject({ code: "page_timeout" });
  await handle.close();
});

test("launchIdentityCheckBrowser refuses a missing executable before forking", async () => {
  const dir = await tempDir();
  await expect(
    launchIdentityCheckBrowser({
      executablePath: join(dir, "missing.exe"),
      url: "https://who.1ms.dog/zh-cn/",
      profileDir: join(dir, "check-profile"),
      identity: {},
      deps: {
        fork: () => {
          throw new Error("must not fork");
        },
      },
    }),
  ).rejects.toMatchObject({ code: "executable_missing" });
});

test("launchIdentityCheckBrowser refuses a missing URL", async () => {
  await expect(
    launchIdentityCheckBrowser({ url: "", profileDir: "/p", identity: {} }),
  ).rejects.toMatchObject({ code: "url_missing" });
});

test("launchIdentityCheckBrowser times out when the host never opens", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 24;
  child.kill = () => {};
  child.send = () => queueMicrotask(() => child.emit("exit", 0));
  child.unref = () => {};
  child.channel = { unref: () => {} };
  await expect(
    launchIdentityCheckBrowser({
      executablePath: exe,
      url: "https://who.1ms.dog/zh-cn/",
      profileDir: join(dir, "check-profile"),
      identity: {},
      launchTimeoutMs: 30,
      deps: { fork: () => child },
    }),
  ).rejects.toMatchObject({ code: "launch_timeout" });
});

test("launchScoreBrowser keeps the host status on an error", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 35;
  child.kill = () => {};
  child.send = () => {};
  child.unref = () => {};
  child.channel = { unref: () => {} };
  let error;
  try {
    await launchScoreBrowser({
      executablePath: exe,
      url: "https://ip.net.coffee/claude/",
      profileDir: join(dir, "profile"),
      identity: {},
      deps: {
        fork: () => {
          queueMicrotask(() =>
            child.emit("message", { type: "error", code: "executable_missing", status: 503, message: "no exe" }),
          );
          return child;
        },
      },
    });
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ScoreBrowserError);
  expect(error.code).toBe("executable_missing");
  expect(error.status).toBe(503);
});

test("launchScoreBrowser surfaces a navigation warning from the host", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 36;
  child.kill = () => {};
  child.send = () => queueMicrotask(() => child.emit("exit", 0));
  child.unref = () => {};
  child.channel = { unref: () => {} };
  const handle = await launchScoreBrowser({
    executablePath: exe,
    url: "https://ip.net.coffee/claude/",
    profileDir: join(dir, "profile"),
    identity: {},
    deps: {
      fork: () => {
        queueMicrotask(() => {
          child.emit("message", {
            type: "ready",
            pid: 36,
            warning: { code: "navigation_failed", status: 504, message: "page did not load" },
          });
          child.emit("message", { type: "score", score: 92, label: "优异", ip: "203.0.113.7" });
        });
        return child;
      },
    },
  });
  expect(handle.warning).toEqual({ code: "navigation_failed", status: 504, message: "page did not load" });
  expect(await handle.result).toEqual({ score: 92, label: "优异", ip: "203.0.113.7" });
  await handle.close();
});

// ---------- Linux DISPLAY & FONTCONFIG opt-ins (#5, #6) ----------

test("hostEnv keeps DISPLAY and FONTCONFIG_FILE unset by default on linux", () => {
  expect(DISPLAY_ENV).toBe("MAGPIE_CLEAN_LOGIN_DISPLAY");
  expect(FONTCONFIG_ENV).toBe("MAGPIE_CLEAN_LOGIN_FONTCONFIG");
  expect(SYSTEM_FONTCONFIG_PATH).toBe("/etc/fonts/fonts.conf");

  const result = hostEnv({}, "/sandbox", "/sandbox/fpgen", "linux", { existsSync: () => true });
  expect(result.DISPLAY).toBeUndefined();
  expect(result.FONTCONFIG_FILE).toBeUndefined();
  expect(result.XDG_CACHE_HOME).toBe("/sandbox");
  expect(result[BROWSER_DIR_ENV]).toBe("/sandbox");
  expect(result.FPGEN_DATA_DIR).toBe("/sandbox/fpgen");
});

test("hostEnv applies explicit DISPLAY opt-in only on linux without an active display", () => {
  expect(
    hostEnv({ [DISPLAY_ENV]: "  :99  " }, "/sandbox", "/m", "linux", { existsSync: () => false }).DISPLAY,
  ).toBe(":99");

  expect(
    hostEnv({ [DISPLAY_ENV]: "   " }, "/sandbox", "/m", "linux", { existsSync: () => false }).DISPLAY,
  ).toBeUndefined();

  // Existing DISPLAY or WAYLAND_DISPLAY is never overridden.
  expect(
    hostEnv({ DISPLAY: ":0", [DISPLAY_ENV]: ":99" }, "/sandbox", "/m", "linux").DISPLAY,
  ).toBe(":0");

  const wayland = hostEnv(
    { WAYLAND_DISPLAY: "wayland-0", [DISPLAY_ENV]: ":99" },
    "/sandbox",
    "/m",
    "linux",
  );
  expect(wayland.WAYLAND_DISPLAY).toBe("wayland-0");
  expect(wayland.DISPLAY).toBeUndefined();

  // Non-linux platforms never synthesize DISPLAY from MAGPIE_CLEAN_LOGIN_DISPLAY.
  for (const platform of ["win32", "darwin"]) {
    expect(hostEnv({ [DISPLAY_ENV]: ":99" }, "/sandbox", "/m", platform).DISPLAY).toBeUndefined();
  }
});

test("hostEnv applies explicit FONTCONFIG_FILE opt-in on linux when the target exists", async () => {
  const dir = await tempDir();
  const realCustom = join(dir, "fonts.conf");
  await writeFile(realCustom, "<fontconfig/>");

  // "system" resolves to SYSTEM_FONTCONFIG_PATH when present, and stays unset when missing.
  for (const flag of ["system", " SYSTEM "]) {
    expect(
      hostEnv({ [FONTCONFIG_ENV]: flag }, "/sandbox", "/m", "linux", {
        existsSync: (p) => p === SYSTEM_FONTCONFIG_PATH,
      }).FONTCONFIG_FILE,
    ).toBe(SYSTEM_FONTCONFIG_PATH);
  }
  expect(
    hostEnv({ [FONTCONFIG_ENV]: "system" }, "/sandbox", "/m", "linux", { existsSync: () => false })
      .FONTCONFIG_FILE,
  ).toBeUndefined();

  // Custom paths are trimmed, checked on disk, and ignored when absent or "off".
  expect(
    hostEnv({ [FONTCONFIG_ENV]: ` ${realCustom} ` }, "/sandbox", "/m", "linux").FONTCONFIG_FILE,
  ).toBe(realCustom);
  expect(
    hostEnv({ [FONTCONFIG_ENV]: join(dir, "missing.conf") }, "/sandbox", "/m", "linux").FONTCONFIG_FILE,
  ).toBeUndefined();

  for (const off of ["off", " OFF ", ""]) {
    expect(
      hostEnv({ [FONTCONFIG_ENV]: off }, "/sandbox", "/m", "linux", { existsSync: () => true })
        .FONTCONFIG_FILE,
    ).toBeUndefined();
  }

  // An existing FONTCONFIG_FILE is always preserved.
  expect(
    hostEnv(
      { FONTCONFIG_FILE: "/already/fonts.conf", [FONTCONFIG_ENV]: "system" },
      "/sandbox",
      "/m",
      "linux",
      { existsSync: () => true },
    ).FONTCONFIG_FILE,
  ).toBe("/already/fonts.conf");

  // Non-linux platforms never set FONTCONFIG_FILE.
  for (const platform of ["win32", "darwin"]) {
    expect(
      hostEnv({ [FONTCONFIG_ENV]: "system" }, "/sandbox", "/m", platform, { existsSync: () => true })
        .FONTCONFIG_FILE,
    ).toBeUndefined();
  }
});

test("launchScoreBrowser keeps F-8 headless=true when MAGPIE_CLEAN_LOGIN_DISPLAY is set without DISPLAY", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const captured = {};
  const handle = await launchScoreBrowser({
    executablePath: exe,
    url: "https://ip.net.coffee/claude/",
    profileDir: join(dir, "profile"),
    env: {
      [DISPLAY_ENV]: ":99",
      [FONTCONFIG_ENV]: "system",
    },
    platform: "linux",
    deps: {
      existsSync: (p) => p === SYSTEM_FONTCONFIG_PATH,
      fork: captureFork(captured),
    },
  });
  expect(captured.payload.headless).toBe(true);
  expect(captured.env.DISPLAY).toBe(":99");
  expect(captured.env.FONTCONFIG_FILE).toBe(SYSTEM_FONTCONFIG_PATH);
  await handle.close();
});

test("launchSignInBrowser and launchIdentityCheckBrowser forward platform and existsSync to hostEnv", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");

  const signInCaptured = {};
  const signInHandle = await launchSignInBrowser({
    executablePath: exe,
    url: "https://x/signin",
    profileDir: join(dir, "signin-profile"),
    env: {
      [DISPLAY_ENV]: ":99",
      [FONTCONFIG_ENV]: "system",
    },
    platform: "linux",
    deps: {
      existsSync: (p) => p === SYSTEM_FONTCONFIG_PATH,
      fork: captureFork(signInCaptured),
    },
  });
  expect(signInCaptured.env.DISPLAY).toBe(":99");
  expect(signInCaptured.env.FONTCONFIG_FILE).toBe(SYSTEM_FONTCONFIG_PATH);
  await signInHandle.close();

  const identityCaptured = {};
  const identityHandle = await launchIdentityCheckBrowser({
    executablePath: exe,
    url: "https://who.1ms.dog/zh-cn/",
    profileDir: join(dir, "check-profile"),
    identity: {},
    env: {
      [DISPLAY_ENV]: ":98",
      [FONTCONFIG_ENV]: "/etc/fonts/custom.conf",
    },
    platform: "linux",
    deps: {
      existsSync: (p) => p === "/etc/fonts/custom.conf",
      fork: captureFork(identityCaptured),
    },
  });
  expect(identityCaptured.env.DISPLAY).toBe(":98");
  expect(identityCaptured.env.FONTCONFIG_FILE).toBe("/etc/fonts/custom.conf");
  await identityHandle.close();

  const winCaptured = {};
  const winHandle = await launchSignInBrowser({
    executablePath: exe,
    url: "https://x/signin",
    profileDir: join(dir, "win-profile"),
    env: {
      [DISPLAY_ENV]: ":99",
      [FONTCONFIG_ENV]: "system",
    },
    platform: "win32",
    deps: {
      existsSync: () => true,
      fork: captureFork(winCaptured),
    },
  });
  expect(winCaptured.env.DISPLAY).toBeUndefined();
  expect(winCaptured.env.FONTCONFIG_FILE).toBeUndefined();
  await winHandle.close();
});

// ---------- account browser purpose ("account") ----------

test("openSignInBrowser with purpose='account' allows empty or about:blank URL and skips page.goto", async () => {
  const dir = await tempDir();
  const profileDir = join(dir, "profile");
  const identity = { tag: "account-pin" };

  for (const rawUrl of [undefined, "", "   ", "about:blank", "  ABOUT:BLANK  "]) {
    const calls = { gotoCalled: false };
    const context = {
      pages: () => [
        {
          goto: async () => {
            calls.gotoCalled = true;
          },
        },
      ],
      on: () => {},
      close: async () => {},
    };
    const camoufox = {
      async launchOptions(options) {
        calls.launchOptions = options;
        return { executablePath: options.executable_path };
      },
      async NewBrowser(_playwright, options) {
        calls.newBrowser = options;
        return context;
      },
    };
    const handle = await openSignInBrowser({
      executablePath: join(dir, "camoufox.exe"),
      url: rawUrl,
      profileDir,
      identity,
      proxy: { type: "socks5", host: "127.0.0.1", port: 1080, username: "u", password: "p" },
      purpose: "account",
      deps: {
        checkExecutable: async () => true,
        loadCamoufox: async () => camoufox,
        loadPlaywright: async () => ({ firefox: {} }),
      },
    });
    expect(calls.gotoCalled).toBe(false);
    expect(handle.navigationError).toBeNull();
    expect(calls.launchOptions.fingerprint).toBe(identity);
    expect(calls.launchOptions.canvas_noise).toBe(false);
    expect(calls.launchOptions.enable_cache).toBe(true);
    expect(calls.launchOptions.humanize).toBe(true);
    expect(calls.launchOptions.proxy).toEqual({
      server: "socks5://127.0.0.1:1080",
      username: "u",
      password: "p",
    });
    expect(calls.launchOptions.geoip).toBe(true);
    expect(calls.newBrowser.persistent_context).toBe(true);
    expect(calls.newBrowser.from_options.user_data_dir).toBe(profileDir);
  }
});

test("openSignInBrowser with purpose='account' navigates http/https URLs and uses neutral wording on errors", async () => {
  const dir = await tempDir();
  const profileDir = join(dir, "profile");
  const calls = { goto: null };
  const page = {
    goto: async (url, options) => {
      calls.goto = { url, options };
      throw new Error("Timeout exceeded");
    },
  };
  const camoufox = {
    async launchOptions() {
      return {};
    },
    async NewBrowser() {
      return { pages: () => [page], on: () => {}, close: async () => {} };
    },
  };
  const handle = await openSignInBrowser({
    executablePath: join(dir, "camoufox.exe"),
    url: "https://example.com/dashboard",
    profileDir,
    identity: { tag: "pin" },
    navTimeoutMs: 15_000,
    purpose: "account",
    deps: {
      checkExecutable: async () => true,
      loadCamoufox: async () => camoufox,
      loadPlaywright: async () => ({ firefox: {} }),
    },
  });
  expect(calls.goto).toEqual({
    url: "https://example.com/dashboard",
    options: { waitUntil: "domcontentloaded", timeout: 15_000 },
  });
  expect(handle.navigationError).toBeInstanceOf(SignInBrowserError);
  expect(handle.navigationError.code).toBe("navigation_failed");
  expect(handle.navigationError.status).toBe(504);
  expect(handle.navigationError.message).toContain("account browser");
  expect(handle.navigationError.message.toLowerCase()).not.toContain("sign-in");
  expect(handle.navigationError.message.toLowerCase()).not.toContain("login browser");

  // Launch failure also uses neutral account-browser wording.
  let launchErr;
  try {
    await openSignInBrowser({
      executablePath: join(dir, "camoufox.exe"),
      url: "about:blank",
      profileDir,
      identity: {},
      purpose: "account",
      deps: {
        checkExecutable: async () => true,
        loadCamoufox: async () => ({
          async launchOptions() {
            return {};
          },
          async NewBrowser() {
            throw new Error("boom");
          },
        }),
        loadPlaywright: async () => ({ firefox: {} }),
      },
    });
  } catch (caught) {
    launchErr = caught;
  }
  expect(launchErr).toBeInstanceOf(SignInBrowserError);
  expect(launchErr.code).toBe("launch_failed");
  expect(launchErr.message).toContain("account browser");
  expect(launchErr.message.toLowerCase()).not.toContain("sign-in");
  expect(launchErr.message.toLowerCase()).not.toContain("login browser");
});

test("openSignInBrowser and launchSignInBrowser with purpose='account' reject invalid URL schemes and embedded credentials", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");

  for (const bad of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,hi",
    "https://user:pass@example.com/",
    123,
  ]) {
    await expect(
      openSignInBrowser({
        executablePath: exe,
        url: bad,
        profileDir: join(dir, "profile"),
        purpose: "account",
      }),
    ).rejects.toMatchObject({ code: "invalid_url", status: 400 });
    await expect(
      launchSignInBrowser({
        executablePath: exe,
        url: bad,
        profileDir: join(dir, "profile"),
        purpose: "account",
      }),
    ).rejects.toMatchObject({ code: "invalid_url", status: 400 });
  }
});

test("launchSignInBrowser forwards purpose='account' and normalized about:blank over stdin", async () => {
  const dir = await tempDir();
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const captured = {};
  const handle = await launchSignInBrowser({
    executablePath: exe,
    url: "",
    profileDir: join(dir, "profile"),
    identity: { tag: "pin" },
    purpose: "account",
    deps: { fork: captureFork(captured) },
  });
  expect(captured.payload.purpose).toBe("account");
  expect(captured.payload.url).toBe("about:blank");
  await handle.close();

  // Default signin launch keeps purpose="signin".
  const signInCaptured = {};
  const signInHandle = await launchSignInBrowser({
    executablePath: exe,
    url: "https://x/signin",
    profileDir: join(dir, "signin-profile"),
    identity: { tag: "pin" },
    deps: { fork: captureFork(signInCaptured) },
  });
  expect(signInCaptured.payload.purpose).toBe("signin");
  await signInHandle.close();

  // Host launch timeout in account mode uses neutral wording.
  const silentChild = new EventEmitter();
  silentChild.pid = 77;
  silentChild.kill = () => {};
  silentChild.send = () => {};
  silentChild.unref = () => {};
  silentChild.channel = { unref: () => {} };
  let timeoutErr;
  try {
    await launchSignInBrowser({
      executablePath: exe,
      url: "about:blank",
      profileDir: join(dir, "timeout-profile"),
      purpose: "account",
      timeoutMs: 25,
      deps: { fork: () => silentChild },
    });
  } catch (caught) {
    timeoutErr = caught;
  }
  expect(timeoutErr).toBeInstanceOf(SignInBrowserError);
  expect(timeoutErr.code).toBe("launch_timeout");
  expect(timeoutErr.status).toBe(504);
  expect(timeoutErr.message).toContain("account browser");
  expect(timeoutErr.message.toLowerCase()).not.toContain("sign-in");
  expect(timeoutErr.message.toLowerCase()).not.toContain("login browser");
});

test("purpose='account' omits local paths and raw error details from executable, runtime, and launch errors", async () => {
  const dir = await tempDir();
  const missingExe = join(dir, "missing-camoufox-secret-path.exe");
  const profileDir = join(dir, "secret-profile-dir");

  // 1. assertExecutable omits executablePath when purpose="account".
  let exeErr;
  try {
    await launchSignInBrowser({
      executablePath: missingExe,
      url: "about:blank",
      profileDir,
      purpose: "account",
      deps: {
        checkExecutable: async () => false,
        fork: () => {
          throw new Error("must not fork");
        },
      },
    });
  } catch (caught) {
    exeErr = caught;
  }
  expect(exeErr).toBeInstanceOf(SignInBrowserError);
  expect(exeErr.code).toBe("executable_missing");
  expect(exeErr.status).toBe(503);
  expect(exeErr.message).not.toContain(missingExe);
  expect(exeErr.message).not.toContain(dir);

  // Backward compatibility: default signin mode keeps its existing message shape.
  let signinExeErr;
  try {
    await launchSignInBrowser({
      executablePath: missingExe,
      url: "https://x/signin",
      profileDir,
      deps: {
        checkExecutable: async () => false,
        fork: () => {
          throw new Error("must not fork");
        },
      },
    });
  } catch (caught) {
    signinExeErr = caught;
  }
  expect(signinExeErr.message).toContain(missingExe);

  // 2. openSignInBrowser omits raw Playwright/Camoufox errors containing profileDir or proxy credentials.
  let launchErr;
  try {
    await openSignInBrowser({
      executablePath: missingExe,
      url: "about:blank",
      profileDir,
      identity: {},
      purpose: "account",
      deps: {
        checkExecutable: async () => true,
        loadCamoufox: async () => ({
          async launchOptions() {
            return {};
          },
          async NewBrowser() {
            throw new Error(
              `Failed to launch ${missingExe} with user_data_dir=${profileDir} proxy=http://u:pw-secret@1.2.3.4:8080`,
            );
          },
        }),
        loadPlaywright: async () => ({ firefox: {} }),
      },
    });
  } catch (caught) {
    launchErr = caught;
  }
  expect(launchErr).toBeInstanceOf(SignInBrowserError);
  expect(launchErr.code).toBe("launch_failed");
  expect(launchErr.status).toBe(502);
  expect(launchErr.message).not.toContain(missingExe);
  expect(launchErr.message).not.toContain(profileDir);
  expect(launchErr.message).not.toContain("pw-secret");

  // 3. openSignInBrowser omits raw runtime errors in account mode.
  let runtimeErr;
  try {
    await openSignInBrowser({
      executablePath: missingExe,
      url: "about:blank",
      profileDir,
      identity: {},
      purpose: "account",
      deps: {
        checkExecutable: async () => true,
        loadCamoufox: async () => {
          throw new Error(`Cannot load ${dir}/camoufox/index.js`);
        },
      },
    });
  } catch (caught) {
    runtimeErr = caught;
  }
  expect(runtimeErr).toBeInstanceOf(SignInBrowserError);
  expect(runtimeErr.code).toBe("runtime_missing");
  expect(runtimeErr.status).toBe(503);
  expect(runtimeErr.message).not.toContain(dir);

  // 4. launchSignInBrowser strips raw host IPC/error messages in account mode.
  const exe = join(dir, "camoufox.exe");
  await writeFile(exe, "exe");
  const child = new EventEmitter();
  child.pid = 88;
  child.kill = () => {};
  child.send = () => {};
  child.unref = () => {};
  child.channel = { unref: () => {} };
  let hostIpcErr;
  try {
    await launchSignInBrowser({
      executablePath: exe,
      url: "about:blank",
      profileDir,
      purpose: "account",
      deps: {
        fork: () => {
          queueMicrotask(() =>
            child.emit("message", {
              type: "error",
              code: "launch_failed",
              status: 502,
              message: `EACCES mkdir ${profileDir} http://u:pw-ipc@1.2.3.4:8080`,
            }),
          );
          return child;
        },
      },
    });
  } catch (caught) {
    hostIpcErr = caught;
  }
  expect(hostIpcErr).toBeInstanceOf(SignInBrowserError);
  expect(hostIpcErr.code).toBe("launch_failed");
  expect(hostIpcErr.status).toBe(502);
  expect(hostIpcErr.message).not.toContain(profileDir);
  expect(hostIpcErr.message).not.toContain("pw-ipc");
});
