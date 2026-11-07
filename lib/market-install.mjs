import { spawn as spawnChild } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMarketCatalog } from "./magpie-catalog.mjs";
import { magpieCli } from "./native-signin.mjs";
import { magpieConfigDir } from "./paths.mjs";

// Installing one of magpie's market plugins from this page.
//
// The page cannot do it itself. magpie's own install route is `POST
// /api/plugins/add`, and every `/api/` request a sandboxed plugin frame sends
// is turned away (`noFramedAPI`, plus `connect-src 'none'` in the frame
// policy). magpie's command line is the door that is open, and it is the same
// door magpie's own market page uses underneath: `magpie plugin add <spec>`.
//
// Two things shape the rest of this file:
//
//   * A successful install restarts magpie's plugin host — the process this
//     service runs in. The child is therefore detached: it finishes the
//     install whether or not we are still alive to watch it, and the outcome
//     is written to a state file that survives the restart.
//   * Only packages magpie's own market lists are ever installed. The card's
//     package name comes from the page, so without that check this route would
//     be a way to run `magpie plugin add <anything>` on the user's machine.

export const INSTALL_STATE_FILE = "market-install.json";
export const INSTALL_LOG_FILE = "market-install.log";
const LOG_TAIL_CHARS = 400;
// magpie's own install budget is five minutes (`plugins.go`); a state file
// left "running" past that means the process died without saying so.
const RUNNING_STALE_MS = 6 * 60 * 1000;

export class MarketInstallError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = "MarketInstallError";
    this.code = code;
    this.status = status;
  }
}

// `@scope/name@1.2.3` and `name@latest` both reduce to the package name. The
// scope's own `@` sits at index 0 and is never the split point.
export function packageName(spec) {
  const value = typeof spec === "string" ? spec.trim() : "";
  if (!value) return "";
  const at = value.lastIndexOf("@");
  return at > 0 ? value.slice(0, at) : value;
}

// Every package magpie's market lists, as the allowlist for `start`.
export function marketPackageSet(env = process.env) {
  const catalog = readMarketCatalog(env);
  const set = new Set();
  for (const plugin of catalog.plugins || []) {
    const name = packageName(plugin.package);
    if (name) set.add(name);
  }
  return set;
}

// The packages magpie has installed, from its own registry
// (`<config>/plugins.json`). A missing or unreadable file is an empty set, not
// an error: it only ever widens what we are willing to install.
export function readInstalledPackages(env = process.env) {
  const set = new Set();
  try {
    const file = join(magpieConfigDir(env), "plugins.json");
    if (!existsSync(file)) return set;
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const rows = doc && Array.isArray(doc.plugins) ? doc.plugins : [];
    for (const row of rows) {
      const name = packageName(row && row.spec);
      if (name) set.add(name);
    }
  } catch {
    return set;
  }
  return set;
}

function logTail(file) {
  try {
    if (!existsSync(file)) return "";
    const text = readFileSync(file, "utf8");
    // One run is a real command line with one result, so the note reads like
    // what failed; our own run headers are for the log file, not the card.
    const lines = text
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("--- "));
    return lines.slice(-3).join(" / ").slice(-LOG_TAIL_CHARS);
  } catch {
    return "";
  }
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return error && error.code === "EPERM";
  }
}

// `spawn`, `now`, `cli` and the file readers are injectable so the tests never
// start a real magpie and never write outside a temp directory.
export function createMarketInstaller({
  env = process.env,
  dataDir,
  cli = magpieCli(env),
  spawn = spawnChild,
  now = Date.now,
  isInstalled = (name) => readInstalledPackages(env).has(name),
  isAlive = alive,
  allowedPackages = () => marketPackageSet(env),
  logFile = join(dataDir, INSTALL_LOG_FILE),
  stateFile = join(dataDir, INSTALL_STATE_FILE),
} = {}) {
  function readState() {
    try {
      if (!existsSync(stateFile)) return null;
      return JSON.parse(readFileSync(stateFile, "utf8"));
    } catch {
      return null;
    }
  }

  function writeState(state) {
    try {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(stateFile, JSON.stringify(state));
    } catch {
      // A state we cannot persist still answers this request; it only costs
      // the honest "running" note after a host restart.
    }
    return state;
  }

  // The state file is the truth: a restarted service (or a reloaded page)
  // reads it instead of remembering anything in memory.
  function read() {
    const state = readState();
    if (!state || state.state !== "running") return state;
    if (isInstalled(state.package)) {
      return writeState({ ...state, state: "done", finishedAt: now(), pid: null });
    }
    if (isAlive(state.pid) && now() - (state.startedAt || 0) < RUNNING_STALE_MS) return state;
    return writeState({
      ...state,
      state: "failed",
      finishedAt: now(),
      pid: null,
      reason: isAlive(state.pid) ? "timeout" : "exited",
      logTail: logTail(logFile),
    });
  }

  function start(spec) {
    const name = packageName(spec);
    if (!name || !allowedPackages().has(name)) {
      throw new MarketInstallError(
        "not_in_market",
        "This package is not one magpie's market lists, so it will not be installed.",
        400,
      );
    }
    const current = read();
    if (current && current.package === name && current.state === "running") {
      throw new MarketInstallError("busy", "That plugin is already being installed.", 409);
    }
    if (isInstalled(name)) {
      return writeState({ package: name, state: "done", startedAt: now(), finishedAt: now(), pid: null, alreadyInstalled: true });
    }
    try {
      mkdirSync(dataDir, { recursive: true });
    } catch {
      throw new MarketInstallError("no_state_dir", "The plugin's data folder could not be created.", 500);
    }
    let fd;
    try {
      fd = openSync(logFile, "a");
    } catch {
      throw new MarketInstallError("no_log", "The install log could not be opened.", 500);
    }
    const startedAt = now();
    try {
      appendFileSync(logFile, `\n--- ${new Date(startedAt).toISOString()} plugin add ${name} ---\n`);
      const child = spawn(cli, ["plugin", "add", name], {
        detached: true,
        stdio: ["ignore", fd, fd],
        windowsHide: true,
        env,
      });
      // The child outlives this process on purpose: installing restarts the
      // plugin host, which is where this service lives.
      child.unref();
      return writeState({ package: name, state: "running", startedAt, finishedAt: null, pid: child.pid || null, cli, logTail: "" });
    } catch (error) {
      throw new MarketInstallError(
        "spawn_failed",
        `magpie could not be started (${error && error.message ? error.message : "unknown error"}).`,
        500,
      );
    } finally {
      try {
        closeSync(fd);
      } catch {
        // The handle closes with the process anyway.
      }
    }
  }

  return { start, read, stateFile, logFile };
}
