// The single door through which this process imports camoufox.
//
// Why this file exists: camoufox's paths.js computes INSTALL_DIR from
// LOCALAPPDATA (Windows), os.homedir()/Library/Caches (macOS — env-immune)
// or XDG_CACHE_HOME (Linux) at module-evaluation time and freezes it. A redirect that wraps the
// import with a try/finally env restore (the old defaultInstaller) only works
// if the module has not been evaluated yet — any earlier import anywhere
// (the fingerprint loader in account-identity, the browser host in
// browser-launcher, a previous install) freezes INSTALL_DIR forever and the
// redirect silently becomes a no-op, so the browser install lands in the
// user's real shared cache.
//
// Routing every import through `loadCamoufoxSandboxed` makes the first
// evaluation deterministic: the redirect is applied BEFORE the import and the
// cached promise is shared by every caller, so there is exactly one
// INSTALL_DIR and it is always inside the plugin's own browser directory.

import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

// How each platform is steered into the sandbox. camoufox offers NO env var
// for the install root (paths.js picks it at module-eval), so the redirect
// has to hit whatever primitive paths.js reads:
//  - win32: LOCALAPPDATA — honored when absolute; INSTALL_DIR becomes
//    <LOCALAPPDATA>/camoufox/camoufox/Cache, so we pass `dir` itself.
//  - linux: XDG_CACHE_HOME — honored as-is.
//  - darwin: os.homedir() ignores $HOME in Node and Bun alike (getpwuid), so
//    no env redirect exists. Instead the real INSTALL_DIR
//    (~/Library/Caches/camoufox) is made a symlink to <sandbox>/camoufox;
//    a pre-existing real directory is migrated into the sandbox first so its
//    bytes stay reachable through the link.
function cacheRedirect(dir, env, platform) {
  if (platform === "darwin") {
    ensureDarwinInstallSymlink(dir);
    return null; // homedir is unredirectable; the symlink does the work
  }
  if (platform === "win32") return { key: "LOCALAPPDATA", value: dir };
  return { key: "XDG_CACHE_HOME", value: dir };
}

export class CamoufoxSandboxError extends Error {
  constructor(message) {
    super(message);
    this.name = "CamoufoxSandboxError";
  }
}

// ~/Library/Caches/camoufox -> <dir>/camoufox. Runs before camoufox's
// paths.js evaluates, so every write under INSTALL_DIR lands in the plugin
// data dir. A foreign symlink or an unmigratable real directory is reported
// instead of silently writing outside the sandbox.
// Exported for tests — production callers should go through
// loadCamoufoxSandboxed, which invokes this before the first camoufox import.
export function ensureDarwinInstallSymlink(dir, { fs, home } = {}) {
  const fsOps = fs ?? { existsSync, lstatSync, mkdirSync, renameSync, symlinkSync, realpathSync };
  const realInstall = join(home ?? homedir(), "Library", "Caches", "camoufox");
  const sandboxInstall = join(dir, "camoufox");
  const link = () => {
    fsOps.mkdirSync(dirname(realInstall), { recursive: true });
    fsOps.symlinkSync(sandboxInstall, realInstall, "dir");
  };
  try {
    const stat = fsOps.lstatSync(realInstall);
    if (stat.isSymbolicLink()) {
      if (canonical(realInstall) !== canonical(sandboxInstall)) {
        throw new CamoufoxSandboxError(`${realInstall} is a symlink to somewhere else`);
      }
      return;
    }
    // A real directory from a pre-sandbox install: migrate its bytes into the
    // sandbox, then link so other camoufox consumers keep working.
    if (fsOps.existsSync(sandboxInstall)) {
      throw new CamoufoxSandboxError(`${sandboxInstall} already exists; cannot migrate ${realInstall}`);
    }
    fsOps.mkdirSync(dirname(sandboxInstall), { recursive: true });
    fsOps.renameSync(realInstall, sandboxInstall);
    link();
  } catch (error) {
    if (error instanceof CamoufoxSandboxError) throw error;
    if (error?.code === "ENOENT") {
      // Nothing at the real path yet — a (possibly dangling) symlink is
      // enough; INSTALL_DIR resolves through it once the target exists.
      link();
      return;
    }
    throw error;
  }
}

// Point camoufox's cache root at `dir` in `env` for the duration of `work`,
// restoring the previous value afterwards. The redirect only matters on the
// first import; it is kept narrow so other code that reads these variables
// later still sees the real user environment.
export async function withCamoufoxCacheDir(dir, work, { env = process.env, platform = process.platform } = {}) {
  const redirect = cacheRedirect(dir, env, platform);
  if (!redirect) return work(); // darwin: the symlink redirect is already done
  const { key, value } = redirect;
  const previous = env[key];
  env[key] = value;
  try {
    return await work();
  } finally {
    if (previous === undefined) delete env[key];
    else env[key] = previous;
  }
}

let cached = null;

// Import camoufox with its install root pinned inside `dir`. The promise is
// cached: once camoufox has evaluated, the redirect is pointless anyway, so
// every later call hands back the same module. `dir` is the plugin's sandbox
// browser directory (browserEnvironmentRoot).
//
// Note the honest contract: if camoufox was already imported by anything else
// (a stray `import("camoufox")` outside this loader, or a previous call with
// a different dir) the module cache wins and the real INSTALL_DIR is whatever
// it froze to then. `assertInstallDir` exists to catch that loudly.
export function loadCamoufoxSandboxed(dir, { env = process.env, platform = process.platform } = {}) {
  if (!cached) {
    cached = withCamoufoxCacheDir(dir, () => import("camoufox"), { env, platform });
  }
  return cached;
}

// Safety net for the install path: after loading (and after any install that
// was already imported by someone else), verify the directory camoufox will
// actually write to sits inside the sandbox. Callers map a false return to
// EnvironmentError("install_dir_mismatch") — better to refuse than to fill the
// user's real cache with a second browser.
export function camoufoxInstallDir(camoufox) {
  return camoufox?.INSTALL_DIR ?? null;
}

function canonical(path) {
  // The sandbox lives under os.tmpdir(), which macOS symlinks (/var ->
  // /private/var); camoufox resolves INSTALL_DIR through the real path, so
  // the comparison must follow links too. The install dir itself does not
  // exist yet (and on macOS sits several nonexistent levels deep, under
  // Library/Caches), so realpath the deepest ancestor that does exist and
  // reattach the missing tail.
  let candidate = resolve(path);
  const tail = [];
  for (;;) {
    try {
      return join(realpathSync(candidate), ...tail.reverse());
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) return resolve(path);
      tail.push(basename(candidate));
      candidate = parent;
    }
  }
}

export function isInsideSandbox(installDir, sandboxDir) {
  if (!installDir || !sandboxDir) return false;
  const root = canonical(sandboxDir);
  const target = canonical(installDir);
  if (target === root) return true;
  return target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}
