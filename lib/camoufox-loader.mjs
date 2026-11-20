// The single door through which this process imports camoufox.
//
// Why this file exists: camoufox's paths.js computes INSTALL_DIR from
// LOCALAPPDATA (Windows), HOME/Library/Caches (macOS) or XDG_CACHE_HOME
// (Linux) at module-evaluation time and freezes it. A redirect that wraps the
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

import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

// The env keys camoufox reads while computing INSTALL_DIR, per platform. The
// sandbox root must be a directory that already exists or can be created by
// the caller — the loader does not create it.
function cacheRedirect(dir, env, platform) {
  if (platform === "win32") return { key: "LOCALAPPDATA", value: dir };
  if (platform === "darwin") return { key: "HOME", value: dir };
  return { key: "XDG_CACHE_HOME", value: dir };
}

// Point camoufox's cache root at `dir` in `env` for the duration of `work`,
// restoring the previous value afterwards. The redirect only matters on the
// first import; it is kept narrow so other code that reads these variables
// later still sees the real user environment.
export async function withCamoufoxCacheDir(dir, work, { env = process.env, platform = process.platform } = {}) {
  const { key, value } = cacheRedirect(dir, env, platform);
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
