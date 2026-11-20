// H-5: camoufox freezes INSTALL_DIR at module-evaluation time, so the sandbox
// redirect must be in place BEFORE the first import. These tests verify the
// contract both ways: the pure path helper, and a real subprocess whose first
// camoufox import goes through the sandboxed loader (the parent process may
// already have camoufox evaluated, so the load-path proof needs a clean module
// cache).
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CamoufoxSandboxError,
  ensureDarwinInstallSymlink,
  isInsideSandbox,
} from "../lib/camoufox-loader.mjs";

test("isInsideSandbox accepts the sandbox itself and its children only", () => {
  const sandbox = join(tmpdir(), "cl-sandbox-x");
  expect(isInsideSandbox(sandbox, sandbox)).toBe(true);
  expect(isInsideSandbox(join(sandbox, "camoufox"), sandbox)).toBe(true);
  expect(isInsideSandbox(join(sandbox, "camoufox", "bin"), sandbox)).toBe(true);
  expect(isInsideSandbox(`${sandbox}-evil`, sandbox)).toBe(false);
  expect(isInsideSandbox(join(sandbox, "..", "outside"), sandbox)).toBe(false);
  expect(isInsideSandbox(null, sandbox)).toBe(false);
  expect(isInsideSandbox("/anywhere", null)).toBe(false);
});

// A clean Bun process: no test in this file (or a sibling file that Bun may
// run first) can have evaluated camoufox yet. The first import MUST see the
// redirected cache root, so INSTALL_DIR lands inside the sandbox directory.
test("loadCamoufoxSandboxed pins INSTALL_DIR inside the sandbox (fresh process)", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "cl-camoufox-loader-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `import { loadCamoufoxSandboxed } from ${JSON.stringify(join(import.meta.dir, "..", "lib", "camoufox-loader.mjs").replace(/\\\\/g, "/"))};
         const dir = ${JSON.stringify(sandbox.replace(/\\\\/g, "/"))};
         const camoufox = await loadCamoufoxSandboxed(dir);
         console.log(JSON.stringify({ installDir: camoufox.INSTALL_DIR ?? null, homedir: process.env.HOME ?? null }));`,
      ],
      { cwd: join(import.meta.dir, ".."), encoding: "utf8", timeout: 30_000 },
    );
    if (result.error?.code === "ENOENT" || result.status === null && /not found/i.test(result.stderr ?? "")) {
      // camoufox not installed in this environment: skip with a named reason.
      console.log("skip: camoufox package not available in test environment");
      return;
    }
    if (result.status !== 0) {
      console.log(`subprocess failed: ${result.stderr ?? result.stdout}`);
    }
    expect(result.status).toBe(0);
    const { installDir, homedir } = JSON.parse(result.stdout.trim().split("\n").pop());
    if (!isInsideSandbox(installDir, sandbox)) {
      // Diagnose before asserting: which of the two paths escaped the sandbox?
      console.log(`installDir=${installDir} homedir=${homedir} sandbox=${sandbox}`);
    }
    expect(installDir).toBeTruthy();
    expect(isInsideSandbox(installDir, sandbox)).toBe(true);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

// macOS cannot redirect camoufox through env (os.homedir() ignores $HOME), so
// the loader symlinks ~/Library/Caches/camoufox into the sandbox instead.
// These tests drive that helper with an in-memory fs so no real home is ever
// touched, whatever platform CI runs on.
function fakeFs(entries = {}) {
  // entries: path -> "dir" | {link: target} ; anything else throws ENOENT
  const calls = [];
  const enoent = (p) => Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
  return {
    calls,
    lstatSync(p) {
      const e = entries[p];
      if (e === "dir") return { isSymbolicLink: () => false };
      if (e && typeof e === "object" && "link" in e) return { isSymbolicLink: () => true };
      throw enoent(p);
    },
    // existsSync follows symlinks (a dangling link reports false).
    existsSync: (p) => {
      const e = entries[p];
      if (e && typeof e === "object" && "link" in e) return e.link in entries;
      return p in entries;
    },
    rmSync: (p) => calls.push(["rm", p]),
    readlinkSync: (p) => entries[p].link,
    realpathSync: (p) => (entries[p] && entries[p].link) ?? p,
    mkdirSync: (p) => calls.push(["mkdir", p]),
    renameSync: (from, to) => calls.push(["rename", from, to]),
    symlinkSync: (to, at) => calls.push(["symlink", to, at]),
  };
}

const HOME = process.platform === "win32" ? "C:\\home" : "/home/user";
const REAL = join(HOME, "Library", "Caches", "camoufox");
const DIR = process.platform === "win32" ? "C:\\sandbox" : "/sandbox";
const SANDBOX_INSTALL = join(DIR, "camoufox");

test("darwin loader links a fresh cache path into the sandbox", () => {
  const fs = fakeFs();
  ensureDarwinInstallSymlink(DIR, { fs, home: HOME });
  expect(fs.calls).toContainEqual(["symlink", SANDBOX_INSTALL, REAL]);
  expect(fs.calls.filter(([op]) => op === "rename")).toEqual([]);
});

test("darwin loader migrates a pre-existing real install before linking", () => {
  const fs = fakeFs({ [REAL]: "dir" });
  ensureDarwinInstallSymlink(DIR, { fs, home: HOME });
  expect(fs.calls).toContainEqual(["rename", REAL, SANDBOX_INSTALL]);
  expect(fs.calls).toContainEqual(["symlink", SANDBOX_INSTALL, REAL]);
});

test("darwin loader repairs a dangling link it left behind", () => {
  // The plugin data dir was deleted after an earlier run: our symlink now
  // dangles. Relink instead of refusing — the debris is ours.
  const gone = join(HOME, "deleted-plugin-dir");
  const fs = fakeFs({ [REAL]: { link: gone }, [join(DIR, "parent")]: undefined });
  ensureDarwinInstallSymlink(DIR, { fs, home: HOME });
  expect(fs.calls).toContainEqual(["rm", REAL]);
  expect(fs.calls).toContainEqual(["symlink", SANDBOX_INSTALL, REAL]);
});

test("darwin loader refuses a foreign symlink and an occupied sandbox", () => {
  const elsewhere = join(HOME, "elsewhere");
  const foreign = fakeFs({ [REAL]: { link: elsewhere }, [elsewhere]: "dir" });
  expect(() => ensureDarwinInstallSymlink(DIR, { fs: foreign, home: HOME })).toThrow(CamoufoxSandboxError);

  // real dir exists AND the sandbox target is already occupied: no rename.
  const occupied = fakeFs({ [REAL]: "dir", [SANDBOX_INSTALL]: "dir" });
  expect(() => ensureDarwinInstallSymlink(DIR, { fs: occupied, home: HOME })).toThrow(CamoufoxSandboxError);
  expect(occupied.calls.filter(([op]) => op === "rename" || op === "symlink")).toEqual([]);
});
